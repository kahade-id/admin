/**
 * Kahade Admin Web — HTTP client (§admin).
 *
 * 03-#10: access token disimpan di MEMORI modul (bukan localStorage).
 * - refresh lewat `POST /v1/admin/auth/refresh` (cookie HttpOnly admin,
 *   `credentials: "include"`) — logika sama: 401 → refresh sekali →
 *   ulangi request; gagal → lempar `AdminAuthError`
 * - `ensureAdminSession()` dipanggil saat boot untuk memulihkan sesi via
 *   refresh cookie bila token memori kosong (mis. setelah reload).
 * - dukungan header `Idempotency-Key` per-request untuk endpoint
 *   idempoten (approve/reject withdrawal, force-cancel/force-complete order)
 *
 * Kontrak yang dipakai modul `src/lib/api/admin/*`:
 *   import { adminHttp } from "@/lib/api/admin-client"
 *   const data = await adminHttp.get<AdminUserList>("/v1/admin/users", { query: { q } })
 */
"use client"

import { API_BASE_URL } from "@/lib/api/config"
import { unwrapResponse } from "@/lib/api/response"
import { errorCopyForCode } from "@/lib/api/error-catalog"

const ADMIN_TOKEN_KEY = "kahade.admin.accessToken"

/**
 * 03-#10/AW-017: access token disimpan di MEMORI modul (bukan localStorage).
 * localStorage persisten dan dapat dibaca oleh skrip XSS; token di memori
 * hilang saat reload — sesi dipulihkan via refresh cookie HttpOnly
 * (POST /v1/admin/auth/refresh, `credentials: "include"`).
 */

/** Dilempar saat sesi admin tidak valid / kedaluwarsa dan refresh gagal. */
export class AdminAuthError extends Error {
  constructor(message = "Sesi Anda telah berakhir. Silakan masuk kembali.") {
    super(message)
    this.name = "AdminAuthError"
  }
}

/** Token hanya di memori — tidak pernah ditulis ke storage persisten. */
let inMemoryAccessToken: string | null = null

export function getAdminAccessToken(): string | null {
  return inMemoryAccessToken
}

export function setAdminAccessToken(token: string): void {
  inMemoryAccessToken = token
}

export function clearAdminAccessToken(): void {
  inMemoryAccessToken = null
  // Hapus sisa token lama bila pernah tersimpan di localStorage
  // (migrasi dari perilaku sebelum 03-#10).
  try {
    if (typeof window !== "undefined") {
      window.localStorage.removeItem("kahade.admin.accessToken")
    }
  } catch {
    /* abaikan */
  }
}

/**
 * 03-#10: pulihkan sesi saat boot — coba refresh via HttpOnly cookie.
 * Kembalikan true bila sesi aktif (token di memori), false bila harus login.
 */
export async function ensureAdminSession(): Promise<boolean> {
  if (inMemoryAccessToken) return true
  const token = await refreshAdminToken()
  return token !== null
}

/**
 * ADM-06 (audit etalase 2026-10-10): bentuk error yang dilempar `request()`
 * untuk respons non-2xx. `code`/`fields`/`data` dibaca dari envelope backend
 * `{ success:false, message, errors:{ code, message, fields?, data?, retryAfter? } }`
 * (HttpExceptionFilter) — sebelumnya hanya `code` level atas yang dibaca
 * sehingga `err.code` SELALU kosong dan semua branching UI berbasis kode mati.
 */
export type AdminHttpError = Error & {
  status?: number
  code?: string
  retryAfter?: number
  /** Error validasi per-field dari backend (errors.fields), bila ada. */
  fields?: Record<string, unknown>
  /** Data tambahan dari backend (errors.data), mis. state server pada 409. */
  data?: Record<string, unknown>
}

function asObject(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function pickString(value: unknown): string | undefined {
  return typeof value === "string" && value ? value : undefined
}

/**
 * ADM-16: `fetch` yang reject = request TIDAK sampai ke server (offline, DNS,
 * CORS, server mati). Sebelumnya "TypeError: Failed to fetch" (Inggris, mentah)
 * sampai ke operator. AbortError diteruskan apa adanya (pembatalan disengaja).
 */
export const NETWORK_ERROR_MESSAGE =
  "Tidak dapat terhubung ke server Kahade. Periksa koneksi internet lalu coba lagi."

type AdminHttpOptions = {
  query?: Record<string, string | number | boolean | undefined | null>
  body?: unknown
  signal?: AbortSignal
  /**
   * Header tambahan per-request. Dipakai endpoint idempoten admin
   * (approve/reject withdrawal, force-cancel/force-complete order) yang
   * mewajibkan `Idempotency-Key: <UUID v4>` — tanpa header ini backend
   * menolak dengan 400 IDEMPOTENCY_KEY_REQUIRED.
   */
  headers?: Record<string, string>
}

let refreshInFlight: Promise<string | null> | null = null

async function refreshAdminToken(): Promise<string | null> {
  if (!refreshInFlight) {
    refreshInFlight = (async () => {
      try {
        const res = await fetch(`${API_BASE_URL}/v1/admin/auth/refresh`, {
          method: "POST",
          headers: { Accept: "application/json", "Content-Type": "application/json" },
          credentials: "include",
        })
        if (!res.ok) return null
        const json = (await res.json().catch(() => null)) as {
          accessToken?: string
          data?: { accessToken?: string }
        } | null
        const token = json?.accessToken ?? json?.data?.accessToken ?? null
        if (token) setAdminAccessToken(token)
        return token
      } catch {
        return null
      } finally {
        refreshInFlight = null
      }
    })()
  }
  return refreshInFlight
}

/**
 * BAI-034 (audit integrasi 2026-09-30) — kontrak serialisasi boolean query:
 * boolean diserialisasi menjadi string "true"/"false" (standar URLSearchParams).
 * Backend WAJIB mem-parse-nya secara ketat (Transform "true"→true,
 * "false"→false + @IsBoolean) — JANGAN pakai `@Type(() => Boolean)` di DTO
 * karena `Boolean("false") === true` sehingga `?flag=false` terfilter SEOLAH
 * true. DTO yang sudah diperbaiki: ModerationQueueQueryDto.overdueOnly,
 * QaModerationQueueQueryDto.{reportedOnly,hiddenOnly,spamOnly},
 * AdminBannerListQueryDto.isActive.
 */
function buildUrl(path: string, query?: AdminHttpOptions["query"]): string {
  const url = new URL(`${API_BASE_URL}${path}`)
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, String(v))
    }
  }
  return url.toString()
}

async function request<T>(
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE",
  path: string,
  opts: AdminHttpOptions = {},
  retried = false,
): Promise<T> {
  const token = getAdminAccessToken()
  const headers: Record<string, string> = {
    Accept: "application/json",
    ...(opts.body !== undefined ? { "Content-Type": "application/json" } : {}),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(opts.headers ?? {}),
  }
  // G478: correlation ID end-to-end (tidak menimpa bila pemanggil sudah menyetel).
  if (!Object.keys(headers).some((name) => name.toLowerCase() === "x-request-id")) {
    headers["X-Request-Id"] =
      typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
        ? crypto.randomUUID()
        : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
  }
  let res: Response
  try {
    res = await fetch(buildUrl(path, opts.query), {
      method,
      headers,
      credentials: "include",
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      signal: opts.signal,
    })
  } catch (e) {
    if ((e as { name?: string } | null)?.name === "AbortError") throw e
    const netErr = new Error(NETWORK_ERROR_MESSAGE) as AdminHttpError
    netErr.name = "AdminNetworkError"
    netErr.status = 0
    netErr.code = "NETWORK_ERROR"
    throw netErr
  }

  if (res.status === 401 && !retried) {
    const fresh = await refreshAdminToken()
    if (fresh) return request<T>(method, path, opts, true)
    throw new AdminAuthError()
  }

  if (!res.ok) {
    const err = asObject(await res.json().catch(() => null))
    // ADM-06: envelope HttpExceptionFilter backend → errors.{code,message,fields,data}.
    // Level atas (code/message/error) tetap dibaca sebagai fallback.
    const envelope = asObject(err?.errors)
    const code = pickString(err?.code) ?? pickString(envelope?.code)
    const message =
      pickString(envelope?.message) ?? pickString(err?.message) ?? pickString(err?.error)
    // SYS-A-001: kode kritis dipetakan ke copy spesifik (jangan mentah).
    // `code` mentah tetap dipertahankan untuk branching UI.
    const specificCopy = errorCopyForCode(code)
    const apiErr = new Error(specificCopy ?? message ?? `Admin API ${res.status}`) as AdminHttpError
    apiErr.status = res.status
    // AUT-003: kode error backend (mis. CAPTCHA_REQUIRED) agar UI bisa
    // bereaksi spesifik — sebelumnya code dibuang dan UI buta.
    if (code) apiErr.code = code
    const fields = asObject(envelope?.fields)
    if (fields) apiErr.fields = fields
    const data = asObject(envelope?.data)
    if (data) apiErr.data = data
    // ADM-426: durasi tunggu (detik) dari header Retry-After / body 429.
    const headerRetryAfter = Number(res.headers.get("Retry-After"))
    const bodyRetryAfter = Number(err?.retryAfter ?? envelope?.retryAfter)
    const retryAfter = Number.isFinite(headerRetryAfter) && headerRetryAfter > 0
      ? headerRetryAfter
      : Number.isFinite(bodyRetryAfter) && bodyRetryAfter > 0
        ? bodyRetryAfter
        : undefined
    if (retryAfter !== undefined) apiErr.retryAfter = retryAfter
    throw apiErr
  }

  if (res.status === 204) return undefined as T
  const json = await res.json().catch(() => null)
  return unwrapResponse(json) as T
}

async function adminGet<T>(path: string, opts: AdminHttpOptions = {}): Promise<T> {
  return request<T>("GET", path, opts)
}

async function adminPost<T>(
  path: string,
  body?: unknown,
  opts: AdminHttpOptions = {},
): Promise<T> {
  return request<T>("POST", path, { ...opts, body })
}

async function adminPut<T>(
  path: string,
  body?: unknown,
  opts: AdminHttpOptions = {},
): Promise<T> {
  return request<T>("PUT", path, { ...opts, body })
}

async function adminPatch<T>(
  path: string,
  body?: unknown,
  opts: AdminHttpOptions = {},
): Promise<T> {
  return request<T>("PATCH", path, { ...opts, body })
}

async function adminDelete<T>(path: string, opts: AdminHttpOptions = {}): Promise<T> {
  return request<T>("DELETE", path, opts)
}

export const adminHttp = {
  get: adminGet,
  post: adminPost,
  put: adminPut,
  patch: adminPatch,
  delete: adminDelete,
}
