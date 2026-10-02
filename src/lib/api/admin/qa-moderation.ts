/**
 * Kahade admin — moderasi platform Q&A profil (G426–G450).
 *
 * Endpoint: `/v1/admin/qa-moderation/*`
 * (lihat `backend/src/modules/admin/qa-moderation/`).
 *
 * RBAC backend: SUPER_ADMIN + CUSTOMER_SUPPORT untuk lihat/hide/unhide;
 * hapus permanen & ekspor agregat HANYA SUPER_ADMIN.
 * Kebijakan: `backend/docs/moderation-qa-policy.md`.
 */
import { adminHttp, getAdminAccessToken } from "@/lib/api/admin-client"
import { API_BASE_URL } from "@/lib/api/config"
import type { Paginated } from "@/lib/api/admin/kyc"

/** UUID v4 untuk `Idempotency-Key` (endpoint hide/unhide memakai @Idempotency()). */
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

export type QaReportTarget = "QUESTION" | "COMMENT"

export type QaModerationReason =
  | "SPAM"
  | "PROFANITY"
  | "HARASSMENT"
  | "PII_LEAK"
  | "SCAM_SUSPECTED"
  | "OFF_TOPIC"
  | "OTHER"

export const QA_REASON_LABEL: Record<QaModerationReason, string> = {
  SPAM: "Spam",
  PROFANITY: "Kata kasar",
  HARASSMENT: "Pelecehan",
  PII_LEAK: "Bocor data pribadi",
  SCAM_SUSPECTED: "Dugaan penipuan",
  OFF_TOPIC: "Keluar topik",
  OTHER: "Lainnya",
}

export const QA_REASON_OPTIONS = (
  Object.keys(QA_REASON_LABEL) as QaModerationReason[]
).map((value) => ({ value, label: QA_REASON_LABEL[value] }))

export type QaQueueItem = {
  targetType: QaReportTarget
  targetId: string
  contentPreview: string
  answered: boolean | null
  isHidden: boolean
  hiddenByType: "OWNER" | "MODERATOR" | null
  hiddenReason: string | null
  hiddenAt: string | null
  authorUsernameMasked: string | null
  profileUsernameMasked: string | null
  pendingReports: number
  reportReasonCode: QaModerationReason | null
  spamSuspected: boolean
  createdAt: string
}

export type QaQueueParams = {
  page?: number
  limit?: number
  q?: string
  targetType?: QaReportTarget
  reasonCode?: QaModerationReason
  answered?: "answered" | "unanswered"
  reportedOnly?: boolean
  hiddenOnly?: boolean
  spamOnly?: boolean
  spamProfileThreshold?: number
}

export type QaReport = {
  id: string
  target_type: QaReportTarget
  target_id: string
  reporter_id: string
  reporter_username: string | null
  reason_code: QaModerationReason
  note: string | null
  status: "PENDING" | "UNDER_REVIEW" | "DISMISSED" | "ACTION_TAKEN"
  assigned_admin_id: string | null
  assigned_admin_name: string | null
  resolved_at: string | null
  created_at: string
  updated_at: string
}

export type QaModerationEvent = {
  id: string
  target_type: QaReportTarget
  target_id: string
  actor_admin_id: string | null
  actor_admin_name: string | null
  action:
    | "HIDDEN"
    | "UNHIDDEN"
    | "REDACTED"
    | "DELETED"
    | "APPEAL_SUBMITTED"
    | "APPEAL_APPROVED"
    | "APPEAL_REJECTED"
    // FAL-012 (audit integrasi 2026-10-03): backend mencatat resolusi laporan.
    | "REPORT_RESOLVED"
  reason_code: QaModerationReason | null
  note: string | null
  created_at: string
}

export type QaAppeal = {
  id: string
  target_type: QaReportTarget
  target_id: string
  appellant_id: string
  appellant_username: string | null
  appellantUsernameMasked?: string | null
  reason: string
  status: "PENDING" | "APPROVED" | "REJECTED"
  reviewer_admin_id: string | null
  reviewer_admin_name: string | null
  reviewed_at: string | null
  review_note: string | null
  created_at: string
}

export type QaDeleteRequest = {
  id: string
  target_type: QaReportTarget
  target_id: string
  requested_by_admin_id: string
  requester_admin_name: string | null
  approved_by_admin_id: string | null
  approver_admin_name: string | null
  status: "PENDING" | "APPROVED" | "REJECTED"
  reason: string | null
  created_at: string
  decided_at: string | null
}

export type QaMetrics = {
  openReports: number
  underReview: number
  avgResolutionSeconds: number | null
  avgResolutionHours: number | null
  resolvedLast30d: number
  reasonDistribution: { reasonCode: QaModerationReason; count: number }[]
  hiddenByModerator: number
  hiddenByOwner: number
}

export type QaSpamCandidate = {
  author_id: string
  authorId: string
  authorUsernameMasked: string | null
  target_type: QaReportTarget
  sampleText: string
  profile_count: number
  item_count: number
  item_ids: string[]
  first_seen: string
  last_seen: string
}

export type QaBulkResult = {
  targetType: QaReportTarget
  total: number
  succeeded: number
  failed: number
  results: { id: string; ok: boolean; error?: string }[]
}

const BASE = "/v1/admin/qa-moderation"

/** Antrean moderasi (G426): dilaporkan ATAU disembunyikan, pagination + pencarian. */
export function listQaQueue(params: QaQueueParams): Promise<Paginated<QaQueueItem>> {
  return adminHttp.get<Paginated<QaQueueItem>>(`${BASE}/queue`, { query: params })
}

export function getQaQuestionDetail(questionId: string): Promise<Record<string, unknown>> {
  return adminHttp.get(`${BASE}/questions/${encodeURIComponent(questionId)}`)
}

export function getQaCommentDetail(commentId: string): Promise<Record<string, unknown>> {
  return adminHttp.get(`${BASE}/comments/${encodeURIComponent(commentId)}`)
}

export function hideQaTarget(
  targetType: QaReportTarget,
  targetId: string,
  input: { reasonCode: QaModerationReason; note?: string },
): Promise<Record<string, unknown>> {
  const seg = targetType === "QUESTION" ? "questions" : "comments"
  return adminHttp.post(
    `${BASE}/${seg}/${encodeURIComponent(targetId)}/hide`,
    input,
    { headers: idempotencyHeaders() },
  )
}

export function unhideQaTarget(
  targetType: QaReportTarget,
  targetId: string,
  note?: string,
): Promise<Record<string, unknown>> {
  const seg = targetType === "QUESTION" ? "questions" : "comments"
  return adminHttp.post(
    `${BASE}/${seg}/${encodeURIComponent(targetId)}/unhide`,
    note ? { note } : {},
    { headers: idempotencyHeaders() },
  )
}

/** Redaksi PII (G434): simpan redacted_text tanpa mengubah original. */
export function redactQaTarget(
  targetType: QaReportTarget,
  targetId: string,
): Promise<{ redactedText: string; truncated: boolean; findings: string; findingCount: number }> {
  return adminHttp.post(`${BASE}/redact`, { targetType, targetId })
}

/** Bulk hide (G442): maks 50, wajib confirm=true, hasil parsial. */
export function bulkHideQa(
  targetType: QaReportTarget,
  ids: string[],
  reasonCode: QaModerationReason,
  note: string | undefined,
  confirm: boolean,
): Promise<QaBulkResult> {
  return adminHttp.post<QaBulkResult>(`${BASE}/bulk-hide`, {
    targetType,
    ids,
    reasonCode,
    note,
    confirm,
  })
}

export function bulkUnhideQa(
  targetType: QaReportTarget,
  ids: string[],
  note: string | undefined,
  confirm: boolean,
): Promise<QaBulkResult> {
  return adminHttp.post<QaBulkResult>(`${BASE}/bulk-unhide`, {
    targetType,
    ids,
    note,
    confirm,
  })
}

/** Assignment / handoff laporan (G446). */
export function assignQaReport(
  reportId: string,
  adminId: string | null,
): Promise<{ reportId: string; assignedAdminId: string | null }> {
  return adminHttp.post(`${BASE}/reports/${encodeURIComponent(reportId)}/assign`, {
    adminId,
  })
}

export function resolveQaReport(
  reportId: string,
  resolution: "DISMISSED" | "ACTION_TAKEN",
  note?: string,
): Promise<{ reportId: string; status: string }> {
  return adminHttp.post(`${BASE}/reports/${encodeURIComponent(reportId)}/resolve`, {
    resolution,
    note,
  })
}

export function listQaAppeals(params?: {
  status?: string
  page?: number
  limit?: number
}): Promise<Paginated<QaAppeal>> {
  return adminHttp.get<Paginated<QaAppeal>>(`${BASE}/appeals`, { query: params })
}

export function reviewQaAppeal(
  appealId: string,
  decision: "APPROVED" | "REJECTED",
  note?: string,
): Promise<{ appealId: string; status: string }> {
  return adminHttp.post(`${BASE}/appeals/${encodeURIComponent(appealId)}/review`, {
    decision,
    note,
  })
}

export function requestQaDelete(
  targetType: QaReportTarget,
  targetId: string,
  reason: string,
): Promise<{ requestId: string; status: string }> {
  const seg = targetType === "QUESTION" ? "questions" : "comments"
  return adminHttp.post(`${BASE}/${seg}/${encodeURIComponent(targetId)}/delete-request`, {
    reason,
  })
}

export function listQaDeleteRequests(status?: string): Promise<QaDeleteRequest[]> {
  return adminHttp.get<QaDeleteRequest[]>(`${BASE}/delete-requests`, {
    query: status ? { status } : undefined,
  })
}

export function decideQaDeleteRequest(
  requestId: string,
  approve: boolean,
  note?: string,
): Promise<{ requestId: string; status: string }> {
  return adminHttp.post(
    `${BASE}/delete-requests/${encodeURIComponent(requestId)}/${approve ? "approve" : "reject"}`,
    note ? { note } : {},
  )
}

/** Metrik antrean (G445). */
export function getQaMetrics(): Promise<QaMetrics> {
  return adminHttp.get<QaMetrics>(`${BASE}/metrics`)
}

/** Kandidat spam lintas profil (G440). */
export function getQaSpamCandidates(params?: {
  threshold?: number
  limit?: number
}): Promise<{ threshold: number; windowHours: number; candidates: QaSpamCandidate[] }> {
  return adminHttp.get(`${BASE}/spam-candidates`, { query: params })
}

/**
 * Ekspor audit agregat CSV (G448) — SUPER_ADMIN saja.
 * Tanpa teks konten massal; counts per reason/day.
 */
export async function downloadQaAuditExport(days = 30): Promise<void> {
  const token = getAdminAccessToken()
  const res = await fetch(
    `${API_BASE_URL}${BASE}/export?days=${encodeURIComponent(String(days))}`,
    {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    },
  )
  if (!res.ok) throw new Error(`Ekspor gagal (${res.status})`)
  const blob = await res.blob()
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = "qa-moderation-audit.csv"
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}
