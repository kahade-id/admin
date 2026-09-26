/**
 * Kahade admin — moderasi rating (penilaian antar pengguna).
 *
 * Endpoint: GET/DELETE/PATCH `/v1/admin/ratings/*`
 * (lihat `backend/src/modules/admin/ratings/admin-ratings.controller.ts`).
 *
 * Catatan kontrak:
 * - `listRatings` menerima filter `stars` (1–5) dan `flagged`
 *   ("true"/"false") — `flagged=true` = rating disembunyikan.
 * - `hideRating` (DELETE) dan `unhideRating` (PATCH) WAJIB mengirim body
 *   `{ reason }` (non-kosong, maks 500 karakter); backend 400 tanpanya.
 */
import { adminHttp } from "@/lib/api/admin-client"
import type { Paginated } from "@/lib/api/admin/kyc"

export type AdminRatingUser = {
  id?: string
  userId?: string
  username?: string | null
  fullName?: string | null
  [key: string]: unknown
}

export type AdminRating = {
  id: string
  stars?: number | null
  comment?: string | null
  isHidden?: boolean | null
  createdAt?: string
  giver?: AdminRatingUser | null
  receiver?: AdminRatingUser | null
  order?: { id?: string; orderId?: string | null; [key: string]: unknown } | null
  [key: string]: unknown
}

export type RatingActionResult = {
  message: string
  ratingId: string
}

/** Daftar semua rating; `hidden=true` hanya yang disembunyikan. */
export function listRatings(query?: {
  page?: number
  limit?: number
  stars?: number
  hidden?: boolean
}): Promise<Paginated<AdminRating>> {
  return adminHttp.get<Paginated<AdminRating>>("/v1/admin/ratings", {
    query: {
      page: query?.page,
      limit: query?.limit,
      stars: query?.stars,
      flagged: query?.hidden === undefined ? undefined : String(query.hidden),
    },
  })
}

/** Sembunyikan (soft-remove) rating yang tidak pantas. `reason` wajib. */
export function hideRating(
  ratingId: string,
  reason: string,
): Promise<RatingActionResult> {
  return adminHttp.delete<RatingActionResult>(
    `/v1/admin/ratings/${encodeURIComponent(ratingId)}`,
    { body: { reason } },
  )
}

/** Tampilkan kembali rating yang pernah disembunyikan. `reason` wajib. */
export function unhideRating(
  ratingId: string,
  reason: string,
): Promise<RatingActionResult> {
  return adminHttp.patch<RatingActionResult>(
    `/v1/admin/ratings/${encodeURIComponent(ratingId)}/unhide`,
    { reason },
  )
}
