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
