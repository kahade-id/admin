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
  /** Kategori sengketa (enum backend DisputeCategory) — nullable untuk data lama. */
  category?: string | null
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
  /** Filter kategori sengketa (enum backend DisputeCategory). */
  category?: string
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

/** Respons mentah backend `GET /v1/admin/disputes/:id/messages`. */
export type DisputeMessagesResponse = {
  messages: DisputeMessage[]
  nextCursor: string | null
  hasMore: boolean
}

/**
 * Ambil pesan sengketa (pesan mediasi admin).
 *
 * ADM-127: backend mengembalikan envelope `{ messages, nextCursor, hasMore }`
 * (limit 50) — adaptor mengembalikan envelope utuh agar riwayat >50 pesan
 * bisa dimuat ("Muat pesan lama").
 */
export async function getDisputeMessages(
  disputeId: string,
  params?: { cursor?: string; limit?: number },
): Promise<DisputeMessagesResponse> {
  const res = await adminHttp.get<DisputeMessagesResponse>(
    `/v1/admin/disputes/${encodeURIComponent(disputeId)}/messages`,
    { query: params },
  )
  return {
    messages: Array.isArray(res?.messages) ? res.messages : [],
    nextCursor: res?.nextCursor ?? null,
    hasMore: res?.hasMore === true,
  }
}

export function sendDisputeMessage(disputeId: string, message: string): Promise<unknown> {
  // DP-002: backend SendDisputeMessageDto mewajibkan field `content`
  // (bukan `message`) — kontrak diselaraskan di sini agar pemanggil
  // tetap memakai string pesan biasa.
  return adminHttp.post(
    `/v1/admin/disputes/${encodeURIComponent(disputeId)}/messages`,
    { content: message },
    { headers: idempotencyHeaders() },
  )
}

export type DisputeOrderChatMessage = {
  id: string
  content?: string
  message?: string
  senderId?: string
  isDeleted?: boolean
  deletedContent?: string | null
  createdAt: string
  [key: string]: unknown
}

/** Respons `GET /v1/admin/disputes/:id/chat` — percakapan order (termasuk pesan terhapus). */
export type DisputeOrderChatResponse = {
  messages: DisputeOrderChatMessage[]
  nextCursor: string | null
  hasMore: boolean
}

/**
 * ADM-111: ambil percakapan buyer–seller di room order sengketa.
 * `includeDeleted` default true (backend) agar mediator melihat isi asli
 * pesan yang dihapus sebagai bukti.
 */
export async function getDisputeChat(
  disputeId: string,
  params?: { cursor?: string; limit?: number; includeDeleted?: boolean },
): Promise<DisputeOrderChatResponse> {
  const res = await adminHttp.get<DisputeOrderChatResponse>(
    `/v1/admin/disputes/${encodeURIComponent(disputeId)}/chat`,
    { query: params },
  )
  return {
    messages: Array.isArray(res?.messages) ? res.messages : [],
    nextCursor: res?.nextCursor ?? null,
    hasMore: res?.hasMore === true,
  }
}

export type DisputeDecision = "FULL_BUYER" | "FULL_SELLER" | "SPLIT"

export type ResolvePreviewResult = {
  disputeId: string
  orderId: string
  decision: DisputeDecision
  buyerPercent: number | null
  sellerPercent: number | null
  /** Nominal dalam rupiah (number). */
  buyerAmount: number
  sellerAmount: number
  platformRetainAmount: number
  escrowedAmount: number
  platformFee: number
  /** Nominal presisi dalam sen (string) — untuk tampilan presisi penuh. */
  buyerAmountSen: string
  sellerAmountSen: string
  platformRetainAmountSen: string
  isPostCompletionDispute: boolean
  feePolicy: { fullBuyerRefundsPlatformFee: boolean }
}

/**
 * ADM-109: pratinjau nominal disbursement SEBELUM eksekusi resolve.
 * GET read-only — tidak memutasi apa pun; guard status sama dengan resolve
 * sehingga angka yang ditampilkan pasti bisa dieksekusi.
 */
export function previewResolveDispute(
  disputeId: string,
  input: {
    decision: DisputeDecision
    buyerPercent?: number
    sellerPercent?: number
  },
): Promise<ResolvePreviewResult> {
  return adminHttp.get<ResolvePreviewResult>(
    `/v1/admin/disputes/${encodeURIComponent(disputeId)}/resolve/preview`,
    { query: input as Record<string, string | number | undefined> },
  )
}

export function resolveDispute(
  disputeId: string,
  input: {
    /** Wajib: enum backend DisputeDecisionDto. */
    decision: DisputeDecision
    /** Wajib: min 100 karakter (dokumentasi audit). */
    decisionNotes: string
    /** Wajib bila decision === 'SPLIT': int 1–99, jumlah dengan sellerPercent = 100. */
    buyerPercent?: number
    /** Wajib bila decision === 'SPLIT': int 1–99, jumlah dengan buyerPercent = 100. */
    sellerPercent?: number
  },
): Promise<unknown> {
  // DP-001: payload persis kontrak backend DisputeDecisionDto.
  // Field lama {resolution, notes, winnerId} tidak dikenal backend dan
  // selalu menghasilkan 400.
  return adminHttp.post(
    `/v1/admin/disputes/${encodeURIComponent(disputeId)}/resolve`,
    input,
    { headers: idempotencyHeaders() },
  )
}
