/**
 * H16 — Status dependency memiliki timestamp (Batch 139).
 *
 * Label "sehat" tanpa waktu pemeriksaan menyesatkan. Kartu ini menampilkan:
 * - waktu pemeriksaan terakhir (relatif + absolut),
 * - latency,
 * - umur data,
 * - status "unknown" bila data stale (melewati ambang).
 *
 * Pemakaian di halaman observability:
 *   <DependencyStatusCard name={d.name} status={d.status} latencyMs={d.latencyMs}
 *     checkedAt={fetchedAt} staleAfterMs={5 * 60 * 1000} detail={d.detail} />
 */
"use client"

import { useEffect, useState } from "react"

import { Badge } from "@/components/ui/badge"
import { Card, CardBody } from "@/components/ui/card"
import { formatDateTimeWIB } from "@/lib/format"
import { cn } from "@/lib/cn"

export type DependencyStatus = "ok" | "degraded" | "down" | "unknown"

function ageLabel(ms: number): string {
  const s = Math.floor(ms / 1000)
  if (s < 5) return "baru saja"
  if (s < 60) return `${s} dtk lalu`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m} mnt lalu`
  const h = Math.floor(m / 60)
  return `${h} jam lalu`
}

const TONE: Record<DependencyStatus, "success" | "warning" | "danger" | "neutral"> = {
  ok: "success",
  degraded: "warning",
  down: "danger",
  unknown: "neutral",
}

const LABEL: Record<DependencyStatus, string> = {
  ok: "Sehat",
  degraded: "Terganggu",
  down: "Mati",
  unknown: "Tidak diketahui",
}

export function DependencyStatusCard({
  name,
  status,
  latencyMs,
  checkedAt,
  staleAfterMs = 5 * 60 * 1000,
  detail,
}: {
  name: string
  status: Exclude<DependencyStatus, "unknown">
  latencyMs: number | null
  /** ISO timestamp kapan pemeriksaan dilakukan (waktu fetch). */
  checkedAt: string | null
  /** Umur data maksimum sebelum dianggap stale → unknown. */
  staleAfterMs?: number
  detail?: Record<string, string | number | boolean>
}) {
  const [, tick] = useState(0)

  // Refresh label umur tiap 30 dtk.
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 30000)
    return () => clearInterval(t)
  }, [])

  const checkedMs = checkedAt ? new Date(checkedAt).getTime() : NaN
  const ageMs = Number.isFinite(checkedMs) ? Date.now() - checkedMs : NaN
  const stale = !Number.isFinite(ageMs) || ageMs > staleAfterMs
  const effective: DependencyStatus = stale ? "unknown" : status

  return (
    <Card className={cn(stale && "border-dashed")}>
      <CardBody className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-2">
          <p className="font-semibold text-text-primary">{name}</p>
          <Badge tone={TONE[effective]} dot>
            {LABEL[effective]}
          </Badge>
        </div>
        <dl className="flex flex-col gap-1 text-caption text-text-secondary">
          <div className="flex justify-between gap-2">
            <dt>Diperiksa</dt>
            <dd className={cn("text-text-primary", stale && "font-semibold text-warning-text")}>
              {Number.isFinite(ageMs)
                ? `${ageLabel(ageMs)} · ${formatDateTimeWIB(checkedAt!)}`
                : "belum pernah"}
            </dd>
          </div>
          <div className="flex justify-between gap-2">
            <dt>Latency</dt>
            <dd className="text-text-primary">
              {latencyMs == null ? "—" : `${latencyMs} ms`}
            </dd>
          </div>
          <div className="flex justify-between gap-2">
            <dt>Umur data</dt>
            <dd className={cn("text-text-primary", stale && "font-semibold text-warning-text")}>
              {Number.isFinite(ageMs) ? ageLabel(ageMs) : "—"}
              {stale ? " (stale)" : ""}
            </dd>
          </div>
        </dl>
        {stale ? (
          <p className="text-caption text-warning-text">
            Data pemeriksaan sudah basi — status sebenarnya tidak diketahui. Muat ulang halaman.
          </p>
        ) : null}
        {detail && Object.keys(detail).length > 0 ? (
          <details className="text-caption text-text-secondary">
            <summary className="cursor-pointer hover:text-text-primary">Detail</summary>
            <dl className="mt-1 flex flex-col gap-0.5">
              {Object.entries(detail).map(([k, v]) => (
                <div key={k} className="flex justify-between gap-2">
                  <dt>{k}</dt>
                  <dd className="font-mono text-[12px] text-text-primary">{String(v)}</dd>
                </div>
              ))}
            </dl>
          </details>
        ) : null}
      </CardBody>
    </Card>
  )
}
