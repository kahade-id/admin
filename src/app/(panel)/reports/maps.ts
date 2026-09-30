/** Peta label & tone status laporan — dipakai halaman daftar & detail. */

export const REPORT_STATUS_LABEL: Record<string, string> = {
  PENDING: "Menunggu",
  UNDER_REVIEW: "Ditinjau",
  RESOLVED_ACTION_TAKEN: "Selesai · ditindak",
  RESOLVED_NO_ACTION: "Selesai · tanpa tindakan",
  DISMISSED: "Ditolak",
  RESOLVED: "Selesai",
}

export const REPORT_STATUS_TONE: Record<
  string,
  "neutral" | "info" | "success" | "warning" | "danger" | "accent"
> = {
  PENDING: "warning",
  UNDER_REVIEW: "info",
  RESOLVED_ACTION_TAKEN: "success",
  RESOLVED_NO_ACTION: "neutral",
  RESOLVED: "success",
  DISMISSED: "neutral",
}

/** Status final: tombol aksi disembunyikan di detail. */
export const REPORT_FINAL_STATUSES = [
  "DISMISSED",
  "RESOLVED",
  "RESOLVED_ACTION_TAKEN",
  "RESOLVED_NO_ACTION",
]

/**
 * BAI-024 — label kategori laporan pengguna (backend: enum ReportCategory
 * pada model UserReport). UI me-render kolom "Alasan" dari category +
 * description, bukan field `reason` yang tidak ada di backend.
 */
export const REPORT_CATEGORY_LABEL: Record<string, string> = {
  FRAUD: "Penipuan",
  FAKE_IDENTITY: "Identitas palsu",
  INAPPROPRIATE_CONTENT: "Konten tidak pantas",
  TNC_VIOLATION: "Pelanggaran S&K",
  MONEY_LAUNDERING: "Pencucian uang",
  SPAM: "Spam",
  OTHER: "Lainnya",
}
