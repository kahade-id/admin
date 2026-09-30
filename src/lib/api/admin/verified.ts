/**
 * Kahade admin — tier verifikasi 3 tingkat (koreksi model 2026-09-26).
 *
 * 1. Abu  = FULLY_VERIFIED    : otomatis (email + KYC + HP + alamat lengkap +
 *    Kahade Plus aktif). Admin bisa revoke (alasan min 10) / restore.
 * 2. Biru = BUSINESS_VERIFIED : verifikasi manual admin via modul
 *    business-verification (lihat `business.ts`), bukan endpoint di sini.
 * 3. Emas = TRUSTED_BY_KAHADE : diberikan manual oleh SUPER_ADMIN ke customer
 *    pilihan; bisa dicabut kapan pun.
 *
 * Badge (sistem `Badge`/`UserBadge`) adalah domain TERPISAH untuk
 * event/pencapaian — BUKAN verifikasi. Jangan campur keduanya.
 */
import { adminHttp } from "@/lib/api/admin-client"
import { API_BASE_URL } from "@/lib/api/config"
import { unwrapResponse } from "@/lib/api/response"

/** Tipe badge verifikasi publik (dari VerificationBadgeService backend). */
export type VerificationBadgeType =
  | "FULLY_VERIFIED"
  | "KYC_VERIFIED"
  | "BUSINESS_VERIFIED"
  | "KAHADE_PLUS"
  | "TRUSTED_BY_KAHADE"
  | "CONTACT_VERIFIED"
  | string

export type VerificationBadge = {
  type: VerificationBadgeType
  labelKey: string
  label: string
  shortLabel: string
  description?: string
  icon?: string
  [key: string]: unknown
}

export type VerificationBadgesResponse = {
  username: string
  badges: VerificationBadge[]
}

/**
 * Beri tier emas ke customer pilihan. Hanya SUPER_ADMIN.
 * Idempoten: bila user sudah memegang tier emas, tetap 200.
 */
export function grantGoldVerified(userId: string): Promise<{ message: string }> {
  return adminHttp.post<{ message: string }>(
    `/v1/admin/users/${encodeURIComponent(userId)}/verified/gold/grant`,
    {},
  )
}

/**
 * Cabut tier emas. Hanya SUPER_ADMIN.
 * 400 bila user tidak memegang tier emas.
 */
export function revokeGoldVerified(userId: string): Promise<{ message: string }> {
  return adminHttp.post<{ message: string }>(
    `/v1/admin/users/${encodeURIComponent(userId)}/verified/gold/revoke`,
    {},
  )
}

/**
 * Cabut tier abu manual. HANYA SUPER_ADMIN (backend @AdminRoles('SUPER_ADMIN')).
 * Syarat otomatis tidak diubah; badge hilang sampai di-restore.
 * 409 bila tier abu sudah di-revoke.
 */
export function revokeGrayVerified(
  userId: string,
  reason: string,
): Promise<{ message: string }> {
  return adminHttp.post<{ message: string }>(
    `/v1/admin/users/${encodeURIComponent(userId)}/verified/gray/revoke`,
    { reason },
  )
}

/**
 * Pulihkan tier abu yang sebelumnya di-revoke. SUPER_ADMIN dan KYC_ADMIN.
 * 400 bila tier abu tidak sedang di-revoke.
 */
export function restoreGrayVerified(userId: string): Promise<{ message: string }> {
  return adminHttp.post<{ message: string }>(
    `/v1/admin/users/${encodeURIComponent(userId)}/verified/gray/restore`,
    {},
  )
}

/**
 * Baca badge verifikasi aktif seorang user (endpoint publik, dipakai admin
 * untuk melihat tier yang sedang aktif). Butuh username; melempar 404 untuk
 * profil privat/nonaktif/diblokir — tangani di pemanggil.
 *
 * ADM-023: endpoint publik — pakai `fetch` polos TANPA bearer admin
 * (sebelumnya via adminHttp → token admin dikirim ke endpoint yang tidak
 * membutuhkannya + memicu alur refresh-on-401 yang tidak relevan).
 */
export async function getUserVerificationBadges(
  username: string,
): Promise<VerificationBadgesResponse> {
  const res = await fetch(
    `${API_BASE_URL}/v1/users/${encodeURIComponent(username)}/badges`,
  )
  if (!res.ok) {
    const err = new Error(
      `GET /v1/users/${username}/badges gagal (${res.status})`,
    ) as Error & { status?: number }
    err.status = res.status
    throw err
  }
  const json = await res.json().catch(() => null)
  return unwrapResponse(json) as VerificationBadgesResponse
}
