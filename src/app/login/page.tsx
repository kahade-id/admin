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
  adminFirstPasswordChange,
  type AdminLoginResult,
} from "@/lib/api/admin/auth"
import {
  AdminCaptchaSlider,
  type AdminCaptchaSolution,
} from "@/components/security/admin-captcha-slider"

type Phase = "credentials" | "mfa" | "mfa-setup" | "password-change"

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
  // AUT-003: slider captcha — muncul bila backend menjawab 401 CAPTCHA_REQUIRED.
  const [captcha, setCaptcha] = useState<AdminCaptchaSolution | null>(null)
  const [captchaResetKey, setCaptchaResetKey] = useState(0)
  const [captchaRequired, setCaptchaRequired] = useState(false)
  // AUT-011: password baru untuk akun yang wajib ganti (akun baru / direset).
  const [newPassword, setNewPassword] = useState("")
  const [newPassword2, setNewPassword2] = useState("")

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
    const code = (err as { code?: string } | null)?.code
    // AUT-003: backend meminta slider captcha (3+ login gagal dari IP ini).
    // Muat tantangan baru — tantangan lama dihapus backend setelah verifikasi
    // pertama, jadi tidak bisa dipakai ulang.
    if (
      code === "CAPTCHA_REQUIRED" ||
      code === "CAPTCHA_FAILED" ||
      code === "CAPTCHA_EXPIRED"
    ) {
      setCaptchaRequired(true)
      setCaptcha(null)
      setCaptchaResetKey((k) => k + 1)
      setError(
        code === "CAPTCHA_REQUIRED"
          ? "Verifikasi keamanan diperlukan. Geser kenop sampai sejajar garis, lalu coba masuk lagi."
          : "Verifikasi gagal atau kedaluwarsa. Selesaikan tantangan baru di bawah, lalu coba lagi.",
      )
      return
    }
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

    if (phase === "password-change") {
      // AUT-011: akun baru / password direset — wajib ganti password dulu.
      // Endpoint first-password-change TIDAK menerbitkan sesi; setelah sukses
      // pengguna login ulang dengan password baru.
      if (newPassword.length < 12) {
        setError("Kata sandi baru minimal 12 karakter.")
        return
      }
      if (newPassword !== newPassword2) {
        setError("Konfirmasi kata sandi tidak cocok.")
        return
      }
      setLoading(true)
      try {
        await adminFirstPasswordChange(tempToken!, newPassword)
        toast.show({ title: "Kata sandi diganti. Silakan masuk dengan kata sandi baru.", tone: "success" })
        setNewPassword("")
        setNewPassword2("")
        setTempToken(null)
        setPhase("credentials")
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
      // AUT-003: sertakan jawaban captcha bila backend mewajibkannya.
      const res: AdminLoginResult = await adminLogin(
        email.trim(),
        password,
        undefined,
        captchaRequired && captcha
          ? { captchaId: captcha.challengeId, captchaAnswer: captcha.answerX }
          : undefined,
      )
      // AUT-003: captcha lolos / tidak diminta lagi — sembunyikan slider.
      setCaptchaRequired(false)
      if ("requiresPasswordChange" in res && res.requiresPasswordChange) {
        // AUT-011: akun wajib ganti password — belum ada sesi.
        setTempToken(res.tempToken)
        setPhase("password-change")
        toast.show({ title: "Anda wajib mengganti kata sandi terlebih dahulu", tone: "info" })
      } else if ("requiresMfa" in res && res.requiresMfa) {
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
    setNewPassword("")
    setNewPassword2("")
    setCaptcha(null)
    setCaptchaRequired(false)
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
                : phase === "password-change"
                  ? "Ganti kata sandi"
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
            ) : phase === "password-change" ? (
              <>
                <p className="text-body text-text-secondary">
                  Akun Anda wajib mengganti kata sandi (akun baru atau kata
                  sandi direset admin). Minimal 12 karakter dengan huruf besar,
                  huruf kecil, angka, dan simbol.
                </p>
                <Field label="Kata sandi baru" error={error ?? undefined}>
                  <Input
                    type="password"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    autoComplete="new-password"
                    placeholder="Minimal 12 karakter"
                    autoFocus
                  />
                </Field>
                <Field label="Ulangi kata sandi baru">
                  <Input
                    type="password"
                    value={newPassword2}
                    onChange={(e) => setNewPassword2(e.target.value)}
                    autoComplete="new-password"
                    placeholder="Ulangi kata sandi baru"
                  />
                </Field>
              </>
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
            {/* AUT-003: slider captcha — hanya bila backend mewajibkan. */}
            {phase === "credentials" && captchaRequired ? (
              <AdminCaptchaSlider
                resetKey={captchaResetKey}
                disabled={loading}
                onSolve={setCaptcha}
              />
            ) : null}
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
              {phase === "credentials"
                ? "Masuk"
                : phase === "mfa-setup"
                  ? "Aktifkan MFA"
                  : phase === "password-change"
                    ? "Ganti kata sandi"
                    : "Verifikasi"}
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
