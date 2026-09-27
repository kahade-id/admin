/**
 * Admin — helper bersama modul patungan grup (batch 43, item #30):
 * label & tone status + progress bar progres dana escrow.
 */
"use client"

import { cn } from "@/lib/cn"
import { formatIDR } from "@/lib/format"
import type {
  GroupBuyItem,
  GroupBuyStatus,
} from "@/lib/api/admin/group-buying"

export const GROUP_BUY_STATUSES: { value: GroupBuyStatus; label: string }[] = [
  { value: "OPEN", label: "Buka (pengumpulan dana)" },
  { value: "FUNDED", label: "Target tercapai" },
  { value: "FAILED", label: "Gagal (auto-refund)" },
  { value: "DISBURSED", label: "Cair ke host" },
  { value: "CANCELLED", label: "Dibatalkan" },
]

export function groupBuyStatusLabel(s: GroupBuyStatus): string {
  return GROUP_BUY_STATUSES.find((x) => x.value === s)?.label ?? s
}

export function groupBuyStatusTone(
  s: GroupBuyStatus,
): "success" | "warning" | "danger" | "neutral" | "info" {
  switch (s) {
    case "FUNDED":
    case "DISBURSED":
      return "success"
    case "OPEN":
      return "info"
    case "FAILED":
    case "CANCELLED":
      return "danger"
    default:
      return "neutral"
  }
}

/** Progress bar progres dana patungan (dana terkumpul di escrow). */
export function GroupBuyProgressBar({ item }: { item: GroupBuyItem }) {
  const pct =
    item.targetAmount > 0
      ? Math.min(100, (item.collectedAmount / item.targetAmount) * 100)
      : 0
  return (
    <div>
      <div
        role="progressbar"
        aria-valuenow={Math.round(pct)}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={`Progres dana ${Math.round(pct)}%`}
        className="h-2 w-full overflow-hidden rounded-full bg-surface-elevated"
      >
        <div
          className={cn("h-full rounded-full bg-primary transition-all", pct >= 100 && "bg-success")}
          style={{ width: `${pct}%` }}
        />
      </div>
      <p className="mt-1 text-caption text-text-secondary">
        {formatIDR(item.collectedAmount)} / {formatIDR(item.targetAmount)} ({Math.round(pct)}%)
      </p>
    </div>
  )
}
