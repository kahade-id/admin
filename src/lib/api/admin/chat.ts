/** Kahade admin — moderasi chat (Trust & Safety). */
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
  type: string
  status: string
  userId?: string
  roomId?: string
  reason?: string
  createdAt: string
  [key: string]: unknown
}

export function listModerationEvents(params?: {
  page?: number
  limit?: number
  status?: string
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

export function reviewModerationEvent(
  eventId: string,
  input: { action: string; notes?: string },
): Promise<unknown> {
  return adminHttp.post(
    `/v1/admin/chat/moderation-events/${encodeURIComponent(eventId)}/review`,
    input,
    { headers: idempotencyHeaders() },
  )
}

export function getModerationStats(): Promise<Record<string, unknown>> {
  return adminHttp.get("/v1/admin/chat/moderation-events/stats")
}

export function getRoomMessages(
  roomId: string,
  params?: { limit?: number; before?: string },
): Promise<unknown[]> {
  return adminHttp.get<unknown[]>(`/v1/admin/chat/rooms/${encodeURIComponent(roomId)}/messages`, {
    query: params,
  })
}

export function listUserModerationEvents(userId: string): Promise<ModerationEvent[]> {
  return adminHttp.get<ModerationEvent[]>(
    `/v1/admin/chat/users/${encodeURIComponent(userId)}/moderation-events`,
  )
}
