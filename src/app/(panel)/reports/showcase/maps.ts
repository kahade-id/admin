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
  // ADM-08 (audit etalase 2026-10-10): nilai enum ModerationEventAction
  // backend yang belum terpetakan — tampil mentah di histori.
  APPEAL_FILED: "Banding diajukan",
  ESCALATED: "Dieskalasi (SLA terlewati)",
  APPEAL_DECIDED: "Banding diputus",
  RESTORED: "Item dipulihkan",
  EXPORTED: "Data diekspor",
}

/**
 * ADM-05 (audit etalase 2026-10-10): `activeAssignment` dari backend hanya
 * membawa `riskScore` (model ReportAssignment tidak menyimpan tier), sehingga
 * UI detail tidak pernah menampilkan tier. Ambang sama persis dengan backend
 * `riskTier()` di moderation-lifecycle.constants.ts: ≥70 HIGH, ≥40 MEDIUM.
 */
export function riskTierFromScore(score: number): "HIGH" | "MEDIUM" | "LOW" {
  if (score >= 70) return "HIGH"
  if (score >= 40) return "MEDIUM"
  return "LOW"
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
