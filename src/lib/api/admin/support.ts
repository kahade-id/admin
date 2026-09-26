/** Kahade admin — tiket bantuan (support tickets). */
import { adminHttp } from "@/lib/api/admin-client"
import type { Paginated } from "@/lib/api/admin/kyc"

export type TicketStatus = "OPEN" | "IN_PROGRESS" | "RESOLVED" | "CLOSED" | string

export type SupportTicket = {
  id: string
  userId: string
  subject: string
  message: string
  category?: string
  status: TicketStatus
  createdAt: string
  updatedAt?: string
  user?: { userId: string; email: string; fullName: string | null }
  replies?: TicketReply[]
  [key: string]: unknown
}

export type TicketReply = {
  id: string
  message: string
  isAdminReply?: boolean
  createdAt: string
  [key: string]: unknown
}

export function listTickets(params?: {
  page?: number
  limit?: number
  status?: string
}): Promise<Paginated<SupportTicket>> {
  return adminHttp.get<Paginated<SupportTicket>>("/v1/admin/support/tickets", { query: params })
}

export function getTicketDetail(ticketId: string): Promise<SupportTicket> {
  return adminHttp.get<SupportTicket>(
    `/v1/admin/support/tickets/${encodeURIComponent(ticketId)}`,
  )
}

export function replyToTicket(ticketId: string, message: string): Promise<unknown> {
  return adminHttp.post(`/v1/admin/support/tickets/${encodeURIComponent(ticketId)}/reply`, {
    message,
  })
}

export function updateTicketStatus(ticketId: string, status: TicketStatus): Promise<unknown> {
  return adminHttp.patch(`/v1/admin/support/tickets/${encodeURIComponent(ticketId)}/status`, {
    status,
  })
}
