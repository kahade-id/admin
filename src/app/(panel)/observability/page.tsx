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
import { EmptyState } from "@/components/ui/empty-state"
import { Spinner } from "@/components/ui/spinner"
import { RoleGate } from "@/components/admin/role-gate"
import { useToast } from "@/components/ui/toast"
import { userMessage } from "@/lib/api/response"
import {
  getLatency,
  getQueues,
  getDependencies,
  listAlerts,
  resolveAlert,
  runSyntheticAlertTest,
  getDelivery,
  getWebsocket,
  getSpans,
  type RouteLatency,
  type QueueDepth,
  type DependencyInfo,
  type AlertItem,
  type DeliveryStats,
  type WsSnapshot,
  type SpanItem,
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
  const [alerts, setAlerts] = useState<AlertItem[]>([])
  const [delivery, setDelivery] = useState<DeliveryStats[]>([])
  const [otpProvider, setOtpProvider] = useState<{ provider: string; tokenConfigured: boolean; production: boolean } | null>(null)
  const [ws, setWs] = useState<WsSnapshot | null>(null)
  const [spans, setSpans] = useState<SpanItem[]>([])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [lat, q, d, a, del, w, s] = await Promise.all([
        getLatency(),
        getQueues(),
        getDependencies(),
        listAlerts(),
        getDelivery(),
        getWebsocket(),
        getSpans(),
      ])
      setRelease(lat.release)
      setRoutes(lat.routes)
      setQueues(q.queues)
      setDeps(d.dependencies)
      setAlerts(a.alerts)
      setDelivery(del.stats)
      setOtpProvider(del.otpProvider)
      setWs(w)
      setSpans(s.spans)
    } catch (err) {
      toast.show({ title: "Gagal memuat observabilitas", description: userMessage(err), tone: "danger" })
    } finally {
      setLoading(false)
    }
  }, [toast])

  useEffect(() => {
    void load()
  }, [load])

  const onResolveAlert = useCallback(async (key: string) => {
    try {
      await resolveAlert(key)
      toast.show({ title: "Alert diselesaikan", tone: "success" })
      const a = await listAlerts()
      setAlerts(a.alerts)
    } catch (err) {
      toast.show({ title: "Gagal resolve alert", description: userMessage(err), tone: "danger" })
    }
  }, [toast])

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
                  { key: "lastSeenAt", header: "Terakhir terlihat" },
                  {
                    key: "id", header: "Aksi",
                    render: (r) => (
                      <Button size="sm" variant="secondary" onClick={() => void onResolveAlert(r.key)}>
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
                  { key: "lastAt", header: "Terakhir", render: (r: DeliveryStats & Record<string, unknown>) => r.lastAt ?? "-" },
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
