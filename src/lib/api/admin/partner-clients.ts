/**
 * Kahade admin — manajemen klien API mitra (G451–G475).
 *
 * Endpoint: `/v1/admin/partner-clients/*`
 * (lihat `backend/src/modules/partner/admin-partner.controller.ts`).
 *
 * RBAC backend: SUPER_ADMIN saja untuk semua operasi admin.
 * Kebijakan: `backend/docs/partner-api-v1.md`,
 * `backend/docs/partner-security-contract.md`.
 *
 * ATURAN TAMPILAN KUNCI: plaintext API key hanya dikembalikan backend SATU
 * KALI saat penerbitan/rotasi dalam respons `{ key, plaintext }`. Tampilkan
 * di dialog "sekali lihat" dengan tombol salin, jangan pernah render ulang
 * dari respons lain (backend tidak menyimpannya).
 *
 * Kontrak diselaraskan dengan DTO backend (`partner.dto.ts`) — ADM-305,
 * ADM-306, ADM-311, ADM-312, ADM-325, ADM-326.
 */
import { adminHttp } from "@/lib/api/admin-client"

export type PartnerClientStatus = "ACTIVE" | "SUSPENDED" | "REVOKED"

/** Model ApiClient backend (schema.prisma) — ADM-307. */
export type PartnerClient = {
  id: string
  orgName: string
  ownerUserId: string | null
  status: PartnerClientStatus
  isSandbox: boolean
  rateLimitPerMinute: number
  quotaPerDay: number
  createdAt: string
  updatedAt: string
}

/** Backend me-return { items, total } saja — tanpa page/limit (ADM-325). */
export type PartnerClientList = {
  items: PartnerClient[]
  total: number
}

/** Ringkasan kunci teredaksi (tanpa keyHash/plaintext) — ADM-304. */
export type PartnerKeySummary = {
  id: string
  name: string | null
  keyPrefix: string
  scopes: string[]
  expiresAt: string | null
  rotatedFromId: string | null
  validUntil: string | null
  revokedAt: string | null
  revokeReason: string | null
  lastUsedAt: string | null
  createdAt: string
}

export type PartnerWebhookEndpoint = {
  id: string
  url: string
  events: string[]
  status: "ACTIVE" | "DISABLED" | "CHALLENGED"
  isActive: boolean
  verifiedAt: string | null
  lastDeliveryAt: string | null
  lastDeliveryStatus: string | null
  createdAt: string
}

/**
 * Enum backend: PENDING | SENT | FAILED | DLQ (PartnerWebhookDeliveryStatus,
 * schema.prisma). Field percobaan = `attempt` (singular) — ADM-311.
 */
export type PartnerDeliveryStatus = "PENDING" | "SENT" | "FAILED" | "DLQ"

export type PartnerDelivery = {
  id: string
  endpointId: string
  eventId: string
  eventType: string
  attempt: number
  status: PartnerDeliveryStatus
  nextRetryAt: string | null
  lastError: string | null
  responseCode: number | null
  createdAt: string
  completedAt: string | null
}

/** Baris PartnerAuditLog: teks audit di `description`, bukan `detail` — ADM-312. */
export type PartnerAuditEntry = {
  id: string
  action: string
  adminId: string | null
  targetType: string | null
  targetId: string | null
  description: string | null
  ipAddress: string | null
  createdAt: string
}

export type PartnerUsageSummary = {
  clientId: string
  orgName: string
  quotaPerDay: number
  todayCalls: number
  quotaUsedPct: number
  /** Persen 1 desimal (backend, ADM-326); null bila tak dihitung. */
  errorRatePct: number | null
  totals: { calls: number; errors: number }
  byEndpoint: Array<Record<string, unknown>>
}

export type PartnerClientDetail = {
  client: PartnerClient
  keys: PartnerKeySummary[]
  endpoints: PartnerWebhookEndpoint[]
  usage: PartnerUsageSummary
}

export async function listPartnerClients(
  page = 1,
  limit = 20,
): Promise<PartnerClientList> {
  return adminHttp.get<PartnerClientList>("/v1/admin/partner-clients", {
    query: { page, limit },
  })
}

export async function getPartnerClient(id: string): Promise<PartnerClientDetail> {
  return adminHttp.get<PartnerClientDetail>(`/v1/admin/partner-clients/${id}`)
}

/** ADM-304: endpoint daftar kunci eksplisit (ringkasan teredaksi). */
export async function listPartnerKeys(clientId: string): Promise<PartnerKeySummary[]> {
  const res = await adminHttp.get<{ clientId: string; keys: PartnerKeySummary[] }>(
    `/v1/admin/partner-clients/${clientId}/keys`,
  )
  return res.keys ?? []
}

/** CreatePartnerClientDto backend — ADM-305. */
export type CreatePartnerClientPayload = {
  orgName: string
  ownerUserId?: string
  isSandbox?: boolean
  rateLimitPerMinute?: number
  quotaPerDay?: number
}

export async function createPartnerClient(payload: CreatePartnerClientPayload) {
  return adminHttp.post<PartnerClient>("/v1/admin/partner-clients", payload)
}

/** UpdatePartnerClientDto backend — ADM-313 (status/suspend + kuota/rate-limit + reason audit-only). */
export async function updatePartnerClient(
  id: string,
  payload: {
    orgName?: string
    status?: PartnerClientStatus
    rateLimitPerMinute?: number
    quotaPerDay?: number
    /** ADM-313: wajib (min. 10 char) bila status berubah; audit-only di backend. */
    reason?: string
  },
) {
  return adminHttp.patch<PartnerClient>(`/v1/admin/partner-clients/${id}`, payload)
}

/**
 * Respons penerbitan/rotasi: `{ key, plaintext }` — ADM-306.
 * `issued.key.id`, `issued.plaintext` (dialog sekali lihat).
 */
export type IssuedPartnerKey = {
  key: {
    id: string
    name: string | null
    keyPrefix: string
    scopes: string[]
    expiresAt: string | null
    createdAt: string
  }
  plaintext: string
}

/** IssuePartnerKeyDto backend — ADM-306 (name wajib, expiresAt ISO). */
export type IssuePartnerKeyPayload = {
  name: string
  scopes: string[]
  expiresAt?: string
}

export async function issuePartnerKey(
  clientId: string,
  payload: IssuePartnerKeyPayload,
): Promise<IssuedPartnerKey> {
  return adminHttp.post<IssuedPartnerKey>(
    `/v1/admin/partner-clients/${clientId}/keys`,
    payload,
  )
}

/**
 * Rotate tanpa body: backend mewarisi name/scopes/expiresAt dari kunci lama
 * (RotatePartnerKeyDto, semua field opsional) — ADM-306.
 */
export async function rotatePartnerKey(
  clientId: string,
  keyId: string,
): Promise<IssuedPartnerKey> {
  return adminHttp.post<IssuedPartnerKey>(
    `/v1/admin/partner-clients/${clientId}/keys/${keyId}/rotate`,
  )
}

export async function revokePartnerKey(
  clientId: string,
  keyId: string,
  reason: string,
): Promise<void> {
  await adminHttp.post(`/v1/admin/partner-clients/${clientId}/keys/${keyId}/revoke`, {
    reason,
  })
}

export async function registerWebhookEndpoint(
  clientId: string,
  payload: { url: string; events: string[] },
): Promise<PartnerWebhookEndpoint> {
  return adminHttp.post<PartnerWebhookEndpoint>(
    `/v1/admin/partner-clients/${clientId}/endpoints`,
    payload,
  )
}

/** ADM-322: edit endpoint webhook (URL/event/isActive; re-verifikasi otomatis backend). */
export async function updateWebhookEndpoint(
  clientId: string,
  endpointId: string,
  payload: { url?: string; events?: string[]; isActive?: boolean },
): Promise<PartnerWebhookEndpoint> {
  return adminHttp.patch<PartnerWebhookEndpoint>(
    `/v1/admin/partner-clients/${clientId}/endpoints/${endpointId}`,
    payload,
  )
}

/** ADM-322: hapus endpoint webhook (204, konfirmasi di UI). */
export async function deleteWebhookEndpoint(
  clientId: string,
  endpointId: string,
): Promise<void> {
  await adminHttp.delete(`/v1/admin/partner-clients/${clientId}/endpoints/${endpointId}`)
}

export async function challengeWebhookEndpoint(
  clientId: string,
  endpointId: string,
): Promise<unknown> {
  return adminHttp.post<unknown>(
    `/v1/admin/partner-clients/${clientId}/endpoints/${endpointId}/challenge`,
  )
}

export async function sendTestWebhook(
  clientId: string,
  endpointId: string,
): Promise<unknown> {
  return adminHttp.post<unknown>(
    `/v1/admin/partner-clients/${clientId}/endpoints/${endpointId}/test`,
  )
}

export async function listWebhookDeliveries(
  clientId: string,
  page = 1,
  limit = 20,
): Promise<{ items: PartnerDelivery[]; total: number }> {
  return adminHttp.get<{ items: PartnerDelivery[]; total: number }>(
    `/v1/admin/partner-clients/${clientId}/deliveries`,
    { query: { page, limit } },
  )
}

/** Replay manual — idempoten (eventId sama), me-return { eventId } (ADM-311). */
export async function replayWebhookDelivery(
  clientId: string,
  deliveryId: string,
): Promise<{ eventId: string }> {
  return adminHttp.post<{ eventId: string }>(
    `/v1/admin/partner-clients/${clientId}/deliveries/${deliveryId}/replay`,
  )
}

export async function getPartnerAuditLog(
  clientId: string,
  limit = 50,
): Promise<PartnerAuditEntry[]> {
  return adminHttp.get<PartnerAuditEntry[]>(
    `/v1/admin/partner-clients/${clientId}/audit-log`,
    { query: { limit } },
  )
}

/* ---------- ADM-311: helper tampilan status delivery backend ---------- */

export function deliveryStatusLabel(status: PartnerDeliveryStatus): string {
  switch (status) {
    case "PENDING":
      return "Menunggu"
    case "SENT":
      return "Terkirim"
    case "FAILED":
      return "Gagal"
    case "DLQ":
      return "Dead-letter"
    default:
      return status
  }
}

export function deliveryStatusTone(
  status: PartnerDeliveryStatus,
): "success" | "danger" | "warning" | "neutral" {
  switch (status) {
    case "SENT":
      return "success"
    case "DLQ":
      return "danger"
    case "FAILED":
      return "warning"
    case "PENDING":
    default:
      return "neutral"
  }
}

/** Tombol replay muncul untuk FAILED dan DLQ (kasus paling butuh replay) — ADM-311. */
export function deliveryCanReplay(status: PartnerDeliveryStatus): boolean {
  return status === "FAILED" || status === "DLQ"
}
