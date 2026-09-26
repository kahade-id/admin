/** Kahade admin — moderasi sengketa (dispute). */
import { adminHttp } from "@/lib/api/admin-client"
import type { Paginated } from "@/lib/api/admin/kyc"

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
}): Promise<Paginated<AdminDisputeItem>> {
  return adminHttp.get<Paginated<AdminDisputeItem>>("/v1/admin/disputes", { query: params })
}

export function getDisputeDetail(disputeId: string): Promise<AdminDisputeItem> {
  return adminHttp.get<AdminDisputeItem>(
    `/v1/admin/disputes/${encodeURIComponent(disputeId)}`,
  )
}

export function assignDispute(disputeId: string, adminId: string): Promise<unknown> {
  return adminHttp.post(`/v1/admin/disputes/${encodeURIComponent(disputeId)}/assign`, { adminId })
}

export function markDisputeUnderReview(disputeId: string): Promise<unknown> {
  return adminHttp.post(`/v1/admin/disputes/${encodeURIComponent(disputeId)}/under-review`, {})
}

export function getDisputeMessages(disputeId: string): Promise<DisputeMessage[]> {
  return adminHttp.get<DisputeMessage[]>(
    `/v1/admin/disputes/${encodeURIComponent(disputeId)}/messages`,
  )
}

export function sendDisputeMessage(disputeId: string, message: string): Promise<unknown> {
  return adminHttp.post(`/v1/admin/disputes/${encodeURIComponent(disputeId)}/messages`, {
    message,
  })
}

export function resolveDispute(
  disputeId: string,
  input: { resolution: string; notes?: string; winnerId?: string },
): Promise<unknown> {
  return adminHttp.post(`/v1/admin/disputes/${encodeURIComponent(disputeId)}/resolve`, input)
}
