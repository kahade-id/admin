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

/**
 * SH-A-014 — label Indonesia untuk kode aksi histori moderasi (G420).
 * Tanpa mapping, UI merender enum mentah ("TAKEDOWN", "RESTRICTED", dst.).
 */
export const MODERATION_EVENT_ACTION_LABEL: Record<string, string> = {
  REPORT_SUBMITTED: "Laporan diajukan",
  UNDER_REVIEW: "Ditandai ditinjau",
  DISMISSED: "Laporan ditolak",
  TAKEDOWN: "Takedown item",
  RESTRICTED: "Item dibatasi sementara",
  NO_ACTION: "Selesai tanpa tindakan",
  REOPENED: "Laporan dibuka kembali",
  ASSIGNED: "Laporan ditugaskan",
  NOTE_ADDED: "Catatan ditambahkan",
  APPEAL_SUBMITTED: "Banding diajukan",
  APPEAL_DECIDED: "Banding diputus",
  RESTORED: "Item dipulihkan",
  EXPORTED: "Data diekspor",
}

/** Label Indonesia untuk tier risiko antrean prioritas (G419). */
export const RISK_TIER_LABEL: Record<string, string> = {
  HIGH: "Risiko tinggi",
  MEDIUM: "Risiko sedang",
  LOW: "Risiko rendah",
}

export const RISK_TIER_TONE: Record<
  string,
  "neutral" | "info" | "success" | "warning" | "danger" | "accent"
> = {
  HIGH: "danger",
  MEDIUM: "warning",
  LOW: "neutral",
}
