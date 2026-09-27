/** Peta label & tone status verifikasi bisnis — dipakai halaman daftar & detail. */

export const BUSINESS_STATUS_LABEL: Record<string, string> = {
  PENDING: "Menunggu",
  APPROVED: "Disetujui",
  REJECTED: "Ditolak",
  REVOKED: "Dicabut",
}

export const BUSINESS_STATUS_TONE: Record<
  string,
  "neutral" | "info" | "success" | "warning" | "danger" | "accent"
> = {
  PENDING: "warning",
  APPROVED: "success",
  REJECTED: "danger",
  REVOKED: "neutral",
}

/**
 * Alasan pencabutan standar (dropdown di dialog cabut persetujuan).
 * "Lainnya" membuka kolom teks bebas. Semua opsi >= 10 karakter
 * (syarat backend RevokeBusinessVerificationDto).
 */
export const BUSINESS_REVOKE_REASONS = [
  "Dokumen legalitas tidak valid atau kedaluwarsa",
  "Data badan usaha tidak sesuai dengan dokumen pendukung",
  "NPWP terindikasi ganda atau disalahgunakan",
  "Badan usaha telah dibubarkan",
  "Atas permintaan pemohon",
  "Lainnya (tulis manual)",
]

export const BUSINESS_REVOKE_CUSTOM = "Lainnya (tulis manual)"
