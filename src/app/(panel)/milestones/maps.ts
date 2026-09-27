/** Peta label & tone status milestone — dipakai dasbor milestone admin. */

export const MILESTONE_STATUS_LABEL: Record<string, string> = {
  DRAFT: "Draf",
  AWAITING_ACTIVATION: "Menunggu aktivasi",
  SUBMITTED: "Hasil terkirim",
  REVISION_REQUESTED: "Revisi diminta",
  ACCEPTED: "Diterima",
  RELEASED: "Dicairkan",
  CANCELLED: "Dibatalkan",
  DISPUTED: "Disengketa",
}

export const MILESTONE_STATUS_TONE: Record<
  string,
  "neutral" | "info" | "success" | "warning" | "danger" | "accent"
> = {
  DRAFT: "neutral",
  AWAITING_ACTIVATION: "info",
  SUBMITTED: "warning",
  REVISION_REQUESTED: "accent",
  ACCEPTED: "info",
  RELEASED: "success",
  CANCELLED: "neutral",
  DISPUTED: "danger",
}
