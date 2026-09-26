/** Kahade admin — moderasi sengketa (dispute). */
import { adminHttp } from "@/lib/api/admin-client"
import type { Paginated } from "@/lib/api/admin/kyc"

/**
 * UUID v4 untuk `Idempotency-Key`. Backend mewajibkan header ini pada
 * endpoint mutasi sengketa (`@Idempotency()`): assign, under-review,
 * resolve — tanpa header, backend menolak dengan 400 IDEMPOTENCY_KEY_REQUIRED.
 * Pola sama seperti `src/lib/api/admin/finance.ts`.
 */
function newIdempotencyKey(): string {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = Math.floor(Math.random() * 16)
    const v = c === "x" ? r : (r & 0x3) | 0x8
    return v.toString(16)
  })
}

const idempotencyHeaders = (): Record<string, string> => ({
  "Idempotency-Key": newIdempotencyKey(),
})

export type DisputeStatus = string

export type AdminDisputeItem = {
  id: string
  orderId: string
  status: DisputeStatus
  reason?: string
  assignedAdminId?: string | null
  createdAt: string
  updatedAt?: string
  [key: string]: unknown
}

export type DisputeMessage = {
  id: string
  senderId: string
  message: string
  createdAt: string
  [key: string]: unknown
}

export function listDisputes(params?: {
  page?: number
  limit?: number
  status?: string
  /** Cari berdasarkan ID sengketa atau ID order (didukung backend). */
  search?: string
}): Promise<Paginated<AdminDisputeItem>> {
  return adminHttp.get<Paginated<AdminDisputeItem>>("/v1/admin/disputes", { query: params })
}

export function getDisputeDetail(disputeId: string): Promise<AdminDisputeItem> {
  return adminHttp.get<AdminDisputeItem>(
    `/v1/admin/disputes/${encodeURIComponent(disputeId)}`,
  )
}

export function assignDispute(disputeId: string, adminId: string): Promise<unknown> {
  return adminHttp.post(
    `/v1/admin/disputes/${encodeURIComponent(disputeId)}/assign`,
    { adminId },
    { headers: idempotencyHeaders() },
  )
}

export function markDisputeUnderReview(disputeId: string): Promise<unknown> {
  return adminHttp.post(
    `/v1/admin/disputes/${encodeURIComponent(disputeId)}/under-review`,
    {},
    { headers: idempotencyHeaders() },
  )
}

export function getDisputeMessages(disputeId: string): Promise<DisputeMessage[]> {
  return adminHttp.get<DisputeMessage[]>(
    `/v1/admin/disputes/${encodeURIComponent(disputeId)}/messages`,
  )
}

export function sendDisputeMessage(disputeId: string, message: string): Promise<unknown> {
  return adminHttp.post(
    `/v1/admin/disputes/${encodeURIComponent(disputeId)}/messages`,
    { message },
    { headers: idempotencyHeaders() },
  )
}

export function resolveDispute(
  disputeId: string,
  input: { resolution: string; notes?: string; winnerId?: string },
): Promise<unknown> {
  return adminHttp.post(
    `/v1/admin/disputes/${encodeURIComponent(disputeId)}/resolve`,
    input,
    { headers: idempotencyHeaders() },
  )
}
