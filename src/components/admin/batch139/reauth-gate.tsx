/**
 * SEC-503 — Re-auth untuk tindakan kritis (ditulis ulang).
 *
 * SEBELUMNYA (H05): step-up HANYA client-side — flag
 * `kahade.admin.reauthUntil` di sessionStorage membuka "jendela konfirmasi"
 * 10 menit untuk SEMUA aksi. Itu bukan kontrol keamanan: sesi curian
 * (token bocor / XSS) langsung lolos karena tidak ada yang diverifikasi di
 * server per aksi.
 *
 * SEKARANG: tiap `require()` → dialog kata sandi → server menerbitkan token
 * sekali pakai (single-use, TTL 2–5 menit, terikat aksi + target) via
 * `POST /v1/admin/auth/step-up`; token itu yang menjadi GERBANG — server
 * menolak 403 bila header `X-Step-Up-Token` absen/tidak valid. Tidak ada
 * lagi konsep jendela waktu: SETIAP aksi sensitif meminta kata sandi baru
 * (fail-closed, tanpa pengecualian). sessionStorage TIDAK dipakai sama
 * sekali.
 *
 * Ini mitigasi SESI CURIAN, bukan sekadar anti-salah-klik: penyerang yang
 * memegang token sesi tetap tidak bisa menjalankan aksi kritis tanpa kata
 * sandi admin.
 *
 * Kompatibilitas: ekspor lama (`useReauthGate`, `ReauthDialog`,
 * `ReauthRequest`) dipertahankan agar pemanggil lama (finance, ops-settings,
 * team, emergency-grants) tidak rusak. `action` kini menerima token step-up
 * server sebagai argumen — fungsi lama tanpa argumen tetap bisa dipakai
 * (token diabaikan), tetapi aksi tersebut akan ditolak server 403 sampai
 * pemanggil dimigrasi ke token per-aksi via `useStepUp`.
 *
 * Pemanggil baru sebaiknya memakai `useStepUp` langsung
 * (`@/components/admin/step-up-gate`) — hook ini hanya untuk kompatibilitas.
 */
"use client"

import { useCallback, useRef, useState } from "react"

import {
  StepUpDialog as StepUpPasswordDialog,
} from "@/components/admin/step-up-gate"

/**
 * Aksi step-up default untuk pemanggil lama yang belum dimigrasi ke token
 * per-aksi. SEMENTARA — pemanggil harus dimigrasi ke `useStepUp` dengan
 * nama aksi spesifik (mis. "finance.withdrawal.approve") agar token
 * diterima server.
 */
export const LEGACY_STEP_UP_ACTION = "admin.panel-action"

/**
 * @deprecated Konsep jendela konfirmasi DIHAPUS (SEC-503) — tidak ada lagi
 * jendela waktu; tiap aksi sensitif meminta kata sandi baru. Konstanta ini
 * dipertahankan agar impor lama tidak merusak kompilasi.
 */
export const REAUTH_WINDOW_MS = 0

export type ReauthRequest = {
  /**
   * Aksi yang dijalankan SETELAH verifikasi sukses, menerima token step-up
   * sekali pakai dari server. Teruskan token ke fungsi API
   * (`stepUpToken`) agar server mengizinkan aksi.
   */
  action: (stepUpToken: string) => void | Promise<void>
  /** Label aksi untuk ditampilkan di dialog (Bahasa Indonesia). */
  label: string
  /** Nama aksi server untuk token step-up, mis. "admin.reset-2fa". */
  stepUpAction: string
  /** Id target aksi (mis. id admin target), bila ada. */
  targetId?: string
}

export type RequireOpts = {
  /** Nama aksi server untuk token step-up (default: LEGACY_STEP_UP_ACTION). */
  stepUpAction?: string
  /** Id target aksi, bila ada. */
  targetId?: string
}

export function useReauthGate() {
  const [dialogOpen, setDialogOpen] = useState(false)
  const [pending, setPending] = useState<ReauthRequest | null>(null)
  const pendingRef = useRef<ReauthRequest | null>(null)

  /**
   * Minta verifikasi ulang lalu jalankan aksi dengan token step-up server.
   * SELALU menampilkan dialog kata sandi — tidak ada jalan pintas jendela
   * waktu. Bila pengguna batal / backend belum mendukung step-up, aksi
   * TIDAK dijalankan (fail-closed).
   */
  const require = useCallback(
    (
      action: (stepUpToken: string) => void | Promise<void>,
      label: string,
      opts: RequireOpts = {},
    ) => {
      if (pendingRef.current) return // satu dialog dalam satu waktu
      const req: ReauthRequest = {
        action,
        label,
        stepUpAction: opts.stepUpAction ?? LEGACY_STEP_UP_ACTION,
        targetId: opts.targetId,
      }
      pendingRef.current = req
      setPending(req)
      setDialogOpen(true)
    },
    [],
  )

  const handleVerified = useCallback((token: string) => {
    setDialogOpen(false)
    const req = pendingRef.current
    pendingRef.current = null
    setPending(null)
    if (req) void req.action(token)
  }, [])

  const close = useCallback(() => {
    setDialogOpen(false)
    pendingRef.current = null
    setPending(null)
  }, [])

  return {
    require,
    dialog: {
      open: dialogOpen,
      request: pending,
      onVerified: handleVerified,
      onClose: close,
    },
    /**
     * @deprecated Konsep jendela konfirmasi DIHAPUS (SEC-503). Selalu false —
     * dipertahankan agar kode lama yang membaca field ini tetap kompilasi.
     */
    windowValid: false as boolean,
    /**
     * @deprecated Konsep jendela konfirmasi DIHAPUS (SEC-503). Selalu 0.
     */
    windowRemainingMs: 0 as number,
  }
}

export type ReauthDialogProps = {
  open: boolean
  request: ReauthRequest | null
  /** Dipanggil dengan token step-up server bila verifikasi sukses. */
  onVerified: (stepUpToken: string) => void
  onClose: () => void
}

/**
 * Dialog verifikasi ulang kata sandi → token step-up server per aksi.
 * Dibangun di atas dialog step-up bersama (`StepUpDialog`).
 */
export function ReauthDialog({ open, request, onVerified, onClose }: ReauthDialogProps) {
  return (
    <StepUpPasswordDialog
      open={open}
      action={request?.stepUpAction ?? LEGACY_STEP_UP_ACTION}
      targetId={request?.targetId}
      title="Verifikasi ulang identitas"
      description={
        request
          ? `Aksi "${request.label}" berisiko tinggi. Masukkan ulang kata sandi ` +
            "Anda — server menerbitkan token sekali pakai khusus untuk aksi ini. " +
            "Tanpa verifikasi ini aksi tidak dapat dijalankan."
          : undefined
      }
      onToken={onVerified}
      onCancel={onClose}
    />
  )
}
