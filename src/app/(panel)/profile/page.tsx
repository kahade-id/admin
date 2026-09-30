/**
 * Kahade Admin Web — profil admin.
 *
 * AUT-002: ganti kata sandi sendiri — butuh kata sandi lama (backend
 * memvalidasi policy password admin: min 12 + kompleksitas) dan mencabut
 * SEMUA sesi lain. Sesi perangkat ini tetap berlaku (refresh token lama
 * sudah tidak bisa dipakai setelah rotasi berikutnya… sebenarnya backend
 * mencabut semua sesi: admin akan diminta login ulang — komunikasikan).
 */
"use client"

import { useState, type FormEvent } from "react"

import { Button } from "@/components/ui/button"
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card"
import { Field, Input } from "@/components/ui/input"
import { useToast } from "@/components/ui/toast"
import { useAuth } from "@/lib/auth-context"
import { adminChangePassword } from "@/lib/api/admin/auth"
import { userMessage } from "@/lib/api/response"
import { roleLabel } from "@/lib/rbac"

function ProfileContent() {
  const toast = useToast()
  const { profile, logout } = useAuth()

  const [currentPassword, setCurrentPassword] = useState("")
  const [newPassword, setNewPassword] = useState("")
  const [newPassword2, setNewPassword2] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    if (!currentPassword) {
      setError("Masukkan kata sandi lama.")
      return
    }
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
      await adminChangePassword(currentPassword, newPassword)
      // Backend mencabut SEMUA sesi termasuk yang ini — paksa login ulang
      // agar admin tidak terkunci di sesi yang sudah dicabut.
      toast.show({
        title: "Kata sandi diganti. Semua sesi lain dicabut.",
        description: "Silakan masuk kembali dengan kata sandi baru.",
        tone: "success",
      })
      await logout()
      window.location.href = "/login"
    } catch (err) {
      setError(userMessage(err))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle>Profil admin</CardTitle>
        </CardHeader>
        <CardBody>
          <dl className="flex flex-col gap-2 text-body">
            <div className="flex justify-between">
              <dt className="text-text-secondary">Nama</dt>
              <dd className="font-medium text-text-primary">{profile?.fullName ?? "—"}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-text-secondary">Email</dt>
              <dd className="font-medium text-text-primary">{profile?.email ?? "—"}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-text-secondary">Role</dt>
              <dd className="font-medium text-text-primary">
                {profile?.role ? roleLabel(profile.role) : "—"}
              </dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-text-secondary">MFA</dt>
              <dd className="font-medium text-text-primary">
                {profile?.isMfaEnabled ? "Aktif" : "Tidak aktif"}
              </dd>
            </div>
          </dl>
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Ganti kata sandi</CardTitle>
          <p className="text-body text-text-secondary">
            Minimal 12 karakter dengan huruf besar, huruf kecil, angka, dan
            simbol. Mengganti kata sandi mencabut semua sesi login Anda di
            perangkat lain.
          </p>
        </CardHeader>
        <CardBody>
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <Field label="Kata sandi lama" error={error ?? undefined}>
              <Input
                type="password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                autoComplete="current-password"
                autoFocus
              />
            </Field>
            <Field label="Kata sandi baru">
              <Input
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                autoComplete="new-password"
                placeholder="Minimal 12 karakter"
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
            <Button type="submit" loading={loading}>
              Ganti kata sandi
            </Button>
          </form>
        </CardBody>
      </Card>
    </div>
  )
}

export default function ProfilePage() {
  return <ProfileContent />
}
