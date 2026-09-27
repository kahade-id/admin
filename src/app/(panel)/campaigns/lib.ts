/**
 * Admin — helper bersama modul kampanye & voucher (label, tone, parsing).
 *
 * Copy UI berbahasa Indonesia.
 */
"use client"

import type {
  AdminCampaignItem,
  AdminCampaignStatus,
  AdminCampaignType,
  AdminMembershipRank,
} from "@/lib/api/admin/campaigns"

export const CAMPAIGN_TYPES: { value: AdminCampaignType; label: string }[] = [
  { value: "FEE_PROMO", label: "Promo fee" },
  { value: "SUBSCRIPTION_DISCOUNT", label: "Diskon langganan" },
  { value: "CASHBACK", label: "Cashback" },
]

export const CAMPAIGN_STATUSES: { value: AdminCampaignStatus; label: string }[] = [
  { value: "DRAFT", label: "Draf" },
  { value: "ACTIVE", label: "Aktif" },
  { value: "PAUSED", label: "Dijeda" },
  { value: "ENDED", label: "Selesai" },
]

export const MEMBERSHIP_RANKS: { value: AdminMembershipRank; label: string }[] = [
  { value: "BRONZE", label: "Bronze" },
  { value: "SILVER", label: "Silver" },
  { value: "GOLD", label: "Gold" },
  { value: "PLATINUM", label: "Platinum" },
  { value: "DIAMOND", label: "Diamond" },
]

export function campaignTypeLabel(t: AdminCampaignType): string {
  return CAMPAIGN_TYPES.find((x) => x.value === t)?.label ?? t
}

export function campaignStatusLabel(s: AdminCampaignStatus): string {
  return CAMPAIGN_STATUSES.find((x) => x.value === s)?.label ?? s
}

export function campaignStatusTone(
  status: AdminCampaignStatus,
): "neutral" | "success" | "warning" | "info" {
  switch (status) {
    case "ACTIVE":
      return "success"
    case "PAUSED":
      return "warning"
    case "ENDED":
      return "neutral"
    default:
      return "info"
  }
}

export function membershipRankLabel(r: AdminMembershipRank): string {
  return MEMBERSHIP_RANKS.find((x) => x.value === r)?.label ?? r
}

export function campaignKey(c: AdminCampaignItem): string {
  return c.campaignId || c.id || ""
}

/**
 * Field kampanye yang TIDAK bisa diubah lewat PUT /v1/admin/campaigns/:id
 * (tidak ada di UpdateCampaignInput): tipe & parameter diskon dihitung
 * saat kampanye dibuat dan terkunci untuk menjaga integritas promo yang
 * sudah diterbitkan.
 */
export const LOCKED_CAMPAIGN_FIELDS: { key: string; label: string }[] = [
  { key: "type", label: "Tipe kampanye" },
  { key: "discountValue", label: "Nilai diskon (Rp)" },
  { key: "discountPercent", label: "Persen diskon (%)" },
  { key: "maxDiscount", label: "Maksimal diskon (Rp)" },
]

export function parseIntInput(input: string): number | undefined {
  const t = input.trim()
  if (!t) return undefined
  const n = Number.parseInt(t, 10)
  return Number.isFinite(n) ? n : undefined
}

export function parseNumberInput(input: string): number | undefined {
  const t = input.trim().replace(",", ".")
  if (!t) return undefined
  const n = Number(t)
  return Number.isFinite(n) ? n : undefined
}

/** "YYYY-MM-DD" (native date input) → ISO; endOfDay untuk batas akhir. */
export function dayToISO(day: string, endOfDay: boolean): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return null
  const d = new Date(`${day}T${endOfDay ? "23:59:59" : "00:00:00"}`)
  if (Number.isNaN(d.getTime())) return null
  return d.toISOString()
}

/** ISO → "YYYY-MM-DD" untuk native date input. */
export function isoToDay(iso: string | null | undefined): string {
  if (!iso) return ""
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ""
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** Proporsi pemakaian kuota 0–1; null bila kuota tanpa batas. */
export function quotaRatio(used: number, quota: number | null | undefined): number | null {
  if (quota == null || quota <= 0) return null
  return Math.max(0, Math.min(1, used / quota))
}
