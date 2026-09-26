/**
 * Kahade admin — badge & award (termasuk centang EMAS eksklusif).
 *
 * Centang emas = badge dengan tier "gold" yang di-award manual oleh admin
 * lewat `awardBadge`. Daftar badge yang tersedia dikelola di layar ini.
 */
import { adminHttp } from "@/lib/api/admin-client"
import type { Paginated } from "@/lib/api/admin/kyc"

export type AdminBadge = {
  id: string
  name: string
  iconUrl?: string | null
  description?: string | null
  tier?: "gold" | "blue" | "gray" | string | null
  createdAt?: string
  holderCount?: number
  [key: string]: unknown
}

export type BadgeHolder = {
  userId: string
  username?: string
  fullName?: string | null
  awardedAt: string
  [key: string]: unknown
}

export function listBadges(params?: { page?: number; limit?: number }): Promise<Paginated<AdminBadge>> {
  return adminHttp.get<Paginated<AdminBadge>>("/v1/admin/badges", { query: params })
}

export function getBadgeDetail(badgeId: string): Promise<AdminBadge & { holders?: BadgeHolder[] }> {
  return adminHttp.get(`/v1/admin/badges/${encodeURIComponent(badgeId)}`)
}

export function createBadge(input: {
  name: string
  description?: string
  iconUrl?: string
}): Promise<AdminBadge> {
  return adminHttp.post<AdminBadge>("/v1/admin/badges", input)
}

export function updateBadge(
  badgeId: string,
  input: { name?: string; description?: string; iconUrl?: string },
): Promise<AdminBadge> {
  return adminHttp.put<AdminBadge>(`/v1/admin/badges/${encodeURIComponent(badgeId)}`, input)
}

export function deleteBadge(badgeId: string): Promise<unknown> {
  return adminHttp.delete(`/v1/admin/badges/${encodeURIComponent(badgeId)}`)
}

/** Beri badge ke user — untuk centang emas, pilih badge tier gold. */
export function awardBadge(badgeId: string, userId: string): Promise<unknown> {
  return adminHttp.post(
    `/v1/admin/badges/${encodeURIComponent(badgeId)}/award/${encodeURIComponent(userId)}`,
    {},
  )
}

export function revokeBadge(badgeId: string, userId: string): Promise<unknown> {
  return adminHttp.delete(
    `/v1/admin/badges/${encodeURIComponent(badgeId)}/revoke/${encodeURIComponent(userId)}`,
  )
}
