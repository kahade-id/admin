/**
 * Admin — Detail Akun Admin (E5a, grup E).
 *
 * getAdmin (existing di management.ts): peran, status, login terakhir.
 * Histori perubahan hak dari audit (getAdminAuditLog), sesi aktif + revoke
 * per sesi, suspend/reactivate dengan alasan WAJIB, ubah role dengan alasan
 * WAJIB + dialog konfirmasi. Guard: admin tidak bisa men-suspend/mengubah
 * role akunnya sendiri.
 */
"use client"

import { useCallback, useEffect, useState } from "react"
import { useParams, useRouter } from "next/navigation"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardBody, CardHeader } from "@/components/ui/card"
import { ConfirmDialog, Dialog } from "@/components/ui/dialog"
import { TextArea } from "@/components/ui/input"
import { DataTable } from "@/components/ui/table"
import { useToast } from "@/components/ui/toast"
import { Select } from "@/components/admin/select"
import { RoleGate } from "@/components/admin/role-gate"
import { useAuth } from "@/lib/auth-context"
import {
  ADMIN_ROLES,
  changeAdminRole,
  getAdmin,
  getAdminAuditLog,
  listAdminSessions,
  reactivateAdmin,
  revokeAdminSession,
  suspendAdmin,
  type AdminManagementSession,
  type AdminRightsChangeEntry,
  type AdminRole,
  type AdminUserItem,
} from "@/lib/api/admin/management"
import { roleLabel } from "@/lib/rbac"
import { userMessage } from "@/lib/api/response"
import { formatDateTimeWIB } from "@/lib/format"

import { ErrorBlock, KeyValue, LoadingBlock, PageHeader } from "../../_components/admin-ui"

const MIN_REASON = 5

const ROLE_LABELS: Record<AdminRole, string> = {
  SUPER_ADMIN: "Super Admin",
  DISPUTE_ADMIN: "Admin Sengketa",
  KYC_ADMIN: "Admin KYC",
  FINANCE_ADMIN: "Admin Keuangan",
  CUSTOMER_SUPPORT: "Customer Support",
}

function AdminDetailContent() {
  const params = useParams<{ id: string }>()
  const id = Array.isArray(params.id) ? params.id[0] : (params.id ?? "")
  const router = useRouter()
  const toast = useToast()
  const { profile } = useAuth()

  const [admin, setAdmin] = useState<AdminUserItem | null>(null)
  const [sessions, setSessions] = useState<AdminManagementSession[]>([])
  const [rights, setRights] = useState<AdminRightsChangeEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [sectionError, setSectionError] = useState<Record<string, string>>({})
  const [acting, setActing] = useState(false)

  const [suspendOpen, setSuspendOpen] = useState(false)
  const [reactivateOpen, setReactivateOpen] = useState(false)
  const [roleOpen, setRoleOpen] = useState(false)
  const [roleConfirmOpen, setRoleConfirmOpen] = useState(false)
  const [reason, setReason] = useState("")
  const [reasonError, setReasonError] = useState<string | null>(null)
  const [newRole, setNewRole] = useState<AdminRole>("CUSTOMER_SUPPORT")
  const [revokeTarget, setRevokeTarget] = useState<AdminManagementSession | null>(null)

  const selfId = profile?.id ?? null
  const selfAdminId = profile?.adminId ?? null
  const isSelf =
    admin != null &&
    ((selfId != null && admin.id === selfId) ||
      (selfAdminId != null && admin.adminId === selfAdminId))

  const loadAll = useCallback(async () => {
    if (!id) return
    setLoading(true)
    setError(null)
    setSectionError({})
    const [a, s, r] = await Promise.allSettled([
      getAdmin(id),
      listAdminSessions(id, { limit: 50 }),
      getAdminAuditLog(id, { limit: 50 }),
    ])
    if (a.status === "fulfilled") setAdmin(a.value)
    else {
      setError(userMessage(a.reason))
      setLoading(false)
      return
    }
    const nextErrors: Record<string, string> = {}
    if (s.status === "fulfilled") setSessions(s.value.data ?? [])
    else nextErrors.sessions = userMessage(s.reason)
    if (r.status === "fulfilled") setRights(r.value.data ?? [])
    else nextErrors.rights = userMessage(r.reason)
    setSectionError(nextErrors)
    setLoading(false)
  }, [id])

  useEffect(() => {
    void loadAll()
  }, [loadAll])

  function validReason(): string | null {
    const r = reason.trim()
    if (r.length < MIN_REASON) {
      setReasonError(`Alasan minimal ${MIN_REASON} karakter.`)
      return null
    }
    setReasonError(null)
    return r
  }

  async function runMutation(
    label: string,
    fn: () => Promise<unknown>,
    successTitle: string,
  ) {
    setActing(true)
    try {
      await fn()
      await loadAll()
      toast.show({ title: successTitle, tone: "success" })
    } catch (e) {
      toast.show({ title: `Gagal: ${label}`, description: userMessage(e), tone: "danger" })
    } finally {
      setActing(false)
    }
  }

  const handleSuspend = () => {
    const r = validReason()
    if (!r) return
    setSuspendOpen(false)
    void runMutation("suspend", () => suspendAdmin(id, r), "Akun admin ditangguhkan.")
    setReason("")
  }

  const handleReactivate = () => {
    const r = validReason()
    if (!r) return
    setReactivateOpen(false)
    void runMutation("reactivate", () => reactivateAdmin(id, r), "Akun admin diaktifkan kembali.")
    setReason("")
  }

  const handleRoleNext = () => {
    const r = validReason()
    if (!r) return
    if (admin && newRole === admin.role) {
      setReasonError("Pilih peran yang berbeda dari peran saat ini.")
      return
    }
    setRoleOpen(false)
    setRoleConfirmOpen(true)
  }

  const handleRoleConfirm = () => {
    const r = reason.trim()
    setRoleConfirmOpen(false)
    void runMutation(
      "ubah role",
      () => changeAdminRole(id, { role: newRole, reason: r }),
      `Peran diubah menjadi ${ROLE_LABELS[newRole]}.`,
    )
    setReason("")
  }

  const handleRevokeSession = () => {
    if (!revokeTarget) return
    const s = revokeTarget
    setRevokeTarget(null)
    void runMutation(
      "cabut sesi",
      () => revokeAdminSession(id, s.id),
      "Sesi dicabut.",
    )
  }

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title={admin ? admin.fullName : "Detail Admin"}
        description={admin ? `${admin.email} · ${roleLabel(admin.role)}` : undefined}
        actions={
          <Button
            variant="secondary"
            size="sm"
            fullWidth={false}
            onClick={() => router.push("/team")}
          >
            ← Daftar tim
          </Button>
        }
        onRefresh={loadAll}
        refreshing={loading}
      />

      {loading && !admin ? (
        <LoadingBlock message="Memuat detail admin…" />
      ) : error && !admin ? (
        <ErrorBlock title="Gagal memuat detail admin" message={error} onRetry={loadAll} />
      ) : admin ? (
        <>
          <Card padded={false}>
            <CardHeader
              title="Profil admin"
              action={
                <Badge tone={admin.isActive ? "success" : "neutral"} dot>
                  {admin.isActive ? "Aktif" : "Nonaktif"}
                </Badge>
              }
            />
            <CardBody>
              <KeyValue label="Nama" value={admin.fullName} />
              <KeyValue label="Email" value={admin.email} mono />
              <KeyValue
                label="Peran"
                value={<Badge tone="info">{ROLE_LABELS[admin.role] ?? admin.role}</Badge>}
              />
              <KeyValue
                label="2FA"
                value={admin.isMfaEnabled ? "Aktif" : "Nonaktif"}
              />
              <KeyValue
                label="Login terakhir"
                value={
                  admin.lastLoginAt
                    ? `${formatDateTimeWIB(admin.lastLoginAt)}${admin.lastLoginIp ? ` · ${admin.lastLoginIp}` : ""}`
                    : "Belum pernah login"
                }
              />
              {admin.lockedUntil && new Date(admin.lockedUntil).getTime() > Date.now() ? (
                <KeyValue
                  label="Terkunci hingga"
                  value={formatDateTimeWIB(admin.lockedUntil)}
                />
              ) : null}
              <KeyValue label="Dibuat" value={formatDateTimeWIB(admin.createdAt)} />
            </CardBody>
          </Card>

          <Card padded={false}>
            <CardHeader title="Sesi aktif" />
            <CardBody>
              {sectionError.sessions ? (
                <p className="text-body text-danger-text">{sectionError.sessions}</p>
              ) : (
                <DataTable<AdminManagementSession & Record<string, unknown>>
                  columns={[
                    {
                      key: "device",
                      header: "Perangkat",
                      render: (s) => (
                        <div>
                          <p className="font-medium">
                            {s.deviceInfo?.trim() || "Perangkat tidak dikenal"}
                            {s.isCurrent ? (
                              <span className="ml-2 text-caption text-text-tertiary">
                                (sesi ini)
                              </span>
                            ) : null}
                          </p>
                          {s.ipAddress ? (
                            <p className="font-mono text-caption text-text-secondary">
                              {s.ipAddress}
                            </p>
                          ) : null}
                        </div>
                      ),
                    },
                    {
                      key: "lastActiveAt",
                      header: "Aktif terakhir",
                      render: (s) => formatDateTimeWIB(s.lastActiveAt),
                    },
                    {
                      key: "expiresAt",
                      header: "Kedaluwarsa",
                      render: (s) => formatDateTimeWIB(s.expiresAt),
                    },
                    {
                      key: "action",
                      header: "",
                      align: "right",
                      render: (s) => (
                        <Button
                          variant="secondary"
                          size="sm"
                          fullWidth={false}
                          onClick={() => setRevokeTarget(s)}
                        >
                          Cabut
                        </Button>
                      ),
                    },
                  ]}
                  rows={sessions.map((s) => ({ ...s }))}
                  rowKey={(s) => s.id}
                  emptyText="Tidak ada sesi aktif."
                />
              )}
            </CardBody>
          </Card>

          <Card padded={false}>
            <CardHeader title="Histori perubahan hak" />
            <CardBody>
              {sectionError.rights ? (
                <p className="text-body text-danger-text">{sectionError.rights}</p>
              ) : (
                <DataTable<AdminRightsChangeEntry & Record<string, unknown>>
                  columns={[
                    {
                      key: "createdAt",
                      header: "Waktu",
                      render: (r) => formatDateTimeWIB(r.createdAt),
                    },
                    {
                      key: "action",
                      header: "Perubahan",
                      render: (r) => (
                        <div>
                          <p className="font-medium">{r.description?.trim() || r.action}</p>
                          <p className="font-mono text-caption text-text-secondary">
                            {r.action}
                          </p>
                        </div>
                      ),
                    },
                    {
                      key: "ipAddress",
                      header: "IP",
                      render: (r) => (
                        <span className="font-mono text-[13px]">{r.ipAddress ?? "—"}</span>
                      ),
                    },
                  ]}
                  rows={rights.map((r) => ({ ...r }))}
                  rowKey={(r) => r.id}
                  emptyText="Belum ada perubahan hak tercatat."
                />
              )}
            </CardBody>
          </Card>

          <Card padded={false}>
            <CardHeader title="Aksi admin" />
            <CardBody>
              {isSelf ? (
                <p className="text-body text-text-secondary">
                  Ini akun Anda sendiri — suspend dan ubah peran tidak tersedia untuk akun
                  sendiri.
                </p>
              ) : (
                <div className="flex flex-wrap gap-3">
                  {admin.isActive ? (
                    <Button
                      variant="destructive"
                      size="sm"
                      fullWidth={false}
                      loading={acting}
                      onClick={() => {
                        setReason("")
                        setReasonError(null)
                        setSuspendOpen(true)
                      }}
                    >
                      Tangguhkan akun
                    </Button>
                  ) : (
                    <Button
                      variant="secondary"
                      size="sm"
                      fullWidth={false}
                      loading={acting}
                      onClick={() => {
                        setReason("")
                        setReasonError(null)
                        setReactivateOpen(true)
                      }}
                    >
                      Aktifkan kembali
                    </Button>
                  )}
                  <Button
                    variant="secondary"
                    size="sm"
                    fullWidth={false}
                    loading={acting}
                    onClick={() => {
                      setReason("")
                      setReasonError(null)
                      setNewRole(admin.role)
                      setRoleOpen(true)
                    }}
                  >
                    Ubah peran
                  </Button>
                </div>
              )}
            </CardBody>
          </Card>
        </>
      ) : null}

      <Dialog
        open={suspendOpen}
        onClose={() => setSuspendOpen(false)}
        title="Tangguhkan akun admin?"
        description={`Akun ${admin?.fullName ?? ""} tidak bisa login ke panel admin sampai diaktifkan kembali. Alasan wajib dan dicatat di audit.`}
        footer={
          <Button variant="destructive" loading={acting} onClick={handleSuspend}>
            Tangguhkan
          </Button>
        }
      >
        <TextArea
          label="Alasan penangguhan"
          required
          rows={4}
          placeholder="Minimal 5 karakter…"
          value={reason}
          onChange={(e) => {
            setReason(e.target.value)
            setReasonError(null)
          }}
          error={reasonError ?? undefined}
        />
      </Dialog>

      <Dialog
        open={reactivateOpen}
        onClose={() => setReactivateOpen(false)}
        title="Aktifkan kembali akun admin?"
        description={`Akun ${admin?.fullName ?? ""} bisa login kembali ke panel admin. Alasan wajib dan dicatat di audit.`}
        footer={
          <Button loading={acting} onClick={handleReactivate}>
            Aktifkan kembali
          </Button>
        }
      >
        <TextArea
          label="Alasan pengaktifan kembali"
          required
          rows={4}
          placeholder="Minimal 5 karakter…"
          value={reason}
          onChange={(e) => {
            setReason(e.target.value)
            setReasonError(null)
          }}
          error={reasonError ?? undefined}
        />
      </Dialog>

      <Dialog
        open={roleOpen}
        onClose={() => setRoleOpen(false)}
        title="Ubah peran admin"
        description="Peran menentukan menu dan aksi yang bisa diakses. Alasan wajib dan dicatat di audit."
        footer={
          <Button loading={acting} onClick={handleRoleNext}>
            Lanjut ke konfirmasi
          </Button>
        }
      >
        <div className="flex flex-col gap-4">
          <Select
            label="Peran baru"
            options={ADMIN_ROLES.map((r) => ({ value: r, label: ROLE_LABELS[r] }))}
            value={newRole}
            onChange={(e) => setNewRole(e.target.value as AdminRole)}
          />
          <TextArea
            label="Alasan perubahan peran"
            required
            rows={4}
            placeholder="Minimal 5 karakter…"
            value={reason}
            onChange={(e) => {
              setReason(e.target.value)
              setReasonError(null)
            }}
            error={reasonError ?? undefined}
          />
        </div>
      </Dialog>

      <ConfirmDialog
        open={roleConfirmOpen}
        onClose={() => setRoleConfirmOpen(false)}
        title="Konfirmasi ubah peran?"
        description={`Peran ${admin?.fullName ?? ""} akan diubah dari ${admin ? ROLE_LABELS[admin.role] : ""} menjadi ${ROLE_LABELS[newRole]}. Alasan: ${reason.trim()}`}
        confirmLabel="Ubah peran"
        onConfirm={handleRoleConfirm}
        loading={acting}
        destructive
      />

      <ConfirmDialog
        open={revokeTarget != null}
        onClose={() => setRevokeTarget(null)}
        title="Cabut sesi ini?"
        description={`Sesi pada ${revokeTarget?.deviceInfo?.trim() || "perangkat tidak dikenal"}${revokeTarget?.ipAddress ? ` (${revokeTarget.ipAddress})` : ""} akan dicabut dan admin harus login ulang.`}
        confirmLabel="Cabut sesi"
        onConfirm={handleRevokeSession}
        loading={acting}
        destructive
      />
    </div>
  )
}

export default function AdminDetailPage() {
  return (
    <RoleGate href="/team">
      <AdminDetailContent />
    </RoleGate>
  )
}
