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
