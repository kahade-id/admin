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

/** Nilai `status` yang diterima `GET /v1/admin/users?status=…`. */
export type AdminUserStatusFilter =
  | "active"
  | "banned"
  | "kyc_approved"
  | "kyc_pending"
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
  createdAt: string
  updatedAt: string
  transactions: AdminUserWalletTransaction[]
}

/** Bentuk paginasi backend `createPaginatedResponse` (field di root, bukan `meta`). */
export type AdminPaginated<T> = {
  data: T[]
  total: number
  page: number
  limit: number
  totalPages: number
  hasNext: boolean
  hasPrev?: boolean
}

export type ListAdminUsersQuery = {
  /** Istilah pencarian (nama, email, username, userId, atau nomor HP). */
  q?: string
  status?: AdminUserStatusFilter
  page?: number
  limit?: number
}

export function listAdminUsers(
  query: ListAdminUsersQuery = {},
): Promise<AdminPaginated<AdminUserSummary>> {
  const { q, status, page, limit } = query
  return adminHttp.get<AdminPaginated<AdminUserSummary>>("/v1/admin/users", {
    query: { search: q?.trim() || undefined, status, page, limit },
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

export function getUserWallet(userId: string): Promise<AdminUserWallet> {
  return adminHttp.get<AdminUserWallet>(
    `/v1/admin/users/${encodeURIComponent(userId)}/wallet`,
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

/** reason wajib, min 5 — divalidasi backend (BanUserDto). */
export function banUser(userId: string, reason: string): Promise<BanUserResult> {
  return adminHttp.post<BanUserResult>(
    `/v1/admin/users/${encodeURIComponent(userId)}/ban`,
    { reason },
  )
}

export function unbanUser(userId: string): Promise<BanUserResult> {
  return adminHttp.post<BanUserResult>(
    `/v1/admin/users/${encodeURIComponent(userId)}/unban`,
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
 */
export function adjustWallet(
  userId: string,
  input: { amount: number; type: WalletAdjustType; reason: string },
): Promise<WalletAdjustResult> {
  const idempotencyKey =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`
  return adminHttp.post<WalletAdjustResult>(
    `/v1/admin/users/${encodeURIComponent(userId)}/wallet/adjust`,
    { amount: input.amount, type: input.type, reason: input.reason, idempotencyKey },
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
