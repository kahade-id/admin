/**
 * Alarm masa berlaku legalitas badan usaha (GAP-E G322).
 *
 * Skema tidak menyimpan tanggal kedaluwarsa per dokumen (tanpa migrasi),
 * sehingga alarm dihitung dari `approvedAt`: persetujuan verifikasi dianggap
 * berlaku selama LEGALITY_VALIDITY_DAYS hari — setelah itu badan usaha perlu
 * verifikasi ulang. Nilai ini SEMENTARA dan butuh KEPUTUSAN PRODUK (berapa
 * lama persetujuan berlaku; apakah tiap jenis dokumen punya masa berlaku
 * sendiri — butuh kolom validUntil per dokumen + migrasi).
 *
 * Mirror dari backend
 * `src/modules/admin/business-verification/admin-business-verification.service.ts`
 * (LEGALITY_VALIDITY_DAYS / legalitasValidUntil / legalitasStatus).
 * Fungsi murni — bisa di-unit-test.
 */

/** Masa berlaku persetujuan verifikasi: 3 tahun (SEMENTARA — keputusan produk). */
export const LEGALITY_VALIDITY_DAYS = 3 * 365
/** Ambang "segera kedaluwarsa": sisa <= 90 hari. */
export const LEGALITY_WARNING_DAYS = 90

export type LegalitasStatus = "ok" | "warning" | "expired" | "na"

/** Tanggal kedaluwarsa = approvedAt + masa berlaku — null bila belum disetujui. */
export function legalitasValidUntil(approvedAt: unknown): Date | null {
  if (approvedAt == null || approvedAt === "") return null
  const date = approvedAt instanceof Date ? approvedAt : new Date(approvedAt as string)
  if (Number.isNaN(date.getTime())) return null
  return new Date(date.getTime() + LEGALITY_VALIDITY_DAYS * 24 * 60 * 60 * 1000)
}

/** Status masa berlaku dari approvedAt. */
export function legalitasStatus(
  approvedAt: unknown,
  nowMs = Date.now(),
): LegalitasStatus {
  const validUntil = legalitasValidUntil(approvedAt)
  if (!validUntil) return "na"
  const remainingMs = validUntil.getTime() - nowMs
  if (remainingMs <= 0) return "expired"
  if (remainingMs <= LEGALITY_WARNING_DAYS * 24 * 60 * 60 * 1000) return "warning"
  return "ok"
}

/** Label Indonesia untuk badge alarm legalitas. */
export const LEGALITAS_STATUS_LABEL: Record<Exclude<LegalitasStatus, "ok" | "na">, string> = {
  warning: "Segera kedaluwarsa",
  expired: "Legalitas kedaluwarsa",
}
