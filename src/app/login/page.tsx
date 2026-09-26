/**
 * Kahade Admin Web — login.
 *
 * Alur:
 * 1. Email + password → POST /v1/admin/auth/login
 * 2. Bila `requiresMfa` → input kode TOTP → POST /v1/admin/auth/2fa/verify
 * 3. Token tersimpan (localStorage, key terpisah dari sesi user) →
 *    redirect ke `/` (panel).
 *
 * Halaman ini di luar <RequireAuth> — guard panel ada di (panel)/layout.
 */
"use client"

import { useRouter } from "next/navigation"
import { useState, type FormEvent } from "react"

import { Button } from "@/components/ui/button"
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card"
import { Field, Input } from "@/components/ui/input"
import { ToastProvider, useToast } from "@/components/ui/toast"
import { AuthProvider, useAuth } from "@/lib/auth-context"
import { userMessage } from "@/lib/api/response"
import {
  adminLogin,
  adminVerify2fa,
  type AdminLoginResult,
} from "@/lib/api/admin/auth"

function LoginForm() {
  const router = useRouter()
  const toast = useToast()
  const { refresh } = useAuth()

  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [totp, setTotp] = useState("")
  const [tempToken, setTempToken] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function finishLogin() {
    await refresh()
    router.replace("/")
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)

    if (tempToken) {
      // Langkah 2: verifikasi TOTP.
      if (totp.trim().length < 6) {
        setError("Masukkan 6 digit kode authenticator.")
        return
      }
      setLoading(true)
      try {
        await adminVerify2fa(tempToken, totp.trim())
        toast.show({ title: "Login berhasil", tone: "success" })
        await finishLogin()
      } catch (err) {
        setError(userMessage(err))
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
        toast.show({ title: "Masukkan kode authenticator", tone: "info" })
      } else {
        toast.show({ title: "Login berhasil", tone: "success" })
        await finishLogin()
      }
    } catch (err) {
      setError(userMessage(err))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Kahade Admin</CardTitle>
          <p className="text-body text-text-secondary">
            {tempToken ? "Verifikasi dua langkah" : "Masuk ke panel admin"}
          </p>
        </CardHeader>
        <CardBody>
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            {tempToken ? (
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
            <Button type="submit" loading={loading}>
              {tempToken ? "Verifikasi" : "Masuk"}
            </Button>
            {tempToken ? (
              <Button
                type="button"
                variant="ghost"
                onClick={() => {
                  setTempToken(null)
                  setTotp("")
                  setError(null)
                }}
              >
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
