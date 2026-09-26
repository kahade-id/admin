/** Kahade admin — manajemen kampanye voucher (CRUD + aktivasi/jeda). */
import { adminHttp } from "@/lib/api/admin-client"
import type { Paginated } from "@/lib/api/admin/kyc"

export type AdminCampaignType = "FEE_PROMO" | "SUBSCRIPTION_DISCOUNT" | "CASHBACK"

export type AdminCampaignStatus = "DRAFT" | "ACTIVE" | "PAUSED" | "ENDED"

export type AdminMembershipRank =
  | "BRONZE"
  | "SILVER"
  | "GOLD"
  | "PLATINUM"
  | "DIAMOND"

export interface AdminCampaignItem {
  id?: string
  campaignId: string
  name: string
  description?: string | null
  type: AdminCampaignType
  status: AdminCampaignStatus
  startsAt: string
  endsAt: string
  promoCode?: string | null
  discountValue?: number | null
  discountPercent?: number | null
  maxDiscount?: number | null
  freeTransactions?: number | null
  targetAudience?: string | null
  targetMinRank?: AdminMembershipRank | null
  targetDormantDays?: number | null
  targetNewUserOnly?: boolean | null
  maxRedemptions?: number | null
  currentRedemptions?: number
  rolloutPercent?: number | null
  createdAt?: string
  updatedAt?: string
}

export interface CreateCampaignInput {
  name: string
  description?: string
  type: AdminCampaignType
  startsAt: string
  endsAt: string
  promoCode?: string
  discountValue?: number
  discountPercent?: number
  maxDiscount?: number
  freeTransactions?: number
  targetAudience?: string
  targetMinRank?: AdminMembershipRank
  targetDormantDays?: number
  targetNewUserOnly?: boolean
  maxRedemptions?: number
  rolloutPercent?: number
}

export interface UpdateCampaignInput {
  name?: string
  description?: string
  startsAt?: string
  endsAt?: string
  promoCode?: string
  targetAudience?: string
  targetMinRank?: AdminMembershipRank
  targetDormantDays?: number
  targetNewUserOnly?: boolean
  maxRedemptions?: number
  status?: AdminCampaignStatus
  rolloutPercent?: number
}

export interface CampaignActivationResult extends AdminCampaignItem {
  /** Ringkasan penerbitan voucher personal saat aktivasi. */
  voucherIssuance?: {
    issued?: number
    skipped?: number
    errors?: number
    [key: string]: unknown
  }
}

/** GET /v1/admin/campaigns — daftar kampanye. */
export function listCampaigns(params?: {
  page?: number
  limit?: number
  status?: AdminCampaignStatus
}): Promise<Paginated<AdminCampaignItem>> {
  return adminHttp.get<Paginated<AdminCampaignItem>>("/v1/admin/campaigns", {
    query: params,
  })
}

/** POST /v1/admin/campaigns — buat kampanye baru. */
export function createCampaign(
  input: CreateCampaignInput,
): Promise<AdminCampaignItem> {
  return adminHttp.post<AdminCampaignItem>("/v1/admin/campaigns", input)
}

/** GET /v1/admin/campaigns/:campaignId — detail kampanye. */
export function getCampaign(campaignId: string): Promise<AdminCampaignItem> {
  return adminHttp.get<AdminCampaignItem>(
    `/v1/admin/campaigns/${encodeURIComponent(campaignId)}`,
  )
}

/** PUT /v1/admin/campaigns/:campaignId — ubah kampanye. */
export function updateCampaign(
  campaignId: string,
  input: UpdateCampaignInput,
): Promise<AdminCampaignItem> {
  return adminHttp.put<AdminCampaignItem>(
    `/v1/admin/campaigns/${encodeURIComponent(campaignId)}`,
    input,
  )
}

/** DELETE /v1/admin/campaigns/:campaignId — hapus kampanye. */
export function deleteCampaign(campaignId: string): Promise<{ message: string }> {
  return adminHttp.delete<{ message: string }>(
    `/v1/admin/campaigns/${encodeURIComponent(campaignId)}`,
  )
}

/**
 * POST /v1/admin/campaigns/:campaignId/activate — aktifkan kampanye dan
 * terbitkan voucher personal untuk pengguna yang memenuhi syarat.
 */
export function activateCampaign(
  campaignId: string,
): Promise<CampaignActivationResult> {
  return adminHttp.post<CampaignActivationResult>(
    `/v1/admin/campaigns/${encodeURIComponent(campaignId)}/activate`,
  )
}

/** POST /v1/admin/campaigns/:campaignId/pause — jeda kampanye. */
export function pauseCampaign(campaignId: string): Promise<AdminCampaignItem> {
  return adminHttp.post<AdminCampaignItem>(
    `/v1/admin/campaigns/${encodeURIComponent(campaignId)}/pause`,
  )
}
