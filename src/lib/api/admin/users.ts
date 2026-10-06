/**
 * Kahade admin — manajemen pengguna (§admin/users).
 *
 * Kontrak backend: `GET/POST/DELETE /v1/admin/users…` (admin-users.controller.ts).
 * `POST :userId/impersonate` SENGAJA tidak diimplementasikan (risiko keamanan).
 */
import {
  adminHttp,
  AdminAuthError,
  getAdminAccessToken,
} from "@/lib/api/admin-client"
import { API_BASE_URL } from "@/lib/api/config"
import type { Paginated } from "@/lib/api/admin/kyc"
import { STEP_UP_HEADER } from "@/lib/api/admin/step-up"

/** Opsi step-up untuk mutasi user — backend mewajibkan @RequireStepUp. */
export type UserStepUpOpts = { stepUpToken?: string }

/** Nilai `status` yang diterima `GET /v1/admin/users?status=…`. */
export type AdminUserStatusFilter =
  | "active"
  | "banned"
  | "kyc_approved"
  | "kyc_pending"
  // BAI-070: segmen KYC yang sebelumnya tak terjangkau filter daftar.
  | "kyc_rejected"
  | "kyc_revoked"
  | "kyc_unverified"
  | "flagged"

/** Status KYC mentah dari backend (string bebas — jangan asumsikan enum tertutup). */
export type KycStatus = string | null

export type AdminUserWalletSummary = {
  totalBalance: number
  availableBalance: number
} | null

export type AdminUserSummary = {
  id: string
  userId: string
  email: string
  fullName: string | null
  username: string | null
  accountType: string | null
  kycStatus: KycStatus
  isBanned: boolean
  banReason: string | null
  emailVerified: boolean
  isActive: boolean
  isKahadePlus: boolean | null
  membershipRank: string | null
  averageRating: number | null
  totalOrdersAsBuyer: number
  totalOrdersAsSeller: number
  totalOrdersCompleted: number
  createdAt: string
  lastLoginAt: string | null
  flaggedForReview: boolean
  flaggedForReviewAt: string | null
  wallet: AdminUserWalletSummary
}

export type AdminUserKycRequest = {
  kycId: string
  status: string
  createdAt: string
  reviewedAt: string | null
  rejectionReason: string | null
}

export type AdminUserDetail = {
  id: string
  userId: string
  email: string
  fullName: string | null
  username: string | null
  avatarUrl: string | null
  accountType: string | null
  phoneNumber: string | null
  phoneVerified: boolean | null
  kycStatus: KycStatus
  isBanned: boolean
  banReason: string | null
  /** BAI-074: suspend ringan berbatas waktu (state Redis, auto-unsuspend). */
  suspended?: boolean
  emailVerified: boolean
  isActive: boolean
  isKahadePlus: boolean | null
  membershipRank: string | null
  averageRating: number | null
  totalOrdersAsBuyer: number
  totalOrdersAsSeller: number
  totalOrdersCompleted: number
  totalOrdersDisputed: number
  createdAt: string
  updatedAt: string
  lastLoginAt: string | null
  lastLoginIp: string | null
  bio: string | null
  flaggedForReview: boolean
  flaggedForReviewAt: string | null
  followersCount: number
  followingCount: number
  blockedUsersCount: number
  reportsReceivedCount: number
  wallet: {
    totalBalance: number
    availableBalance: number
    escrowBalance: number
  } | null
  kycRequests: AdminUserKycRequest[]
}

export type AdminUserOrder = {
  id: string
  orderId: string
  title: string | null
  orderType: string | null
  status: string
  orderValue: number
  feeAmount: number
  buyerId: string
  sellerId: string
  createdAt: string
  completedAt: string | null
  cancelledAt: string | null
}

export type AdminUserSession = {
  id: string
  deviceInfo: string | null
  ipAddress: string | null
  lastActiveAt: string
  expiresAt: string
  createdAt: string
}

export type AdminUserAuditEntry = {
  id: string
  action: string
  entityType: string | null
  entityId: string | null
  description: string | null
  ipAddress: string | null
  createdAt: string
}

export type AdminUserWalletTransaction = {
  id: string
  txId: string
  type: string
  status: string
  amount: number
  /** ADM-007: arah mutasi dari backend (diturunkan dari `type`); optional untuk kompatibilitas. */
  direction?: "DEBIT" | "CREDIT" | "UNKNOWN" | null
  balanceBefore: number
  balanceAfter: number
  description: string | null
  createdAt: string
}

export type AdminUserWallet = {
  id: string
  availableBalance: number
  escrowBalance: number
  totalBalance: number
  todayTopupAmount: number
  todayWithdrawAmount: number
  isLocked: boolean
  lockedAt: string | null
  lockReason: string | null
  /** Kode stabil alasan penguncian (i18n di bawah); null untuk data lama. */
  lockReasonCode: string | null
  createdAt: string
  updatedAt: string
  transactions: AdminUserWalletTransaction[]
  /** ADM-013: meta paginasi transaksi (opsional untuk kompatibilitas). */
  transactionsMeta?: {
    page: number
    limit: number
    total: number
    totalPages: number
  }
}

/** AW-019: alias — bentuk paginasi backend `createPaginatedResponse` (field di root). */
export type AdminPaginated<T> = Paginated<T>

export type ListAdminUsersQuery = {
  /** Istilah pencarian (nama, email, username, userId, atau nomor HP). */
  q?: string
  status?: AdminUserStatusFilter
  /** Poin 3: filter tipe akun (backend GET /v1/admin/users?accountType=…). */
  accountType?: "PERSONAL" | "BUSINESS"
  page?: number
  limit?: number
  /** ADM-014: sortir (backend me-whitelist sortBy). */
  sortBy?: "createdAt" | "lastLoginAt" | "email" | "fullName"
  sortOrder?: "asc" | "desc"
}

export function listAdminUsers(
  query: ListAdminUsersQuery = {},
): Promise<AdminPaginated<AdminUserSummary>> {
  const { q, status, accountType, page, limit, sortBy, sortOrder } = query
  return adminHttp.get<AdminPaginated<AdminUserSummary>>("/v1/admin/users", {
    query: { search: q?.trim() || undefined, status, accountType, page, limit, sortBy, sortOrder },
  })
}

export function getAdminUserDetail(userId: string): Promise<AdminUserDetail> {
  return adminHttp.get<AdminUserDetail>(
    `/v1/admin/users/${encodeURIComponent(userId)}`,
  )
}

export function getUserOrders(
  userId: string,
  opts: { page?: number; limit?: number; status?: string } = {},
): Promise<AdminPaginated<AdminUserOrder>> {
  return adminHttp.get<AdminPaginated<AdminUserOrder>>(
    `/v1/admin/users/${encodeURIComponent(userId)}/orders`,
    { query: opts },
  )
}

/**
 * ADM-013: `page`/`limit` opsional — mem-paginasi daftar transaksi wallet
 * (default backend 10). Tanpa argumen, berperilaku seperti semula.
 */
export function getUserWallet(
  userId: string,
  opts: { page?: number; limit?: number } = {},
): Promise<AdminUserWallet> {
  return adminHttp.get<AdminUserWallet>(
    `/v1/admin/users/${encodeURIComponent(userId)}/wallet`,
    { query: opts },
  )
}

export function getUserSessions(
  userId: string,
  opts: { page?: number; limit?: number } = {},
): Promise<AdminPaginated<AdminUserSession>> {
  return adminHttp.get<AdminPaginated<AdminUserSession>>(
    `/v1/admin/users/${encodeURIComponent(userId)}/sessions`,
    { query: opts },
  )
}

export function getUserAuditLog(
  userId: string,
  opts: { page?: number; limit?: number } = {},
): Promise<AdminPaginated<AdminUserAuditEntry>> {
  return adminHttp.get<AdminPaginated<AdminUserAuditEntry>>(
    `/v1/admin/users/${encodeURIComponent(userId)}/audit-log`,
    { query: opts },
  )
}

export type BanUserResult = {
  userId: string
  isBanned: boolean
  banReason: string | null
  bannedAt: string | null
  bannedBy: string | null
  flaggedForReview: boolean
}

/**
 * P2-1 (audit integrasi 2026-10-06): backend mewajibkan
 * @RequireStepUp('user.ban','userId') — kirim token step-up.
 */
export function banUser(
  userId: string,
  reason: string,
  opts?: UserStepUpOpts,
): Promise<BanUserResult> {
  return adminHttp.post<BanUserResult>(
    `/v1/admin/users/${encodeURIComponent(userId)}/ban`,
    { reason },
    {
      headers: {
        ...(opts?.stepUpToken ? { [STEP_UP_HEADER]: opts.stepUpToken } : {}),
      },
    },
  )
}

export function unbanUser(userId: string): Promise<BanUserResult> {
  return adminHttp.post<BanUserResult>(
    `/v1/admin/users/${encodeURIComponent(userId)}/unban`,
  )
}

/* ----------------- BAI-074: suspend ringan berbatas waktu ----------------- */

export type SuspendUserResult = {
  userId: string
  suspended: boolean
  reason: string
  durationHours: number
  suspendedAt: string
  expiresAt: string
  sessionsRevoked: number
}

/**
 * BAI-074 — suspend ringan: sesi aktif dicabut (kick langsung) + login
 * diblokir sampai durasi habis (auto-unsuspend via TTL Redis). Alasan wajib
 * min 10 karakter (ditegakkan DTO backend); durasi 1–720 jam.
 * SENSITIF: SUPER_ADMIN saja + audit wajib.
 *
 * P2-1 (audit integrasi 2026-10-06): backend mewajibkan
 * @RequireStepUp('user.suspend','userId') — kirim token step-up.
 */
export function suspendUser(
  userId: string,
  input: { reason: string; durationHours: number },
  opts?: UserStepUpOpts,
): Promise<SuspendUserResult> {
  return adminHttp.post<SuspendUserResult>(
    `/v1/admin/users/${encodeURIComponent(userId)}/suspend`,
    input,
    {
      headers: {
        ...(opts?.stepUpToken ? { [STEP_UP_HEADER]: opts.stepUpToken } : {}),
      },
    },
  )
}

/** BAI-074 — lepas suspend sebelum waktunya (sesi yang dicabut tidak pulih). */
export function unsuspendUser(userId: string): Promise<{ userId: string; suspended: boolean }> {
  return adminHttp.post<{ userId: string; suspended: boolean }>(
    `/v1/admin/users/${encodeURIComponent(userId)}/unsuspend`,
    {},
  )
}

export function forceLogout(
  userId: string,
): Promise<{ message: string; revokedCount: number }> {
  return adminHttp.post<{ message: string; revokedCount: number }>(
    `/v1/admin/users/${encodeURIComponent(userId)}/force-logout`,
  )
}

export function revokeUserSession(
  userId: string,
  sessionId: string,
): Promise<{ message: string }> {
  return adminHttp.delete<{ message: string }>(
    `/v1/admin/users/${encodeURIComponent(userId)}/sessions/${encodeURIComponent(sessionId)}`,
  )
}

export function resetUserPassword(
  userId: string,
): Promise<{ message: string }> {
  return adminHttp.post<{ message: string }>(
    `/v1/admin/users/${encodeURIComponent(userId)}/reset-password`,
  )
}

export function clearReviewFlag(
  userId: string,
): Promise<{ message: string; userId: string; flaggedForReview: boolean }> {
  return adminHttp.post<{ message: string; userId: string; flaggedForReview: boolean }>(
    `/v1/admin/users/${encodeURIComponent(userId)}/review-flag/clear`,
  )
}

export type WalletAdjustType = "CREDIT" | "DEBIT"

export type WalletAdjustResult = {
  txId: string
  type: string
  amount: number
  reason: string
  balanceAfter: number
}

/**
 * Penyesuaian manual saldo (SUPER_ADMIN saja). `amount` dalam Rupiah bilangan
 * bulat (>= 1, maks 50 jt per backend). Kunci idempotensi dibuat per panggilan
 * supaya klik ganda tidak menggandakan mutasi.
 *
 * Backend: @RequireStepUp('wallet.adjust','userId') + `reauthPassword` wajib
 * di body (WalletAdjustDto @IsNotEmpty) (P0-6).
 */
export function adjustWallet(
  userId: string,
  input: {
    amount: number
    type: WalletAdjustType
    reason: string
    /** Kata sandi admin — DIVERIFIKASI server-side. Wajib. */
    reauthPassword: string
  },
  opts?: UserStepUpOpts,
): Promise<WalletAdjustResult> {
  const idempotencyKey =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`
  return adminHttp.post<WalletAdjustResult>(
    `/v1/admin/users/${encodeURIComponent(userId)}/wallet/adjust`,
    {
      amount: input.amount,
      type: input.type,
      reason: input.reason,
      idempotencyKey,
      reauthPassword: input.reauthPassword,
    },
    {
      // Backend hanya membaca header `Idempotency-Key` (interceptor menolak
      // 400 IDEMPOTENCY_KEY_REQUIRED bila absen); field body dipertahankan
      // untuk kompatibilitas DTO.
      headers: {
        "Idempotency-Key": idempotencyKey,
        ...(opts?.stepUpToken ? { [STEP_UP_HEADER]: opts.stepUpToken } : {}),
      },
    },
  )
}

/**
 * Ekspor CSV (opsional; endpoint mengembalikan `text/csv`, bukan JSON —
 * tidak bisa lewat `adminHttp` yang mem-parsing JSON).
 */
export async function exportUsersCsv(
  query: { q?: string; status?: AdminUserStatusFilter } = {},
): Promise<string> {
  const token = await getAdminAccessToken()
  const url = new URL(`${API_BASE_URL}/v1/admin/users/export/csv`)
  const search = query.q?.trim()
  if (search) url.searchParams.set("search", search)
  if (query.status) url.searchParams.set("status", query.status)
  const res = await fetch(url.toString(), {
    headers: {
      Accept: "text/csv",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    credentials: "include",
  })
  if (res.status === 401) throw new AdminAuthError()
  if (!res.ok) throw new Error(`Ekspor CSV gagal (${res.status})`)
  return res.text()
}

/* ---------------------------------------------------------------------- */
/* E5a — Moderasi pengguna + ekspor CSV diperkuat (grup E, audit 2026-09-26) */
/*                                                                        */
/* KONTRAK ASUMSI: worker backend paralel (grup E) sedang membangun       */
/* endpoint di bawah. Path & shape didefinisikan bersama sesuai brief      */
/* G376–G400; UI ini siap dipasang dan diverifikasi begitu backend         */
/* selesai. Fungsi lama di atas TIDAK diubah.                              */
/* ---------------------------------------------------------------------- */

/** Sumber event moderasi: tindakan otomatis sistem vs tindakan manual admin. */
export type UserModerationEventKind = "system" | "admin"

/**
 * BAI-061: bentuk event moderasi SELARAS dengan respons backend
 * (`AdminUsersService.listModerationEvents`):
 * `{ id, type, source, title, description, actor: { id, name, role } | null,
 * createdAt, metadata, internalNote?/internalNoteHidden? }`.
 */
export type UserModerationEventActor = {
  id: string
  name: string | null
  role: string | null
} | null

export type UserModerationEvent = {
  id: string
  /** Jenis event mentah backend (mis. USER_BANNED, KYC_DECISION, AUTO_FLAG). */
  type: string
  /** Sumber event: tindakan otomatis sistem vs tindakan manual admin. */
  source: UserModerationEventKind
  title: string
  description: string | null
  /** Admin pelaksana; null untuk event sistem. */
  actor: UserModerationEventActor
  /**
   * Catatan internal — backend hanya mengembalikannya untuk role berhak;
   * UI menyembunyikannya dari CUSTOMER_SUPPORT sebagai lapis pertahanan
   * tambahan (lihat moderation-tab.tsx).
   */
  internalNote?: string | null
  internalNoteHidden?: boolean
  metadata?: Record<string, unknown>
  createdAt: string
}

export type ListUserModerationEventsQuery = {
  kind?: UserModerationEventKind
  /** ADM-018: filter jenis event sesuai enum backend (ban|unban|kyc_decision|…). */
  event?: string
  /**
   * BAI-067: filter aktor — backend HANYA menerima ID admin internal
   * (bukan nama). Pencarian dengan nama selalu menghasilkan daftar kosong.
   */
  actor?: string
  /** ISO date (dari). */
  from?: string
  /** ISO date (sampai). */
  to?: string
  page?: number
  limit?: number
}

/**
 * GET /v1/admin/users/:userId/moderation-events — timeline gabungan
 * event sistem & tindakan admin untuk pengguna.
 */
export function listUserModerationTimeline(
  userId: string,
  query: ListUserModerationEventsQuery = {},
): Promise<AdminPaginated<UserModerationEvent>> {
  return adminHttp.get<AdminPaginated<UserModerationEvent>>(
    `/v1/admin/users/${encodeURIComponent(userId)}/moderation-events`,
    { query: { kind: query.kind, event: query.event, actor: query.actor, from: query.from, to: query.to, page: query.page, limit: query.limit } },
  )
}

/* ------------------------- Ekspor CSV diperkuat ------------------------- */

/** Kolom yang didukung backend untuk ekspor pengguna. */
export type ExportableUserColumn = {
  key: string
  label: string
  /** Data PII — backend meng-mask saat flag masking aktif. */
  masked: boolean
}

export const EXPORTABLE_USER_COLUMNS: readonly ExportableUserColumn[] = [
  { key: "fullName", label: "Nama lengkap", masked: false },
  { key: "username", label: "Username", masked: false },
  { key: "email", label: "Email", masked: true },
  { key: "phoneNumber", label: "No. HP", masked: true },
  { key: "kycStatus", label: "Status KYC", masked: false },
  { key: "isBanned", label: "Diblokir", masked: false },
  { key: "totalOrdersAsBuyer", label: "Order (beli)", masked: false },
  { key: "totalOrdersAsSeller", label: "Order (jual)", masked: false },
  { key: "createdAt", label: "Terdaftar", masked: false },
  { key: "lastLoginAt", label: "Login terakhir", masked: false },
] as const

export type UsersExportRequest = {
  /** Alasan ekspor — WAJIB (dicatat backend di audit). */
  reason: string
  /** Subset dari EXPORTABLE_USER_COLUMNS; kosong/undefined = semua. */
  columns?: string[]
  q?: string
  status?: AdminUserStatusFilter
}

export type UsersExportResult =
  | { type: "csv"; csv: string }
  | { type: "job"; jobId: string }

export type UsersExportJobStatus = {
  jobId: string
  /** P1-24: backend kirim 'ready' (bukan 'done') saat selesai. */
  status: "pending" | "ready" | "done" | "failed"
  /** 0–100 untuk ekspor besar. */
  progress?: number | null
  /** URL unduh saat status=ready/done (relatif ke API_BASE_URL atau absolut). */
  downloadUrl?: string | null
  error?: string | null
}

/**
 * POST /v1/admin/users/export — ekspor CSV diperkuat (alasan wajib,
 * pilihan kolom, masking server-side). Ekspor besar me-return 202
 * `{ jobId }` → polling `getUsersExportJob` sampai done.
 */
export async function requestUsersExport(
  input: UsersExportRequest,
): Promise<UsersExportResult> {
  const token = await getAdminAccessToken()
  const res = await fetch(`${API_BASE_URL}/v1/admin/users/export`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "text/csv, application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    credentials: "include",
    body: JSON.stringify({
      reason: input.reason.trim(),
      columns: input.columns && input.columns.length > 0 ? input.columns : undefined,
      search: input.q?.trim() || undefined,
      status: input.status,
    }),
  })
  if (res.status === 401) throw new AdminAuthError()
  if (res.status === 202) {
    const data = (await res.json().catch(() => null)) as { jobId?: string } | null
    if (!data?.jobId) throw new Error("Backend me-return 202 tanpa jobId.")
    return { type: "job", jobId: data.jobId }
  }
  if (!res.ok) throw new Error(`Ekspor CSV gagal (${res.status})`)
  return { type: "csv", csv: await res.text() }
}

/** GET /v1/admin/users/export/jobs/:jobId — status job ekspor besar. */
export function getUsersExportJob(
  jobId: string,
): Promise<UsersExportJobStatus> {
  return adminHttp.get<UsersExportJobStatus>(
    `/v1/admin/users/export/jobs/${encodeURIComponent(jobId)}`,
  )
}

/** Unduh file hasil ekspor via URL yang dikembalikan job (bukan JSON). */
export async function downloadExportFile(downloadUrl: string): Promise<string> {
  const token = await getAdminAccessToken()
  const url = /^https?:\/\//i.test(downloadUrl)
    ? downloadUrl
    : `${API_BASE_URL}${downloadUrl.startsWith("/") ? "" : "/"}${downloadUrl}`
  const res = await fetch(url, {
    headers: {
      Accept: "text/csv",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    credentials: "include",
  })
  if (res.status === 401) throw new AdminAuthError()
  if (!res.ok) throw new Error(`Unduhan ekspor gagal (${res.status})`)
  return res.text()
}

/* ── GAP-A: status penghapusan akun + legal hold (G067/G071) ─────────── */

/**
 * BAI-075: `PENDING` DIHAPUS dari union — backend menandai status ini
 * "dipesan untuk kompatibilitas maju" dan TIDAK ADA jalur kode yang
 * menghasilkannya. Menampilkannya sebagai opsi valid menyesatkan.
 */
export type DeletionRequestStatus =
  | "REQUESTED"
  | "CANCELLED"
  | "PURGED"
  | "ON_HOLD"

export type DeletionStatusHistoryEntry = {
  id: string
  fromStatus: DeletionRequestStatus | null
  toStatus: DeletionRequestStatus
  actorType: string
  actorUserId: string | null
  reason: string | null
  createdAt: string
}

export type AdminDeletionRequest = {
  id: string
  referenceCode: string
  status: DeletionRequestStatus
  requestedAt: string
  purgeAt: string
  cancelledAt: string | null
  purgedAt: string | null
  legalHoldReason: string | null
  history?: DeletionStatusHistoryEntry[]
} | null

export type AdminDeletionStatus = {
  /**
   * BAI-075: PERHATIAN — ini id INTERNAL user (kolom `id`), BUKAN `userId`
   * publik yang tampil di halaman detail. Jangan bandingkan langsung dengan
   * `userId` publik tanpa resolve.
   */
  userId: string
  request: AdminDeletionRequest
  history: DeletionStatusHistoryEntry[]
}

/** GET /v1/admin/users/:userId/deletion — status + riwayat (read-only). */
export function getDeletionStatus(userId: string): Promise<AdminDeletionStatus> {
  return adminHttp.get<AdminDeletionStatus>(
    `/v1/admin/users/${encodeURIComponent(userId)}/deletion`,
  )
}

/** POST /v1/admin/users/:userId/deletion/legal-hold — tahan purge (ON_HOLD). */
export function placeDeletionLegalHold(
  userId: string,
  reason: string,
): Promise<{ message?: string }> {
  return adminHttp.post<{ message?: string }>(
    `/v1/admin/users/${encodeURIComponent(userId)}/deletion/legal-hold`,
    { reason },
  )
}

/** POST /v1/admin/users/:userId/deletion/release-hold — lepas hold. */
export function releaseDeletionLegalHold(
  userId: string,
): Promise<{ message?: string }> {
  return adminHttp.post<{ message?: string }>(
    `/v1/admin/users/${encodeURIComponent(userId)}/deletion/release-hold`,
  )
}
