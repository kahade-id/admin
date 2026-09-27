/**
 * Status SLA antrean verifikasi bisnis.
 *
 * `slaHours` dibaca dari GET sla-config scope BUSINESS_VERIFICATION bila
 * endpoint worker E1 tersedia; bila tidak, fallback 48 jam kalender.
 * Durasi antrean = now - slaStartedAt (bila ada) atau createdAt.
 */

export const BUSINESS_SLA_FALLBACK_HOURS = 48

export type SlaStatus = "ok" | "warning" | "breached" | "unknown"

/** Umur antrean dalam jam desimal — null bila tanggal invalid. */
export function queueAgeHours(slaStartedAt: unknown, createdAt: unknown): number | null {
  const raw = slaStartedAt ?? createdAt
  if (raw == null || raw === "") return null
  const date = raw instanceof Date ? raw : new Date(raw as string)
  if (Number.isNaN(date.getTime())) return null
  return Math.max(0, (Date.now() - date.getTime()) / 3600000)
}

/**
 * Status SLA: breached bila umur > slaHours; warning bila >= 80% slaHours.
 * Hanya relevan untuk status PENDING — pemanggil yang memutuskan.
 */
export function slaStatus(ageHours: number | null, slaHours: number): SlaStatus {
  if (ageHours == null || !Number.isFinite(slaHours) || slaHours <= 0) return "unknown"
  if (ageHours > slaHours) return "breached"
  if (ageHours >= slaHours * 0.8) return "warning"
  return "ok"
}
