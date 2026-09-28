/**
 * Admin — Akses Darurat (E5a, grup E).
 *
 * Form pemberian grant sementara (admin, alasan, scope, durasi ≤ 120 menit)
 * + daftar grant aktif + revoke per grant. Setiap grant dicatat di audit
 * oleh backend.
 */
"use client"

import { useCallback, useEffect, useState } from "react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardBody, CardHeader } from "@/components/ui/card"
import { ConfirmDialog, Dialog } from "@/components/ui/dialog"
import { Input, TextArea } from "@/components/ui/input"
import { DataTable } from "@/components/ui/table"
import { useToast } from "@/components/ui/toast"
import { Select } from "@/components/admin/select"
import { RoleGate } from "@/components/admin/role-gate"
import {
  createEmergencyGrant,
  listAdmins,
  listEmergencyGrants,
  revokeEmergencyGrant,
  type AdminUserItem,
  type EmergencyGrant,
} from "@/lib/api/admin/management"
import { roleLabel } from "@/lib/rbac"
import { userMessage } from "@/lib/api/response"
import { formatDateTimeWIB } from "@/lib/format"
// H05: step-up re-auth untuk aksi grant darurat.
import { ReauthDialog, useReauthGate } from "@/components/admin/batch139/reauth-gate"

import { ErrorBlock, LoadingBlock, PageHeader } from "../../_components/admin-ui"

const MAX_DURATION_MINUTES = 120
const MIN_REASON = 10

const SCOPE_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "USERS", label: "Pengguna" },
  { value: "KYC", label: "KYC" },
  { value: "FINANCE", label: "Keuangan" },
  { value: "DISPUTES", label: "Sengketa" },
  { value: "ALL", label: "Semua area" },
]

function scopeLabel(scope: string): string {
  return SCOPE_OPTIONS.find((o) => o.value === scope)?.label ?? scope
}

function remainingLabel(expiresAt: string): string {
  const ms = new Date(expiresAt).getTime() - Date.now()
  if (ms <= 0) return "Kedaluwarsa"
  const m = Math.floor(ms / 60_000)
  if (m < 60) return `${m} mnt lagi`
  const h = Math.floor(m / 60)
  return `${h} jam ${m % 60} mnt lagi`
}

function EmergencyGrantsContent() {
  const toast = useToast()
  // H05: gate verifikasi ulang untuk aksi grant darurat.
  const reauth = useReauthGate()
  const [grants, setGrants] = useState<EmergencyGrant[]>([])
  const [admins, setAdmins] = useState<AdminUserItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [formOpen, setFormOpen] = useState(false)
  const [adminId, setAdminId] = useState("")
  const [reason, setReason] = useState("")
  const [scope, setScope] = useState("USERS")
  const [duration, setDuration] = useState("30")
  const [formError, setFormError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const [revokeTarget, setRevokeTarget] = useState<EmergencyGrant | null>(null)
  const [revoking, setRevoking] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [g, a] = await Promise.all([
        listEmergencyGrants({ activeOnly: true }),
        listAdmins({ limit: 100 }),
      ])
      setGrants(g.filter((x) => x.isActive && !x.revokedAt))
      setAdmins((a.data ?? []).filter((x) => x.isActive))
    } catch (e) {
      setError(userMessage(e))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  function resetForm() {
    setAdminId("")
    setReason("")
    setScope("USERS")
    setDuration("30")
    setFormError(null)
  }

  async function handleCreate() {
    const r = reason.trim()
    const mins = Number(duration)
    if (!adminId) {
      setFormError("Pilih admin penerima akses darurat.")
      return
    }
    if (r.length < MIN_REASON) {
      setFormError(`Alasan minimal ${MIN_REASON} karakter.`)
      return
    }
    if (!Number.isInteger(mins) || mins < 1 || mins > MAX_DURATION_MINUTES) {
      setFormError(`Durasi 1–${MAX_DURATION_MINUTES} menit.`)
      return
    }
    setFormError(null)
    setSaving(true)
    try {
      await createEmergencyGrant({ adminId, reason: r, scope, durationMinutes: mins })
      toast.show({ title: "Akses darurat diberikan.", tone: "success" })
      setFormOpen(false)
      resetForm()
      await load()
    } catch (e) {
      setFormError(userMessage(e))
    } finally {
      setSaving(false)
    }
  }

  async function handleRevoke() {
    if (!revokeTarget) return
    const g = revokeTarget
    setRevokeTarget(null)
    setRevoking(true)
    try {
      await revokeEmergencyGrant(g.id)
      toast.show({ title: "Grant dicabut.", tone: "success" })
      await load()
    } catch (e) {
      toast.show({ title: "Gagal mencabut grant", description: userMessage(e), tone: "danger" })
    } finally {
      setRevoking(false)
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Akses Darurat"
        description="Pemberian hak sementara untuk penanganan insiden. Maksimal 120 menit, otomatis kedaluwarsa, dan tercatat di audit."
        actions={
          <Button
            variant="secondary"
            size="sm"
            fullWidth={false}
            onClick={() => {
              resetForm()
              setFormOpen(true)
            }}
          >
            Beri akses darurat
          </Button>
        }
        onRefresh={load}
        refreshing={loading}
      />

      <Card padded={false}>
        <CardHeader title="Grant aktif" />
        <CardBody>
          {loading ? (
            <LoadingBlock message="Memuat grant aktif…" />
          ) : error ? (
            <ErrorBlock title="Gagal memuat grant" message={error} onRetry={load} />
          ) : (
            <DataTable<EmergencyGrant & Record<string, unknown>>
              columns={[
                {
                  key: "admin",
                  header: "Penerima",
                  render: (g) => (
                    <div>
                      <p className="font-semibold">{g.adminName ?? g.adminId}</p>
                      {g.grantedByName ? (
                        <p className="text-caption text-text-secondary">
                          diberi oleh {g.grantedByName}
                        </p>
                      ) : null}
                    </div>
                  ),
                },
                {
                  key: "scope",
                  header: "Scope",
                  render: (g) => <Badge tone="warning">{scopeLabel(g.scope)}</Badge>,
                },
                {
                  key: "reason",
                  header: "Alasan",
                  render: (g) => g.reason,
                },
                {
                  key: "expires",
                  header: "Berlaku hingga",
                  render: (g) => (
                    <span>
                      {formatDateTimeWIB(g.expiresAt)}
                      <span className="block text-caption text-text-tertiary">
                        {remainingLabel(g.expiresAt)}
                      </span>
                    </span>
                  ),
                },
                {
                  key: "action",
                  header: "",
                  align: "right",
                  render: (g) => (
                    <Button
                      variant="destructive"
                      size="sm"
                      fullWidth={false}
                      loading={revoking}
                      onClick={() => setRevokeTarget(g)}
                    >
                      Cabut
                    </Button>
                  ),
                },
              ]}
              rows={grants.map((g) => ({ ...g }))}
              rowKey={(g) => g.id}
              emptyText="Tidak ada grant akses darurat yang aktif."
            />
          )}
        </CardBody>
      </Card>

      <Dialog
        open={formOpen}
        onClose={() => setFormOpen(false)}
        title="Beri akses darurat"
        description="Hak tambahan sementara di luar peran normal admin. Gunakan hanya untuk penanganan insiden."
      >
        <div className="flex flex-col gap-4">
          {formError ? (
            <p role="alert" className="text-body text-danger-text">
              {formError}
            </p>
          ) : null}
          <Select
            label="Admin penerima"
            options={[
              { value: "", label: "— Pilih admin —" },
              ...admins.map((a) => ({
                value: a.id,
                label: `${a.fullName} · ${roleLabel(a.role)}`,
              })),
            ]}
            value={adminId}
            onChange={(e) => setAdminId(e.target.value)}
          />
          <Select
            label="Scope"
            options={SCOPE_OPTIONS}
            value={scope}
            onChange={(e) => setScope(e.target.value)}
          />
          <Input
            label="Durasi (menit)"
            type="number"
            min={1}
            max={MAX_DURATION_MINUTES}
            value={duration}
            onChange={(e) => setDuration(e.target.value)}
            hint={`Maksimal ${MAX_DURATION_MINUTES} menit.`}
          />
          <TextArea
            label="Alasan pemberian"
            required
            rows={4}
            placeholder={`Minimal ${MIN_REASON} karakter — cth. Insiden payout…`}
            value={reason}
            onChange={(e) => {
              setReason(e.target.value)
              setFormError(null)
            }}
          />
          <Button
            loading={saving}
            // H05: grant darurat wajib verifikasi ulang.
            onClick={() => reauth.require(() => void handleCreate(), "Beri akses darurat")}
          >
            Beri akses
          </Button>
        </div>
      </Dialog>

      <ConfirmDialog
        open={revokeTarget != null}
        onClose={() => setRevokeTarget(null)}
        title="Cabut grant ini?"
        description={`Akses darurat ${revokeTarget?.adminName ?? ""} (${revokeTarget ? scopeLabel(revokeTarget.scope) : ""}) akan dicabut sebelum kedaluwarsa.`}
        confirmLabel="Cabut grant"
        // H05: pencabutan grant darurat wajib verifikasi ulang.
        onConfirm={() =>
          reauth.require(
            () => void handleRevoke(),
            `Cabut grant darurat ${revokeTarget?.adminName ?? ""}`,
          )
        }
        loading={revoking}
        destructive
      />
      {/* H05: dialog verifikasi ulang untuk aksi grant darurat. */}
      <ReauthDialog {...reauth.dialog} />
    </div>
  )
}

export default function EmergencyGrantsPage() {
  return (
    <RoleGate href="/team">
      <EmergencyGrantsContent />
    </RoleGate>
  )
}
