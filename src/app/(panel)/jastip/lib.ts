/**
 * Admin — helper bersama modul jastip (batch 43, item #29): label & tone status trip.
 */
"use client"

import type { JastipTripStatus } from "@/lib/api/admin/jastip"

export const JASTIP_TRIP_STATUSES: { value: JastipTripStatus; label: string }[] = [
  { value: "OPEN", label: "Buka (menerima pesanan)" },
  { value: "CLOSED", label: "Tutup (tenggat lewat)" },
  { value: "COMPLETED", label: "Selesai" },
  { value: "CANCELLED", label: "Dibatalkan" },
]

export function jastipTripStatusLabel(s: JastipTripStatus): string {
  return JASTIP_TRIP_STATUSES.find((x) => x.value === s)?.label ?? s
}

export function jastipTripStatusTone(
  s: JastipTripStatus,
): "success" | "warning" | "danger" | "neutral" | "info" {
  switch (s) {
    case "COMPLETED":
      return "success"
    case "OPEN":
      return "info"
    case "CLOSED":
      return "warning"
    case "CANCELLED":
      return "danger"
    default:
      return "neutral"
  }
}
