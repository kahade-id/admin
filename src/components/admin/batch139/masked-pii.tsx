/**
 * H13 — Masking PII mengikuti izin (Batch 139).
 *
 * Data sensitif di-mask secara default. Bila admin berhak melihat, tombol
 * "Tampilkan" membuka nilai ASLI dengan:
 * - pencatatan aksi reveal (siapa, field apa, record apa, kapan) — jejak
 *   audit lokal per admin (backend tidak punya endpoint khusus reveal),
 * - timeout otomatis: nilai kembali ter-mask setelah 30 detik,
 * - re-mask manual kapan saja.
 *
 * Tidak melemahkan masking yang sudah ada: default tetap masked, reveal
 * selalu eksplisit dan tercatat.
 */
"use client"

import { useCallback, useEffect, useRef, useState } from "react"

import { Button } from "@/components/ui/button"
import { useAuth } from "@/lib/auth-context"

export type PiiKind = "email" | "phone" | "name" | "account" | "other"

/** Batas waktu nilai terbuka sebelum otomatis ter-mask lagi. */
export const PII_REVEAL_TIMEOUT_MS = 30 * 1000

export type PiiRevealEntry = {
  at: string
  adminId: string
  adminName: string
  field: string
  recordId: string
}

const LOG_KEY = "kahade.admin.piiRevealLog"
const LOG_MAX = 500

export function logPiiReveal(entry: Omit<PiiRevealEntry, "at">) {
  try {
    const raw = localStorage.getItem(LOG_KEY)
    const list: PiiRevealEntry[] = raw ? (JSON.parse(raw) as PiiRevealEntry[]) : []
    list.unshift({ ...entry, at: new Date().toISOString() })
    localStorage.setItem(LOG_KEY, JSON.stringify(list.slice(0, LOG_MAX)))
  } catch {
    /* abaikan */
  }
}

export function getPiiRevealLog(): PiiRevealEntry[] {
  try {
    const raw = localStorage.getItem(LOG_KEY)
    return raw ? (JSON.parse(raw) as PiiRevealEntry[]) : []
  } catch {
    return []
  }
}

export function MaskedPii({
  label,
  masked,
  full,
  kind = "other",
  recordId,
}: {
  /** Label field untuk jejak audit, mis. "No. HP". */
  label: string
  /** Nilai yang sudah di-mask (tampilan default). */
  masked: string
  /** Nilai asli — hanya dirender saat reveal aktif. */
  full: string | null | undefined
  kind?: PiiKind
  /** ID record pemilik data (untuk jejak audit). */
  recordId: string
}) {
  const { profile } = useAuth()
  const [revealed, setRevealed] = useState(false)
  const [remaining, setRemaining] = useState(0)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const remask = useCallback(() => {
    if (timerRef.current) clearInterval(timerRef.current)
    timerRef.current = null
    setRevealed(false)
    setRemaining(0)
  }, [])

  useEffect(() => () => remask(), [remask])

  const reveal = () => {
    if (!full) return
    logPiiReveal({
      adminId: profile?.adminId ?? "anon",
      adminName: profile?.fullName ?? "Admin",
      field: `${label} (${kind})`,
      recordId,
    })
    setRevealed(true)
    const deadline = Date.now() + PII_REVEAL_TIMEOUT_MS
    setRemaining(Math.ceil(PII_REVEAL_TIMEOUT_MS / 1000))
    if (timerRef.current) clearInterval(timerRef.current)
    timerRef.current = setInterval(() => {
      const left = Math.ceil((deadline - Date.now()) / 1000)
      if (left <= 0) {
        remask()
      } else {
        setRemaining(left)
      }
    }, 1000)
  }

  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <span className="font-mono text-[13px] text-text-primary">
        {revealed ? full : masked}
      </span>
      {revealed ? (
        <span className="inline-flex items-center gap-2">
          <span className="text-caption text-warning-text" role="timer">
            Tertutup otomatis dalam {remaining} dtk
          </span>
          <Button variant="ghost" size="sm" fullWidth={false} onClick={remask}>
            Sembunyikan
          </Button>
        </span>
      ) : (
        <Button
          variant="ghost"
          size="sm"
          fullWidth={false}
          onClick={reveal}
          disabled={!full}
          title="Tampilkan nilai asli — aksi ini dicatat"
        >
          Tampilkan
        </Button>
      )}
    </span>
  )
}
