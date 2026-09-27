/** Kahade admin — observability: latency, queue, dependensi, alert, delivery, websocket, insiden, status publik. */
import { adminHttp } from "@/lib/api/admin-client"

export interface RouteLatency {
  route: string
  count: number
  p50: number
  p95: number
  p99: number
  avg: number
  max: number
  errors: number
  errorRate: number
  lastSeenAt: string | null
  release: string | null
}

export interface LatencySummary {
  release: string
  totalRequests: number
  totalErrors: number
  errorRate: number
  slowestRoutes: Array<{ route: string; p95: number; p99: number; count: number }>
}

export interface QueueDepth {
  name: string
  waiting: number
  active: number
  delayed: number
  failed: number
  backlog: number
  available: boolean
}

export interface DependencyInfo {
  name: string
  status: "ok" | "degraded" | "down"
  latencyMs: number | null
  detail: Record<string, string | number | boolean>
}

export interface AlertItem {
  id: string
  key: string
  severity: string
  message: string
  context: Record<string, unknown> | null
  status: string
  raisedAt: string
  lastSeenAt: string
}

export interface DeliveryStats {
  channel: string
  provider: string
  sent: number
  failed: number
  skipped: number
  lastAt: string | null
}

export interface WsSnapshot {
  worker: string
  activeConnections: number
  totalConnects: number
  totalDisconnects: number
  reconnectsByAppVersion: Record<string, number>
  connectsByAppVersion: Record<string, number>
  at: string
}

export interface SpanItem {
  traceId: string
  spanId: string
  name: string
  requestId: string | null
  durationMs: number
  status: "ok" | "error"
  errorName?: string
  attributes: Record<string, string | number | boolean>
}

export interface IncidentItem {
  id: string
  title: string
  description: string
  severity: "SEV1" | "SEV2" | "SEV3" | "SEV4"
  status: "INVESTIGATING" | "IDENTIFIED" | "MONITORING" | "RESOLVED"
  component: string
  startedAt: string
  resolvedAt: string | null
  updatedAt: string
}

export interface PublicStatus {
  status: "operational" | "degraded" | "outage"
  release: string
  at: string
  components: Array<{ name: string; status: "operational" | "degraded" | "outage" }>
  activeIncidents: IncidentItem[]
  history: IncidentItem[]
}

export async function getLatency(route?: string): Promise<{ release: string; routes: RouteLatency[] }> {
  return adminHttp.get("/v1/admin/observability/latency", { query: route ? { route } : undefined })
}

export async function getLatencySummary(): Promise<LatencySummary> {
  return adminHttp.get("/v1/admin/observability/latency/summary")
}

export async function getSpans(): Promise<{ sampling: Record<string, unknown>; spans: SpanItem[] }> {
  return adminHttp.get("/v1/admin/observability/spans")
}

export async function getQueues(): Promise<{ queues: QueueDepth[] }> {
  return adminHttp.get("/v1/admin/observability/queues")
}

export async function getDependencies(): Promise<{ dependencies: DependencyInfo[] }> {
  return adminHttp.get("/v1/admin/observability/dependencies")
}

export async function listAlerts(): Promise<{ alerts: AlertItem[] }> {
  return adminHttp.get("/v1/admin/observability/alerts")
}

export async function resolveAlert(key: string): Promise<{ resolved: boolean }> {
  return adminHttp.post(`/v1/admin/observability/alerts/${encodeURIComponent(key)}/resolve`)
}

export async function runSyntheticAlertTest(): Promise<{ raised: boolean; resolved: boolean; key: string }> {
  return adminHttp.post("/v1/admin/observability/alerts/synthetic-test")
}

export async function getDelivery(): Promise<{
  stats: DeliveryStats[]
  otpProvider: { provider: string; tokenConfigured: boolean; production: boolean }
}> {
  return adminHttp.get("/v1/admin/observability/delivery")
}

export async function getWebsocket(): Promise<WsSnapshot> {
  return adminHttp.get("/v1/admin/observability/websocket")
}

export async function listIncidents(status?: string): Promise<{ incidents: IncidentItem[] }> {
  return adminHttp.get("/v1/admin/observability/incidents", { query: status ? { status } : undefined })
}

export async function createIncident(input: {
  title: string
  description: string
  severity: IncidentItem["severity"]
  component: string
}): Promise<IncidentItem> {
  // ADM-303: adminPost(path, body) — body sebagai argumen ke-2, BUKAN { body: input }.
  return adminHttp.post("/v1/admin/observability/incidents", input)
}

export async function updateIncident(
  id: string,
  input: Partial<Pick<IncidentItem, "title" | "description" | "severity" | "status" | "component">>,
): Promise<IncidentItem> {
  // ADM-303: sama — body sebagai argumen ke-2.
  return adminHttp.patch(`/v1/admin/observability/incidents/${encodeURIComponent(id)}`, input)
}

/** Status publik — endpoint tanpa auth (untuk pratinjau di halaman kelola). */
export async function getPublicStatus(): Promise<PublicStatus> {
  return adminHttp.get("/v1/status")
}

/* ---------- ADM-315: kapasitas storage & synthetic check manual ---------- */

/** GET /v1/admin/observability/storage — ringkasan alert disk_usage/table_growth (on-demand). */
export interface StorageAlert {
  key: string
  severity: string
  message: string
  context: Record<string, unknown> | null
  status: string
  raisedAt: string
  lastSeenAt: string
}

export async function getStorageSummary(): Promise<{
  alerts: StorageAlert[]
  note: string
}> {
  return adminHttp.get("/v1/admin/observability/storage")
}

/** POST /v1/admin/observability/synthetic/run — cek sintetis manual. */
export async function runSyntheticCheck(): Promise<Record<string, unknown>> {
  return adminHttp.post("/v1/admin/observability/synthetic/run")
}
