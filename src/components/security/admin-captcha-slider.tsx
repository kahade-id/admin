/**
 * Kahade Admin — <AdminCaptchaSlider> (captcha geser untuk login admin).
 *
 * Kontrak backend (`POST /v1/admin/auth/captcha/generate`):
 * - respons: `{ challengeId, targetX }`, `targetX` = persen (20–80);
 * - jawaban: `captchaAnswer` = posisi slider pengguna dalam persen (0–100);
 * - backend menerima selisih ≤4 poin, tantangan kedaluwarsa 120 detik, dan
 *   solusi <800 ms dianggap bot.
 *
 * Protokol yang sama dengan CaptchaSlider mobile (frontend) — komponen ini
 * versi web yang sederhana memakai <input type="range"> bawaan browser.
 * Garis tujuan (targetX dari server) dirender di atas lintasan; pengguna
 * menggeser kenop sampai sejajar, lalu jawaban dikirim bersama request login.
 */
"use client"

import { useCallback, useEffect, useState } from "react"

import { Button } from "@/components/ui/button"
import { adminGenerateCaptcha } from "@/lib/api/admin/auth"

export type AdminCaptchaSolution = {
  challengeId: string
  answerX: number
}

export function AdminCaptchaSlider({
  onSolve,
  resetKey,
  disabled = false,
}: {
  /** Dipanggil dengan solusi saat pengguna melepas slider / menekan tombol. */
  onSolve: (solution: AdminCaptchaSolution | null) => void
  /** Berubah → muat tantangan baru (dipakai setelah CAPTCHA_FAILED/EXPIRED). */
  resetKey?: number | string
  disabled?: boolean
}) {
  const [challengeId, setChallengeId] = useState<string | null>(null)
  const [targetX, setTargetX] = useState(0)
  const [value, setValue] = useState(0)
  const [loading, setLoading] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setLoadError(null)
    onSolve(null)
    try {
      const c = await adminGenerateCaptcha()
      setChallengeId(c.challengeId)
      setTargetX(c.targetX)
      setValue(0)
    } catch {
      setLoadError("Gagal memuat verifikasi. Coba muat ulang.")
    } finally {
      setLoading(false)
    }
  }, [onSolve])

  useEffect(() => {
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resetKey])

  return (
    <div className="flex flex-col gap-2">
      <p className="text-body font-medium text-text-primary">Verifikasi keamanan</p>
      <p className="text-caption text-text-secondary">
        Terlalu banyak percobaan login gagal. Geser kenop sampai sejajar dengan
        garis tujuan, lalu tekan tombol Masuk.
      </p>
      <div className="relative h-12 rounded-md border border-border bg-surface px-3 pt-5">
        {/* Garis tujuan dari server */}
        <div
          className="absolute top-1 h-9 w-1 rounded-full bg-primary"
          style={{ left: `calc(${Math.min(100, Math.max(0, targetX))}% - 2px)` }}
          aria-hidden
        />
        <input
          type="range"
          min={0}
          max={100}
          step={1}
          value={value}
          disabled={disabled || loading || !challengeId}
          onChange={(e) => {
            const v = Number(e.target.value)
            setValue(v)
            if (challengeId) onSolve({ challengeId, answerX: v })
          }}
          className="w-full accent-[var(--color-primary)]"
          aria-label="Geser kenop ke garis tujuan"
        />
      </div>
      <div className="flex items-center justify-between">
        <p className="text-caption text-text-tertiary">Posisi: {value}%</p>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          fullWidth={false}
          loading={loading}
          disabled={disabled}
          onClick={() => void load()}
        >
          Muat ulang tantangan
        </Button>
      </div>
      {loadError ? (
        <p role="alert" className="text-caption text-danger-text">
          {loadError}
        </p>
      ) : null}
    </div>
  )
}
