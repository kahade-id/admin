/**
 * Kahade admin — gate step-up UI (SEC-503).
 *
 * `useStepUp().requestStepUp({ action, targetId, title, description })`
 * menampilkan dialog kata sandi (Bahasa Indonesia), memanggil
 * `requestStepUpToken`, dan me-resolve token sekali pakai dari server —
 * atau `null` bila pengguna membatalkan.
 *
 * Fail-closed: bila backend belum mendukung step-up (404 →
 * StepUpNotSupportedError), dialog menampilkan pesan yang jelas dan aksi
 * DIBATALKAN — tidak ada jalan pintas tanpa token server.
 *
 * Pemakaian (render `stepUpDialog` sekali di JSX halaman):
 *   const { requestStepUp, stepUpDialog } = useStepUp()
 *   const token = await requestStepUp({
 *     action: "admin.reset-2fa",
 *     targetId: admin.id,
 *     title: "Reset 2FA",
 *     description: `Reset 2FA untuk ${admin.fullName}.`,
 *   })
 *   if (!token) return
 *   await resetAdmin2fa(admin.id, { reason, stepUpToken: token })
 *   ...
 *   {stepUpDialog}
 */
"use client"

import { useCallback, useRef, useState, type ReactNode } from "react"

import { Button } from "@/components/ui/button"
import { Dialog } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import {
  StepUpNotSupportedError,
  requestStepUpToken,
} from "@/lib/api/admin/step-up"
import { userMessage } from "@/lib/api/response"

export type StepUpRequestOptions = {
  /** Nama aksi server untuk token, mis. "admin.reset-2fa". */
  action: string
  /** Id target aksi (mis. id admin target), bila ada. */
  targetId?: string
  /** Judul dialog (Bahasa Indonesia). */
  title: string
  /** Penjelasan aksi untuk pengguna, opsional. */
  description?: string
}

type PendingRequest = {
  opts: StepUpRequestOptions
  resolve: (token: string | null) => void
}

export type StepUpDialogProps = {
  open: boolean
  /** Nama aksi server untuk token, mis. "admin.reset-2fa". */
  action: string
  /** Id target aksi, bila ada. */
  targetId?: string
  /** Judul dialog (Bahasa Indonesia). */
  title: string
  /** Penjelasan aksi untuk pengguna. */
  description?: string
  /** Dipanggil dengan token sekali pakai bila verifikasi sukses. */
  onToken: (token: string) => void
  /** Dipanggil bila pengguna membatalkan (aksi harus dibatalkan). */
  onCancel: () => void
}

/**
 * Dialog kata sandi → token step-up server per aksi.
 *
 * Fail-closed: bila backend belum mendukung step-up (404 →
 * StepUpNotSupportedError), dialog menampilkan pesan yang jelas dan TIDAK
 * memanggil `onToken` — pengguna hanya bisa membatalkan.
 */
export function StepUpDialog({
  open,
  action,
  targetId,
  title,
  description,
  onToken,
  onCancel,
}: StepUpDialogProps) {
  const [password, setPassword] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = useCallback(async () => {
    if (busy) return
    if (!password) {
      setError("Masukkan kata sandi Anda untuk verifikasi ulang.")
      return
    }
    setBusy(true)
    setError(null)
    try {
      const token = await requestStepUpToken(action, targetId, password)
      setPassword("")
      onToken(token)
    } catch (e) {
      setBusy(false)
      if (e instanceof StepUpNotSupportedError) {
        setError(
          "Backend belum mendukung verifikasi per aksi. Aksi dibatalkan demi keamanan.",
        )
      } else {
        setError(userMessage(e) || "Verifikasi gagal — periksa kata sandi Anda.")
      }
    }
  }, [busy, password, action, targetId, onToken])

  return (
    <Dialog
      open={open}
      onClose={() => {
        if (busy) return
        setPassword("")
        setError(null)
        onCancel()
      }}
      title={title}
      description={
        description ??
        "Aksi ini berisiko tinggi. Masukkan ulang kata sandi Anda — server akan menerbitkan token sekali pakai khusus untuk aksi ini."
      }
      dirty={password.length > 0}
    >
      <div className="flex flex-col gap-4">
        <Input
          label="Kata sandi admin"
          type="password"
          value={password}
          onChange={(e) => {
            setPassword(e.target.value)
            if (error) setError(null)
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") void submit()
          }}
          placeholder="••••••••"
          autoComplete="current-password"
          autoFocus
        />
        {error ? (
          <p role="alert" className="text-body text-danger-text">
            {error}
          </p>
        ) : null}
        <div className="flex flex-col gap-2">
          <Button loading={busy} disabled={!password} onClick={() => void submit()}>
            Verifikasi & lanjutkan
          </Button>
          <Button
            variant="ghost"
            disabled={busy}
            onClick={() => {
              setPassword("")
              setError(null)
              onCancel()
            }}
          >
            Batal
          </Button>
        </div>
      </div>
    </Dialog>
  )
}

export function useStepUp(): {
  requestStepUp: (opts: StepUpRequestOptions) => Promise<string | null>
  stepUpDialog: ReactNode
} {
  const [pending, setPending] = useState<PendingRequest | null>(null)
  const pendingRef = useRef<PendingRequest | null>(null)

  const requestStepUp = useCallback(
    (opts: StepUpRequestOptions): Promise<string | null> => {
      return new Promise((resolve) => {
        // Re-entrant: satu dialog dalam satu waktu — panggilan kedua
        // dianggap dibatalkan agar tidak menggantung.
        if (pendingRef.current) {
          resolve(null)
          return
        }
        const req: PendingRequest = { opts, resolve }
        pendingRef.current = req
        setPending(req)
      })
    },
    [],
  )

  const close = useCallback((token: string | null) => {
    const req = pendingRef.current
    pendingRef.current = null
    setPending(null)
    if (req) req.resolve(token)
  }, [])

  const stepUpDialog: ReactNode = (
    <StepUpDialog
      open={pending !== null}
      action={pending?.opts.action ?? ""}
      targetId={pending?.opts.targetId}
      title={pending?.opts.title ?? "Verifikasi ulang identitas"}
      description={pending?.opts.description}
      onToken={(token) => close(token)}
      onCancel={() => close(null)}
    />
  )

  return { requestStepUp, stepUpDialog }
}
