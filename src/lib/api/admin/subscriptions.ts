/**
 * Kahade admin — kelola subscription Kahade+ (daftar, detail, pembatalan,
 * pemberian manual/grant).
 *
 * Endpoint: GET/POST/PATCH `/v1/admin/subscriptions/*`
 *
 * Kontrak backend (Kahade+, tetap):
 * - GET /v1/admin/subscriptions?page&limit&status&search → {data, pagination}
 * - GET /v1/admin/subscriptions/:id → detail + usage periode berjalan
 * - POST /v1/admin/subscriptions/:id/cancel {reason?}
 * - POST /v1/admin/subscriptions/grant
 *   {userId, plan: 'MONTHLY'|'YEARLY', durationDays: number, reason: string}
 *
 * Catatan kontrak:
 * - Status valid: ACTIVE, EXPIRED, CANCELED; plan valid: MONTHLY, YEARLY.
 *   Ejaan lama backend (CANCELLED, ANNUAL, PENDING, SUSPENDED) tetap
 *   ditoleransi saat menampilkan agar drift respons tidak merusak UI.
 * - Harga dikembalikan sebagai rupiah (number).
 * - `cancelSubscription` hanya valid untuk status ACTIVE/PENDING;
 *   backend 400 untuk status lain.
 */
import { adminHttp } from "@/lib/api/admin-client"
import type { Paginated } from "@/lib/api/admin/kyc"

export type SubscriptionStatus =
  | "ACTIVE"
  | "CANCELED"
  | "CANCELLED"
  | "EXPIRED"
  | "PENDING"
  | "SUSPENDED"

export type SubscriptionPlan = "MONTHLY" | "YEARLY"

export type SubscriptionUser = {
  id?: string
  userId?: string
  username?: string | null
  fullName?: string | null
  email?: string | null
  [key: string]: unknown
}

/** Penggunaan kuota fee pada periode berjalan. */
export type SubscriptionFeeUsage = {
  used?: number | null
  limit?: number | null
  remaining?: number | null
  periodStart?: string | null
  periodEnd?: string | null
  [key: string]: unknown
}

export type SubscriptionItem = {
  id: string
  userId?: string
  plan?: SubscriptionPlan | string
  status?: SubscriptionStatus | string
  price?: number
  currentPeriodStart?: string | null
  currentPeriodEnd?: string | null
  cancelledAt?: string | null
  createdAt?: string
  user?: SubscriptionUser | null
  /** Ringkasan penggunaan kuota fee (bila dikembalikan di daftar). */
  feeUsage?: SubscriptionFeeUsage | null
  [key: string]: unknown
}

export type SubscriptionDetail = SubscriptionItem & {
  originalPrice?: number | null
  feeSavingsUsed?: number | null
  feeSavingsLimit?: number | null
  /** Penggunaan kuota fee pada periode berjalan (kontrak baru). */
  currentUsage?: SubscriptionFeeUsage | null
  paymentTx?: {
    txId?: string
    status?: string
    amount?: number
    createdAt?: string
    [key: string]: unknown
  } | null
  /** Riwayat perubahan status (bila dikembalikan backend). */
  history?: Array<{
    id?: string
    action?: string
    status?: string
    note?: string | null
    createdAt?: string
    [key: string]: unknown
  }> | null
  [key: string]: unknown
}

export type CancelSubscriptionResult = {
  message: string
  subscriptionId: string
  status: string
}

export type GrantSubscriptionInput = {
  userId: string
  plan: "MONTHLY" | "YEARLY"
  durationDays: number
  reason: string
}

export type GrantSubscriptionResult = {
  message: string
  subscriptionId: string
  status: string
}

/** Daftar subscription Kahade+; filter status & pencarian pengguna. */
export function listSubscriptions(query?: {
  page?: number
  limit?: number
  status?: "ACTIVE" | "EXPIRED" | "CANCELED"
  search?: string
}): Promise<Paginated<SubscriptionItem>> {
  return adminHttp.get<Paginated<SubscriptionItem>>("/v1/admin/subscriptions", {
    query: {
      page: query?.page,
      limit: query?.limit,
      status: query?.status,
      search: query?.search?.trim() || undefined,
    },
  })
}

/** Detail subscription: user, periode, usage periode berjalan, riwayat. */
export function getSubscriptionDetail(
  subId: string,
): Promise<SubscriptionDetail> {
  return adminHttp.get<SubscriptionDetail>(
    `/v1/admin/subscriptions/${encodeURIComponent(subId)}`,
  )
}

/**
 * Paksa batalkan subscription (intervensi admin). Hanya untuk status
 * ACTIVE/PENDING; backend 400 untuk status lain.
 */
export function cancelSubscription(
  subId: string,
  reason?: string,
): Promise<CancelSubscriptionResult> {
  const body: { reason?: string } = {}
  const trimmed = reason?.trim()
  if (trimmed) body.reason = trimmed
  return adminHttp.post<CancelSubscriptionResult>(
    `/v1/admin/subscriptions/${encodeURIComponent(subId)}/cancel`,
    body,
  )
}

/**
 * Beri subscription Kahade+ secara manual ke pengguna.
 * `durationDays`: durasi dalam hari; `reason`: alasan wajib (audit).
 */
export function grantSubscription(
  input: GrantSubscriptionInput,
): Promise<GrantSubscriptionResult> {
  return adminHttp.post<GrantSubscriptionResult>(
    "/v1/admin/subscriptions/grant",
    {
      userId: input.userId,
      plan: input.plan,
      durationDays: input.durationDays,
      reason: input.reason.trim(),
    },
  )
}
