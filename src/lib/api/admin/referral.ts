/**
 * Kahade admin — statistik & kode referral.
 *
 * Endpoint: GET `/v1/admin/referral/stats`, GET `/v1/admin/referral/codes`
 * (lihat `backend/src/modules/admin/referral/admin-referral.controller.ts`).
 *
 * Catatan kontrak:
 * - Stats: total kode, kode aktif, relasi, reward, reward pending, dan
 *   `totalRewardsPaid` (rupiah, number — hasil `toIdr`).
 * - Codes: paginated; filter `isActive` ("true"/"false");
 *   `totalRewardEarned` dikembalikan sebagai rupiah (number).
 */
import { adminHttp } from "@/lib/api/admin-client"
import type { Paginated } from "@/lib/api/admin/kyc"

export type ReferralStats = {
  totalCodes: number
  activeCodes: number
  totalRelations: number
  totalRewards: number
  pendingRewards: number
  totalRewardsPaid: number
  [key: string]: unknown
}

export type ReferralCodeItem = {
  id: string
  userId?: string
  code?: string
  isActive?: boolean
  totalReferrals?: number
  totalRewardEarned?: number
  createdAt?: string
  user?: {
    id?: string
    userId?: string
    username?: string | null
    fullName?: string | null
    email?: string | null
    [key: string]: unknown
  } | null
  [key: string]: unknown
}

/** Statistik referral platform (kode, relasi, reward). */
export function getReferralStats(): Promise<ReferralStats> {
  return adminHttp.get<ReferralStats>("/v1/admin/referral/stats")
}

/** Daftar kode referral; `active=true/false` filter status aktif. */
export function listReferralCodes(query?: {
  page?: number
  limit?: number
  active?: boolean
}): Promise<Paginated<ReferralCodeItem>> {
  return adminHttp.get<Paginated<ReferralCodeItem>>("/v1/admin/referral/codes", {
    query: {
      page: query?.page,
      limit: query?.limit,
      isActive: query?.active === undefined ? undefined : String(query.active),
    },
  })
}
