/** Peta label & tone status KYC — dipakai halaman daftar & detail. */

export const KYC_STATUS_LABEL: Record<string, string> = {
  UNVERIFIED: "Belum verifikasi",
  PENDING: "Menunggu",
  APPROVED: "Disetujui",
  REJECTED: "Ditolak",
  REVOKED: "Dicabut",
}

export const KYC_STATUS_TONE: Record<
  string,
  "neutral" | "info" | "success" | "warning" | "danger" | "accent"
> = {
  UNVERIFIED: "neutral",
  PENDING: "warning",
  APPROVED: "success",
  REJECTED: "danger",
  REVOKED: "neutral",
}
