/**
 * Kahade Admin Web — login.
 *
 * Alur:
 * 1. Email + password → POST /v1/admin/auth/login
 * 2a. Bila `requiresMfa` → input kode TOTP → POST /v1/admin/auth/2fa/verify
 * 2b. Bila `requiresMfaSetup` (03-#8) → tampilkan QR/secret →
 *     input kode TOTP → POST /v1/admin/auth/mfa/enable
 * 3. Token tersimpan di memori (bukan localStorage) → redirect ke `/` (panel).
 *
 * Halaman ini di luar <RequireAuth> — guard panel ada di (panel)/layout.
 */
"use client"

import { useRouter } from "next/navigation"
import { useEffect, useRef, useState, type FormEvent } from "react"

import { Button } from "@/components/ui/button"
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card"
import { Field, Input } from "@/components/ui/input"
import { MfaQrCode } from "@/components/security/mfa-qr-code"
import { ToastProvider, useToast } from "@/components/ui/toast"
import { AuthProvider, useAuth } from "@/lib/auth-context"
import { userMessage } from "@/lib/api/response"
import {
  adminLogin,
  adminVerify2fa,
  adminMfaSetup,
  adminMfaEnable,
  type AdminLoginResult,
} from "@/lib/api/admin/auth"

type Phase = "credentials" | "mfa" | "mfa-setup"

function LoginForm() {
  const router = useRouter()
  const toast = useToast()
  const { refresh } = useAuth()

  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [totp, setTotp] = useState("")
  const [tempToken, setTempToken] = useState<string | null>(null)
  const [phase, setPhase] = useState<Phase>("credentials")
  const [mfaSecret, setMfaSecret] = useState<string | null>(null)
  const [mfaOtpauthUrl, setMfaOtpauthUrl] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // ADM-426: hitung mundur setelah 429 (rate limit / lockout sementara).
  const [cooldownLeft, setCooldownLeft] = useState(0)
  const cooldownTimer = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    return () => {
      if (cooldownTimer.current) clearInterval(cooldownTimer.current)
    }
  }, [])

  function startCooldown(seconds: number) {
    if (cooldownTimer.current) clearInterval(cooldownTimer.current)
    setCooldownLeft(seconds)
    cooldownTimer.current = setInterval(() => {
      setCooldownLeft((left) => {
        if (left <= 1) {
          if (cooldownTimer.current) clearInterval(cooldownTimer.current)
          return 0
        }
        return left - 1
      })
    }, 1000)
  }

  /** ADM-426: kenali 429/lockout — pesan ramah + countdown dari Retry-After. */
  function handleAuthError(err: unknown) {
    const status = (err as { status?: number } | null)?.status
    const retryAfter = (err as { retryAfter?: number } | null)?.retryAfter
    if (status === 429) {
      // ADM-426: banner countdown khusus — bukan error field biasa.
      const seconds = retryAfter && retryAfter > 0 ? Math.ceil(retryAfter) : 60
      startCooldown(seconds)
      setError(null)
      return
    }
    setError(userMessage(err))
  }

  async function finishLogin() {
    await refresh()
    router.replace("/")
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)

    if (phase === "mfa") {
      // Langkah 2a: verifikasi TOTP.
      if (totp.trim().length < 6) {
        setError("Masukkan 6 digit kode authenticator.")
        return
      }
      setLoading(true)
      try {
        await adminVerify2fa(tempToken!, totp.trim())
        toast.show({ title: "Login berhasil", tone: "success" })
        await finishLogin()
      } catch (err) {
        handleAuthError(err)
      } finally {
        setLoading(false)
      }
      return
    }

    if (phase === "mfa-setup") {
      // Langkah 2b (03-#8): selesaikan enroll MFA.
      if (totp.trim().length < 6) {
        setError("Masukkan 6 digit kode dari aplikasi authenticator.")
        return
      }
      setLoading(true)
      try {
        await adminMfaEnable(tempToken!, totp.trim())
        toast.show({ title: "MFA diaktifkan. Login berhasil.", tone: "success" })
        await finishLogin()
      } catch (err) {
        handleAuthError(err)
      } finally {
        setLoading(false)
      }
      return
    }

    // Langkah 1: email + password.
    if (!email.trim() || !password) {
      setError("Isi email dan kata sandi admin.")
      return
    }
    setLoading(true)
    try {
      const res: AdminLoginResult = await adminLogin(email.trim(), password)
      if ("requiresMfa" in res && res.requiresMfa) {
        setTempToken(res.tempToken)
        setPhase("mfa")
        toast.show({ title: "Masukkan kode authenticator", tone: "info" })
      } else if ("requiresMfaSetup" in res && res.requiresMfaSetup) {
        // 03-#8: admin belum punya MFA — mulai enroll.
        setTempToken(res.tempToken)
        const setup = await adminMfaSetup(res.tempToken)
        setMfaSecret(setup.secret)
        setMfaOtpauthUrl(setup.otpauthUrl)
        setPhase("mfa-setup")
        toast.show({ title: "Aktifkan MFA untuk akun Anda", tone: "info" })
      } else {
        toast.show({ title: "Login berhasil", tone: "success" })
        await finishLogin()
      }
    } catch (err) {
      handleAuthError(err)
    } finally {
      setLoading(false)
    }
  }

  function resetToCredentials() {
    setTempToken(null)
    setTotp("")
    setError(null)
    setMfaSecret(null)
    setMfaOtpauthUrl(null)
    setPhase("credentials")
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Kahade Admin</CardTitle>
          <p className="text-body text-text-secondary">
            {phase === "mfa"
              ? "Verifikasi dua langkah"
              : phase === "mfa-setup"
                ? "Aktifkan autentikasi dua langkah"
                : "Masuk ke panel admin"}
          </p>
        </CardHeader>
        <CardBody>
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            {phase === "mfa" ? (
              <Field label="Kode authenticator (6 digit)" error={error ?? undefined}>
                <Input
                  value={totp}
                  onChange={(e) => setTotp(e.target.value)}
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={6}
                  placeholder="123456"
                  autoFocus
                />
              </Field>
            ) : phase === "mfa-setup" ? (
              <>
                <p className="text-body text-text-secondary">
                  Pindai kode berikut di aplikasi authenticator (Google
                  Authenticator, Authy, dsb.), lalu masukkan 6 digit kode yang
                  muncul.
                </p>
                {mfaOtpauthUrl ? (
                  <div className="flex justify-center">
                    <MfaQrCode otpauthUrl={mfaOtpauthUrl} />
                  </div>
                ) : null}
                {mfaSecret ? (
                  <Field label="Kode manual (bila QR tidak bisa dipindai)">
                    <Input value={mfaSecret} readOnly onFocus={(e) => e.target.select()} />
                  </Field>
                ) : null}
                <Field label="Kode authenticator (6 digit)" error={error ?? undefined}>
                  <Input
                    value={totp}
                    onChange={(e) => setTotp(e.target.value)}
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    maxLength={6}
                    placeholder="123456"
                    autoFocus
                  />
                </Field>
              </>
            ) : (
              <>
                <Field label="Email admin" error={error ?? undefined}>
                  <Input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    autoComplete="username"
                    placeholder="admin@kahade.id"
                    autoFocus
                  />
                </Field>
                <Field label="Kata sandi">
                  <Input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    autoComplete="current-password"
                    placeholder="••••••••"
                  />
                </Field>
              </>
            )}
            {/* ADM-426: banner lockout/rate-limit dengan countdown dari Retry-After. */}
            {cooldownLeft > 0 ? (
              <p
                role="alert"
                className="rounded-md border border-warning bg-warning/10 px-4 py-3 text-body text-text-primary"
              >
                Terlalu banyak percobaan. Coba lagi dalam {cooldownLeft} detik.
              </p>
            ) : null}
            <Button type="submit" loading={loading} disabled={cooldownLeft > 0}>
              {phase === "credentials" ? "Masuk" : phase === "mfa-setup" ? "Aktifkan MFA" : "Verifikasi"}
            </Button>
            {phase !== "credentials" ? (
              <Button type="button" variant="ghost" onClick={resetToCredentials}>
                Kembali
              </Button>
            ) : null}
          </form>
          <p className="mt-6 text-caption text-text-tertiary">
            Halaman ini hanya untuk tim operasional Kahade. Seluruh aktivitas
            dicatat di audit log.
          </p>
        </CardBody>
      </Card>
    </div>
  )
}

export default function AdminLoginPage() {
  return (
    <AuthProvider>
      <ToastProvider>
        <LoginForm />
      </ToastProvider>
    </AuthProvider>
  )
}
