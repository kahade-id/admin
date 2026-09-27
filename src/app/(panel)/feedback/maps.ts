/** Peta label & tone status/risiko feedback — dipakai halaman daftar & detail. */

export const FEEDBACK_STATUS_LABEL: Record<string, string> = {
  NEW: "Baru",
  IN_REVIEW: "Ditinjau",
  ACTIONED: "Ditindaklanjuti",
  CLOSED: "Ditutup",
}

export const FEEDBACK_STATUS_TONE: Record<
  string,
  "neutral" | "info" | "success" | "warning" | "danger" | "accent"
> = {
  NEW: "warning",
  IN_REVIEW: "info",
  ACTIONED: "success",
  CLOSED: "neutral",
}

export const FEEDBACK_RISK_LABEL: Record<string, string> = {
  NONE: "—",
  SECURITY_RISK: "Risiko keamanan",
  FRAUD_RISK: "Risiko fraud",
}

export const FEEDBACK_RISK_TONE: Record<string, "neutral" | "danger"> = {
  NONE: "neutral",
  SECURITY_RISK: "danger",
  FRAUD_RISK: "danger",
}

export const FEEDBACK_CLOSE_REASON_LABEL: Record<string, string> = {
  RESOLVED: "Terselesaikan",
  DUPLICATE: "Duplikat",
  NOT_ACTIONABLE: "Tidak dapat ditindaklanjuti",
  SPAM: "Spam",
  OUT_OF_SCOPE: "Di luar cakupan",
  OTHER: "Lainnya",
}

export const FEEDBACK_CLOSE_REASON_OPTIONS = Object.entries(FEEDBACK_CLOSE_REASON_LABEL).map(
  ([value, label]) => ({ value, label }),
)

export const FEEDBACK_STATUS_OPTIONS = [
  { value: "ALL", label: "Semua status" },
  ...Object.entries(FEEDBACK_STATUS_LABEL).map(([value, label]) => ({ value, label })),
]

export const FEEDBACK_IMPACT_LABELS = ["Rendah", "Sedang", "Tinggi", "Kritis"]
