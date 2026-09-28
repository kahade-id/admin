/**
 * H07 — Detail audit dapat dibandingkan (Batch 139).
 *
 * Audit trail: tampilkan diff field sebelum/sesudah (bukan JSON mentah) +
 * aktor, alasan, correlation ID, dan waktu lokal.
 *
 * Pemakaian di baris audit log:
 *   <AuditDiffToggle before={row.before} after={row.after} />
 * atau panel penuh:
 *   <AuditDiffPanel entry={row} actorName={...} />
 */
"use client"

import { useState } from "react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { diffObjects, formatDiffValue, type FieldDiff } from "./diff"
import { formatDateTimeWIB } from "@/lib/format"
import { cn } from "@/lib/cn"

/** Field tambahan yang mungkin ada di payload backend (opsional). */
export type AuditEntryLike = {
  id: string
  adminId: string
  action: string
  description?: string | null
  before?: Record<string, unknown> | null
  after?: Record<string, unknown> | null
  ipAddress?: string | null
  userAgent?: string | null
  createdAt: string
  /** Opsional bila backend mengirimkannya. */
  reason?: string | null
  correlationId?: string | null
  actorName?: string | null
}

const KIND_META: Record<FieldDiff["kind"], { label: string; tone: "success" | "danger" | "info" }> = {
  added: { label: "ditambah", tone: "success" },
  removed: { label: "dihapus", tone: "danger" },
  changed: { label: "diubah", tone: "info" },
}

export function AuditDiffTable({ diffs }: { diffs: FieldDiff[] }) {
  if (diffs.length === 0) {
    return <p className="text-body text-text-secondary">Tidak ada perubahan field.</p>
  }
  return (
    <table className="w-full border-collapse text-body">
      <thead>
        <tr className="border-b border-border text-left">
          <th className="py-2 pr-3 text-caption uppercase text-text-secondary">Field</th>
          <th className="py-2 pr-3 text-caption uppercase text-text-secondary">Sebelum</th>
          <th className="py-2 pr-3 text-caption uppercase text-text-secondary">Sesudah</th>
          <th className="py-2 text-caption uppercase text-text-secondary">Jenis</th>
        </tr>
      </thead>
      <tbody>
        {diffs.map((d) => {
          const meta = KIND_META[d.kind]
          return (
            <tr key={d.path} className="border-b border-border align-top last:border-b-0">
              <td className="py-2 pr-3 font-mono text-[13px] text-text-primary">{d.path}</td>
              <td
                className={cn(
                  "max-w-56 break-words py-2 pr-3 font-mono text-[13px]",
                  d.kind === "removed" || d.kind === "changed"
                    ? "text-danger-text line-through"
                    : "text-text-tertiary",
                )}
              >
                {formatDiffValue(d.before)}
              </td>
              <td
                className={cn(
                  "max-w-56 break-words py-2 pr-3 font-mono text-[13px]",
                  d.kind === "added" || d.kind === "changed"
                    ? "text-success-text"
                    : "text-text-tertiary",
                )}
              >
                {formatDiffValue(d.after)}
              </td>
              <td className="py-2">
                <Badge tone={meta.tone}>{meta.label}</Badge>
              </td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}

/** Panel detail satu entri audit: diff + aktor + alasan + correlation ID + waktu lokal. */
export function AuditDiffPanel({ entry }: { entry: AuditEntryLike }) {
  const diffs = diffObjects(entry.before, entry.after)
  return (
    <div className="flex flex-col gap-4">
      <dl className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <div>
          <dt className="text-caption text-text-secondary">Aktor</dt>
          <dd className="text-body text-text-primary">
            {entry.actorName ?? <span className="font-mono text-[13px]">{entry.adminId.slice(0, 8)}…</span>}
          </dd>
        </div>
        <div>
          <dt className="text-caption text-text-secondary">Waktu (lokal)</dt>
          <dd className="text-body text-text-primary">{formatDateTimeWIB(entry.createdAt)}</dd>
        </div>
        <div>
          <dt className="text-caption text-text-secondary">Alasan</dt>
          <dd className="text-body text-text-primary">{entry.reason ?? "—"}</dd>
        </div>
        <div>
          <dt className="text-caption text-text-secondary">Correlation ID</dt>
          <dd className="font-mono text-[13px] text-text-primary">{entry.correlationId ?? "—"}</dd>
        </div>
        {entry.ipAddress ? (
          <div>
            <dt className="text-caption text-text-secondary">IP</dt>
            <dd className="font-mono text-[13px] text-text-primary">{entry.ipAddress}</dd>
          </div>
        ) : null}
      </dl>
      <div>
        <p className="mb-2 text-label font-semibold text-text-secondary">
          Perubahan field ({diffs.length})
        </p>
        <AuditDiffTable diffs={diffs} />
      </div>
    </div>
  )
}

/** Toggle expand/collapse diff di dalam baris tabel audit. */
export function AuditDiffToggle({ entry }: { entry: AuditEntryLike }) {
  const [open, setOpen] = useState(false)
  const diffs = diffObjects(entry.before, entry.after)
  return (
    <div>
      <Button
        variant="ghost"
        size="sm"
        fullWidth={false}
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        {open ? "Sembunyikan" : `Lihat diff (${diffs.length})`}
      </Button>
      {open ? (
        <div className="mt-2 rounded-sm border border-border bg-background p-3">
          <AuditDiffPanel entry={entry} />
        </div>
      ) : null}
    </div>
  )
}
