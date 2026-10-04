/** Kahade admin — moderasi pesan antar-user (Trust & Safety). */
import { adminHttp } from "@/lib/api/admin-client"
import type { Paginated } from "@/lib/api/admin/kyc"

/**
 * UUID v4 untuk `Idempotency-Key`. Backend mewajibkan header ini pada
 * endpoint mutasi (`@Idempotency()`): review moderation event — tanpa
 * header, backend menolak dengan 400 IDEMPOTENCY_KEY_REQUIRED.
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

export type ModerationEvent = {
  id: string
  eventId?: string
  type: string
  kind?: string
  severity?: string
  status: string
  userId?: string
  roomId?: string
  reason?: string
  reviewedById?: string
  reviewedAt?: string | null
  reviewNote?: string | null
  createdAt: string
  // GO-PUBLIK H1: backend tidak lagi mengirim `content`/`snippet` untuk room
  // INQUIRY (DM privat). Kedua field nullable — UI wajib menangani
  // metadata-only tanpa crash (lihat chat/page.tsx).
  content?: string | null
  snippet?: string | null
  message?: {
    id?: string
    content?: string | null
    messageType?: string
    isDeleted?: boolean
  } | null
  room?: { id?: string; type?: string; subject?: string } | null
  [key: string]: unknown
}

export function listModerationEvents(params?: {
  page?: number
  limit?: number
  status?: string
  /** ADM-122: filter severity yang didukung backend (LOW–CRITICAL). */
  severity?: string
  /** ADM-122: filter aksi otomatis backend (BLOCKED/REDACTED/FLAGGED). */
  action?: string
  /** ADM-122: filter jenis pelanggaran (CIRCUMVENTION/CONTACT_SHARING/…). */
  kind?: string
}): Promise<Paginated<ModerationEvent>> {
  return adminHttp.get<Paginated<ModerationEvent>>("/v1/admin/chat/moderation-events", {
    query: params,
  })
}

export function getModerationEventDetail(eventId: string): Promise<ModerationEvent> {
  return adminHttp.get<ModerationEvent>(
    `/v1/admin/chat/moderation-events/${encodeURIComponent(eventId)}`,
  )
}

export type ReviewModerationStatus = "REVIEWED" | "DISMISSED" | "ACTIONED"

export function reviewModerationEvent(
  eventId: string,
  input: { status: ReviewModerationStatus; note?: string },
): Promise<unknown> {
  // ADM-102: payload persis ReviewModerationEventDto backend { status, note }.
  // Payload lama { action, notes } TIDAK dikenal backend — status diam-diam
  // jatuh ke REVIEWED dan notes hilang. Jangan kembalikan bentuk lama.
  const body: { status: ReviewModerationStatus; note?: string } = { status: input.status }
  const note = input.note?.trim()
  if (note) body.note = note.slice(0, 500)
  return adminHttp.post(
    `/v1/admin/chat/moderation-events/${encodeURIComponent(eventId)}/review`,
    body,
    { headers: idempotencyHeaders() },
  )
}

export function getModerationStats(): Promise<Record<string, unknown>> {
  return adminHttp.get("/v1/admin/chat/moderation-events/stats")
}

/** Respons mentah backend `GET /v1/admin/chat/rooms/:roomId/messages`. */
export type RoomMessagesResponse = {
  messages: unknown[]
  nextCursor: string | null
  hasMore: boolean
}

/**
 * ADM-103: backend mengembalikan envelope { messages, nextCursor, hasMore }
 * (bukan array) — adaptor mengembalikan envelope utuh agar pemanggil bisa
 * paginasi ("muat lebih banyak").
 */
export async function getRoomMessages(
  roomId: string,
  params?: { limit?: number; before?: string; cursor?: string; includeDeleted?: boolean },
): Promise<RoomMessagesResponse> {
  const res = await adminHttp.get<RoomMessagesResponse>(
    `/v1/admin/chat/rooms/${encodeURIComponent(roomId)}/messages`,
    { query: params },
  )
  return {
    messages: Array.isArray(res?.messages) ? res.messages : [],
    nextCursor: res?.nextCursor ?? null,
    hasMore: res?.hasMore === true,
  }
}

export type RoomByOrderResult = {
  roomId: string
  orderDbId: string
  orderId: string
}

/**
 * ADM-115: resolve room chat transaksi dari orderId.
 * Backend hanya mengembalikan room bertipe ORDER — DM pribadi (INQUIRY)
 * tidak pernah bocor lewat jalur ini.
 */
export function getRoomIdByOrder(orderId: string): Promise<RoomByOrderResult> {
  return adminHttp.get<RoomByOrderResult>(
    `/v1/admin/chat/rooms/by-order/${encodeURIComponent(orderId)}`,
  )
}

export function listUserModerationEvents(userId: string): Promise<ModerationEvent[]> {
  return adminHttp.get<ModerationEvent[]>(
    `/v1/admin/chat/users/${encodeURIComponent(userId)}/moderation-events`,
  )
}
