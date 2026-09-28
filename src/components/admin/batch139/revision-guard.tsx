/**
 * H08 — Peringatan data berubah saat form terbuka (Batch 139).
 *
 * Admin lain dapat mengubah record yang sama saat form sedang diisi.
 * Hook ini mem-poll "revision" ringan (mis. updatedAt / version dari API)
 * dan menandai bila berubah — pemanggil menampilkan banner dan menawarkan
 * muat ulang SEBELUM menyimpan (mencegah overwrite diam-diam).
 *
 * Pemakaian:
 *   const rev = useRevisionGuard({
 *     recordKey: `dispute:${id}`,
 *     getRevision: () => getDisputeDetail(id).then((d) => d.updatedAt ?? null),
 *     dirty: notes.trim().length > 0,
 *   })
 *   {rev.stale && <RevisionBanner onReload={async () => { await load(); rev.acknowledge() }} />}
 */
"use client"

import { useCallback, useEffect, useRef, useState } from "react"

import { Button } from "@/components/ui/button"

export type RevisionGuardOptions = {
  /** Kunci unik record, mis. `dispute:abc`. */
  recordKey: string
  /** Ambil penanda revisi saat ini (updatedAt / version / etag). */
  getRevision: () => Promise<string | number | null>
  /** Apakah form sedang kotor (ada perubahan belum disimpan). */
  dirty: boolean
  /** Interval polling (ms). Default 20 dtk. */
  intervalMs?: number
  /** Nonaktifkan (mis. saat data belum dimuat). */
  enabled?: boolean
}

export type RevisionGuard = {
  /** true bila revisi berubah sejak form dibuka/dimuat ulang. */
  stale: boolean
  /** Revisi terakhir yang terlihat (untuk debug). */
  revision: string | number | null
  /** Panggil setelah muat ulang data — baseline di-reset. */
  acknowledge: () => void
}

export function useRevisionGuard({
  recordKey,
  getRevision,
  dirty,
  intervalMs = 20000,
  enabled = true,
}: RevisionGuardOptions): RevisionGuard {
  const [baseline, setBaseline] = useState<string | number | null>(null)
  const [stale, setStale] = useState(false)
  const baselineRef = useRef<string | number | null>(null)
  const staleRef = useRef(false)
  const getRevisionRef = useRef(getRevision)
  getRevisionRef.current = getRevision

  const check = useCallback(async () => {
    try {
      const rev = await getRevisionRef.current()
      if (rev == null) return
      if (baselineRef.current == null) {
        baselineRef.current = rev
        setBaseline(rev)
        return
      }
      if (rev !== baselineRef.current && !staleRef.current) {
        staleRef.current = true
        setStale(true)
      }
    } catch {
      /* polling gagal — jangan ganggu form; coba lagi interval berikut */
    }
  }, [])

  // Baseline di-reset tiap recordKey berubah (navigasi antar record).
  useEffect(() => {
    baselineRef.current = null
    staleRef.current = false
    setBaseline(null)
    setStale(false)
    if (enabled) void check()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recordKey, enabled])

  useEffect(() => {
    if (!enabled) return
    const timer = setInterval(() => void check(), intervalMs)
    return () => clearInterval(timer)
  }, [enabled, intervalMs, check])

  const acknowledge = useCallback(() => {
    baselineRef.current = null
    staleRef.current = false
    setStale(false)
    void check()
  }, [check])

  return { stale: stale && dirty, revision: baseline, acknowledge }
}

/** Banner peringatan "data berubah" + tombol muat ulang. */
export function RevisionBanner({ onReload }: { onReload: () => void | Promise<void> }) {
  return (
    <div
      role="alert"
      className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-md border border-warning bg-warning/10 px-4 py-3"
    >
      <p className="text-body text-text-primary">
        <strong>Data berubah</strong> — record ini diubah (kemungkinan oleh admin lain) saat
        form terbuka. Muat ulang dulu agar tidak menimpa perubahan mereka.
      </p>
      <Button variant="secondary" size="sm" fullWidth={false} onClick={() => void onReload()}>
        Muat ulang data
      </Button>
    </div>
  )
}
