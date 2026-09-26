/**
 * Kahade admin — daftar & pembatalan paksa subscription.
 *
 * Endpoint: GET/POST `/v1/admin/subscriptions/*`
 * (lihat `backend/src/modules/admin/subscriptions/admin-subscriptions.controller.ts`).
 *
 * Catatan kontrak:
 * - Status valid: ACTIVE, CANCELLED, EXPIRED, PENDING, SUSPENDED;
 *   plan valid: MONTHLY, ANNUAL.
 * - Harga dikembalikan sebagai rupiah (number) via `toIdr`.
 * - `cancelSubscription` (POST) tidak menerima body — backend selalu
 *   mencatat `cancelReason: "Force cancelled by admin"`. Parameter
 *   `reason?` disiapkan untuk catatan UI; saat ini hanya dicatat di
 *   audit log backend standar.
 */
import { adminHttp } from "@/lib/api/admin-client"
import type { Paginated } from "@/lib/api/admin/kyc"

export type SubscriptionStatus =
  | "ACTIVE"
  | "CANCELLED"
  | "EXPIRED"
  | "PENDING"
  | "SUSPENDED"

export type SubscriptionPlan = "MONTHLY" | "ANNUAL"

export type SubscriptionUser = {
  id?: string
  userId?: string
  username?: string | null
  fullName?: string | null
  email?: string | null
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
  [key: string]: unknown
}

export type SubscriptionDetail = SubscriptionItem & {
  originalPrice?: number | null
  feeSavingsUsed?: number | null
  feeSavingsLimit?: number | null
  paymentTx?: {
    txId?: string
    status?: string
    amount?: number
    createdAt?: string
    [key: string]: unknown
  } | null
  [key: string]: unknown
}

export type CancelSubscriptionResult = {
  message: string
  subscriptionId: string
  status: string
}

/** Daftar semua subscription; filter status & plan. */
export function listSubscriptions(query?: {
  page?: number
  limit?: number
  status?: SubscriptionStatus
  plan?: SubscriptionPlan
}): Promise<Paginated<SubscriptionItem>> {
  return adminHttp.get<Paginated<SubscriptionItem>>(
    "/v1/admin/subscriptions",
    {
      query: {
        page: query?.page,
        limit: query?.limit,
        status: query?.status,
        plan: query?.plan,
      },
    },
  )
}

/** Detail subscription: user, periode, riwayat pembayaran. */
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
  // Backend mengabaikan body; alasan saat ini hanya terdokumentasi di
  // audit log admin. Parameter dipertahankan agar UI bisa mengirimnya
  // bila kontrak diperbarui.
  void reason
  return adminHttp.post<CancelSubscriptionResult>(
    `/v1/admin/subscriptions/${encodeURIComponent(subId)}/cancel`,
  )
}
