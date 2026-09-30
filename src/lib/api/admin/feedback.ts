/** Kahade admin — antrean umpan balik (feedback workflow).
 *
 * KONTRAK (asumsi sementara; backend /v1/admin/feedback/* sedang dibangun
 * worker lain — sesuaikan bila final berbeda):
 * - GET    /v1/admin/feedback?cursor&limit&category&platform&rating&from&to&status&account&q
 *          → { data, nextCursor, hasMore }
 * - GET    /v1/admin/feedback/:id              → FeedbackDetail
 * - PATCH  /v1/admin/feedback/:id/status      { status }
 * - POST   /v1/admin/feedback/:id/assign      { adminId }
 * - POST   /v1/admin/feedback/:id/unassign
 * - POST   /v1/admin/feedback/:id/notes       { note }
 * - PATCH  /v1/admin/feedback/:id/tags        { tags, impactLabel }
 * - POST   /v1/admin/feedback/:id/reply       { body }
 * - GET    /v1/admin/feedback/:id/contact     { contact, maskedContact, consent, visibleToRole }
 * - POST   /v1/admin/feedback/:id/escalate    { risk, note? }
 * - POST   /v1/admin/feedback/:id/close       { reason }
 * - GET    /v1/admin/feedback/:id/duplicates  { items }
 * - GET    /v1/admin/feedback/export?...filter → { url } (URL unduhan bertanda)
 * - GET    /v1/admin/feedback/summary         → agregat ringkasan
 * - GET    /v1/admin/feedback/sla-rules       → daftar aturan SLA
 * - POST   /v1/admin/feedback/sla-rules       { category, hours, isCritical? }
 * - PATCH  /v1/admin/feedback/sla-rules/:ruleId { category?, hours?, isCritical? }
 * - DELETE /v1/admin/feedback/sla-rules/:ruleId
 *
 * Kontak pengirim hanya dikembalikan backend dalam bentuk TERMASKING kecuali
 * role admin diizinkan (lihat tipe FeedbackContact.visibleToRole).
 */
import { adminHttp } from "@/lib/api/admin-client"

export type FeedbackStatus = "NEW" | "IN_REVIEW" | "ACTIONED" | "CLOSED" | string
export type FeedbackRisk = "NONE" | "SECURITY_RISK" | "FRAUD_RISK" | string
export type FeedbackCloseReason =
  | "RESOLVED"
  | "DUPLICATE"
  | "NOT_ACTIONABLE"
  | "SPAM"
  | "OUT_OF_SCOPE"
  | "OTHER"
  | string

export type FeedbackAssignee = {
  id: string
  fullName: string
  email: string
  role: string
}

export type FeedbackItem = {
  id: string
  userId?: string | null
  /** true bila dari tamu (tanpa akun). */
  isGuest?: boolean
  category: string
  message: string
  rating?: number | null
  platform: string
  appVersion?: string | null
  status: FeedbackStatus
  assignee?: FeedbackAssignee | null
  assigneeId?: string | null
  tags: string[]
  impactLabel?: string | null
  riskFlag: FeedbackRisk
  /** Tenggat SLA (ISO). null bila tidak berlaku. */
  slaDueAt?: string | null
  contactConsent?: boolean
  createdAt: string
  closedReason?: FeedbackCloseReason | null
  closedAt?: string | null
  redactedAt?: string | null
  updatedAt?: string
  [key: string]: unknown
}

export type FeedbackInternalNote = {
  id: string
  note: string
  author?: { fullName: string; email?: string } | null
  createdAt: string
}

export type FeedbackReply = {
  id: string
  message: string
  author?: { fullName: string } | null
  createdAt: string
}

export type FeedbackAuditEntry = {
  id: string
  action: string
  detail?: string | null
  actor?: { fullName: string } | null
  createdAt: string
}

export type FeedbackAccount = {
  userId?: string | null
  fullName?: string | null
  email?: string | null
  isGuest: boolean
}

export type FeedbackDetail = FeedbackItem & {
  account: FeedbackAccount
  notes: FeedbackInternalNote[]
  replies: FeedbackReply[]
  audit: FeedbackAuditEntry[]
}

/** Bentuk paginasi cursor untuk daftar feedback. */
export type CursorPaginated<T> = {
  data: T[]
  nextCursor: string | null
  hasMore: boolean
  total?: number
}

export type FeedbackListParams = {
  cursor?: string
  limit?: number
  category?: string
  platform?: string
  rating?: number
  from?: string
  to?: string
  status?: string
  /** "all" | "user" | "guest" — diset ke undefined bila "all". */
  account?: "user" | "guest"
  q?: string
}

export function listFeedback(
  params?: FeedbackListParams,
): Promise<CursorPaginated<FeedbackItem>> {
  return adminHttp.get<CursorPaginated<FeedbackItem>>("/v1/admin/feedback", {
    query: {
      cursor: params?.cursor,
      limit: params?.limit,
      category: params?.category,
      platform: params?.platform,
      rating: params?.rating,
      from: params?.from,
      to: params?.to,
      status: params?.status,
      account: params?.account,
      q: params?.q,
    },
  })
}

export function getFeedbackDetail(feedbackId: string): Promise<FeedbackDetail> {
  return adminHttp.get<FeedbackDetail>(
    `/v1/admin/feedback/${encodeURIComponent(feedbackId)}`,
  )
}

export function updateFeedbackStatus(
  feedbackId: string,
  status: FeedbackStatus,
): Promise<unknown> {
  return adminHttp.patch(`/v1/admin/feedback/${encodeURIComponent(feedbackId)}/status`, {
    status,
  })
}

export function assignFeedback(feedbackId: string, adminId: string): Promise<unknown> {
  return adminHttp.post(`/v1/admin/feedback/${encodeURIComponent(feedbackId)}/assign`, {
    adminId,
  })
}

export function unassignFeedback(feedbackId: string): Promise<unknown> {
  return adminHttp.post(`/v1/admin/feedback/${encodeURIComponent(feedbackId)}/unassign`)
}

export function addFeedbackNote(feedbackId: string, note: string): Promise<unknown> {
  return adminHttp.post(`/v1/admin/feedback/${encodeURIComponent(feedbackId)}/notes`, {
    note,
  })
}

export function updateFeedbackTags(
  feedbackId: string,
  tags: string[],
  impactLabel?: string | null,
): Promise<unknown> {
  return adminHttp.post(`/v1/admin/feedback/${encodeURIComponent(feedbackId)}/tags`, {
    tags,
    impactLabel: impactLabel ?? null,
  })
}

export function replyToFeedback(feedbackId: string, body: string): Promise<unknown> {
  return adminHttp.post(`/v1/admin/feedback/${encodeURIComponent(feedbackId)}/reply`, {
    body,
  })
}

export type FeedbackContact = {
  /** Kontak asli — hanya bila backend mengizinkan role ini; jika tidak, null. */
  contact: string | null
  /** Bentuk termasking yang selalu aman ditampilkan. */
  maskedContact: string | null
  /** true bila pengirim menyetujui dihubungi (checkbox di aplikasi). */
  consent: boolean
  /** true bila role admin ini boleh melihat kontak asli. */
  visibleToRole: boolean
}

export function getFeedbackContact(feedbackId: string): Promise<FeedbackContact> {
  return adminHttp.post<FeedbackContact>(
    `/v1/admin/feedback/${encodeURIComponent(feedbackId)}/contact`,
  )
}

export function escalateFeedback(
  feedbackId: string,
  risk: "SECURITY_RISK" | "FRAUD_RISK",
  note?: string,
): Promise<unknown> {
  return adminHttp.post(`/v1/admin/feedback/${encodeURIComponent(feedbackId)}/escalate`, {
    risk,
    note: note?.trim() || undefined,
  })
}

export function closeFeedback(
  feedbackId: string,
  reason: FeedbackCloseReason,
): Promise<unknown> {
  return adminHttp.post(`/v1/admin/feedback/${encodeURIComponent(feedbackId)}/close`, {
    reason,
  })
}

export type FeedbackDuplicate = {
  id: string
  category: string
  messagePreview: string
  status: FeedbackStatus
  createdAt: string
  similarity?: number
}

export function findDuplicateFeedback(feedbackId: string): Promise<{ items: FeedbackDuplicate[] }> {
  return adminHttp.get<{ items: FeedbackDuplicate[] }>(
    `/v1/admin/feedback/${encodeURIComponent(feedbackId)}/duplicates`,
  )
}

/** Ekspor CSV: backend memproses dan mengembalikan URL unduhan bertanda. */
export function exportFeedback(params?: Omit<FeedbackListParams, "cursor" | "limit">): Promise<{
  url: string
}> {
  return adminHttp.get<{ url: string }>("/v1/admin/feedback/export", { query: params })
}

export type FeedbackSummary = {
  total: number
  byStatus: Record<string, number>
  byCategory: Record<string, number>
  byPlatform: Record<string, number>
  avgRating: number | null
  trend?: {
    windowDays: number
    daily: { day: string; total: number; avgRating: number | null }[]
    byPlatform: { day: string; platform: string; total: number }[]
    byAppVersion: { day: string; appVersion: string; total: number }[]
  }
}

function toRecord(
  arr: unknown,
  keyField: string,
): Record<string, number> {
  const out: Record<string, number> = {}
  if (Array.isArray(arr)) {
    for (const r of arr) {
      const rec = r as Record<string, unknown>
      const key = typeof rec[keyField] === "string" ? (rec[keyField] as string) : null
      const count = typeof rec.count === "number" ? rec.count : 0
      if (key) out[key] = count
    }
  } else if (arr && typeof arr === "object") {
    for (const [k, v] of Object.entries(arr as Record<string, unknown>)) {
      if (typeof v === "number") out[k] = v
    }
  }
  return out
}

/** GET /v1/admin/feedback/summary — backend mengembalikan { success, data }. */
export function getFeedbackSummary(): Promise<FeedbackSummary> {
  return adminHttp
    .get<{ success?: boolean; data?: unknown } | FeedbackSummary>("/v1/admin/feedback/summary")
    .then((res) => {
      const raw = (res as { data?: unknown })?.data ?? res
      const r = raw as Record<string, unknown>
      return {
        total: typeof r.total === "number" ? r.total : 0,
        byStatus: toRecord(r.byStatus, "status"),
        byCategory: toRecord(r.byCategory, "category"),
        byPlatform: toRecord(r.byPlatform, "platform"),
        avgRating: typeof r.avgRating === "number" ? r.avgRating : null,
        trend: (r.trend as FeedbackSummary["trend"]) ?? undefined,
      }
    })
}

/** Bentuk aturan SLA — selaras dengan AdminFeedbackSlaRuleDto backend (BAI-002). */
export type FeedbackSlaRule = {
  id: string
  category: string
  hours: number
  isCritical: boolean
  createdAt?: string
  updatedAt?: string
}

/** GET /v1/admin/feedback/sla-rules — backend mengembalikan array rule. */
export function listSlaRules(): Promise<FeedbackSlaRule[]> {
  return adminHttp.get<FeedbackSlaRule[]>("/v1/admin/feedback/sla-rules")
}

export type CreateSlaRuleInput = {
  category: string
  hours: number
  isCritical?: boolean
}

export type UpdateSlaRuleInput = Partial<CreateSlaRuleInput>

/** POST /v1/admin/feedback/sla-rules — upsert berdasarkan category. */
export function createSlaRule(input: CreateSlaRuleInput): Promise<FeedbackSlaRule> {
  return adminHttp.post<FeedbackSlaRule>("/v1/admin/feedback/sla-rules", input)
}

/** PATCH /v1/admin/feedback/sla-rules/:ruleId — update parsial (BAI-001). */
export function updateSlaRule(
  ruleId: string,
  input: UpdateSlaRuleInput,
): Promise<FeedbackSlaRule> {
  return adminHttp.patch<FeedbackSlaRule>(
    `/v1/admin/feedback/sla-rules/${encodeURIComponent(ruleId)}`,
    input,
  )
}

export function deleteSlaRule(ruleId: string): Promise<unknown> {
  return adminHttp.delete(`/v1/admin/feedback/sla-rules/${encodeURIComponent(ruleId)}`)
}
