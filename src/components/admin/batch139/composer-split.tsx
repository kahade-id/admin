/**
 * H12 — Pemisahan catatan internal dan pesan pengguna (Batch 139).
 *
 * Composer tiket/sengketa: bedakan warna, label, dan mode default;
 * pesan EKSTERNAL (ke pengguna) wajib konfirmasi eksplisit untuk mencegah
 * salah kirim. Mode default = catatan internal (aman).
 *
 * Pemakaian:
 *   <SplitComposer
 *     internalValue={draft.value} onInternalChange={draft.setValue}
 *     onSendInternal={(text) => ...} onSendExternal={(text) => ...}
 *     sending={sending}
 *   />
 */
"use client"

import { useState } from "react"

import { Button } from "@/components/ui/button"
import { Dialog } from "@/components/ui/dialog"
import { TextArea } from "@/components/ui/input"
import { cn } from "@/lib/cn"

export type SplitComposerProps = {
  internalValue: string
  onInternalChange: (v: string) => void
  externalValue: string
  onExternalChange: (v: string) => void
  onSendInternal: (text: string) => void | Promise<void>
  onSendExternal: (text: string) => void | Promise<void>
  sending?: boolean
  /** Slot di bawah textarea internal (mis. indikator draf H11). */
  internalFooter?: React.ReactNode
}

export function SplitComposer({
  internalValue,
  onInternalChange,
  externalValue,
  onExternalChange,
  onSendInternal,
  onSendExternal,
  sending,
  internalFooter,
}: SplitComposerProps) {
  // Default = internal (mode aman).
  const [mode, setMode] = useState<"internal" | "external">("internal")
  const [confirmOpen, setConfirmOpen] = useState(false)

  const externalValid = externalValue.trim().length > 0

  const handleExternalConfirm = () => {
    setConfirmOpen(false)
    void onSendExternal(externalValue.trim())
  }

  return (
    <div className="flex flex-col gap-3">
      <div role="tablist" aria-label="Jenis pesan" className="flex gap-2">
        <button
          type="button"
          role="tab"
          aria-selected={mode === "internal"}
          onClick={() => setMode("internal")}
          className={cn(
            "rounded-sm border px-3 py-1.5 text-label font-semibold transition-colors",
            mode === "internal"
              ? "border-warning bg-warning/15 text-text-primary"
              : "border-border bg-surface text-text-secondary hover:text-text-primary",
          )}
        >
          📝 Catatan internal
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={mode === "external"}
          onClick={() => setMode("external")}
          className={cn(
            "rounded-sm border px-3 py-1.5 text-label font-semibold transition-colors",
            mode === "external"
              ? "border-info-text bg-info-text/15 text-text-primary"
              : "border-border bg-surface text-text-secondary hover:text-text-primary",
          )}
        >
          💬 Pesan ke pengguna
        </button>
      </div>

      {mode === "internal" ? (
        <div className="rounded-md border border-warning/50 bg-warning/5 p-3">
          <p className="mb-2 text-caption font-semibold uppercase tracking-wide text-warning-text">
            Catatan internal — hanya terlihat admin
          </p>
          <TextArea
            value={internalValue}
            onChange={(e) => onInternalChange(e.target.value)}
            rows={3}
            placeholder="Catatan untuk tim internal…"
            aria-label="Catatan internal"
          />
          {internalFooter}
          <div className="mt-2 flex justify-end">
            <Button
              variant="secondary"
              size="sm"
              fullWidth={false}
              loading={sending}
              disabled={!internalValue.trim()}
              onClick={() => void onSendInternal(internalValue.trim())}
            >
              Simpan catatan internal
            </Button>
          </div>
        </div>
      ) : (
        <div className="rounded-md border border-info-text/50 bg-info-text/5 p-3">
          <p className="mb-2 text-caption font-semibold uppercase tracking-wide text-info-text">
            Pesan ke pengguna — akan dikirim & terlihat pengguna
          </p>
          <TextArea
            value={externalValue}
            onChange={(e) => onExternalChange(e.target.value)}
            rows={3}
            placeholder="Tulis pesan untuk pengguna…"
            aria-label="Pesan ke pengguna"
          />
          <div className="mt-2 flex justify-end">
            <Button
              size="sm"
              fullWidth={false}
              loading={sending}
              disabled={!externalValid}
              onClick={() => setConfirmOpen(true)}
            >
              Kirim ke pengguna…
            </Button>
          </div>
        </div>
      )}

      {/* Konfirmasi eksplisit sebelum pesan eksternal terkirim. */}
      <Dialog
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        title="Kirim pesan ke pengguna?"
        description="Pesan ini akan terlihat oleh pengguna dan tidak bisa ditarik. Pastikan ini BUKAN catatan internal."
        dirty={externalValid}
      >
        <div className="rounded-sm border border-border bg-background p-3">
          <p className="text-caption text-text-secondary">Pratinjau pesan:</p>
          <p className="mt-1 whitespace-pre-wrap text-body text-text-primary">{externalValue.trim()}</p>
        </div>
        <div className="mt-4 flex flex-col gap-2">
          <Button loading={sending} onClick={handleExternalConfirm}>
            Ya, kirim ke pengguna
          </Button>
          <Button variant="ghost" disabled={sending} onClick={() => setConfirmOpen(false)}>
            Batal — kembali periksa
          </Button>
        </div>
      </Dialog>
    </div>
  )
}
