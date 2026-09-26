/**
 * Kahade admin — daftar & intervensi darurat order.
 *
 * Endpoint: GET/POST `/v1/admin/orders/*`
 * (lihat `backend/src/modules/admin/orders/admin-orders.controller.ts`).
 *
 * Catatan kontrak:
 * - `listOrders` memakai param `search` (orderId/judul, case-insensitive).
 * - Detail di-resolve lewat `id` ATAU `orderId` publik.
 * - `forceCancel` / `forceComplete` mewajibkan body `{ reason }`
 *   (min 10 karakter, maks 500) dan header `Idempotency-Key: <UUID v4>`.
 * - `forceComplete` hanya untuk status PROCESSING / IN_DELIVERY; order
 *   DISPUTED harus lewat alur resolusi sengketa (backend menolak 400).
 */
import { adminHttp } from "@/lib/api/admin-client"
import type { Paginated } from "@/lib/api/admin/kyc"

export type AdminOrderStatus =
  | "WAITING_CONFIRMATION"
  | "WAITING_PAYMENT"
  | "PROCESSING"
  | "IN_DELIVERY"
  | "COMPLETED"
  | "DISPUTED"
  | "CANCELLED"

export type AdminOrderParty = {
  userId: string
  username?: string | null
  fullName?: string | null
  email?: string | null
  kycStatus?: string | null
  averageRating?: number | null
  avatarUrl?: string | null
}

export type AdminOrderItem = {
  id: string
  orderId: string
  title?: string | null
  status: AdminOrderStatus | string
  orderValue: number
  feeAmount?: number
  buyerPayAmount?: number
  sellerReceiveAmount?: number
  createdAt: string
  completedAt?: string | null
  buyer?: AdminOrderParty | null
  seller?: AdminOrderParty | null
  [key: string]: unknown
}

export type AdminOrderStatusHistory = {
  id?: string
  status?: string
  createdAt?: string
  note?: string | null
  [key: string]: unknown
}

export type AdminOrderDetail = AdminOrderItem & {
  buyer: AdminOrderParty | null
  seller: AdminOrderParty | null
  statusHistories?: AdminOrderStatusHistory[]
  walletTransactions?: Array<{
    txId?: string
    type?: string
    status?: string
    amount?: number
    createdAt?: string
    [key: string]: unknown
  }>
  dispute?: { id?: string; status?: string; [key: string]: unknown } | null
}

export type ForceActionResult = {
  orderId: string
  status: string
}

/**
 * UUID v4 sederhana untuk `Idempotency-Key` (lihat finance.ts — kunci
 * per panggilan agar double-tap tidak mengeksekusi dua kali).
 */
function newIdempotencyKey(): string {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = Math.floor(Math.random() * 16)
    const v = c === "x" ? r : (r & 0x3) | 0x8
    return v.toString(16)
  })
}

/** Daftar semua order; `q` dipetakan ke param `search` backend (orderId/judul). */
export function listAdminOrders(query?: {
  q?: string
  status?: AdminOrderStatus
  page?: number
  limit?: number
  hasEscrow?: boolean
}): Promise<Paginated<AdminOrderItem>> {
  const { q, ...rest } = query ?? {}
  return adminHttp.get<Paginated<AdminOrderItem>>("/v1/admin/orders", {
    query: { ...rest, search: q?.trim() || undefined },
  })
}

/** Detail order: pihak pembeli/penjual, transaksi escrow, riwayat status. */
export function getAdminOrderDetail(orderId: string): Promise<AdminOrderDetail> {
  return adminHttp.get<AdminOrderDetail>(
    `/v1/admin/orders/${encodeURIComponent(orderId)}`,
  )
}

/**
 * Paksa batal order (intervensi escrow, termasuk refund). `reason` wajib
 * (min 10 karakter).
 */
export function forceCancelOrder(
  orderId: string,
  reason: string,
): Promise<ForceActionResult> {
  return adminHttp.post<ForceActionResult>(
    `/v1/admin/orders/${encodeURIComponent(orderId)}/force-cancel`,
    { reason },
    { headers: { "Idempotency-Key": newIdempotencyKey() } },
  )
}

/**
 * Paksa selesaikan order — escrow dicairkan ke penjual (intervensi escrow).
 * Hanya untuk order PROCESSING / IN_DELIVERY. `reason` wajib (min 10 karakter).
 */
export function forceCompleteOrder(
  orderId: string,
  reason: string,
): Promise<ForceActionResult> {
  return adminHttp.post<ForceActionResult>(
    `/v1/admin/orders/${encodeURIComponent(orderId)}/force-complete`,
    { reason },
    { headers: { "Idempotency-Key": newIdempotencyKey() } },
  )
}
