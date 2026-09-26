/**
 * Label + tone badge untuk status laporan etalase (enum ReportStatus backend).
 */

export const SHOWCASE_REPORT_STATUS_LABEL: Record<string, string> = {
  PENDING: "Menunggu",
  UNDER_REVIEW: "Ditinjau",
  RESOLVED_ACTION_TAKEN: "Selesai (ditindak)",
  RESOLVED_NO_ACTION: "Selesai (tanpa tindakan)",
  DISMISSED: "Ditolak",
}

export const SHOWCASE_REPORT_STATUS_TONE: Record<
  string,
  "neutral" | "info" | "success" | "warning" | "danger" | "accent"
> = {
  PENDING: "warning",
  UNDER_REVIEW: "info",
  RESOLVED_ACTION_TAKEN: "success",
  RESOLVED_NO_ACTION: "neutral",
  DISMISSED: "neutral",
}
