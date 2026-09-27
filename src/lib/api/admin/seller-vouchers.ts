/**
 * Kahade admin — voucher buatan penjual/seller (batch 43, item #11).
 *
 * KONTRAK ASUMSI (belum diverifikasi ke backend): cabang backend
 * `mega/be-commerce` belum tersedia di remote saat modul ini dibuat
 * (2026-09-28). Path endpoint berikut adalah asumsi berdasarkan konvensi
 * `/v1/admin/*` yang sudah ada — sesuaikan dengan kontrak final backend
 * bila berbeda:
 *   GET  /v1/admin/seller-vouchers            — daftar (query: page, limit, isActive, q)
 *   GET  /v1/admin/seller-vouchers/:id        — detail + statistik pemakaian
 *   POST /v1/admin/seller-vouchers/:id/deactivate — nonaktifkan (idempoten)
 *
 * Admin hanya memantau + menonaktifkan; pembuatan voucher dilakukan
 * penjual dari aplikasi mobile.
 */
import { adminHttp } from "@/lib/api/admin-client"
import type { Paginated } from "@/lib/api/admin/kyc"
import { newIdempotencyKey } from "@/lib/api/admin/finance"

const idemHeaders = (key?: string): Record<string, string> => ({
  "Idempotency-Key": key ?? newIdempotencyKey(),
})

export interface SellerVoucherItem {
  id: string
  code: string
  name: string
  description?: string | null
  sellerId: string
  sellerName?: string | null
  sellerShopName?: string | null
  discountAmount?: number | null
  discountPercent?: number | null
  maxDiscountAmount?: number | null
  minOrderValue?: number | null
  usageQuota?: number | null
  usageCount?: number
  isActive: boolean
  startsAt: string
  endsAt: string
  createdAt: string
  updatedAt?: string | null
}

export interface SellerVoucherUsage {
  id: string
  discountApplied?: number | null
  orderId?: string | null
  usedAt?: string
  user?: {
    id: string
    fullName?: string | null
    email?: string | null
    phone?: string | null
  } | null
}

export interface SellerVoucherDetail extends SellerVoucherItem {
  usages?: SellerVoucherUsage[]
}

export interface SellerVoucherListQuery {
  page?: number
  limit?: number
  /** "true" | "false" — filter status aktif. */
  isActive?: "true" | "false"
  /** Pencarian kode/nama voucher atau nama penjual (diteruskan ke backend bila didukung). */
  q?: string
}

/** GET /v1/admin/seller-vouchers — daftar voucher seller. */
export function listSellerVouchers(
  params?: SellerVoucherListQuery,
): Promise<Paginated<SellerVoucherItem>> {
  return adminHttp.get<Paginated<SellerVoucherItem>>("/v1/admin/seller-vouchers", {
    query: params as Record<string, string | number | boolean | null | undefined>,
  })
}

/** GET /v1/admin/seller-vouchers/:id — detail + riwayat pemakaian. */
export function getSellerVoucherDetail(voucherId: string): Promise<SellerVoucherDetail> {
  return adminHttp.get<SellerVoucherDetail>(
    `/v1/admin/seller-vouchers/${encodeURIComponent(voucherId)}`,
  )
}

/**
 * POST /v1/admin/seller-vouchers/:id/deactivate — nonaktifkan voucher seller
 * (idempoten). Penjual tetap melihat voucher sebagai nonaktif; tidak
 * menghapus data.
 */
export function deactivateSellerVoucher(
  voucherId: string,
  idempotencyKey?: string,
): Promise<SellerVoucherItem> {
  return adminHttp.post<SellerVoucherItem>(
    `/v1/admin/seller-vouchers/${encodeURIComponent(voucherId)}/deactivate`,
    {},
    { headers: idemHeaders(idempotencyKey) },
  )
}
