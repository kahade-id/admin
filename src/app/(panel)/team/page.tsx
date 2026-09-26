/**
 * Admin — Tim (manajemen akun admin).
 *
 * Daftar akun admin (nama, email, peran, status, 2FA, login terakhir),
 * tambah admin baru (kata sandi min 12 karakter + kompleksitas), serta aksi
 * per baris: reset 2FA, kunci/buka kunci akun, dan hapus (soft-delete).
 * Admin tidak bisa menghapus akunnya sendiri.
 *
 * Port dari frontend/app/admin/(panel)/team.tsx → web desktop.
 */
"use client"

import { useCallback, useEffect, useState } from "react"

import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Card, CardBody } from "@/components/ui/card"
import { ConfirmDialog, Dialog } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { DataTable } from "@/components/ui/table"
import { useToast } from "@/components/ui/toast"
import { Select } from "@/components/admin/select"
import { Pagination } from "@/components/admin/pagination"
import { RoleGate } from "@/components/admin/role-gate"
import { useAuth } from "@/lib/auth-context"
import { formatDateTimeWIB } from "@/lib/format"
import { userMessage } from "@/lib/api/response"
import type { Paginated } from "@/lib/api/admin/kyc"
import {
  ADMIN_ROLES,
  listAdmins,
  createAdmin,
  updateAdmin,
  deleteAdmin,
  resetAdmin2fa,
  unlockAdmin,
  type AdminRole,
  type AdminUserItem,
} from "@/lib/api/admin/management"

const PAGE_SIZE = 20

/** Nilai enum AdminRole di backend — dipakai persis apa adanya. */
const ROLE_LABELS: Record<AdminRole, string> = {
  SUPER_ADMIN: "Super Admin",
  DISPUTE_ADMIN: "Admin Sengketa",
  KYC_ADMIN: "Admin KYC",
  FINANCE_ADMIN: "Admin Keuangan",
  CUSTOMER_SUPPORT: "Layanan Pelanggan",
}

function isLocked(admin: AdminUserItem): boolean {
  if (!admin.lockedUntil) return false
  return new Date(admin.lockedUntil).getTime() > Date.now()
}

/**
 * Baris tabel: interface dari kontrak API tidak punya implicit index
 * signature sehingga tidak memenuhi `DataTable<Row extends Record<string,
 * unknown>>` — alias lokal ini menutupinya tanpa mengubah kontrak API.
 */
type AdminRow = AdminUserItem & Record<string, unknown>

/** Min 12 karakter + huruf besar, huruf kecil, angka, simbol. */
function validatePassword(pw: string): string | null {
  if (pw.length < 12) return "Kata sandi minimal 12 karakter."
  if (!/[A-Z]/.test(pw)) return "Kata sandi harus mengandung huruf besar."
  if (!/[a-z]/.test(pw)) return "Kata sandi harus mengandung huruf kecil."
  if (!/[0-9]/.test(pw)) return "Kata sandi harus mengandung angka."
  if (!/[^A-Za-z0-9]/.test(pw)) return "Kata sandi harus mengandung simbol."
  return null
}

/* ------------------------------------------------------------------ */
/* Form tambah admin                                                    */
/* ------------------------------------------------------------------ */

function CreateAdminForm({ onCreated }: { onCreated: () => void }) {
  const toast = useToast()
  const [fullName, setFullName] = useState("")
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [role, setRole] = useState<AdminRole>("CUSTOMER_SUPPORT")
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  async function handleSubmit() {
    setFormError(null)
    if (fullName.trim().length < 2) {
      setFormError("Nama lengkap minimal 2 karakter.")
      return
    }
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) {
      setFormError("Format email tidak valid.")
      return
    }
    const pwError = validatePassword(password)
    if (pwError) {
      setFormError(pwError)
      return
    }
    setSaving(true)
    try {
      await createAdmin({
        fullName: fullName.trim(),
        email: email.trim(),
        password,
        role,
      })
      toast.show({ title: "Akun admin dibuat.", tone: "success" })
      onCreated()
    } catch (e) {
      setFormError(userMessage(e))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {formError ? (
        <p role="alert" className="text-body text-danger-text">
          {formError}
        </p>
      ) : null}
      <Input
        label="Nama lengkap"
        value={fullName}
        onChange={(e) => setFullName(e.target.value)}
        maxLength={60}
        required
      />
      <Input
        label="Email"
        type="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        autoComplete="email"
        required
      />
      <Input
        label="Kata sandi awal"
        type="password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        autoComplete="new-password"
        hint="Min. 12 karakter: huruf besar, huruf kecil, angka, dan simbol."
        required
      />
      <Select
        label="Peran"
        value={role}
        onChange={(e) => setRole(e.target.value as AdminRole)}
        options={ADMIN_ROLES.map((r) => ({ value: r, label: ROLE_LABELS[r] }))}
      />
      <Button loading={saving} onClick={handleSubmit}>
        Tambah admin
      </Button>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Halaman                                                             */
/* ------------------------------------------------------------------ */

type ConfirmAction =
  | { kind: "reset-2fa"; admin: AdminUserItem }
  | { kind: "toggle-lock"; admin: AdminUserItem }
  | { kind: "delete"; admin: AdminUserItem }

function TeamPageContent() {
  const toast = useToast()
  const { profile } = useAuth()
  const [page, setPage] = useState(1)
  const [rows, setRows] = useState<AdminUserItem[]>([])
  const [total, setTotal] = useState(0)
  const [totalPages, setTotalPages] = useState(1)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [searchText, setSearchText] = useState("")
  const [search, setSearch] = useState("")
  const [createOpen, setCreateOpen] = useState(false)
  const [confirm, setConfirm] = useState<ConfirmAction | null>(null)
  const [confirming, setConfirming] = useState(false)

  const selfId = profile?.id ?? null
  const selfAdminId = profile?.adminId ?? null
  const isSelf = useCallback(
    (a: AdminUserItem) =>
      (selfId != null && a.id === selfId) ||
      (selfAdminId != null && a.adminId === selfAdminId),
    [selfId, selfAdminId],
  )

  const load = useCallback(
    async (targetPage: number, query: string) => {
      setLoading(true)
      setError(null)
      try {
        const res: Paginated<AdminUserItem> = await listAdmins({
          page: targetPage,
          limit: PAGE_SIZE,
          search: query || undefined,
        })
        setRows(res.data ?? [])
        const t = res.total ?? res.data?.length ?? 0
        setTotal(t)
        setTotalPages(res.totalPages ?? Math.max(1, Math.ceil(t / PAGE_SIZE)))
        setPage(targetPage)
      } catch (e) {
        const msg = userMessage(e)
        setError(msg)
        toast.show({ title: "Gagal memuat tim admin", description: msg, tone: "danger" })
      } finally {
        setLoading(false)
      }
    },
    [toast],
  )

  useEffect(() => {
    void load(1, search)
  }, [load, search])

  function submitSearch() {
    setSearch(searchText.trim())
  }

  async function handleConfirm() {
    if (!confirm) return
    const { kind, admin } = confirm
    setConfirming(true)
    try {
      if (kind === "reset-2fa") {
        await resetAdmin2fa(admin.id)
        toast.show({
          title: "2FA direset.",
          description: `${admin.fullName} harus menyiapkan ulang authenticator.`,
          tone: "success",
        })
      } else if (kind === "toggle-lock") {
        if (isLocked(admin)) {
          await unlockAdmin(admin.id)
          toast.show({ title: "Akun dibuka.", tone: "success" })
        } else if (admin.isActive) {
          await updateAdmin(admin.id, { isActive: false })
          toast.show({ title: "Akun dikunci.", tone: "success" })
        } else {
          await updateAdmin(admin.id, { isActive: true })
          toast.show({ title: "Akun diaktifkan.", tone: "success" })
        }
      } else {
        await deleteAdmin(admin.id)
        toast.show({ title: "Akun admin dihapus.", tone: "success" })
      }
      setConfirm(null)
      void load(page, search)
    } catch (e) {
      toast.show({ title: "Aksi gagal", description: userMessage(e), tone: "danger" })
    } finally {
      setConfirming(false)
    }
  }

  function confirmMeta(): { title: string; description: string; confirmLabel: string; destructive: boolean } {
    if (!confirm) return { title: "", description: "", confirmLabel: "", destructive: false }
    const { kind, admin } = confirm
    if (kind === "reset-2fa")
      return {
        title: "Reset 2FA?",
        description: `2FA akun ${admin.fullName} (${admin.email}) akan direset. Admin harus menyiapkan ulang authenticator.`,
        confirmLabel: "Reset 2FA",
        destructive: false,
      }
    if (kind === "delete")
      return {
        title: "Hapus admin?",
        description: `Akun ${admin.fullName} (${admin.email}) akan dinonaktifkan (soft-delete). Tindakan ini tidak dapat dibatalkan.`,
        confirmLabel: "Hapus",
        destructive: true,
      }
    if (isLocked(admin))
      return {
        title: "Buka akun?",
        description: `Akun ${admin.fullName} akan dibuka dan bisa login kembali.`,
        confirmLabel: "Buka akun",
        destructive: false,
      }
    if (admin.isActive)
      return {
        title: "Kunci akun?",
        description: `Akun ${admin.fullName} akan dinonaktifkan dan tidak bisa login ke panel admin.`,
        confirmLabel: "Kunci akun",
        destructive: true,
      }
    return {
      title: "Aktifkan akun?",
      description: `Akun ${admin.fullName} akan diaktifkan kembali dan bisa login ke panel admin.`,
      confirmLabel: "Aktifkan",
      destructive: false,
    }
  }

  const meta = confirmMeta()

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-h2 font-semibold text-text-primary">Tim</h1>
          <p className="mt-1 text-body text-text-secondary">
            Kelola akun admin yang bisa mengakses panel ini.
          </p>
        </div>
        <Button fullWidth={false} onClick={() => setCreateOpen(true)}>
          Tambah admin
        </Button>
      </div>

      <div className="flex max-w-md gap-2">
        <div className="flex-1">
          <Input
            label="Cari admin"
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") submitSearch()
            }}
            placeholder="Nama, email, atau ID admin"
          />
        </div>
        <div className="pt-[26px]">
          <Button variant="secondary" size="md" fullWidth={false} onClick={submitSearch}>
            Cari
          </Button>
        </div>
      </div>

      {error && !loading ? (
        <Card>
          <CardBody className="flex flex-col gap-3">
            <p role="alert" className="text-body text-danger-text">
              {error}
            </p>
            <div className="max-w-xs">
              <Button variant="secondary" onClick={() => load(page, search)}>
                Coba lagi
              </Button>
            </div>
          </CardBody>
        </Card>
      ) : (
        <>
          <DataTable<AdminRow>
            columns={[
              {
                key: "fullName",
                header: "Nama",
                render: (r) => (
                  <div>
                    <p className="font-semibold">
                      {r.fullName}
                      {isSelf(r) ? (
                        <span className="ml-2 text-caption text-text-tertiary">(Anda)</span>
                      ) : null}
                    </p>
                    <p className="text-caption text-text-secondary">{r.email}</p>
                  </div>
                ),
              },
              {
                key: "role",
                header: "Peran",
                render: (r) => ROLE_LABELS[r.role] ?? r.role,
              },
              {
                key: "status",
                header: "Status",
                render: (r) => {
                  const locked = isLocked(r)
                  return (
                    <Badge
                      tone={locked ? "danger" : r.isActive ? "success" : "neutral"}
                      dot
                    >
                      {locked ? "Terkunci" : r.isActive ? "Aktif" : "Nonaktif"}
                    </Badge>
                  )
                },
              },
              {
                key: "mfa",
                header: "2FA",
                render: (r) =>
                  r.isMfaEnabled ? (
                    <Badge tone="success" dot>
                      Aktif
                    </Badge>
                  ) : (
                    <Badge tone="neutral">Nonaktif</Badge>
                  ),
              },
              {
                key: "lastLoginAt",
                header: "Terakhir login",
                render: (r) => formatDateTimeWIB(r.lastLoginAt),
              },
              {
                key: "action",
                header: "",
                align: "right",
                render: (r) => {
                  const locked = isLocked(r)
                  return (
                    <div className="flex flex-wrap justify-end gap-2">
                      <Button
                        variant="secondary"
                        size="sm"
                        fullWidth={false}
                        onClick={() => setConfirm({ kind: "reset-2fa", admin: r })}
                      >
                        Reset 2FA
                      </Button>
                      <Button
                        variant="secondary"
                        size="sm"
                        fullWidth={false}
                        onClick={() => setConfirm({ kind: "toggle-lock", admin: r })}
                      >
                        {locked ? "Buka kunci" : r.isActive ? "Kunci" : "Aktifkan"}
                      </Button>
                      {isSelf(r) ? null : (
                        <Button
                          variant="destructive"
                          size="sm"
                          fullWidth={false}
                          onClick={() => setConfirm({ kind: "delete", admin: r })}
                        >
                          Hapus
                        </Button>
                      )}
                    </div>
                  )
                },
              },
            ]}
            rows={rows as AdminRow[]}
            rowKey={(r) => r.id}
            loading={loading}
            emptyText="Belum ada akun admin. Tambah akun admin pertama untuk tim."
          />
          <Pagination
            page={page}
            totalPages={totalPages}
            total={total}
            pageSize={PAGE_SIZE}
            onPageChange={(p) => load(p, search)}
            disabled={loading}
          />
        </>
      )}

      <Dialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        title="Tambah admin"
        description="Akun baru langsung bisa login ke panel admin sesuai perannya."
      >
        <CreateAdminForm
          key="create-admin"
          onCreated={() => {
            setCreateOpen(false)
            void load(1, search)
          }}
        />
      </Dialog>

      <ConfirmDialog
        open={confirm != null}
        onClose={() => setConfirm(null)}
        title={meta.title}
        description={meta.description}
        confirmLabel={meta.confirmLabel}
        onConfirm={handleConfirm}
        loading={confirming}
        destructive={meta.destructive}
      />
    </div>
  )
}

export default function TeamPage() {
  return (
    <RoleGate href="/team">
      <TeamPageContent />
    </RoleGate>
  )
}
