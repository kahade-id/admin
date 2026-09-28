/**
 * Admin — Status publik & insiden (G497, Grup F worker D).
 *
 * SUPER_ADMIN: kelola IncidentLog (buat/ubah/tutup) yang tampil di
 * `GET /v1/status` + pratinjau tampilan publiknya.
 * Deskripsi ditulis UNTUK PUBLIK — backend menolak pola mirip PII.
 *
 * CATATAN NAV: route ini didaftarkan di MENU (src/lib/rbac.ts) per ADM-417 —
 * SUPER_ADMIN melihatnya di sidebar. RoleGate tetap menolak non-SUPER_ADMIN.
 */
"use client"

import { useCallback, useEffect, useState } from "react"

import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Card, CardBody } from "@/components/ui/card"
import { DataTable } from "@/components/ui/table"
import { EmptyState } from "@/components/ui/empty-state"
import { Spinner } from "@/components/ui/spinner"
import { Dialog } from "@/components/ui/dialog"
import { Input, TextArea } from "@/components/ui/input"
import { Select } from "@/components/admin/select"
import { RoleGate } from "@/components/admin/role-gate"
import { useToast } from "@/components/ui/toast"
import { userMessage } from "@/lib/api/response"
import {
  listIncidents,
  createIncident,
  updateIncident,
  getPublicStatus,
  type IncidentItem,
  type PublicStatus,
} from "@/lib/api/admin/observability"

type IncidentRow = IncidentItem & Record<string, unknown>

const SEVERITIES: IncidentItem["severity"][] = ["SEV1", "SEV2", "SEV3", "SEV4"]
const STATUSES: IncidentItem["status"][] = ["INVESTIGATING", "IDENTIFIED", "MONITORING", "RESOLVED"]

function severityTone(s: string): "danger" | "warning" | "neutral" {
  if (s === "SEV1") return "danger"
  if (s === "SEV2") return "warning"
  return "neutral"
}

function statusTone(s: string): "success" | "warning" | "neutral" {
  if (s === "RESOLVED") return "success"
  if (s === "INVESTIGATING") return "warning"
  return "neutral"
}

function IncidentForm({
  initial,
  onClose,
  onSaved,
}: {
  initial?: IncidentItem
  onClose: () => void
  onSaved: () => void
}) {
  const toast = useToast()
  const [title, setTitle] = useState(initial?.title ?? "")
  const [description, setDescription] = useState(initial?.description ?? "")
  const [severity, setSeverity] = useState<IncidentItem["severity"]>(initial?.severity ?? "SEV3")
  const [status, setStatus] = useState<IncidentItem["status"]>(initial?.status ?? "INVESTIGATING")
  const [component, setComponent] = useState(initial?.component ?? "api")
  const [saving, setSaving] = useState(false)

  const save = useCallback(async () => {
    if (!title.trim() || !description.trim()) {
      toast.show({ title: "Judul & deskripsi wajib diisi", tone: "danger" })
      return
    }
    setSaving(true)
    try {
      if (initial) {
        await updateIncident(initial.id, { title, description, severity, status, component })
      } else {
        await createIncident({ title, description, severity, component })
      }
      toast.show({ title: initial ? "Insiden diperbarui" : "Insiden dibuat", tone: "success" })
      onSaved()
      onClose()
    } catch (err) {
      toast.show({ title: "Gagal menyimpan", description: userMessage(err), tone: "danger" })
    } finally {
      setSaving(false)
    }
  }, [title, description, severity, status, component, initial, onClose, onSaved, toast])

  return (
    <div className="flex flex-col gap-3">
      <Input label="Judul" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} />
      <TextArea
        label="Deskripsi (publik — tanpa PII/nomor HP/email)"
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        rows={4}
      />
      <div className="grid grid-cols-3 gap-3">
        <Select
          label="Tingkat keparahan"
          value={severity}
          options={SEVERITIES.map((s) => ({ value: s, label: s }))}
          onChange={(e) => setSeverity(e.target.value as IncidentItem["severity"])}
        />
        {initial ? (
          <Select
            label="Status"
            value={status}
            options={STATUSES.map((s) => ({ value: s, label: s }))}
            onChange={(e) => setStatus(e.target.value as IncidentItem["status"])}
          />
        ) : null}
        <Input label="Komponen" value={component} onChange={(e) => setComponent(e.target.value)} maxLength={100} />
      </div>
      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose} disabled={saving}>Batal</Button>
        <Button onClick={() => void save()} disabled={saving}>Simpan</Button>
      </div>
    </div>
  )
}

function StatusInner() {
  const toast = useToast()
  const [loading, setLoading] = useState(true)
  const [incidents, setIncidents] = useState<IncidentItem[]>([])
  const [publicStatus, setPublicStatus] = useState<PublicStatus | null>(null)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState<IncidentItem | undefined>(undefined)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [inc, pub] = await Promise.all([listIncidents(), getPublicStatus()])
      setIncidents(inc.incidents)
      setPublicStatus(pub)
    } catch (err) {
      toast.show({ title: "Gagal memuat status", description: userMessage(err), tone: "danger" })
    } finally {
      setLoading(false)
    }
  }, [toast])

  useEffect(() => {
    void load()
  }, [load])

  const openCreate = useCallback(() => {
    setEditing(undefined)
    setDialogOpen(true)
  }, [])

  const openEdit = useCallback((row: IncidentRow) => {
    setEditing(row)
    setDialogOpen(true)
  }, [])

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Spinner size="md" />
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-8">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-h2 font-semibold text-text-primary">Status Layanan</h1>
          <p className="mt-1 text-body text-text-secondary">
            Kelola insiden yang tampil di halaman status publik <code>GET /v1/status</code>.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={() => void load()}>Muat ulang</Button>
          <Button onClick={openCreate}>Insiden baru</Button>
        </div>
      </div>

      <section className="flex flex-col gap-3">
        <h2 className="text-h3 font-semibold text-text-primary">Pratinjau publik</h2>
        <Card>
          <CardBody>
            {!publicStatus ? (
              <EmptyState title="Tidak dapat membaca status publik" />
            ) : (
              <div className="flex flex-col gap-3 text-body text-text-secondary">
                <p>
                  Status keseluruhan:{" "}
                  <Badge tone={publicStatus.status === "operational" ? "success" : publicStatus.status === "degraded" ? "warning" : "danger"}>
                    {publicStatus.status}
                  </Badge>{" "}
                  · release <code>{publicStatus.release}</code>
                </p>
                <div className="flex flex-wrap gap-2">
                  {publicStatus.components.map((c) => (
                    <Badge
                      key={c.name}
                      tone={c.status === "operational" ? "success" : c.status === "degraded" ? "warning" : "danger"}
                    >
                      {c.name}: {c.status}
                    </Badge>
                  ))}
                </div>
                {publicStatus.activeIncidents.length > 0 ? (
                  <div>
                    <p className="font-semibold text-text-primary">Insiden aktif:</p>
                    <ul className="list-disc pl-5">
                      {publicStatus.activeIncidents.map((i) => (
                        <li key={i.id}>
                          [{i.severity}] {i.title} — {i.status}
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : (
                  <p>Tidak ada insiden aktif.</p>
                )}
              </div>
            )}
          </CardBody>
        </Card>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-h3 font-semibold text-text-primary">Insiden</h2>
        <Card>
          <CardBody>
            {incidents.length === 0 ? (
              <EmptyState title="Belum ada insiden" description="Riwayat gangguan akan tercatat di sini." />
            ) : (
              <DataTable<IncidentRow>
                columns={[
                  { key: "title", header: "Judul" },
                  {
                    key: "severity", header: "Tingkat keparahan",
                    render: (r) => <Badge tone={severityTone(r.severity)}>{r.severity}</Badge>,
                  },
                  {
                    key: "status", header: "Status",
                    render: (r) => <Badge tone={statusTone(r.status)}>{r.status}</Badge>,
                  },
                  { key: "component", header: "Komponen" },
                  { key: "startedAt", header: "Mulai" },
                  {
                    key: "id", header: "Aksi",
                    render: (r) => (
                      <Button size="sm" variant="secondary" onClick={() => openEdit(r)}>Ubah</Button>
                    ),
                  },
                ]}
                rows={incidents as IncidentRow[]}
                rowKey={(r) => r.id}
              />
            )}
          </CardBody>
        </Card>
      </section>

      <Dialog open={dialogOpen} onClose={() => setDialogOpen(false)} title={editing ? "Ubah insiden" : "Insiden baru"}>
        <IncidentForm initial={editing} onClose={() => setDialogOpen(false)} onSaved={() => void load()} />
      </Dialog>
    </div>
  )
}

export default function StatusPage() {
  return (
    <RoleGate href="/status">
      <StatusInner />
    </RoleGate>
  )
}
