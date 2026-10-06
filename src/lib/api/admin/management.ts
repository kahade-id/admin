/** Kahade admin — manajemen akun admin (tim). */
import { adminHttp, getAdminAccessToken, AdminAuthError } from "@/lib/api/admin-client"
import { API_BASE_URL } from "@/lib/api/config"
import { STEP_UP_HEADER } from "@/lib/api/admin/step-up"
import type { Paginated } from "@/lib/api/admin/kyc"

/**
 * UUID v4 untuk `Idempotency-Key`. Backend mewajibkan header ini pada semua
 * endpoint mutasi (`@Idempotency()`): create, update, delete, reset-2fa,
 * unlock — tanpa header, backend menolak dengan 400 IDEMPOTENCY_KEY_REQUIRED.
 * Pola sama seperti `src/lib/api/admin/finance.ts`.
 */
function newIdempotencyKey(): string {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = Math.floor(Math.random() * 16)
    const v = c === "x" ? r : (r & 0x3) | 0x8
    return v.toString(16)
  })
}

const idempotencyHeaders = (): Record<string, string> => ({
  "Idempotency-Key": newIdempotencyKey(),
})

/**
 * BAD-028: opsi umum aksi identitas kritis — alasan audit + token step-up.
 * `reason` WAJIB (min 5 karakter; divalidasi di UI dengan pesan Indonesia,
 * divalidasi ulang backend) dan dicatat di audit log.
 */
export type CriticalActionOpts = {
  /** Alasan aksi — wajib, min 5 karakter. */
  reason: string
  /**
   * BAD-009: token step-up sekali pakai dari POST /v1/admin/auth/step-up,
   * terikat aksi+target. Dikirim via header `X-Step-Up-Token`; server
   * menolak 403 bila absen (fail-closed).
   */
  stepUpToken?: string
}

/** Header aksi kritis: idempotency + token step-up (bila ada). */
function criticalActionHeaders(stepUpToken?: string): Record<string, string> {
  return {
    ...idempotencyHeaders(),
    ...(stepUpToken ? { [STEP_UP_HEADER]: stepUpToken } : {}),
  }
}

/**
 * Body `{ reason }` — defensif: JANGAN kirim bila reason kosong (backend
 * lama yang belum punya DTO alasan mengabaikan body; body kosong tidak
 * merusak).
 */
function reasonBody(reason: string): { reason: string } | undefined {
  const r = reason.trim()
  return r ? { reason: r } : undefined
}

/**
 * Nilai enum AdminRole di backend (prisma):
 * SUPER_ADMIN, DISPUTE_ADMIN, KYC_ADMIN, FINANCE_ADMIN, CUSTOMER_SUPPORT.
 */
export type AdminRole =
  | "SUPER_ADMIN"
  | "DISPUTE_ADMIN"
  | "KYC_ADMIN"
  | "FINANCE_ADMIN"
  | "CUSTOMER_SUPPORT"

export const ADMIN_ROLES: readonly AdminRole[] = [
  "SUPER_ADMIN",
  "DISPUTE_ADMIN",
  "KYC_ADMIN",
  "FINANCE_ADMIN",
  "CUSTOMER_SUPPORT",
] as const

export interface AdminUserItem {
  id: string
  adminId?: string
  fullName: string
  email: string
  role: AdminRole
  isActive: boolean
  isMfaEnabled?: boolean
  lockedUntil?: string | null
  lastLoginAt?: string | null
  lastLoginIp?: string | null
  createdBy?: string | null
  createdAt: string
  updatedAt?: string
}

export interface CreateAdminInput {
  fullName: string
  email: string
  /** min 12 karakter, mengandung huruf besar, huruf kecil, angka, karakter khusus. */
  password: string
  role: AdminRole
}

export interface UpdateAdminInput {
  fullName?: string
  role?: AdminRole
  isActive?: boolean
}

/** GET /v1/admin/management — daftar akun admin. */
export function listAdmins(params?: {
  page?: number
  limit?: number
  search?: string
}): Promise<Paginated<AdminUserItem>> {
  return adminHttp.get<Paginated<AdminUserItem>>("/v1/admin/management", {
    query: params,
  })
}

/** POST /v1/admin/management — buat akun admin baru. */
export function createAdmin(input: CreateAdminInput): Promise<AdminUserItem> {
  return adminHttp.post<AdminUserItem>("/v1/admin/management", input, {
    headers: idempotencyHeaders(),
  })
}

/** GET /v1/admin/management/:id — detail akun admin. */
export function getAdmin(id: string): Promise<AdminUserItem> {
  return adminHttp.get<AdminUserItem>(
    `/v1/admin/management/${encodeURIComponent(id)}`,
  )
}

/** PUT /v1/admin/management/:id — ubah akun admin (nama, peran, status aktif). */
export function updateAdmin(
  id: string,
  input: UpdateAdminInput,
  opts: { stepUpToken?: string } = {},
): Promise<AdminUserItem> {
  return adminHttp.put<AdminUserItem>(
    `/v1/admin/management/${encodeURIComponent(id)}`,
    input,
    { headers: criticalActionHeaders(opts.stepUpToken) },
  )
}

/**
 * DELETE /v1/admin/management/:id — soft-delete akun admin.
 *
 * BAD-009/BAD-028: wajib `reason` (min 5 karakter, dicatat di audit) dan
 * token step-up per aksi (`admin.delete`) via header `X-Step-Up-Token`.
 */
export function deleteAdmin(
  id: string,
  opts: CriticalActionOpts,
): Promise<{ message: string }> {
  return adminHttp.delete<{ message: string }>(
    `/v1/admin/management/${encodeURIComponent(id)}`,
    {
      headers: criticalActionHeaders(opts.stepUpToken),
      body: reasonBody(opts.reason),
    },
  )
}

/**
 * POST /v1/admin/management/:id/reset-2fa — reset 2FA akun admin.
 *
 * BAD-009/BAD-028: wajib `reason` dan token step-up (`admin.reset-2fa`).
 */
export function resetAdmin2fa(
  id: string,
  opts: CriticalActionOpts,
): Promise<{ message: string }> {
  return adminHttp.post<{ message: string }>(
    `/v1/admin/management/${encodeURIComponent(id)}/reset-2fa`,
    reasonBody(opts.reason),
    { headers: criticalActionHeaders(opts.stepUpToken) },
  )
}

/**
 * POST /v1/admin/management/:id/unlock — buka akun admin yang terkunci.
 *
 * BAD-009/BAD-028: wajib `reason` dan token step-up (`admin.unlock`).
 */
export function unlockAdmin(
  id: string,
  opts: CriticalActionOpts,
): Promise<{ message: string }> {
  return adminHttp.post<{ message: string }>(
    `/v1/admin/management/${encodeURIComponent(id)}/unlock`,
    reasonBody(opts.reason),
    { headers: criticalActionHeaders(opts.stepUpToken) },
  )
}

/* ---------------------------------------------------------------------- */
/* E5a — sesi, suspend, role, review akses, akses darurat, handoff,       */
/* log aktivitas admin (grup E, audit 2026-09-26)                          */
/*                                                                        */
/* KONTRAK ASUMSI: worker backend paralel sedang membangun endpoint       */
/* di bawah (brief G376–G400). Path & shape didefinisikan bersama;        */
/* verifikasi akhir setelah backend selesai. Fungsi lama TIDAK diubah.    */
/* ---------------------------------------------------------------------- */

/** Sesi login akun admin. */
export type AdminManagementSession = {
  id: string
  deviceInfo: string | null
  ipAddress: string | null
  lastActiveAt: string
  expiresAt: string
  createdAt: string
  /** true bila ini sesi yang sedang dipakai admin ini. */
  isCurrent?: boolean | null
  /**
   * P1-26 (audit integrasi 2026-10-06): kunci backend aktual.
   * Backend kirim {id,ipAddress,userAgent,createdAt,lastSeenAt,revokedAt}.
   */
  userAgent?: string | null
  lastSeenAt?: string | null
  revokedAt?: string | null
}

/** GET /v1/admin/management/:id/sessions — sesi aktif akun admin. */
export async function listAdminSessions(
  id: string,
  opts: { page?: number; limit?: number } = {},
): Promise<Paginated<AdminManagementSession>> {
  // P1-26: backend kembalikan {data,total} (bukan paginated penuh) dengan
  // kunci berbeda — normalisasi ke bentuk UI.
  const raw = await adminHttp.get<{ data?: unknown[]; total?: number }>(
    `/v1/admin/management/${encodeURIComponent(id)}/sessions`,
    { query: opts },
  )
  const rows = Array.isArray(raw?.data) ? raw.data : []
  const data: AdminManagementSession[] = rows.map((r) => {
    const s = (r ?? {}) as Record<string, unknown>
    return {
      id: String(s.id ?? ""),
      deviceInfo: (s.deviceInfo as string | null) ?? (s.userAgent as string | null) ?? null,
      ipAddress: (s.ipAddress as string | null) ?? null,
      lastActiveAt: String(s.lastActiveAt ?? s.lastSeenAt ?? s.createdAt ?? ""),
      expiresAt: String(s.expiresAt ?? ""),
      createdAt: String(s.createdAt ?? ""),
      isCurrent: (s.isCurrent as boolean | null) ?? null,
      userAgent: (s.userAgent as string | null) ?? null,
      lastSeenAt: (s.lastSeenAt as string | null) ?? null,
      revokedAt: (s.revokedAt as string | null) ?? null,
    }
  })
  return {
    data,
    total: typeof raw?.total === "number" ? raw.total : data.length,
    page: opts.page ?? 1,
    limit: opts.limit ?? data.length,
    totalPages: 1,
  } as Paginated<AdminManagementSession>
}

/** DELETE /v1/admin/management/:id/sessions/:sessionId — cabut satu sesi. */
export function revokeAdminSession(
  id: string,
  sessionId: string,
): Promise<{ message: string }> {
  return adminHttp.delete<{ message: string }>(
    `/v1/admin/management/${encodeURIComponent(id)}/sessions/${encodeURIComponent(sessionId)}`,
    { headers: idempotencyHeaders() },
  )
}

/**
 * POST /v1/admin/management/:id/suspend { reason } — tangguhkan akun admin.
 * `reason` wajib (min 5 karakter, divalidasi backend).
 */
export function suspendAdmin(id: string, reason: string): Promise<AdminUserItem> {
  return adminHttp.post<AdminUserItem>(
    `/v1/admin/management/${encodeURIComponent(id)}/suspend`,
    { reason },
    { headers: idempotencyHeaders() },
  )
}

/**
 * POST /v1/admin/management/:id/reactivate { reason } — aktifkan kembali
 * akun admin yang ditangguhkan. `reason` wajib.
 */
export function reactivateAdmin(id: string, reason: string): Promise<AdminUserItem> {
  return adminHttp.post<AdminUserItem>(
    `/v1/admin/management/${encodeURIComponent(id)}/reactivate`,
    { reason },
    { headers: idempotencyHeaders() },
  )
}

/**
 * PATCH /v1/admin/management/:id/role { role, reason } — ubah role akun
 * admin dengan alasan wajib (dicatat di audit).
 */
export function changeAdminRole(
  id: string,
  input: { role: AdminRole; reason: string },
): Promise<AdminUserItem> {
  return adminHttp.patch<AdminUserItem>(
    `/v1/admin/management/${encodeURIComponent(id)}/role`,
    input,
    { headers: idempotencyHeaders() },
  )
}

/** Satu entri histori perubahan hak akun admin (dari jejak audit backend). */
export type AdminRightsChangeEntry = {
  id: string
  action: string
  description: string | null
  ipAddress: string | null
  createdAt: string
}

/**
 * GET /v1/admin/management/:id/audit-log — histori perubahan hak
 * (role, suspend, revoke, dsb.) untuk akun admin.
 */
export function getAdminAuditLog(
  id: string,
  opts: { page?: number; limit?: number } = {},
): Promise<Paginated<AdminRightsChangeEntry>> {
  return adminHttp.get<Paginated<AdminRightsChangeEntry>>(
    `/v1/admin/management/${encodeURIComponent(id)}/audit-log`,
    { query: opts },
  )
}

/* ------------------------- Akses darurat ------------------------- */

/** Scope hak yang diberikan sementara oleh emergency grant. */
export type EmergencyGrantScope = string

export type EmergencyGrant = {
  id: string
  adminId: string
  /** Nama admin penerima grant (denormalisasi backend). */
  adminName: string | null
  grantedBy: string | null
  grantedByName: string | null
  reason: string
  scope: EmergencyGrantScope
  /** TTL maks 120 menit — divalidasi backend. */
  durationMinutes: number
  expiresAt: string
  createdAt: string
  revokedAt: string | null
  isActive: boolean
}

export type CreateEmergencyGrantInput = {
  adminId: string
  reason: string
  scope: EmergencyGrantScope
  /** 1–120 menit. */
  durationMinutes: number
}

/** GET /v1/admin/emergency-grants — daftar grant akses darurat. */
export async function listEmergencyGrants(opts: { activeOnly?: boolean } = {}): Promise<EmergencyGrant[]> {
  const res = await adminHttp.get<{ data: unknown[] } | unknown[]>(
    "/v1/admin/emergency-grants",
    { query: { activeOnly: opts.activeOnly ?? true } },
  )
  const raw = Array.isArray(res) ? res : (res.data ?? [])
  // P1-27 (audit integrasi 2026-10-06): backend kirim relasi `admin` nested
  // (bukan adminName flat) dan tanpa field `isActive` — hitung dari
  // revokedAt/expiresAt agar filter UI tidak selalu kosong.
  const now = Date.now()
  return raw.map((g) => {
    const grant = (g ?? {}) as Record<string, unknown>
    const admin = (grant.admin ?? {}) as Record<string, unknown>
    const revokedAt = grant.revokedAt as string | null
    const expiresAt = grant.expiresAt as string | null
    const isActive =
      !revokedAt && !!expiresAt && new Date(expiresAt).getTime() > now
    return {
      ...(grant as object),
      id: String(grant.id ?? ""),
      adminId: String(grant.adminId ?? admin.adminId ?? admin.id ?? ""),
      adminName:
        (grant.adminName as string | null) ??
        (admin.fullName as string | null) ??
        null,
      grantedBy: (grant.grantedBy as string | null) ?? null,
      grantedByName: (grant.grantedByName as string | null) ?? null,
      reason: String(grant.reason ?? ""),
      scope: String(grant.scope ?? ""),
      durationMinutes: Number(grant.durationMinutes ?? 0),
      expiresAt: expiresAt ?? "",
      createdAt: String(grant.createdAt ?? ""),
      revokedAt,
      isActive,
    } as EmergencyGrant
  })
}

/**
 * POST /v1/admin/emergency-grants — berikan akses darurat sementara.
 *
 * BAD-009: aksi kritis — token step-up per aksi (`admin.emergency-grant.create`)
 * via header `X-Step-Up-Token`; server menolak 403 bila absen.
 */
export function createEmergencyGrant(
  input: CreateEmergencyGrantInput,
  opts: { stepUpToken?: string } = {},
): Promise<EmergencyGrant> {
  return adminHttp.post<EmergencyGrant>(
    "/v1/admin/emergency-grants",
    input,
    { headers: criticalActionHeaders(opts.stepUpToken) },
  )
}

/**
 * DELETE /v1/admin/emergency-grants/:id — cabut grant sebelum kedaluwarsa.
 *
 * BAD-009: token step-up per aksi (`admin.emergency-grant.revoke`).
 */
export function revokeEmergencyGrant(
  id: string,
  opts: { stepUpToken?: string } = {},
): Promise<{ message: string }> {
  return adminHttp.delete<{ message: string }>(
    `/v1/admin/emergency-grants/${encodeURIComponent(id)}`,
    { headers: criticalActionHeaders(opts.stepUpToken) },
  )
}

/* ------------------------- Review akses periodik ------------------------- */

/** Satu baris daftar review akses: admin + tanggal sertifikasi ulang terakhir. */
export type AccessReviewItem = {
  adminId: string
  fullName: string
  email: string
  role: AdminRole
  isActive: boolean
  lastCertifiedAt: string | null
  certifiedBy: string | null
  /** Overdue bila backend menghitungnya; UI juga menghitung fallback 90 hari. */
  isOverdue?: boolean | null
}

/** GET /v1/admin/access-review — daftar admin + tanggal sertifikasi ulang. */
export function listAccessReview(): Promise<AccessReviewItem[]> {
  return adminHttp.get<{ data: AccessReviewItem[] } | AccessReviewItem[]>(
    "/v1/admin/access-review",
  ).then((res) => (Array.isArray(res) ? res : (res.data ?? [])))
}

/** POST /v1/admin/access-review/:adminId/certify — tandai sudah direview. */
export function certifyAccessReview(
  adminId: string,
): Promise<{ message: string; lastCertifiedAt?: string }> {
  return adminHttp.post<{ message: string; lastCertifiedAt?: string }>(
    `/v1/admin/access-review/${encodeURIComponent(adminId)}/certify`,
    undefined,
    { headers: idempotencyHeaders() },
  )
}

/* ------------------------- Handoff kasus ------------------------- */

/** Jenis kasus yang bisa di-handoff. Backend hanya menerima lowercase: 'kyc'|'dispute'|'report'. */
export type HandoffCaseType = "kyc" | "dispute" | "report" | "user" | string

export type Handoff = {
  id: string
  caseType: HandoffCaseType
  caseId: string
  fromAdminId: string | null
  fromAdminName: string | null
  toAdminId: string
  toAdminName: string | null
  note: string | null
  createdAt: string
}

export type CreateHandoffInput = {
  caseType: HandoffCaseType
  caseId: string
  /** ID admin pemberi — WAJIB oleh backend (CreateHandoffDto). Diisi dari sesi admin. */
  fromAdminId: string
  toAdminId: string
  note: string
}

/** GET /v1/admin/handoffs?caseType&caseId — riwayat handoff (per kasus). */
export function listHandoffs(
  opts: { caseType?: string; caseId?: string; page?: number; limit?: number } = {},
): Promise<Paginated<Handoff>> {
  return adminHttp.get<Paginated<Handoff>>("/v1/admin/handoffs", {
    query: opts,
  })
}

/** POST /v1/admin/handoffs — catat handoff kasus ke petugas lain. */
/**
 * POST /v1/admin/handoffs — catat handoff kasus antar petugas.
 * Backend (CreateHandoffDto): `caseType` lowercase @IsIn(['kyc','dispute','report']),
 * `fromAdminId` WAJIB (P0-10).
 */
export function createHandoff(input: CreateHandoffInput): Promise<Handoff> {
  return adminHttp.post<Handoff>(
    "/v1/admin/handoffs",
    { ...input, caseType: input.caseType.toLowerCase() },
    {
      headers: idempotencyHeaders(),
    },
  )
}

/** Beban kasus terbuka per petugas (angka sederhana untuk UI handoff). */
export type HandoffWorkload = {
  adminId: string
  fullName: string
  openCount: number
  /**
   * P1-28 (audit integrasi 2026-10-06): kunci backend aktual.
   * Backend kirim handoffsReceived30d + activeAssignedDisputes.
   */
  handoffsReceived30d?: number
  activeAssignedDisputes?: number
}

/** GET /v1/admin/handoffs/workload — beban kasus per petugas. */
export async function getHandoffWorkload(): Promise<HandoffWorkload[]> {
  const res = await adminHttp.get<{ data: unknown[] } | unknown[]>(
    "/v1/admin/handoffs/workload",
  )
  const raw = Array.isArray(res) ? res : (res.data ?? [])
  // P1-28: backend kirim {adminId,admin,handoffsReceived30d,activeAssignedDisputes}
  // — bukan openCount. Hitung openCount dari jumlah keduanya.
  return raw.map((w) => {
    const row = (w ?? {}) as Record<string, unknown>
    const admin = (row.admin ?? {}) as Record<string, unknown>
    const handoffs = Number(row.handoffsReceived30d ?? 0)
    const disputes = Number(row.activeAssignedDisputes ?? 0)
    return {
      adminId: String(row.adminId ?? admin.id ?? ""),
      fullName:
        String(row.fullName ?? admin.fullName ?? ""),
      openCount: Number(row.openCount ?? handoffs + disputes),
      handoffsReceived30d: handoffs,
      activeAssignedDisputes: disputes,
    } as HandoffWorkload
  })
}

/* ------------------------- Log aktivitas admin ------------------------- */

export type AdminActivityEntry = {
  id: string
  adminId: string | null
  adminName: string | null
  action: string
  entityType: string | null
  entityId: string | null
  description: string | null
  ipAddress: string | null
  createdAt: string
}

export type ListAdminActivityQuery = {
  adminId?: string
  action?: string
  from?: string
  to?: string
  page?: number
  limit?: number
}

/** GET /v1/admin/activity-log — jejak aktivitas admin (filter admin/aksi/waktu). */
export function listAdminActivity(
  query: ListAdminActivityQuery = {},
): Promise<Paginated<AdminActivityEntry>> {
  return adminHttp.get<Paginated<AdminActivityEntry>>("/v1/admin/activity-log", {
    query,
  })
}

/**
 * Ekspor CSV log aktivitas admin (endpoint mengembalikan `text/csv`,
 * bukan JSON — tidak bisa lewat `adminHttp` yang mem-parsing JSON).
 * Pola sama seperti `exportUsersCsv` di users.ts.
 */
export async function exportAdminActivityCsv(
  query: Omit<ListAdminActivityQuery, "page" | "limit"> = {},
): Promise<string> {
  const token = await getAdminAccessToken()
  const url = new URL(`${API_BASE_URL}/v1/admin/activity-log/export`)
  for (const [k, v] of Object.entries(query)) {
    if (v) url.searchParams.set(k, v)
  }
  const res = await fetch(url.toString(), {
    headers: {
      Accept: "text/csv",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    credentials: "include",
  })
  if (res.status === 401) throw new AdminAuthError()
  if (!res.ok) throw new Error(`Ekspor log aktivitas gagal (${res.status})`)
  return res.text()
}

export type ActivityRetentionInfo = {
  /** Hari retensi log aktivitas (mis. 365). */
  retentionDays: number
  /** Catatan kebijakan (mis. arsip cold storage setelah retensi). */
  note: string | null
}

/** GET /v1/admin/activity-log/retention — info kebijakan retensi log. */
export function getActivityRetention(): Promise<ActivityRetentionInfo> {
  return adminHttp.get<ActivityRetentionInfo>("/v1/admin/activity-log/retention")
}
