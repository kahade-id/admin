/**
 * H03 — Bulk action menampilkan scope + H06 — Dry run sebelum perubahan
 * massal (Batch 139).
 *
 * - `useBulkSelection`: state multi-select (per halaman).
 * - `BulkScopeBar`: tampilkan jumlah ID eksplisit + jelaskan scope
 *   (halaman ini vs seluruh hasil) + tombol aksi.
 * - `BulkConfirmDialog`: konfirmasi sebelum submit — memuat ringkasan scope,
 *   hasil dry-run (H06), alasan terstruktur (via DangerActionDialog), dan
 *   tombol eksekusi.
 * - `DryRunPreview`: tampilkan jumlah terpengaruh, pengecualian, konflik
 *   TANPA menulis data. Bila backend belum menyediakan endpoint dry-run,
 *   pemanggil mengisi `fallback` dari data client-side (ditandai jelas).
 */
"use client"

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import { DangerActionDialog, type ReasonOption } from "./danger-action"

// ------------------------------------------------------------------
// useBulkSelection — multi-select per halaman
// ------------------------------------------------------------------

export function useBulkSelection(pageIds: string[]) {
  const [selected, setSelected] = useState<Set<string>>(new Set())

  const toggle = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  const selectPage = useCallback(() => {
    setSelected((prev) => new Set([...prev, ...pageIds]))
  }, [pageIds])

  const deselectPage = useCallback(() => {
    setSelected((prev) => {
      const next = new Set(prev)
      for (const id of pageIds) next.delete(id)
      return next
    })
  }, [pageIds])

  const clear = useCallback(() => setSelected(new Set()), [])

  const pageSelectedCount = useMemo(
    () => pageIds.filter((id) => selected.has(id)).length,
    [pageIds, selected],
  )

  return {
    selected,
    selectedIds: useMemo(() => [...selected], [selected]),
    selectedCount: selected.size,
    pageSelectedCount,
    allPageSelected: pageIds.length > 0 && pageSelectedCount === pageIds.length,
    toggle,
    selectPage,
    deselectPage,
    clear,
    isSelected: useCallback((id: string) => selected.has(id), [selected]),
  }
}

export type BulkSelection = ReturnType<typeof useBulkSelection>

// ------------------------------------------------------------------
// H06 — hasil dry-run
// ------------------------------------------------------------------

export type DryRunResult = {
  /** Jumlah record yang akan terpengaruh bila dieksekusi. */
  affected: number
  /** ID yang dilewati + alasannya (mis. status tidak memenuhi syarat). */
  excluded: Array<{ id: string; reason: string }>
  /** Konflik yang butuh perhatian (mis. sudah ditangani admin lain). */
  conflicts: Array<{ id: string; detail: string }>
  /** true bila angka berasal dari estimasi client-side (tanpa endpoint dry-run). */
  estimated: boolean
}

export function DryRunPreview({ result }: { result: DryRunResult }) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone="info">{result.affected} akan diproses</Badge>
        {result.excluded.length > 0 ? (
          <Badge tone="warning">{result.excluded.length} dilewati</Badge>
        ) : null}
        {result.conflicts.length > 0 ? (
          <Badge tone="danger">{result.conflicts.length} konflik</Badge>
        ) : null}
        {result.estimated ? (
          <Badge tone="neutral">Estimasi client-side — belum ada dry-run server</Badge>
        ) : (
          <Badge tone="success">Dry-run server</Badge>
        )}
      </div>
      {result.excluded.length > 0 ? (
        <div>
          <p className="mb-1 text-label font-semibold text-text-secondary">Dilewati:</p>
          <ul className="flex max-h-32 flex-col gap-1 overflow-y-auto text-body text-text-secondary">
            {result.excluded.map((e) => (
              <li key={e.id}>
                <span className="font-mono text-[13px]">{e.id.slice(0, 8)}…</span> — {e.reason}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {result.conflicts.length > 0 ? (
        <div>
          <p className="mb-1 text-label font-semibold text-danger-text">Konflik:</p>
          <ul className="flex max-h-32 flex-col gap-1 overflow-y-auto text-body text-danger-text">
            {result.conflicts.map((c) => (
              <li key={c.id}>
                <span className="font-mono text-[13px]">{c.id.slice(0, 8)}…</span> — {c.detail}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  )
}

// ------------------------------------------------------------------
// H03 — BulkScopeBar: jumlah ID eksplisit + penjelasan scope
// ------------------------------------------------------------------

export function BulkScopeBar({
  selection,
  pageSize,
  totalResults,
  scope,
  actions,
}: {
  selection: BulkSelection
  /** Jumlah baris di halaman aktif. */
  pageSize: number
  /** Total hasil filter saat ini (semua halaman). */
  totalResults: number
  /** Scope aksi: hanya ID terpilih di halaman ini, atau seluruh hasil filter. */
  scope: "selected-page" | "all-results"
  actions: ReactNode
}) {
  if (selection.selectedCount === 0) return null
  return (
    <div
      role="status"
      className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-md border border-border bg-surface px-4 py-3"
    >
      <div className="text-body text-text-primary">
        <strong>{selection.selectedCount} ID dipilih</strong>
        <span className="text-text-secondary">
          {" — "}aksi berlaku untuk{" "}
          {scope === "all-results"
            ? `seluruh ${totalResults.toLocaleString("id-ID")} hasil filter (semua halaman)`
            : `${selection.selectedCount} ID terpilih di halaman ini (dari ${pageSize} baris)`}
          . ID lain tidak tersentuh.
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {actions}
        <Button variant="ghost" size="sm" fullWidth={false} onClick={selection.clear}>
          Batalkan pilihan
        </Button>
      </div>
    </div>
  )
}

// ------------------------------------------------------------------
// Dialog konfirmasi bulk: scope + dry-run + alasan (H03+H04+H06)
// ------------------------------------------------------------------

export type BulkConfirmDialogProps = {
  open: boolean
  onClose: () => void
  title: string
  /** Ringkasan aksi, mis. "Tandai 12 sengketa sebagai Dalam Review". */
  summary: string
  selectedIds: string[]
  scope: "selected-page" | "all-results"
  totalResults: number
  /** Hasil dry-run; bila null tampilkan spinner/peringatan. */
  dryRun: DryRunResult | null
  dryRunLoading?: boolean
  dryRunError?: string | null
  onRetryDryRun?: () => void
  reasonOptions: ReasonOption[]
  impactItems: string[]
  confirmLabel?: string
  loading?: boolean
  onConfirm: (reason: string, notes: string) => void | Promise<void>
}

export function BulkConfirmDialog({
  open,
  onClose,
  title,
  summary,
  selectedIds,
  scope,
  totalResults,
  dryRun,
  dryRunLoading,
  dryRunError,
  onRetryDryRun,
  reasonOptions,
  impactItems,
  confirmLabel = "Ya, jalankan",
  loading,
  onConfirm,
}: BulkConfirmDialogProps) {
  const [confirmed, setConfirmed] = useState(false)

  // Reset checkbox setiap dialog dibuka/ditutup — termasuk saat parent
  // menutup dialog secara programatik setelah sukses.
  useEffect(() => {
    if (!open) setConfirmed(false)
  }, [open ])

  return (
    <DangerActionDialog
      open={open}
      onClose={() => {
        setConfirmed(false)
        onClose()
      }}
      title={title}
      description={summary}
      reasonOptions={reasonOptions}
      impactItems={[
        scope === "all-results"
          ? `Scope: seluruh ${totalResults.toLocaleString("id-ID")} hasil filter`
          : `Scope: ${selectedIds.length} ID terpilih (halaman ini saja)`,
        ...impactItems,
      ]}
      confirmLabel={confirmLabel}
      loading={loading}
      onConfirm={onConfirm}
      extra={
        <div className="rounded-sm border border-border bg-background p-3">
          <p className="mb-2 text-label font-semibold text-text-secondary">
            Pratinjau dry-run — tanpa menulis data
          </p>
          {dryRunLoading ? (
            <div className="flex items-center gap-2 text-body text-text-secondary">
              <Spinner size="sm" /> Menghitung dampak…
            </div>
          ) : dryRunError ? (
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-body text-danger-text">{dryRunError}</p>
              {onRetryDryRun ? (
                <Button variant="secondary" size="sm" fullWidth={false} onClick={onRetryDryRun}>
                  Coba lagi
                </Button>
              ) : null}
            </div>
          ) : dryRun ? (
            <DryRunPreview result={dryRun} />
          ) : null}
          <label className="mt-3 flex cursor-pointer items-start gap-2 text-body text-text-primary">
            <input
              type="checkbox"
              checked={confirmed}
              onChange={(e) => setConfirmed(e.target.checked)}
              className="mt-1 h-4 w-4 accent-[var(--color-primary)]"
            />
            Saya memahami scope di atas dan dampaknya
          </label>
        </div>
      }
      confirmDisabled={!confirmed || !dryRun || dryRun.conflicts.length > 0}
    />
  )
}
