/**
 * Kahade admin — antrean retur (GAP-D G214–G217, G224).
 * Backend: /v1/admin/returns. Mutasi aksi memakai Idempotency-Key
 * (@Idempotency() pada controller) agar retry aman.
 */
import { adminHttp } from "@/lib/api/admin-client"
import type { Paginated } from "@/lib/api/admin/kyc"

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

export type AdminReturnStatus =
  | "REQUESTED"
  | "SELLER_REVIEW"
  | "CLARIFICATION_NEEDED"
  | "APPROVED"
  | "REJECTED"
  | "RETURN_SHIPPING"
  | "RECEIVED"
  | "RESOLVED_REFUND"
  | "RESOLVED_EXCHANGE"
  | "RESOLVED_REPAIR"
  | "ESCALATED"
  | "CANCELLED"
  | "EXPIRED"

export const ADMIN_RETURN_STATUS_LABEL: Record<AdminReturnStatus, string> = {
  REQUESTED: "Diajukan",
  SELLER_REVIEW: "Ditinjau penjual",
  CLARIFICATION_NEEDED: "Butuh klarifikasi",
  APPROVED: "Disetujui",
  REJECTED: "Ditolak",
  RETURN_SHIPPING: "Pengiriman balik",
  RECEIVED: "Diterima penjual",
  RESOLVED_REFUND: "Selesai (refund)",
  RESOLVED_EXCHANGE: "Selesai (tukar)",
  RESOLVED_REPAIR: "Selesai (perbaikan)",
  ESCALATED: "Dieskalasi",
  CANCELLED: "Dibatalkan",
  EXPIRED: "Kedaluwarsa",
}

export type AdminReturnItem = {
  id: string
  returnId: string
  orderId: string
  buyerId: string
  sellerId: string
  status: AdminReturnStatus
  reasonCode: string
  reasonDetail?: string | null
  resolutionType?: string | null
  refundAmount?: string | number | null
  sellerRespondBy?: string | null
  createdAt: string
  updatedAt?: string
  [key: string]: unknown
}

export function listAdminReturns(params?: {
  page?: number
  limit?: number
  status?: string
  search?: string
  /** Filter umur pengajuan (jam) untuk menyorot SLA. */
  minAgeHours?: number
}): Promise<Paginated<AdminReturnItem>> {
  return adminHttp.get<Paginated<AdminReturnItem>>("/v1/admin/returns", { query: params })
}

export function getAdminReturnDetail(returnId: string): Promise<AdminReturnItem> {
  return adminHttp.get<AdminReturnItem>(`/v1/admin/returns/${encodeURIComponent(returnId)}`)
}

export function adminForceCloseReturn(returnId: string, body: { resolution: string; note?: string }): Promise<unknown> {
  return adminHttp.post(`/v1/admin/returns/${encodeURIComponent(returnId)}/force-close`, body, {
    headers: idempotencyHeaders(),
  })
}

export function adminEscalateReturn(returnId: string, body?: { note?: string }): Promise<unknown> {
  return adminHttp.post(`/v1/admin/returns/${encodeURIComponent(returnId)}/escalate`, body ?? {}, {
    headers: idempotencyHeaders(),
  })
}

export function adminApproveReturnRefund(returnId: string): Promise<unknown> {
  return adminHttp.post(
    `/v1/admin/returns/${encodeURIComponent(returnId)}/approve-refund`,
    {},
    { headers: idempotencyHeaders() },
  )
}

export function adminExtendSellerDeadline(returnId: string, hours: number): Promise<unknown> {
  return adminHttp.post(
    `/v1/admin/returns/${encodeURIComponent(returnId)}/extend-deadline`,
    { hours },
    { headers: idempotencyHeaders() },
  )
}
