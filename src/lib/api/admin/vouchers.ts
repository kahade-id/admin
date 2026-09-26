/** Kahade admin — manajemen voucher (list, buat, detail, nonaktifkan). */
import { adminHttp } from "@/lib/api/admin-client"
import type { Paginated } from "@/lib/api/admin/kyc"

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
}

export interface VoucherListQuery {
  page?: number
  limit?: number
  /** "true" | "false" — filter status aktif */
  isActive?: "true" | "false"
}

/** GET /v1/admin/vouchers — daftar voucher. */
export function listVouchers(
  params?: VoucherListQuery,
): Promise<Paginated<AdminVoucherItem>> {
  return adminHttp.get<Paginated<AdminVoucherItem>>("/v1/admin/vouchers", {
    query: params as Record<string, string | number | boolean | null | undefined>,
  })
}

/** POST /v1/admin/vouchers — buat voucher baru. */
export function createVoucher(
  input: CreateVoucherInput,
): Promise<AdminVoucherItem> {
  return adminHttp.post<AdminVoucherItem>("/v1/admin/vouchers", input)
}

/** GET /v1/admin/vouchers/:voucherId — detail + statistik pemakaian. */
export function getVoucherDetail(voucherId: string): Promise<AdminVoucherDetail> {
  return adminHttp.get<AdminVoucherDetail>(
    `/v1/admin/vouchers/${encodeURIComponent(voucherId)}`,
  )
}

/** POST /v1/admin/vouchers/:voucherId/deactivate — nonaktifkan voucher. */
export function deactivateVoucher(voucherId: string): Promise<AdminVoucherItem> {
  return adminHttp.post<AdminVoucherItem>(
    `/v1/admin/vouchers/${encodeURIComponent(voucherId)}/deactivate`,
  )
}
