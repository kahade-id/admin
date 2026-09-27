/** Kahade admin — manajemen akun admin (tim). */
import { adminHttp, getAdminAccessToken, AdminAuthError } from "@/lib/api/admin-client"
import { API_BASE_URL } from "@/lib/api/config"
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
): Promise<AdminUserItem> {
  return adminHttp.put<AdminUserItem>(
    `/v1/admin/management/${encodeURIComponent(id)}`,
    input,
    { headers: idempotencyHeaders() },
  )
}

/** DELETE /v1/admin/management/:id — soft-delete akun admin. */
export function deleteAdmin(id: string): Promise<{ message: string }> {
  return adminHttp.delete<{ message: string }>(
    `/v1/admin/management/${encodeURIComponent(id)}`,
    { headers: idempotencyHeaders() },
  )
}

/** POST /v1/admin/management/:id/reset-2fa — reset 2FA akun admin. */
export function resetAdmin2fa(id: string): Promise<{ message: string }> {
  return adminHttp.post<{ message: string }>(
    `/v1/admin/management/${encodeURIComponent(id)}/reset-2fa`,
    undefined,
    { headers: idempotencyHeaders() },
  )
}

/** POST /v1/admin/management/:id/unlock — buka akun admin yang terkunci. */
export function unlockAdmin(id: string): Promise<{ message: string }> {
  return adminHttp.post<{ message: string }>(
    `/v1/admin/management/${encodeURIComponent(id)}/unlock`,
    undefined,
    { headers: idempotencyHeaders() },
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
}

/** GET /v1/admin/management/:id/sessions — sesi aktif akun admin. */
export function listAdminSessions(
  id: string,
  opts: { page?: number; limit?: number } = {},
): Promise<Paginated<AdminManagementSession>> {
  return adminHttp.get<Paginated<AdminManagementSession>>(
    `/v1/admin/management/${encodeURIComponent(id)}/sessions`,
    { query: opts },
  )
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
export function listEmergencyGrants(opts: { activeOnly?: boolean } = {}): Promise<EmergencyGrant[]> {
  return adminHttp.get<{ data: EmergencyGrant[] } | EmergencyGrant[]>(
    "/v1/admin/emergency-grants",
    { query: { activeOnly: opts.activeOnly ?? true } },
  ).then((res) => (Array.isArray(res) ? res : (res.data ?? [])))
}

/**
 * POST /v1/admin/emergency-grants — berikan akses darurat sementara.
 */
export function createEmergencyGrant(
  input: CreateEmergencyGrantInput,
): Promise<EmergencyGrant> {
  return adminHttp.post<EmergencyGrant>(
    "/v1/admin/emergency-grants",
    input,
    { headers: idempotencyHeaders() },
  )
}

/** DELETE /v1/admin/emergency-grants/:id — cabut grant sebelum kedaluwarsa. */
export function revokeEmergencyGrant(id: string): Promise<{ message: string }> {
  return adminHttp.delete<{ message: string }>(
    `/v1/admin/emergency-grants/${encodeURIComponent(id)}`,
    { headers: idempotencyHeaders() },
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

/** Jenis kasus yang bisa di-handoff; diperluas backend bila perlu. */
export type HandoffCaseType = "USER" | "DISPUTE" | "KYC" | "TICKET" | string

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
export function createHandoff(input: CreateHandoffInput): Promise<Handoff> {
  return adminHttp.post<Handoff>("/v1/admin/handoffs", input, {
    headers: idempotencyHeaders(),
  })
}

/** Beban kasus terbuka per petugas (angka sederhana untuk UI handoff). */
export type HandoffWorkload = {
  adminId: string
  fullName: string
  openCount: number
}

/** GET /v1/admin/handoffs/workload — beban kasus per petugas. */
export function getHandoffWorkload(): Promise<HandoffWorkload[]> {
  return adminHttp.get<{ data: HandoffWorkload[] } | HandoffWorkload[]>(
    "/v1/admin/handoffs/workload",
  ).then((res) => (Array.isArray(res) ? res : (res.data ?? [])))
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
