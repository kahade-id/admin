/**
 * H05 — Re-auth untuk tindakan kritis (Batch 139).
 *
 * Sesi admin yang masih valid belum cukup untuk aksi berisiko tinggi
 * (finance, RBAC, ops-settings). Pola: minta verifikasi ulang kredensial
 * (kata sandi + TOTP bila MFA aktif) sebelum aksi, lalu buka "jendela
 * konfirmasi" terbatas (default 10 menit, di sessionStorage).
 *
 * Implementasi: verifikasi memakai endpoint login yang SUDAH ADA
 * (`adminLogin(email, password, totpToken)`) — kredensial benar-benar
 * dicek ke server, bukan sekadar UI. Token sesi di-refresh untuk admin
 * yang sama sehingga sesi berjalan tidak terputus.
 *
 * STATUS: parsial — ini step-up sisi klien. Enforcement penuh per-aksi di
 * sisi server butuh endpoint/API khusus (belum ada); backend tetap menjadi
 * penegak otorisasi via RBAC yang sudah ada.
 *
 * Pemakaian:
 *   const reauth = useReauthGate()
 *   <Button onClick={() => reauth.require(() => doCriticalAction(), "Ubah limit payout")}>
 *     Simpan
 *   </Button>
 *   <ReauthDialog state={reauth.dialog} />
 */
"use client"

import { useCallback, useEffect, useRef, useState } from "react"

import { Button } from "@/components/ui/button"
import { Dialog } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { useToast } from "@/components/ui/toast"
import { adminLogin, adminVerify2fa } from "@/lib/api/admin/auth"
import { useAuth } from "@/lib/auth-context"
import { userMessage } from "@/lib/api/response"

/** Lama jendela konfirmasi setelah re-auth sukses (10 menit). */
export const REAUTH_WINDOW_MS = 10 * 60 * 1000
const STORAGE_KEY = "kahade.admin.reauthUntil"

function readWindow(): number {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY)
    const ts = raw ? Number.parseInt(raw, 10) : 0
    return Number.isFinite(ts) ? ts : 0
  } catch {
    return 0
  }
}

export type ReauthRequest = {
  /** Aksi yang dijalankan setelah re-auth sukses / dalam jendela. */
  action: () => void | Promise<void>
  /** Label aksi untuk ditampilkan di dialog. */
  label: string
}

export function useReauthGate() {
  const { profile } = useAuth()
  const [dialogOpen, setDialogOpen] = useState(false)
  const [pending, setPending] = useState<ReauthRequest | null>(null)
  const [windowUntil, setWindowUntil] = useState<number>(0)
  const pendingRef = useRef<ReauthRequest | null>(null)

  useEffect(() => {
    setWindowUntil(readWindow())
  }, [])

  const windowValid = windowUntil > Date.now()

  const openFor = useCallback((req: ReauthRequest) => {
    pendingRef.current = req
    setPending(req)
    setDialogOpen(true)
  }, [])

  /** Minta re-auth; jalankan aksi langsung bila masih dalam jendela. */
  const require = useCallback(
    (action: () => void | Promise<void>, label: string) => {
      if (readWindow() > Date.now()) {
        void action()
        return
      }
      openFor({ action, label })
    },
    [openFor],
  )

  const handleVerified = useCallback(() => {
    const until = Date.now() + REAUTH_WINDOW_MS
    try {
      sessionStorage.setItem(STORAGE_KEY, String(until))
    } catch {
      /* abaikan */
    }
    setWindowUntil(until)
    setDialogOpen(false)
    const req = pendingRef.current
    pendingRef.current = null
    setPending(null)
    if (req) void req.action()
  }, [])

  const close = useCallback(() => {
    setDialogOpen(false)
    pendingRef.current = null
    setPending(null)
  }, [])

  return {
    require,
    windowValid,
    /** Sisa jendela (ms) untuk indikator UI. */
    windowRemainingMs: Math.max(0, windowUntil - Date.now()),
    dialog: { open: dialogOpen, request: pending, onVerified: handleVerified, onClose: close },
  }
}

export type ReauthDialogProps = {
  open: boolean
  request: ReauthRequest | null
  onVerified: () => void
  onClose: () => void
}

/** Dialog verifikasi ulang kredensial + TOTP (bila MFA aktif). */
export function ReauthDialog({ open, request, onVerified, onClose }: ReauthDialogProps) {
  const { profile } = useAuth()
  const toast = useToast()
  const [password, setPassword] = useState("")
  const [totp, setTotp] = useState("")
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const mfaEnabled = !!profile?.isMfaEnabled

  useEffect(() => {
    if (open) {
      setPassword("")
      setTotp("")
      setError(null)
    }
  }, [open ])

  const submit = async () => {
    if (!profile?.email || !password || loading) return
    setLoading(true)
    setError(null)
    try {
      const res = await adminLogin(profile.email, password, totp.trim() || undefined)
      if ("requiresMfa" in res && res.requiresMfa) {
        // Login butuh MFA tapi TOTP belum diberikan / salah.
        if (!totp.trim()) {
          setError("Akun ini memakai MFA — masukkan kode TOTP.")
          return
        }
        await adminVerify2fa(res.tempToken, totp.trim())
      } else if ("requiresMfaSetup" in res && res.requiresMfaSetup) {
        setError("Akun belum menyelesaikan setup MFA. Selesaikan di Pengaturan terlebih dahulu.")
        return
      }
      // Sukses: kredensial terverifikasi server.
      onVerified()
      toast.show({ title: "Identitas terverifikasi", tone: "success" })
    } catch (e) {
      setError(userMessage(e) || "Verifikasi gagal — periksa kata sandi / kode MFA.")
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Verifikasi ulang identitas"
      description={
        request
          ? `Aksi "${request.label}" berisiko tinggi. Masukkan ulang kredensial Anda untuk melanjutkan. Jendela konfirmasi berlaku ${REAUTH_WINDOW_MS / 60000} menit.`
          : "Masukkan ulang kredensial Anda."
      }
      dirty={password.length > 0}
    >
      <div className="flex flex-col gap-4">
        <Input
          label="Kata sandi admin"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="••••••••"
          autoComplete="current-password"
        />
        {mfaEnabled ? (
          <Input
            label="Kode TOTP (MFA aktif)"
            value={totp}
            onChange={(e) => setTotp(e.target.value.replace(/\D/g, "").slice(0, 6))}
            placeholder="123456"
            inputMode="numeric"
          />
        ) : null}
        {error ? <p className="text-body text-danger-text">{error}</p> : null}
        <div className="flex flex-col gap-2">
          <Button loading={loading} disabled={!password} onClick={submit}>
            Verifikasi & lanjutkan
          </Button>
          <Button variant="ghost" disabled={loading} onClick={onClose}>
            Batal
          </Button>
        </div>
      </div>
    </Dialog>
  )
}
