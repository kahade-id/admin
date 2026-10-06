/** Kahade admin — moderasi pesan antar-user (Trust & Safety). */
import { adminHttp } from "@/lib/api/admin-client"
import type { Paginated } from "@/lib/api/admin/kyc"
import { stepUpHeaders } from "@/lib/api/admin/step-up"

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

/**
 * true bila error adalah 404 dari backend. Dipakai pola defensif: tim
 * backend paralel membangun endpoint baru — 404 berarti endpoint belum
 * ada di rilis yang sedang jalan, bukan kesalahan data.
 */
function isNotFoundError(e: unknown): boolean {
  return (
    typeof e === "object" && e !== null && (e as { status?: number }).status === 404
  )
}

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
  params?: { limit?: number; cursor?: string; includeDeleted?: boolean },
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

// ---------------------------------------------------------------------------
// FAL-003 (audit integrasi 2026-10-03): moderasi polling chat.
// Admin sebelumnya buta terhadap polling — kini bisa melihat hasil
// (opsi + jumlah suara + total) dan menutup polling.
//
// Kontrak backend (asumsi — tim backend membangun paralel; SELALU defensif):
// - GET  /v1/admin/chat/polls/:pollId
//   → { id, question, options: [{ id, text, voteCount }], totalVotes, isClosed, closedAt? }
// - POST /v1/admin/chat/polls/:pollId/close  { reason }
//   → poll setelah ditutup. Wajib header `X-Step-Up-Token` (aksi
//   step-up `chat.poll.close`) + `Idempotency-Key`.
//
// 404 → Error dengan pesan jelas ("membutuhkan backend terbaru"), bukan crash.
// ---------------------------------------------------------------------------

export type ChatPollOption = {
  id: string
  text: string
  voteCount: number
}

export type ChatPoll = {
  id: string
  question: string
  options: ChatPollOption[]
  totalVotes: number
  isClosed: boolean
  closedAt?: string | null
  [key: string]: unknown
}

export async function getChatPoll(pollId: string): Promise<ChatPoll> {
  try {
    // P1-5 (audit integrasi 2026-10-06): backend bungkus dalam `{poll:{...}}`,
    // bukan top-level. Unwrap dulu.
    const res = await adminHttp.get<{ poll?: ChatPoll } & ChatPoll>(
      `/v1/admin/chat/polls/${encodeURIComponent(pollId)}`,
    )
    const poll = res?.poll ?? res
    return {
      ...poll,
      options: Array.isArray(poll?.options) ? poll.options : [],
      totalVotes: typeof poll?.totalVotes === "number" ? poll.totalVotes : 0,
    }
  } catch (e) {
    if (isNotFoundError(e)) {
      throw new Error(
        "Hasil polling belum tersedia — membutuhkan backend terbaru (GET /v1/admin/chat/polls/:pollId).",
      )
    }
    throw e
  }
}

/**
 * Tutup polling. `reason` wajib di UI (dicatat di audit) — catatan: backend
 * saat ini tidak membaca body dan tidak memverifikasi step-up untuk endpoint
 * ini, serta mengembalikan `{ok:true}` (bukan ChatPoll).
 * P1-6 (audit integrasi 2026-10-06): sesuaikan dengan respons aktual agar
 * kartu tidak blank setelah tutup.
 */
export async function closeChatPoll(
  pollId: string,
  reason: string,
  stepUpToken: string,
): Promise<{ ok: boolean }> {
  try {
    return await adminHttp.post<{ ok: boolean }>(
      `/v1/admin/chat/polls/${encodeURIComponent(pollId)}/close`,
      { reason },
      {
        headers: { ...idempotencyHeaders(), ...stepUpHeaders(stepUpToken) },
      },
    )
  } catch (e) {
    if (isNotFoundError(e)) {
      throw new Error(
        "Tutup polling belum tersedia — membutuhkan backend terbaru (POST /v1/admin/chat/polls/:pollId/close).",
      )
    }
    throw e
  }
}
