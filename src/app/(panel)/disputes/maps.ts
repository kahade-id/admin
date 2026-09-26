/** Peta label & tone status sengketa — dipakai halaman daftar & detail. */

export const DISPUTE_STATUS_LABEL: Record<string, string> = {
  OPEN: "Terbuka",
  ASSIGNED: "Ditugaskan",
  UNDER_REVIEW: "Ditinjau",
  WAITING_RESPONSE: "Menunggu respons",
  ESCALATED: "Dieskalasi",
  RESOLVED: "Selesai",
}

export const DISPUTE_STATUS_TONE: Record<
  string,
  "neutral" | "info" | "success" | "warning" | "danger" | "accent"
> = {
  OPEN: "warning",
  ASSIGNED: "info",
  UNDER_REVIEW: "info",
  WAITING_RESPONSE: "warning",
  ESCALATED: "danger",
  RESOLVED: "success",
}
