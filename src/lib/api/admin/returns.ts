/**
 * Kahade admin — antrean retur.
 *
 * ADM-101/105 (2026-09-27): kontrak diselaraskan ke backend nyata
 * `AdminReturnsController`:
 * - list   → GET /v1/admin/returns/queue  → { items, page, limit, total, totalPages }
 *             (diadaptasi ke Paginated { data, ... } di sini)
 * - detail → GET /v1/admin/returns/:id
 * - aksi   → POST /v1/admin/returns/:id/action { action, ... } dengan Idempotency-Key
 *             (APPROVE | REJECT | ESCALATE | FORCE_RESOLVE_REFUND |
 *              FORCE_RESOLVE_EXCHANGE | FORCE_RESOLVE_REPAIR | EXTEND_DEADLINE)
 *
 * Endpoint lama yang TIDAK ADA di backend (/force-close, /escalate,
 * /approve-refund, /extend-deadline) dihapus — semuanya 404.
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

export type AdminReturnAction =
  | "APPROVE"
  | "REJECT"
  | "ESCALATE"
  | "FORCE_RESOLVE_REFUND"
  | "FORCE_RESOLVE_EXCHANGE"
  | "FORCE_RESOLVE_REPAIR"
  | "EXTEND_DEADLINE"

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
  order?: {
    orderId?: string
    buyerPayAmount?: string | number | null
    [key: string]: unknown
  } | null
  [key: string]: unknown
}

/** Respons mentah backend `GET /v1/admin/returns/queue` (ADM-105: `items`, bukan `data`). */
type ReturnQueueResponse = {
  items: AdminReturnItem[]
  page: number
  limit: number
  total: number
  totalPages: number
}

export async function listAdminReturns(params?: {
  page?: number
  limit?: number
  status?: string
  search?: string
  /** Filter umur pengajuan (jam) untuk menyorot SLA. */
  minAgeHours?: number
}): Promise<Paginated<AdminReturnItem>> {
  const res = await adminHttp.get<ReturnQueueResponse>("/v1/admin/returns/queue", {
    query: params,
  })
  // ADM-105: adaptor items → data (kontrak Paginated admin).
  const items = Array.isArray(res?.items) ? res.items : []
  return {
    data: items,
    total: res?.total ?? items.length,
    page: res?.page ?? 1,
    limit: res?.limit ?? items.length,
    totalPages: res?.totalPages ?? 1,
  }
}

export function getAdminReturnDetail(returnId: string): Promise<AdminReturnItem> {
  return adminHttp.get<AdminReturnItem>(`/v1/admin/returns/${encodeURIComponent(returnId)}`)
}

export type AdminReturnActionInput = {
  action: AdminReturnAction
  /** Nominal refund yang disetujui (sen). Bila kosong + APPROVE → full buyerPayAmount (backend). */
  refundAmountSen?: number
  resolutionType?: "REFUND" | "EXCHANGE" | "REPAIR"
  rejectReasonCode?: string
  /** Catatan wajib untuk aksi destruktif (force-resolve). */
  note?: string
}

/**
 * Satu pintu aksi admin retur → POST /v1/admin/returns/:id/action.
 * Selalu membawa Idempotency-Key (backend @Idempotency()).
 */
export function adminReturnAction(
  returnId: string,
  input: AdminReturnActionInput,
): Promise<AdminReturnItem> {
  return adminHttp.post<AdminReturnItem>(
    `/v1/admin/returns/${encodeURIComponent(returnId)}/action`,
    input,
    { headers: idempotencyHeaders() },
  )
}

/** Eskalasi retur ke sengketa (sengketa yang sudah ada dipakai ulang). */
export function adminEscalateReturn(returnId: string, note?: string): Promise<AdminReturnItem> {
  return adminReturnAction(returnId, { action: "ESCALATE", note })
}

/** Setujui refund — nominal dikonfirmasi di UI (ADM-113) sebelum dikirim. */
export function adminApproveReturnRefund(
  returnId: string,
  opts?: { refundAmountSen?: number; resolutionType?: "REFUND" | "EXCHANGE" | "REPAIR"; note?: string },
): Promise<AdminReturnItem> {
  return adminReturnAction(returnId, { action: "APPROVE", ...opts })
}

/** Tolak pengajuan retur dengan alasan terstruktur. */
export function adminRejectReturn(
  returnId: string,
  opts: { rejectReasonCode: string; note?: string },
): Promise<AdminReturnItem> {
  return adminReturnAction(returnId, { action: "REJECT", ...opts })
}

/** Tutup paksa — outcome dipilih eksplisit (pengganti endpoint /force-close yang tidak ada). */
export function adminForceResolveReturn(
  returnId: string,
  outcome: "REFUND" | "EXCHANGE" | "REPAIR",
  note: string,
): Promise<AdminReturnItem> {
  return adminReturnAction(returnId, {
    action: `FORCE_RESOLVE_${outcome}` as AdminReturnAction,
    note,
  })
}

/** Perpanjang deadline respons seller +24 jam (ADM-114; backend cap 3x per case). */
export function adminExtendSellerDeadline(returnId: string): Promise<AdminReturnItem> {
  return adminReturnAction(returnId, { action: "EXTEND_DEADLINE" })
}
