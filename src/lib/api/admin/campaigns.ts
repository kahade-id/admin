/** Kahade admin — manajemen kampanye voucher (CRUD + aktivasi/jeda). */
import { adminHttp } from "@/lib/api/admin-client"
import type { Paginated } from "@/lib/api/admin/kyc"
import { newIdempotencyKey } from "@/lib/api/admin/finance"
import { STEP_UP_HEADER } from "@/lib/api/admin/step-up"

/** Opsi step-up untuk mutasi kampanye — backend mewajibkan @RequireStepUp. */
export type CampaignStepUpOpts = { stepUpToken?: string }

function stepUpHeader(opts?: CampaignStepUpOpts): Record<string, string> {
  return opts?.stepUpToken ? { [STEP_UP_HEADER]: opts.stepUpToken } : {}
}

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
  /** Nama/id pembuat kampanye (bila backend mengembalikannya). */
  createdBy?: string | null
  createdByName?: string | null
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

/** Satu entri riwayat versi/audit perubahan kampanye. */
export interface CampaignVersionChange {
  field: string
  from?: unknown
  to?: unknown
}

export interface AdminCampaignVersion {
  id?: string
  version?: number
  changedAt: string
  changedBy?: string | null
  actorName?: string | null
  action?: string | null
  note?: string | null
  changes?: CampaignVersionChange[] | Record<string, unknown> | string[] | null
}

/** GET /v1/admin/campaigns — daftar kampanye. */
export function listCampaigns(params?: {
  page?: number
  limit?: number
  status?: AdminCampaignStatus
  /** Filter pembuat (diteruskan ke backend bila didukung). */
  createdBy?: string
  /** Rentang tanggal mulai kampanye, "YYYY-MM-DD".
   *  BAD-014: backend membaca @Query('from')/@Query('to') — param asing
   *  diabaikan diam-diam sehingga filter tak berfungsi bila salah nama. */
  from?: string
  /** Rentang tanggal mulai kampanye, "YYYY-MM-DD". */
  to?: string
}): Promise<Paginated<AdminCampaignItem>> {
  return adminHttp.get<Paginated<AdminCampaignItem>>("/v1/admin/campaigns", {
    query: params,
  })
}

/** POST /v1/admin/campaigns — buat kampanye baru. Backend: @RequireStepUp('campaign.create'). */
export function createCampaign(
  input: CreateCampaignInput,
  opts?: CampaignStepUpOpts,
): Promise<AdminCampaignItem> {
  return adminHttp.post<AdminCampaignItem>("/v1/admin/campaigns", input, {
    headers: stepUpHeader(opts),
  })
}

/** GET /v1/admin/campaigns/:campaignId — detail kampanye. */
export function getCampaign(campaignId: string): Promise<AdminCampaignItem> {
  return adminHttp.get<AdminCampaignItem>(
    `/v1/admin/campaigns/${encodeURIComponent(campaignId)}`,
  )
}

/**
 * PUT /v1/admin/campaigns/:campaignId — ubah kampanye.
 * Backend: @RequireStepUp('campaign.update','campaignId'); { changeReason } min 5 (P1-8).
 */
export function updateCampaign(
  campaignId: string,
  input: UpdateCampaignInput & { changeReason: string },
  opts?: CampaignStepUpOpts,
): Promise<AdminCampaignItem> {
  return adminHttp.put<AdminCampaignItem>(
    `/v1/admin/campaigns/${encodeURIComponent(campaignId)}`,
    input,
    { headers: stepUpHeader(opts) },
  )
}

/** DELETE /v1/admin/campaigns/:campaignId — hapus kampanye. Backend: @RequireStepUp('campaign.delete','campaignId'). */
export function deleteCampaign(
  campaignId: string,
  opts?: CampaignStepUpOpts,
): Promise<{ message: string }> {
  return adminHttp.delete<{ message: string }>(
    `/v1/admin/campaigns/${encodeURIComponent(campaignId)}`,
    { headers: stepUpHeader(opts) },
  )
}

/**
 * POST /v1/admin/campaigns/:campaignId/activate — aktifkan kampanye dan
 * terbitkan voucher personal untuk pengguna yang memenuhi syarat.
 * BAI-007: backend mewajibkan { reason } (min 5 karakter).
 * Backend: @RequireStepUp('campaign.activate','campaignId') + @Idempotency() (P1-7).
 */
export function activateCampaign(
  campaignId: string,
  reason: string,
  idempotencyKey?: string,
  opts?: CampaignStepUpOpts,
): Promise<CampaignActivationResult> {
  return adminHttp.post<CampaignActivationResult>(
    `/v1/admin/campaigns/${encodeURIComponent(campaignId)}/activate`,
    { reason },
    {
      headers: {
        "Idempotency-Key": idempotencyKey ?? newIdempotencyKey(),
        ...stepUpHeader(opts),
      },
    },
  )
}

/**
 * POST /v1/admin/campaigns/:campaignId/pause — jeda kampanye.
 * BAI-007: backend mewajibkan { reason } (min 5 karakter).
 * Backend: @RequireStepUp('campaign.pause','campaignId').
 */
export function pauseCampaign(
  campaignId: string,
  reason: string,
  opts?: CampaignStepUpOpts,
): Promise<AdminCampaignItem> {
  return adminHttp.post<AdminCampaignItem>(
    `/v1/admin/campaigns/${encodeURIComponent(campaignId)}/pause`,
    { reason },
    { headers: stepUpHeader(opts) },
  )
}

/**
 * POST /v1/admin/campaigns/:campaignId/duplicate — duplikasi kampanye ke
 * draf baru. Backend mengembalikan kampanye draf hasil duplikasi.
 * Backend: @RequireStepUp('campaign.duplicate','campaignId').
 */
export function duplicateCampaign(
  campaignId: string,
  opts?: CampaignStepUpOpts,
): Promise<AdminCampaignItem> {
  return adminHttp.post<AdminCampaignItem>(
    `/v1/admin/campaigns/${encodeURIComponent(campaignId)}/duplicate`,
    {},
    { headers: stepUpHeader(opts) },
  )
}

function unwrapVersionList(
  raw: unknown,
): AdminCampaignVersion[] {
  if (Array.isArray(raw)) return raw as AdminCampaignVersion[]
  if (raw && typeof raw === "object") {
    const r = raw as Record<string, unknown>
    if (Array.isArray(r.versions)) return r.versions as AdminCampaignVersion[]
    if (Array.isArray(r.data)) return r.data as AdminCampaignVersion[]
  }
  return []
}

/**
 * GET /v1/admin/campaigns/:campaignId/versions — riwayat versi + audit
 * perubahan kampanye. Melempar bila endpoint belum tersedia (404) —
 * pemanggil sebaiknya try/catch dan menyembunyikan section.
 */
export async function getCampaignVersions(
  campaignId: string,
): Promise<AdminCampaignVersion[]> {
  const raw = await adminHttp.get<unknown>(
    `/v1/admin/campaigns/${encodeURIComponent(campaignId)}/versions`,
  )
  return unwrapVersionList(raw)
}
