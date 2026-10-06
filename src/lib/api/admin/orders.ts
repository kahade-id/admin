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
import { STEP_UP_HEADER } from "@/lib/api/admin/step-up"
import type { OrderKind } from "@/lib/order-kind"

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
  /**
   * POIN 2 (unifikasi transaksi escrow): tipe transaksi order
   * (DIRECT|JASTIP|PATUNGAN|SERVICE_BOOKING) — deprecated, dipertahankan
   * untuk kompatibilitas.
   */
  orderKind?: OrderKind | string | null
  /**
   * TX-UNIFIED-V2: 3 dimensi independen pengganti orderKind flat.
   * Dikirim backend bila kolomnya sudah diimplementasikan.
   */
  fulfillment?: string | null
  participantMode?: string | null
  category?: string | null
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
  // Lokasi presisi pembeli (fraud checking) — backend menyimpan terenkripsi
  // (migrasi 20261006000000) dan mengembalikan terdekripsi fail-closed.
  // null bila order dibuat sebelum capture lokasi atau dekripsi gagal.
  buyerLocation?: {
    latitude?: string | number | null
    longitude?: string | number | null
    accuracy?: string | number | null
    capturedAt?: string | null
  } | null
  // ADM-118: info pengiriman — backend mengirimnya via spread serializeOrder
  // (trackingNumber / courierName / trackingNotes / shippedAt di model Order).
  trackingNumber?: string | null
  courierName?: string | null
  trackingNotes?: string | null
  shippedAt?: string | null
  walletTransactions?: Array<{
    txId?: string
    type?: string
    status?: string
    amount?: number
    createdAt?: string
    [key: string]: unknown
  }>
  /**
   * MFE-012/MFE-013: jejak finansial DANA-direct per order — diekspos backend
   * di `GET /v1/admin/orders/:id` (field `danaPayments`). Mode tanpa-wallet:
   * tidak ada `walletTransactions` escrow; DANA-direct adalah sumber kebenaran.
   */
  danaPayments?: AdminDanaPayment[]
  dispute?: { id?: string; status?: string; [key: string]: unknown } | null
}

/**
 * MFE-012/MFE-013: snapshot charge DANA-direct untuk satu order (IDR).
 * Cerminan `danaPayments` dari `AdminOrdersService.getOrderDetail` backend.
 */
export type AdminDanaPayment = {
  id: string
  partnerReferenceNo: string
  payKind: string
  purpose: string
  status: string
  amount: number
  providerFee: number
  grossAmount: number
  refundedAmount: number
  refundReference: string | null
  danaPartnerReferenceNo: string | null
  danaReferenceNo: string | null
  paidAt: string | null
  failedAt: string | null
  createdAt: string
}

export type ForceActionResult = {
  orderId: string
  status: string
}

export type ForceActionOpts = {
  /**
   * SEC-504: kunci idempotency dibuat SEKALI per sesi dialog di pemanggil
   * (useMemo saat dialog dibuka) — retry memakai kunci yang sama.
   * Bila tidak diberi, dibuatkan (fallback).
   */
  idempotencyKey?: string
  /** Token verifikasi ulang server (header X-Step-Up-Token), bila ada. */
  stepUpToken?: string
}

/**
 * UUID v4 sederhana untuk `Idempotency-Key`.
 *
 * SEC-504: kunci dibuat SEKALI per sesi dialog di pemanggil (bukan per
 * panggilan — retry harus memakai kunci yang sama).
 *
 * CATATAN: tidak diekspor dari barrel agar tak bentrok dengan
 * `@/lib/api/admin/finance` (sumber kanonis `newIdempotencyKey`).
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
  /** ADM-117: filter periode (ISO date) — didukung backend AdminOrderQueryDto. */
  startDate?: string
  endDate?: string
  /** ADM-117: sort — createdAt | updatedAt | orderValue | buyerPayAmount | completedAt. */
  sortBy?: "createdAt" | "updatedAt" | "orderValue" | "buyerPayAmount" | "completedAt"
  sortOrder?: "asc" | "desc"
  /**
   * POIN 2 (unifikasi transaksi escrow): filter tipe transaksi — diteruskan
   * sebagai param `kind` (nama yang disepakati; BUKAN `type`) ke
   * `GET /v1/admin/orders`. Backend mengabaikan param tak dikenal bila
   * worker backend belum mendaratkan filter ini, sehingga aman dipanggil.
   * DEPRECATED: gunakan fulfillment/participantMode/category.
   */
  kind?: OrderKind | string
  /**
   * TX-UNIFIED-V2: filter 3 dimensi — diteruskan sebagai param
   * `fulfillment`, `participantMode`, `category` ke `GET /v1/admin/orders`.
   */
  fulfillment?: string
  participantMode?: string
  category?: string
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
/**
 * AUT-013: force-cancel WAJIB menyertakan password admin (reauth) — backend
 * memverifikasi password terhadap hash dan mengaudit kegagalan. Tanpa ini,
 * sesi admin yang dibiarkan terbuka bisa membatalkan escrow tanpa hambatan.
 */
export function forceCancelOrder(
  orderId: string,
  reason: string,
  password: string,
  opts?: ForceActionOpts,
): Promise<ForceActionResult> {
  const headers: Record<string, string> = {
    "Idempotency-Key": opts?.idempotencyKey ?? newIdempotencyKey(),
  }
  if (opts?.stepUpToken) {
    headers[STEP_UP_HEADER] = opts.stepUpToken
  }
  return adminHttp.post<ForceActionResult>(
    `/v1/admin/orders/${encodeURIComponent(orderId)}/force-cancel`,
    { reason, password },
    { headers },
  )
}

/**
 * Paksa selesaikan order — escrow dicairkan ke penjual (intervensi escrow).
 * Hanya untuk order PROCESSING / IN_DELIVERY. `reason` wajib (min 10 karakter).
 */
/**
 * AUT-013: force-complete WAJIB menyertakan password admin (reauth) — backend
 * memverifikasi password terhadap hash dan mengaudit kegagalan. Tanpa ini,
 * sesi admin yang dibiarkan terbuka bisa mencairkan escrow tanpa hambatan.
 */
export function forceCompleteOrder(
  orderId: string,
  reason: string,
  password: string,
  opts?: ForceActionOpts,
): Promise<ForceActionResult> {
  const headers: Record<string, string> = {
    "Idempotency-Key": opts?.idempotencyKey ?? newIdempotencyKey(),
  }
  if (opts?.stepUpToken) {
    headers[STEP_UP_HEADER] = opts.stepUpToken
  }
  return adminHttp.post<ForceActionResult>(
    `/v1/admin/orders/${encodeURIComponent(orderId)}/force-complete`,
    { reason, password },
    { headers },
  )
}
