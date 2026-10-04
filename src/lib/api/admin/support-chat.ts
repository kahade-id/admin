/**
 * Kahade Admin Web — konsol livechat support (POIN 5, gelombang 2 admin).
 *
 * REST untuk: antrean percakapan, claim, tutup, eskalasi → tiket, dan
 * status ketersediaan agen. Pengiriman/penerimaan pesan utama lewat
 * WebSocket (`support.join` / `support.message` / …), lihat
 * `src/lib/realtime/support-socket.ts`.
 *
 * Backend (main): `src/modules/admin/support/admin-support-chat.controller.ts`.
 */
import { adminHttp } from "@/lib/api/admin-client"
import type { Paginated } from "@/lib/api/admin/kyc"

export type SupportConversationStatus = "WAITING" | "ASSIGNED" | "OPEN" | "CLOSED"

export type SupportConversation = {
  id: string
  userId: string
  user: { id: string; username: string | null; fullName: string | null } | null
  status: SupportConversationStatus
  subject: string | null
  /** Prioritas Kahade+ (antrean WAITING diurutkan prioritas dulu, lalu FIFO). */
  priority: boolean
  source: string
  assignedAgent: { id: string; name: string } | null
  closedAt: string | null
  rating: number | null
  createdAt: string
  updatedAt: string
  queuePosition?: number | null
  lastMessage?: SupportMessage | null
  [key: string]: unknown
}

export type SupportMessage = {
  id: string
  conversationId: string
  /** USER | AGENT | SYSTEM */
  senderType: string
  senderId: string | null
  senderName: string | null
  content: string | null
  attachments: string[]
  createdAt: string
}

export type SupportAgentStatus = {
  id: string
  name: string
  email: string
  role: string
  online: boolean
  /** Siap menerima percakapan baru (toggle manual agen). */
  available: boolean
  openConversations: number
}

/** Antrean percakapan; status WAITING diprioritaskan (Kahade+ dulu, FIFO). */
export function listSupportQueue(params?: {
  status?: SupportConversationStatus
  page?: number
  limit?: number
}): Promise<Paginated<SupportConversation>> {
  return adminHttp.get<Paginated<SupportConversation>>("/v1/admin/support/chat/conversations", {
    query: params,
  })
}

/** Ambil percakapan (WAITING/ASSIGNED → claim untuk diri sendiri). */
export function claimSupportConversation(conversationId: string): Promise<SupportConversation> {
  return adminHttp.post<SupportConversation>(
    `/v1/admin/support/chat/conversations/${encodeURIComponent(conversationId)}/claim`,
    {},
  )
}

/** Tutup percakapan sebagai agen. */
export function closeSupportConversation(conversationId: string): Promise<unknown> {
  return adminHttp.post(
    `/v1/admin/support/chat/conversations/${encodeURIComponent(conversationId)}/close`,
    {},
  )
}

export type EscalateSupportConversationInput = {
  subject: string
  category?: string
  message?: string
}

/** Eskalasi → tiket (sourceType=CHAT_ESCALATION) + transkrip otomatis. */
export function escalateSupportConversation(
  conversationId: string,
  input: EscalateSupportConversationInput,
): Promise<unknown> {
  return adminHttp.post(
    `/v1/admin/support/chat/conversations/${encodeURIComponent(conversationId)}/escalate`,
    { subject: input.subject, category: input.category, message: input.message },
  )
}

/** Status semua agen support (online + ketersediaan + beban OPEN). */
export function getSupportAgents(): Promise<SupportAgentStatus[]> {
  return adminHttp.get<SupportAgentStatus[]>("/v1/admin/support/chat/agents")
}

/** Toggle ketersediaan diri untuk percakapan baru. */
export function setAgentAvailability(available: boolean): Promise<unknown> {
  return adminHttp.post("/v1/admin/support/chat/agents/availability", { available })
}
