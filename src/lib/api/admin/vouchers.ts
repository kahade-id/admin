/** Kahade admin — manajemen voucher (list, buat, detail, nonaktifkan, aktifkan kembali). */
import { adminHttp } from "@/lib/api/admin-client"
import type { Paginated } from "@/lib/api/admin/kyc"
import { newIdempotencyKey } from "@/lib/api/admin/finance"

/** Header idempotency untuk aksi voucher: satu kunci stabil per sesi aksi. */
const idemHeaders = (key?: string): Record<string, string> => ({
  "Idempotency-Key": key ?? newIdempotencyKey(),
})

export type AdminVoucherType =
  | "FEE_DISCOUNT_FLAT"
  | "FEE_DISCOUNT_PERCENT"
  | "WALLET_CASHBACK"
  | "TOPUP_BONUS"

export type AdminVoucherApplicability =
  | "ALL"
  | "BUYER_ONLY"
  | "SELLER_ONLY"
  | "NEW_USER"
  | "DORMANT_USER"

export interface AdminVoucherItem {
  id: string
  voucherId?: string
  code: string
  name: string
  description?: string | null
  voucherType: AdminVoucherType
  discountAmount?: number | null
  discountPercent?: number | null
  maxDiscountAmount?: number | null
  maxUsageTotal?: number | null
  maxUsagePerUser?: number | null
  minOrderValue?: number | null
  applicableTo?: AdminVoucherApplicability | null
  isActive: boolean
  validFrom: string
  validUntil: string
  usageCount?: number
  createdAt: string
  updatedAt?: string
}

export interface AdminVoucherUsage {
  id: string
  discountApplied?: number | null
  usedAt?: string
  user?: {
    id: string
    userId?: string
    fullName?: string | null
    email?: string | null
    /** Nomor HP — bila dikembalikan backend, ditampilkan termasking. */
    phone?: string | null
  } | null
}

export interface AdminVoucherDetail extends AdminVoucherItem {
  usages?: AdminVoucherUsage[]
}

export interface CreateVoucherInput {
  code: string
  name: string
  description?: string
  voucherType: AdminVoucherType
  discountAmount?: number
  discountPercent?: number
  maxDiscountAmount?: number
  maxUsageTotal?: number
  maxUsagePerUser?: number
  validFrom: string
  validUntil: string
  minOrderValue?: number
  applicableTo?: AdminVoucherApplicability
  /** ID user untuk voucher personal — backend memvalidasi keberadaan user (SP-048). */
  assignedToUserId?: string
}

export interface VoucherListQuery {
  page?: number
  limit?: number
  /** "true" | "false" — filter status aktif */
  isActive?: "true" | "false"
  /** Pencarian kode/nama voucher (diteruskan ke backend bila didukung). */
  q?: string
}

/** GET /v1/admin/vouchers — daftar voucher. */
export function listVouchers(
  params?: VoucherListQuery,
): Promise<Paginated<AdminVoucherItem>> {
  return adminHttp.get<Paginated<AdminVoucherItem>>("/v1/admin/vouchers", {
    query: params as Record<string, string | number | boolean | null | undefined>,
  })
}

/** POST /v1/admin/vouchers — buat voucher baru (idempoten, ADM-219). */
export function createVoucher(
  input: CreateVoucherInput,
  idempotencyKey?: string,
): Promise<AdminVoucherItem> {
  return adminHttp.post<AdminVoucherItem>("/v1/admin/vouchers", input, {
    headers: idemHeaders(idempotencyKey),
  })
}

/** GET /v1/admin/vouchers/:voucherId — detail + statistik pemakaian. */
export function getVoucherDetail(voucherId: string): Promise<AdminVoucherDetail> {
  return adminHttp.get<AdminVoucherDetail>(
    `/v1/admin/vouchers/${encodeURIComponent(voucherId)}`,
  )
}

/** POST /v1/admin/vouchers/:voucherId/deactivate — nonaktifkan voucher (idempoten, ADM-219). */
export function deactivateVoucher(
  voucherId: string,
  idempotencyKey?: string,
): Promise<AdminVoucherItem> {
  return adminHttp.post<AdminVoucherItem>(
    `/v1/admin/vouchers/${encodeURIComponent(voucherId)}/deactivate`,
    {},
    { headers: idemHeaders(idempotencyKey) },
  )
}

/**
 * POST /v1/admin/vouchers/:voucherId/reactivate — aktifkan kembali voucher
 * yang dinonaktifkan (ADM-218). Hanya untuk voucher nonaktif yang belum
 * kedaluwarsa; fail-closed di backend. Idempoten (ADM-219).
 */
export function reactivateVoucher(
  voucherId: string,
  idempotencyKey?: string,
): Promise<AdminVoucherItem> {
  return adminHttp.post<AdminVoucherItem>(
    `/v1/admin/vouchers/${encodeURIComponent(voucherId)}/reactivate`,
    {},
    { headers: idemHeaders(idempotencyKey) },
  )
}
