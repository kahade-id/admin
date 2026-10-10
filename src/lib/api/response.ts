/**
 * Kahade Admin Web — response helpers (port ringkas dari frontend).
 *
 * `unwrapResponse` mempertahankan kontrak backend: envelope
 * `{success, data, message?}` di-unwrap; `success:false` dilempar
 * sebagai `ApiError`; envelope murni `{data, message?}` tanpa `success`
 * ikut di-unwrap.
 */
import { errorCopyForCode } from "@/lib/api/error-catalog"

/** Error API dengan info yang cukup untuk ditampilkan ke admin. */
export class ApiError extends Error {
  readonly code: string
  readonly status?: number
  readonly backendCode?: string
  readonly validationMessages?: string[]

  constructor(opts: {
    code?: string
    message?: string
    status?: number
    backendCode?: string
    validationMessages?: string[]
  }) {
    super(opts.message ?? "Terjadi kesalahan.")
    this.name = "ApiError"
    this.code = opts.code ?? "UNKNOWN"
    this.status = opts.status
    this.backendCode = opts.backendCode
    this.validationMessages = opts.validationMessages
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function messageOf(body: Record<string, unknown>): string {
  const m = body.message
  return typeof m === "string" && m ? m : "Permintaan gagal."
}

export function unwrapResponse(value: unknown): unknown {
  const body = asRecord(value)
  if (!body || typeof body.success !== "boolean") {
    if (
      body &&
      "data" in body &&
      Object.keys(body).every((k) => k === "data" || k === "message")
    ) {
      return body.data
    }
    return value
  }
  if (!body.success) {
    const backendCode =
      typeof body.code === "string"
        ? body.code
        : typeof body.errorCode === "string"
          ? body.errorCode
          : undefined
    throw new ApiError({ code: backendCode ?? "BAD_REQUEST", message: messageOf(body), backendCode })
  }
  if (!("data" in body)) return value
  return body.data ?? (typeof body.message === "string" ? { message: body.message } : null)
}

/**
 * ADM-06 (audit etalase 2026-10-10): kode error backend dari error apa pun —
 * `ApiError` (unwrapResponse) maupun error `adminHttp` (status !ok) yang
 * membawa `code` dari envelope `errors.code`. Dipakai UI untuk branching
 * (mis. REPORT_ALREADY_RESOLVED → muat ulang, SHOWCASE_COMMENT_NOT_FOUND).
 */
export function errorCode(err: unknown): string | undefined {
  if (err instanceof ApiError) return err.backendCode ?? err.code
  if (typeof err === "object" && err !== null) {
    const c = (err as { code?: unknown }).code
    if (typeof c === "string" && c) return c
  }
  return undefined
}

/** Ambil pesan yang layak tampil dari error tak dikenal. */
export function userMessage(err: unknown): string {
  if (err instanceof ApiError) {
    // SYS-A-001: kode backend kritis → copy spesifik (jangan mentah).
    const specific = errorCopyForCode(err.backendCode ?? err.code)
    if (specific) return specific
    return err.message
  }
  if (err instanceof Error && err.message) return err.message
  return "Terjadi kesalahan tak terduga."
}
