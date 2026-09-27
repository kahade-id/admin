/**
 * Kahade admin — manajemen klien API mitra (G451–G475).
 *
 * Endpoint: `/v1/admin/partner-clients/*`
 * (lihat `backend/src/modules/partner/admin-partner.controller.ts`).
 *
 * RBAC backend: SUPER_ADMIN saja untuk semua operasi admin.
 * Kebijakan keamanan: `backend/docs/partner-api-v1.md`,
 * `backend/docs/partner-security-contract.md`.
 *
 * ATURAN TAMPILAN KUNCI: plaintext API key hanya dikembalikan backend SATU
 * KALI saat penerbitan/rotasi. Tampilkan di dialog "sekali lihat" dengan
 * tombol salin, jangan pernah render ulang dari respons lain (backend tidak
 * menyimpannya).
 */
import { adminHttp } from "@/lib/api/admin-client"

export type PartnerClientStatus = "ACTIVE" | "SUSPENDED"

export type PartnerClient = {
  id: string
  name: string
  environment: "SANDBOX" | "PRODUCTION"
  status: PartnerClientStatus
  scopes: string[]
  dailyQuota?: number | null
  createdAt: string
  updatedAt: string
}

export type PartnerClientList = {
  items: PartnerClient[]
  total: number
  page: number
  limit: number
}

export type PartnerKeySummary = {
  id: string
  label: string | null
  keyPrefix: string
  scopes: string[]
  expiresAt: string | null
  revokedAt: string | null
  revokedReason: string | null
  createdAt: string
}

export type PartnerWebhookEndpoint = {
  id: string
  url: string
  events: string[]
  status: "ACTIVE" | "DISABLED" | "CHALLENGED"
  lastDeliveryAt: string | null
  lastDeliveryStatus: string | null
  createdAt: string
}

export type PartnerDelivery = {
  id: string
  eventType: string
  endpointId: string
  status: "PENDING" | "DELIVERED" | "FAILED" | "DEAD_LETTER"
  attempts: number
  nextRetryAt: string | null
  createdAt: string
}

export type PartnerAuditEntry = {
  id: string
  action: string
  adminId: string | null
  detail: string | null
  createdAt: string
}

export type PartnerClientDetail = {
  client: PartnerClient
  keys: PartnerKeySummary[]
  endpoints: PartnerWebhookEndpoint[]
  usage: {
    requestsToday: number
    quotaUsedPct: number | null
    errorRatePct: number | null
  }
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

export type CreatePartnerClientPayload = {
  name: string
  environment: "SANDBOX" | "PRODUCTION"
  scopes: string[]
  dailyQuota?: number
}

export async function createPartnerClient(payload: CreatePartnerClientPayload) {
  return adminHttp.post<PartnerClient>("/v1/admin/partner-clients", payload)
}

export async function updatePartnerClient(
  id: string,
  payload: Partial<CreatePartnerClientPayload> & { status?: PartnerClientStatus },
) {
  return adminHttp.patch<PartnerClient>(`/v1/admin/partner-clients/${id}`, payload)
}

export type IssuedPartnerKey = {
  id: string
  label: string | null
  keyPrefix: string
  /** Plaintext — hanya ada SEKALI dalam respons penerbitan/rotasi. */
  plaintext: string
  expiresAt: string | null
}

export async function issuePartnerKey(
  clientId: string,
  payload: { label?: string; scopes?: string[]; ttlDays?: number },
): Promise<IssuedPartnerKey> {
  return adminHttp.post<IssuedPartnerKey>(
    `/v1/admin/partner-clients/${clientId}/keys`,
    payload,
  )
}

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

export async function challengeWebhookEndpoint(
  clientId: string,
  endpointId: string,
): Promise<{ challenged: boolean }> {
  return adminHttp.post<{ challenged: boolean }>(
    `/v1/admin/partner-clients/${clientId}/endpoints/${endpointId}/challenge`,
  )
}

export async function sendTestWebhook(
  clientId: string,
  endpointId: string,
): Promise<{ enqueued: boolean }> {
  return adminHttp.post<{ enqueued: boolean }>(
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

export async function replayWebhookDelivery(
  clientId: string,
  deliveryId: string,
): Promise<{ enqueued: boolean }> {
  return adminHttp.post<{ enqueued: boolean }>(
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
