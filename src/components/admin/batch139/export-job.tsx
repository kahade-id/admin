/**
 * H14 — Ekspor berjalan sebagai job (Batch 139).
 *
 * Pola generik: ekspor besar = job dengan status (progress), expiry file,
 * audit, dan notifikasi selesai. Backend ekspor pengguna SUDAH mendukung
 * 202 { jobId } + polling; ekspor lain yang belum punya endpoint job memakai
 * pola ini dengan fallback unduhan langsung (ditandai di UI).
 *
 * STATUS: parsial — endpoint job backend baru ada untuk ekspor pengguna
 * (`/v1/admin/users/export`). Ekspor lain memakai fallback client-side
 * sampai backend menyediakan job generik.
 */
"use client"

import { useCallback, useEffect, useRef, useState } from "react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import { useToast } from "@/components/ui/toast"
import { formatDateTimeWIB } from "@/lib/format"

export type ExportRequestResult =
  | { type: "file"; save: () => void }
  | { type: "job"; jobId: string }

export type ExportJobStatusInfo = {
  status: "pending" | "done" | "failed"
  progress?: number | null
  downloadUrl?: string | null
  expiresAt?: string | null
  error?: string | null
}

export type ExportJobPhase =
  | { phase: "idle" }
  | { phase: "requesting" }
  | { phase: "polling"; jobId: string; progress: number | null }
  | { phase: "done"; downloadUrl: string | null; expiresAt: string | null; viaJob: boolean }
  | { phase: "failed"; error: string }

export function useExportJob(opts: {
  request: () => Promise<ExportRequestResult>
  getStatus: (jobId: string) => Promise<ExportJobStatusInfo>
  download: (downloadUrl: string) => Promise<void>
  pollMs?: number
  /** Dipanggil saat job selesai — untuk notifikasi + audit client-side. */
  onDone?: (jobId: string | null) => void
}) {
  const toast = useToast()
  const [phase, setPhase] = useState<ExportJobPhase>({ phase: "idle" })
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const optsRef = useRef(opts)
  optsRef.current = opts

  const stopPolling = useCallback(() => {
    if (timerRef.current) clearInterval(timerRef.current)
    timerRef.current = null
  }, [])

  useEffect(() => stopPolling, [stopPolling])

  const poll = useCallback(
    (jobId: string) => {
      const tick = async () => {
        try {
          const s = await optsRef.current.getStatus(jobId)
          if (s.status === "done") {
            stopPolling()
            setPhase({
              phase: "done",
              downloadUrl: s.downloadUrl ?? null,
              expiresAt: s.expiresAt ?? null,
              viaJob: true,
            })
            optsRef.current.onDone?.(jobId)
            toast.show({ title: "Ekspor selesai", description: "File siap diunduh.", tone: "success" })
          } else if (s.status === "failed") {
            stopPolling()
            setPhase({ phase: "failed", error: s.error || "Job ekspor gagal." })
          } else {
            setPhase({ phase: "polling", jobId, progress: s.progress ?? null })
          }
        } catch (e) {
          stopPolling()
          setPhase({
            phase: "failed",
            error: e instanceof Error ? e.message : "Gagal memeriksa status job.",
          })
        }
      }
      void tick()
      timerRef.current = setInterval(() => void tick(), optsRef.current.pollMs ?? 1500)
    },
    [stopPolling, toast],
  )

  const start = useCallback(async () => {
    stopPolling()
    setPhase({ phase: "requesting" })
    try {
      const res = await optsRef.current.request()
      if (res.type === "file") {
        res.save()
        setPhase({ phase: "done", downloadUrl: null, expiresAt: null, viaJob: false })
        optsRef.current.onDone?.(null)
      } else {
        setPhase({ phase: "polling", jobId: res.jobId, progress: null })
        poll(res.jobId)
      }
    } catch (e) {
      setPhase({
        phase: "failed",
        error: e instanceof Error ? e.message : "Gagal memulai ekspor.",
      })
    }
  }, [stopPolling, poll])

  const downloadNow = useCallback(async () => {
    if (phase.phase !== "done" || !phase.downloadUrl) return
    try {
      await optsRef.current.download(phase.downloadUrl)
    } catch (e) {
      toast.show({
        title: "Unduhan gagal",
        description: e instanceof Error ? e.message : "Tidak bisa mengunduh file.",
        tone: "danger",
      })
    }
  }, [phase, toast])

  const reset = useCallback(() => {
    stopPolling()
    setPhase({ phase: "idle" })
  }, [stopPolling])

  return { phase, start, downloadNow, reset }
}

/** Panel status job ekspor: progress, expiry, tombol unduh. */
export function ExportJobPanel({
  phase,
  onDownload,
  onReset,
}: {
  phase: ExportJobPhase
  onDownload: () => void
  onReset: () => void
}) {
  if (phase.phase === "idle") return null
  return (
    <div className="rounded-md border border-border bg-surface p-4" role="status">
      {phase.phase === "requesting" ? (
        <div className="flex items-center gap-2 text-body text-text-secondary">
          <Spinner size="sm" /> Menyiapkan ekspor…
        </div>
      ) : null}

      {phase.phase === "polling" ? (
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <Badge tone="info">Job berjalan</Badge>
            <span className="font-mono text-[13px] text-text-secondary">{phase.jobId.slice(0, 8)}…</span>
          </div>
          <div
            className="h-2 overflow-hidden rounded-full bg-surface-elevated"
            role="progressbar"
            aria-valuenow={phase.progress ?? undefined}
            aria-valuemin={0}
            aria-valuemax={100}
          >
            <div
              className="h-full bg-primary transition-all"
              style={{ width: `${Math.max(5, Math.min(100, phase.progress ?? 5))}%` }}
            />
          </div>
          <p className="text-caption text-text-secondary">
            {phase.progress != null ? `${phase.progress}% — ` : ""}Ekspor besar diproses di
            server. Anda boleh menutup dialog ini; status tercatat di audit.
          </p>
        </div>
      ) : null}

      {phase.phase === "done" ? (
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <Badge tone="success">Selesai</Badge>
            {!phase.viaJob ? (
              <span className="text-caption text-text-secondary">
                Unduhan langsung — backend belum menyediakan job untuk ekspor ini
              </span>
            ) : null}
          </div>
          {phase.expiresAt ? (
            <p className="text-caption text-text-secondary">
              File kedaluwarsa: {formatDateTimeWIB(phase.expiresAt)}
            </p>
          ) : null}
          <div className="flex gap-2">
            {phase.downloadUrl ? (
              <Button size="sm" fullWidth={false} onClick={onDownload}>
                Unduh file
              </Button>
            ) : null}
            <Button variant="ghost" size="sm" fullWidth={false} onClick={onReset}>
              Tutup
            </Button>
          </div>
        </div>
      ) : null}

      {phase.phase === "failed" ? (
        <div className="flex flex-col gap-2">
          <Badge tone="danger">Gagal</Badge>
          <p className="text-body text-danger-text">{phase.error}</p>
          <div>
            <Button variant="secondary" size="sm" fullWidth={false} onClick={onReset}>
              Coba lagi
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  )
}
