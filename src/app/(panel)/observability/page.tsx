/**
 * Admin — Observabilitas (G482/G483/G484/G488/G492/G493/G494, Grup F worker D).
 *
 * Halaman SUPER_ADMIN: tabel p95/p99 per route per deployment (dari ring
 * buffer MetricsService), backlog antrean Bull, status dependensi, metrik
 * delivery push/email/OTP, metrik WebSocket, alert aktif, dan buffer span
 * bisnis (gagal 100% + sampel sukses 1%).
 *
 * CATATAN NAV: route ini didaftarkan di MENU (src/lib/rbac.ts) pada
 * integrasi admin 2026-09-27 sebagai SUPER_ADMIN-only (halaman memakai
 * endpoint detail backend yang SUPER_ADMIN-only).
 * RoleGate tetap menolak non-SUPER_ADMIN (canAccess).
 */
"use client"

import { useCallback, useEffect, useState } from "react"

import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Card, CardBody, CardHeader } from "@/components/ui/card"
import { DataTable } from "@/components/ui/table"
import { Dialog } from "@/components/ui/dialog"
import { EmptyState } from "@/components/ui/empty-state"
import { Field, Input, TextArea } from "@/components/ui/input"
import { Spinner } from "@/components/ui/spinner"
import { RoleGate } from "@/components/admin/role-gate"
import { Select } from "@/components/admin/select"
// H16: status dependensi dengan checked-at + stale→unknown.
import { DependencyStatusCard } from "@/components/admin/batch139/dependency-status"
import { useToast } from "@/components/ui/toast"
import { userMessage } from "@/lib/api/response"
import { formatDateTimeWIB } from "@/lib/format"
import {
  getLatency,
  getQueues,
  getDependencies,
  listAlerts,
  resolveAlert,
  runSyntheticAlertTest,
  runSyntheticCheck,
  getDelivery,
  getWebsocket,
  getSpans,
  listIncidents,
  createIncident,
  updateIncident,
  getPublicStatus,
  getStorageSummary,
  type RouteLatency,
  type QueueDepth,
  type DependencyInfo,
  type AlertItem,
  type DeliveryStats,
  type WsSnapshot,
  type SpanItem,
  type IncidentItem,
  type PublicStatus,
  type StorageAlert,
} from "@/lib/api/admin/observability"

type LatencyRow = RouteLatency & Record<string, unknown>
type AlertRow = AlertItem & Record<string, unknown>

function ms(v: number): string {
  return `${v} ms`
}

function Section({ title, description, action, children }: {
  title: string
  description?: string
  action?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-h3 font-semibold text-text-primary">{title}</h2>
          {description ? <p className="mt-1 text-body text-text-secondary">{description}</p> : null}
        </div>
        {action}
      </div>
      {children}
    </section>
  )
}

function ObservabilityInner() {
  const toast = useToast()
  const [loading, setLoading] = useState(true)
  const [release, setRelease] = useState("unknown")
  const [routes, setRoutes] = useState<RouteLatency[]>([])
  const [queues, setQueues] = useState<QueueDepth[]>([])
  const [deps, setDeps] = useState<DependencyInfo[]>([])
  // H16: kapan dependensi terakhir berhasil diperiksa (untuk umur data/stale).
  const [depsCheckedAt, setDepsCheckedAt] = useState<string | null>(null)
  const [alerts, setAlerts] = useState<AlertItem[]>([])
  const [delivery, setDelivery] = useState<DeliveryStats[]>([])
  const [otpProvider, setOtpProvider] = useState<{ provider: string; tokenConfigured: boolean; production: boolean } | null>(null)
  const [ws, setWs] = useState<WsSnapshot | null>(null)
  const [spans, setSpans] = useState<SpanItem[]>([])
  // ADM-303: insiden + pratinjau status publik.
  const [incidents, setIncidents] = useState<IncidentItem[]>([])
  const [publicStatus, setPublicStatus] = useState<PublicStatus | null>(null)
  const [showIncidentDialog, setShowIncidentDialog] = useState(false)
  const [incidentForm, setIncidentForm] = useState({ title: "", description: "", severity: "SEV2", component: "api" })
  const [savingIncident, setSavingIncident] = useState(false)
  const [updatingIncidentId, setUpdatingIncidentId] = useState<string | null>(null)
  const [updatingIncidentStatus, setUpdatingIncidentStatus] = useState("")
  // ADM-315: kapasitas storage + synthetic check manual.
  const [storageAlerts, setStorageAlerts] = useState<StorageAlert[]>([])
  const [storageNote, setStorageNote] = useState("")
  const [syntheticResult, setSyntheticResult] = useState<Record<string, unknown> | null>(null)
  const [runningSynthetic, setRunningSynthetic] = useState(false)
  // ADM-316: konfirmasi resolve alert.
  const [resolvingAlertKey, setResolvingAlertKey] = useState<string | null>(null)
  const [resolving, setResolving] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [lat, q, d, a, del, w, s, inc, ps, st] = await Promise.all([
        getLatency(),
        getQueues(),
        getDependencies(),
        listAlerts(),
        getDelivery(),
        getWebsocket(),
        getSpans(),
        listIncidents(),
        getPublicStatus(),
        getStorageSummary(),
      ])
      setRelease(lat.release)
      setRoutes(lat.routes)
      setQueues(q.queues)
      setDeps(d.dependencies)
      // H16: timestamp pemeriksaan dependensi — untuk label umur & stale.
      setDepsCheckedAt(new Date().toISOString())
      setAlerts(a.alerts)
      setDelivery(del.stats)
      setOtpProvider(del.otpProvider)
      setWs(w)
      setSpans(s.spans)
      setIncidents(inc.incidents)
      setPublicStatus(ps)
      setStorageAlerts(st.alerts)
      setStorageNote(st.note)
    } catch (err) {
      toast.show({ title: "Gagal memuat observabilitas", description: userMessage(err), tone: "danger" })
    } finally {
      setLoading(false)
    }
  }, [toast])

  useEffect(() => {
    void load()
  }, [load])

  const onResolveAlert = useCallback(async () => {
    if (!resolvingAlertKey) return
    setResolving(true)
    try {
      await resolveAlert(resolvingAlertKey)
      toast.show({ title: "Alert diselesaikan", tone: "success" })
      setResolvingAlertKey(null)
      const a = await listAlerts()
      setAlerts(a.alerts)
    } catch (err) {
      toast.show({ title: "Gagal resolve alert", description: userMessage(err), tone: "danger" })
    } finally {
      setResolving(false)
    }
  }, [resolvingAlertKey, toast])

  const onSyntheticTest = useCallback(async () => {
    try {
      const r = await runSyntheticAlertTest()
      toast.show({
        title: r.raised && r.resolved ? "Uji pipeline alert OK" : "Uji pipeline alert bermasalah",
        description: `raised=${r.raised} resolved=${r.resolved} key=${r.key}`,
        tone: r.raised && r.resolved ? "success" : "danger",
      })
      const a = await listAlerts()
      setAlerts(a.alerts)
    } catch (err) {
      toast.show({ title: "Uji sintetis gagal", description: userMessage(err), tone: "danger" })
    }
  }, [toast])

  // ADM-303: buat insiden.
  const onCreateIncident = useCallback(async () => {
    const title = incidentForm.title.trim()
    const description = incidentForm.description.trim()
    if (!title || !description) {
      toast.show({ title: "Judul & deskripsi wajib", tone: "danger" })
      return
    }
    setSavingIncident(true)
    try {
      await createIncident({
        title,
        description,
        severity: incidentForm.severity as IncidentItem["severity"],
        component: incidentForm.component.trim() || "api",
      })
      toast.show({ title: "Insiden dibuat", tone: "success" })
      setShowIncidentDialog(false)
      setIncidentForm({ title: "", description: "", severity: "SEV2", component: "api" })
      const [inc, ps] = await Promise.all([listIncidents(), getPublicStatus()])
      setIncidents(inc.incidents)
      setPublicStatus(ps)
    } catch (err) {
      toast.show({ title: "Gagal membuat insiden", description: userMessage(err), tone: "danger" })
    } finally {
      setSavingIncident(false)
    }
  }, [incidentForm, toast])

  // ADM-303: ubah status insiden.
  const onUpdateIncidentStatus = useCallback(async () => {
    if (!updatingIncidentId || !updatingIncidentStatus) return
    setSavingIncident(true)
    try {
      await updateIncident(updatingIncidentId, {
        status: updatingIncidentStatus as IncidentItem["status"],
      })
      toast.show({ title: "Status insiden diperbarui", tone: "success" })
      setUpdatingIncidentId(null)
      setUpdatingIncidentStatus("")
      const [inc, ps] = await Promise.all([listIncidents(), getPublicStatus()])
      setIncidents(inc.incidents)
      setPublicStatus(ps)
    } catch (err) {
      toast.show({ title: "Gagal memperbarui insiden", description: userMessage(err), tone: "danger" })
    } finally {
      setSavingIncident(false)
    }
  }, [updatingIncidentId, updatingIncidentStatus, toast])

  // ADM-315: jalankan synthetic check manual.
  const onRunSynthetic = useCallback(async () => {
    setRunningSynthetic(true)
    try {
      const r = await runSyntheticCheck()
      setSyntheticResult(r)
      toast.show({ title: "Synthetic check selesai", tone: "success" })
    } catch (err) {
      toast.show({ title: "Synthetic check gagal", description: userMessage(err), tone: "danger" })
    } finally {
      setRunningSynthetic(false)
    }
  }, [toast])

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
          <h1 className="text-h2 font-semibold text-text-primary">Observabilitas</h1>
          <p className="mt-1 text-body text-text-secondary">
            Latency, antrean, dependensi, dan alert operasional. Release: <code>{release}</code>
          </p>
        </div>
        <Button onClick={() => void load()}>Muat ulang</Button>
      </div>

      <Section title="Alert aktif" description="Threshold + cooldown anti-storm (G485/G486/G492)." action={
        <Button variant="secondary" onClick={() => void onSyntheticTest()}>Uji pipeline alert</Button>
      }>
        <Card>
          <CardBody>
            {alerts.length === 0 ? (
              <EmptyState title="Tidak ada alert aktif" description="Semua aturan dalam batas normal." />
            ) : (
              <DataTable<AlertRow>
                columns={[
                  { key: "key", header: "Kunci" },
                  {
                    key: "severity", header: "Severity",
                    render: (r) => (
                      <Badge tone={r.severity === "critical" ? "danger" : "warning"}>{r.severity}</Badge>
                    ),
                  },
                  { key: "message", header: "Pesan" },
                  { key: "lastSeenAt", header: "Terakhir terlihat", render: (r: AlertRow) => formatDateTimeWIB(r.lastSeenAt) },
                  {
                    key: "id", header: "Aksi",
                    render: (r) => (
                      <Button size="sm" variant="secondary" onClick={() => setResolvingAlertKey(r.key)}>
                        Resolve
                      </Button>
                    ),
                  },
                ]}
                rows={alerts as AlertRow[]}
                rowKey={(r) => r.id}
              />
            )}
          </CardBody>
        </Card>
      </Section>

      {/* ADM-303 — Manajemen insiden: daftar + buat + ubah status + pratinjau status publik. */}
      <Section
        title="Insiden"
        description="Deklarasikan insiden saat outage; status publik (/v1/status) ter-update otomatis."
        action={
          <Button variant="secondary" size="sm" onClick={() => setShowIncidentDialog(true)}>
            Buat insiden
          </Button>
        }
      >
        <Card>
          <CardBody>
            {publicStatus ? (
              <div className="mb-3 flex flex-wrap items-center gap-2 text-body text-text-secondary">
                <span>Pratinjau status publik:</span>
                <Badge
                  tone={
                    publicStatus.status === "operational"
                      ? "success"
                      : publicStatus.status === "degraded"
                        ? "warning"
                        : "danger"
                  }
                >
                  {publicStatus.status}
                </Badge>
                <span className="text-caption">
                  {publicStatus.activeIncidents.length} insiden aktif
                </span>
              </div>
            ) : null}
            {incidents.length === 0 ? (
              <EmptyState title="Tidak ada insiden" description="Semua operasional normal." />
            ) : (
              <DataTable
                columns={[
                  { key: "title", header: "Judul" },
                  {
                    key: "severity", header: "Severity",
                    render: (r: IncidentItem & Record<string, unknown>) => (
                      <Badge tone={r.severity === "SEV1" ? "danger" : r.severity === "SEV2" ? "warning" : "neutral"}>
                        {r.severity}
                      </Badge>
                    ),
                  },
                  {
                    key: "status", header: "Status",
                    render: (r: IncidentItem & Record<string, unknown>) => (
                      <Badge tone={r.status === "RESOLVED" ? "success" : "info"}>{r.status}</Badge>
                    ),
                  },
                  { key: "component", header: "Komponen" },
                  { key: "startedAt", header: "Mulai", render: (r: IncidentItem & Record<string, unknown>) => formatDateTimeWIB(r.startedAt) },
                  {
                    key: "id", header: "Aksi",
                    render: (r: IncidentItem & Record<string, unknown>) =>
                      r.status === "RESOLVED" ? (
                        <span className="text-caption text-text-secondary">Selesai</span>
                      ) : (
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => {
                            setUpdatingIncidentId(r.id)
                            setUpdatingIncidentStatus(r.status)
                          }}
                        >
                          Ubah status
                        </Button>
                      ),
                  },
                ]}
                rows={incidents.map((i) => ({ ...i }) as IncidentItem & Record<string, unknown>)}
                rowKey={(r) => r.id}
              />
            )}
          </CardBody>
        </Card>
      </Section>

      {/* ADM-315 — Kapasitas storage & synthetic check manual. */}
      <Section
        title="Kapasitas & synthetic check"
        description="Kesehatan disk/pertumbuhan tabel (evaluasi on-demand) + cek sintetis manual."
        action={
          <Button variant="secondary" size="sm" loading={runningSynthetic} onClick={() => void onRunSynthetic()}>
            Jalankan synthetic check
          </Button>
        }
      >
        <Card>
          <CardBody>
            {storageNote ? <p className="mb-2 text-caption text-text-secondary">{storageNote}</p> : null}
            {storageAlerts.length === 0 ? (
              <EmptyState title="Kapasitas normal" description="Tidak ada alert disk_usage/table_growth." />
            ) : (
              <DataTable
                columns={[
                  { key: "key", header: "Kunci" },
                  {
                    key: "severity", header: "Severity",
                    render: (r: StorageAlert & Record<string, unknown>) => (
                      <Badge tone={r.severity === "critical" ? "danger" : "warning"}>{r.severity}</Badge>
                    ),
                  },
                  { key: "message", header: "Pesan" },
                  { key: "lastSeenAt", header: "Terakhir terlihat", render: (r: StorageAlert & Record<string, unknown>) => formatDateTimeWIB(r.lastSeenAt) },
                ]}
                rows={storageAlerts.map((a) => ({ ...a }) as StorageAlert & Record<string, unknown>)}
                rowKey={(r) => r.key}
              />
            )}
            {syntheticResult ? (
              <div className="mt-3 rounded-sm border border-border bg-surface-elevated p-3">
                <p className="mb-1 text-caption text-text-secondary">Hasil synthetic check:</p>
                <pre className="overflow-x-auto text-caption text-text-primary">
                  {JSON.stringify(syntheticResult, null, 2)}
                </pre>
              </div>
            ) : null}
          </CardBody>
        </Card>
      </Section>

      <Section title="Latency per route" description="p95/p99 per route per deployment — ring buffer 1000 sampel/route (G482/G483).">
        <Card>
          <CardBody>
            {routes.length === 0 ? (
              <EmptyState title="Belum ada sampel" description="Buffer terisi setelah ada request ke route kunci." />
            ) : (
              <DataTable<LatencyRow>
                columns={[
                  { key: "route", header: "Route" },
                  { key: "count", header: "Req" },
                  { key: "p50", header: "p50", render: (r) => ms(r.p50) },
                  { key: "p95", header: "p95", render: (r) => ms(r.p95) },
                  { key: "p99", header: "p99", render: (r) => ms(r.p99) },
                  { key: "max", header: "max", render: (r) => ms(r.max) },
                  {
                    key: "errorRate", header: "Error",
                    render: (r) => `${r.errors} (${(r.errorRate * 100).toFixed(1)}%)`,
                  },
                  { key: "release", header: "Release", render: (r) => r.release ?? "-" },
                ]}
                rows={routes as LatencyRow[]}
                rowKey={(r) => r.route}
              />
            )}
          </CardBody>
        </Card>
      </Section>

      <Section title="Antrean Bull" description="Backlog email, notifikasi, audit-log, dead-letter (G484).">
        <Card>
          <CardBody>
            <DataTable
              columns={[
                { key: "name", header: "Queue" },
                { key: "waiting", header: "Waiting" },
                { key: "active", header: "Active" },
                { key: "delayed", header: "Delayed" },
                { key: "failed", header: "Failed" },
                { key: "backlog", header: "Backlog" },
                {
                  key: "available", header: "Status",
                  render: (r: QueueDepth & Record<string, unknown>) => (
                    <Badge tone={r.available ? "success" : "danger"}>{r.available ? "OK" : "N/A"}</Badge>
                  ),
                },
              ]}
              rows={queues.map((q) => ({ ...q }) as QueueDepth & Record<string, unknown>)}
              rowKey={(r) => r.name}
            />
          </CardBody>
        </Card>
      </Section>

      <Section title="Dependensi" description="ok / degraded / down + latency — tanpa kredensial (G488).">
        {/* H16: kartu per dependensi dengan checked-at + umur data; data lama
            > 5 menit otomatis dianggap unknown (stale). */}
        {deps.length > 0 ? (
          <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {deps.map((d) => (
              <DependencyStatusCard
                key={d.name}
                name={d.name}
                status={d.status}
                latencyMs={d.latencyMs}
                checkedAt={depsCheckedAt}
                detail={d.detail}
              />
            ))}
          </div>
        ) : null}
        <Card>
          <CardBody>
            <DataTable
              columns={[
                { key: "name", header: "Dependensi" },
                {
                  key: "status", header: "Status",
                  render: (r: DependencyInfo & Record<string, unknown>) => (
                    <Badge tone={r.status === "ok" ? "success" : r.status === "degraded" ? "warning" : "danger"}>
                      {r.status}
                    </Badge>
                  ),
                },
                { key: "latencyMs", header: "Latency", render: (r: DependencyInfo & Record<string, unknown>) => r.latencyMs === null ? "-" : ms(r.latencyMs) },
                { key: "detail", header: "Detail", render: (r: DependencyInfo & Record<string, unknown>) => JSON.stringify(r.detail) },
              ]}
              rows={deps.map((d) => ({ ...d }) as DependencyInfo & Record<string, unknown>)}
              rowKey={(r) => r.name}
            />
          </CardBody>
        </Card>
      </Section>

      <Section title="Delivery push / email / OTP" description="Counter agregat + status konfigurasi provider OTP tanpa kredensial (G494).">
        <Card>
          <CardHeader>
            {otpProvider ? (
              <p className="text-body text-text-secondary">
                Provider OTP: <strong>{otpProvider.provider}</strong> · token terkonfigurasi:{" "}
                <strong>{otpProvider.tokenConfigured ? "ya" : "tidak"}</strong> · production:{" "}
                <strong>{otpProvider.production ? "ya" : "tidak"}</strong>
              </p>
            ) : null}
          </CardHeader>
          <CardBody>
            {delivery.length === 0 ? (
              <EmptyState title="Belum ada event delivery" description="Counter terisi setelah ada pengiriman." />
            ) : (
              <DataTable
                columns={[
                  { key: "channel", header: "Kanal" },
                  { key: "provider", header: "Provider" },
                  { key: "sent", header: "Terkirim" },
                  { key: "failed", header: "Gagal" },
                  { key: "skipped", header: "Dilewati" },
                  { key: "lastAt", header: "Terakhir", render: (r: DeliveryStats & Record<string, unknown>) => r.lastAt ? formatDateTimeWIB(r.lastAt) : "-" },
                ]}
                rows={delivery.map((d) => ({ ...d }) as DeliveryStats & Record<string, unknown>)}
                rowKey={(r) => `${r.channel}:${r.provider}`}
              />
            )}
          </CardBody>
        </Card>
      </Section>

      <Section title="WebSocket" description="Koneksi aktif + reconnect per versi aplikasi, per worker (G493).">
        <Card>
          <CardBody>
            {!ws ? (
              <EmptyState title="Tidak ada data" description="Gateway realtime belum mencatat koneksi." />
            ) : (
              <div className="flex flex-col gap-2 text-body text-text-secondary">
                <p>Worker <code>{ws.worker}</code> · koneksi aktif: <strong>{ws.activeConnections}</strong> · total connect: <strong>{ws.totalConnects}</strong> · total disconnect: <strong>{ws.totalDisconnects}</strong></p>
                <p>Connect per versi app: <code>{JSON.stringify(ws.connectsByAppVersion)}</code></p>
                <p>Reconnect per versi app: <code>{JSON.stringify(ws.reconnectsByAppVersion)}</code></p>
              </div>
            )}
          </CardBody>
        </Card>
      </Section>

      <Section title="Span bisnis" description="100 span terakhir — gagal 100%, sukses sampling 1% (G479/G491).">
        <Card>
          <CardBody>
            {spans.length === 0 ? (
              <EmptyState title="Buffer span kosong" description="Span tercatat saat ada order/payment/upload." />
            ) : (
              <DataTable
                columns={[
                  { key: "name", header: "Span" },
                  {
                    key: "status", header: "Status",
                    render: (r: SpanItem & Record<string, unknown>) => (
                      <Badge tone={r.status === "ok" ? "success" : "danger"}>{r.status}</Badge>
                    ),
                  },
                  { key: "durationMs", header: "Durasi", render: (r: SpanItem & Record<string, unknown>) => ms(r.durationMs) },
                  { key: "requestId", header: "Request ID", render: (r: SpanItem & Record<string, unknown>) => r.requestId ?? "-" },
                  { key: "attributes", header: "Atribut", render: (r: SpanItem & Record<string, unknown>) => JSON.stringify(r.attributes) },
                ]}
                rows={spans.map((s) => ({ ...s }) as SpanItem & Record<string, unknown>)}
                rowKey={(r) => r.spanId}
              />
            )}
          </CardBody>
        </Card>
      </Section>

      {/* ADM-316: dialog konfirmasi resolve alert (satu klik bisa menghilangkan sinyal). */}
      <Dialog
        open={resolvingAlertKey !== null}
        onClose={() => {
          if (!resolving) setResolvingAlertKey(null)
        }}
        title="Resolve alert"
        description={resolvingAlertKey ? `Tandai alert "${resolvingAlertKey}" sebagai selesai?` : ""}
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="ghost" disabled={resolving} onClick={() => setResolvingAlertKey(null)}>
              Batal
            </Button>
            <Button variant="primary" loading={resolving} onClick={() => void onResolveAlert()}>
              Resolve
            </Button>
          </div>
        }
      />

      {/* ADM-303: dialog buat insiden. */}
      <Dialog
        open={showIncidentDialog}
        onClose={() => {
          if (!savingIncident) setShowIncidentDialog(false)
        }}
        title="Buat insiden"
        description="Insiden aktif tampil di status publik. Jangan tulis data pribadi."
        footer={
          <div className="flex flex-col gap-3">
            <Field label="Judul (wajib)">
              <Input
                value={incidentForm.title}
                onChange={(e) => setIncidentForm((f) => ({ ...f, title: e.target.value }))}
                placeholder="mis. Latency checkout meningkat"
              />
            </Field>
            <Field label="Deskripsi (wajib)">
              <TextArea
                value={incidentForm.description}
                onChange={(e) => setIncidentForm((f) => ({ ...f, description: e.target.value }))}
                rows={3}
                placeholder="Dampak, komponen terdampak, langkah mitigasi…"
              />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Severity">
                <Select
                  value={incidentForm.severity}
                  onChange={(e) => setIncidentForm((f) => ({ ...f, severity: e.target.value }))}
                  options={[
                    { value: "SEV1", label: "SEV1" },
                    { value: "SEV2", label: "SEV2" },
                    { value: "SEV3", label: "SEV3" },
                    { value: "SEV4", label: "SEV4" },
                  ]}
                />
              </Field>
              <Field label="Komponen">
                <Input
                  value={incidentForm.component}
                  onChange={(e) => setIncidentForm((f) => ({ ...f, component: e.target.value }))}
                  placeholder="api"
                />
              </Field>
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" disabled={savingIncident} onClick={() => setShowIncidentDialog(false)}>
                Batal
              </Button>
              <Button variant="primary" loading={savingIncident} onClick={() => void onCreateIncident()}>
                Buat
              </Button>
            </div>
          </div>
        }
      />

      {/* ADM-303: dialog ubah status insiden. */}
      <Dialog
        open={updatingIncidentId !== null}
        onClose={() => {
          if (!savingIncident) {
            setUpdatingIncidentId(null)
            setUpdatingIncidentStatus("")
          }
        }}
        title="Ubah status insiden"
        footer={
          <div className="flex flex-col gap-3">
            <Field label="Status">
              <Select
                value={updatingIncidentStatus}
                onChange={(e) => setUpdatingIncidentStatus(e.target.value)}
                options={[
                  { value: "INVESTIGATING", label: "INVESTIGATING" },
                  { value: "IDENTIFIED", label: "IDENTIFIED" },
                  { value: "MONITORING", label: "MONITORING" },
                  { value: "RESOLVED", label: "RESOLVED" },
                ]}
              />
            </Field>
            <div className="flex justify-end gap-2">
              <Button
                variant="ghost"
                disabled={savingIncident}
                onClick={() => {
                  setUpdatingIncidentId(null)
                  setUpdatingIncidentStatus("")
                }}
              >
                Batal
              </Button>
              <Button variant="primary" loading={savingIncident} onClick={() => void onUpdateIncidentStatus()}>
                Simpan
              </Button>
            </div>
          </div>
        }
      />
    </div>
  )
}

export default function ObservabilityPage() {
  return (
    <RoleGate href="/observability">
      <ObservabilityInner />
    </RoleGate>
  )
}
