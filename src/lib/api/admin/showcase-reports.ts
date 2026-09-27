/**
 * Kahade admin — moderasi laporan etalase (showcase reports).
 *
 * Endpoint: GET `/v1/admin/showcase-reports`, GET/POST
 * `/v1/admin/showcase-reports/:id` + `/:id/review`
 * (lihat `backend/src/modules/admin/showcase-reports/`).
 *
 * Status laporan (enum backend ReportStatus): PENDING, UNDER_REVIEW,
 * RESOLVED_ACTION_TAKEN, RESOLVED_NO_ACTION, DISMISSED. Tiga terakhir +
 * DISMISSED bersifat final — backend menolak aksi lanjutan dengan 400.
 */
import { adminHttp, getAdminAccessToken } from "@/lib/api/admin-client"
import { API_BASE_URL } from "@/lib/api/config"
import type { Paginated } from "@/lib/api/admin/kyc"

/**
 * UUID v4 untuk `Idempotency-Key`. Backend mewajibkan header ini pada
 * endpoint review (`@Idempotency()`): tanpa header, backend menolak
 * dengan 400 IDEMPOTENCY_KEY_REQUIRED. Pola sama seperti
 * `src/lib/api/admin/disputes.ts` dan `finance.ts`.
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

export type ShowcaseReportStatus =
  | "PENDING"
  | "UNDER_REVIEW"
  | "RESOLVED_ACTION_TAKEN"
  | "RESOLVED_NO_ACTION"
  | "DISMISSED"

export type ShowcaseReportAction =
  | "dismiss"
  | "takedown"
  | "no_action"
  | "under_review"

export type ShowcaseReportItemRef = {
  id: string
  title?: string | null
  isActive?: boolean | null
  images?: { imageUrl: string }[]
  user?: { id: string; username?: string | null; fullName?: string | null } | null
  [key: string]: unknown
}

export type ShowcaseReporter = {
  id: string
  username?: string | null
  fullName?: string | null
  [key: string]: unknown
}

export type ShowcaseReport = {
  id: string
  showcaseId: string
  showcase?: ShowcaseReportItemRef | null
  reporterId: string
  reporter?: ShowcaseReporter | null
  reason: string
  description?: string | null
  status: ShowcaseReportStatus
  reviewedBy?: string | null
  reviewedAt?: string | null
  resolution?: string | null
  createdAt: string
  updatedAt?: string
  reviewedByAdmin?: { id: string; fullName?: string | null; email?: string } | null
  [key: string]: unknown
}

export type ShowcaseReportDetail = ShowcaseReport & {
  showcase?: (ShowcaseReportItemRef & {
    description?: string | null
    category?: string | null
    visibility?: string | null
    priceMin?: number | string | null
    priceMax?: number | string | null
    likeCount?: number
    commentCount?: number
    createdAt?: string
    images?: { id: string; imageUrl: string; sortOrder: number }[]
    user?: {
      id: string
      username?: string | null
      fullName?: string | null
      avatarUrl?: string | null
    } | null
  }) | null
}

export type ReviewShowcaseReportResult = {
  message: string
  reportId: string
  status: ShowcaseReportStatus
  [key: string]: unknown
}

/** SH-A-024 — restrict juga mengembalikan jadwal auto-restore. */
export type RestrictShowcaseResult = ReviewShowcaseReportResult & {
  restrictUntil: string
}

/** SH-A-003 — kontrak PASTI backend: 200 `{ ok: true, item }`. */
export type RestoreTakedownResult = {
  ok: boolean
  item: unknown
  [key: string]: unknown
}

/** Daftar laporan etalase dengan filter status + paginasi. */
export function listShowcaseReports(params?: {
  page?: number
  limit?: number
  status?: ShowcaseReportStatus
}): Promise<Paginated<ShowcaseReport>> {
  return adminHttp.get<Paginated<ShowcaseReport>>("/v1/admin/showcase-reports", {
    query: params,
  })
}

/** Detail satu laporan (termasuk item etalase + pelapor). */
export function getShowcaseReportDetail(
  reportId: string,
): Promise<ShowcaseReportDetail> {
  return adminHttp.get<ShowcaseReportDetail>(
    `/v1/admin/showcase-reports/${encodeURIComponent(reportId)}`,
  )
}

/**
 * Moderasi laporan: dismiss / takedown / no_action / under_review.
 * `resolution` = catatan admin (opsional). Takedown hanya bisa bila item
 * masih aktif; status final ditolak backend dengan 400 (bukan 500).
 */
export function reviewShowcaseReport(
  reportId: string,
  input: { action: ShowcaseReportAction; resolution?: string },
): Promise<ReviewShowcaseReportResult> {
  return adminHttp.post<ReviewShowcaseReportResult>(
    `/v1/admin/showcase-reports/${encodeURIComponent(reportId)}/review`,
    input,
    { headers: idempotencyHeaders() },
  )
}

// ---------------------------------------------------------------------------
// GAP-F (G401–G425): lifecycle moderasi pasca-final.
// ---------------------------------------------------------------------------

export type ModerationEvent = {
  id: string
  action: string
  stateFrom?: string | null
  stateTo?: string | null
  reasonCode?: string | null
  note?: string | null
  actorAdminId?: string | null
  actorAdminName?: string | null
  createdAt: string
  [key: string]: unknown
}

export type ReportAppeal = {
  id: string
  reportId: string
  appellantType: "OWNER" | "REPORTER"
  reason: string
  newEvidence?: unknown
  status: "PENDING" | "APPROVED" | "REJECTED"
  reviewerAdminId?: string | null
  decidedAt?: string | null
  decisionNote?: string | null
  createdAt: string
  [key: string]: unknown
}

export type ShowcaseReportDetailWithLifecycle = ShowcaseReportDetail & {
  moderationEvents?: ModerationEvent[]
  activeAssignment?: {
    assigneeAdminId: string
    assignedAt: string
    slaDueAt?: string | null
    riskScore?: number | null
    riskTier?: string | null
  } | null
  appeals?: ReportAppeal[]
  [key: string]: unknown
}

/** G401 — buka kembali laporan final → UNDER_REVIEW (SUPER_ADMIN saja). */
export function reopenShowcaseReport(
  reportId: string,
  input: { reason: string; reasonCode?: string },
): Promise<ReviewShowcaseReportResult> {
  return adminHttp.post<ReviewShowcaseReportResult>(
    `/v1/admin/showcase-reports/${encodeURIComponent(reportId)}/reopen`,
    input,
    { headers: idempotencyHeaders() },
  )
}

/** G402 — tambah catatan moderasi (append-only). */
export function addModerationNote(
  reportId: string,
  input: { note: string },
): Promise<{ message: string }> {
  return adminHttp.post<{ message: string }>(
    `/v1/admin/showcase-reports/${encodeURIComponent(reportId)}/notes`,
    input,
  )
}

/** G411 — hasil assign: assignee + SLA (24 jam risiko tinggi / 72 jam normal). */
export type AssignShowcaseReportResult = {
  message: string
  reportId: string
  assignmentId: string
  assigneeAdminId: string
  riskScore: number
  riskTier: string
  slaDueAt: string
  [key: string]: unknown
}

/** G411 — assign / handoff laporan ke admin. */
export function assignShowcaseReport(
  reportId: string,
  input: { assigneeAdminId?: string | null; reasonCode?: string },
): Promise<AssignShowcaseReportResult> {
  return adminHttp.post(
    `/v1/admin/showcase-reports/${encodeURIComponent(reportId)}/assign`,
    input,
  )
}

/** G423 — batasi sementara item N hari (auto-restore). */
export function restrictShowcase(
  reportId: string,
  input: { days: number; reason: string; reasonCode?: string },
): Promise<RestrictShowcaseResult> {
  return adminHttp.post<RestrictShowcaseResult>(
    `/v1/admin/showcase-reports/${encodeURIComponent(reportId)}/restrict`,
    input,
    { headers: idempotencyHeaders() },
  )
}

/**
 * SH-A-003 — batalkan takedown: pulihkan item yang salah takedown.
 * Endpoint `POST /v1/admin/showcase-reports/items/:id/restore-takedown`
 * dibuat tim backend dengan kontrak 200 `{ ok: true, item }`.
 * Bila backend belum menyediakannya (404), pemanggil WAJIB menangani
 * secara graceful (toast info, bukan crash).
 */
export function restoreTakedownShowcaseItem(
  itemId: string,
): Promise<RestoreTakedownResult> {
  return adminHttp.post<RestoreTakedownResult>(
    `/v1/admin/showcase-reports/items/${encodeURIComponent(itemId)}/restore-takedown`,
    {},
    { headers: idempotencyHeaders() },
  )
}

/** G405 — antrean banding PENDING. */
export function listPendingAppeals(params?: {
  page?: number
  limit?: number
}): Promise<Paginated<ReportAppeal>> {
  return adminHttp.get<Paginated<ReportAppeal>>(
    "/v1/admin/showcase-reports/appeals/pending",
    { query: params },
  )
}

/** G405–G408 — putusan banding (reviewer ≠ moderator awal; APPROVED → restore). */
export function decideAppeal(
  appealId: string,
  input: { decision: "APPROVED" | "REJECTED"; decisionNote: string },
): Promise<{ message: string; [key: string]: unknown }> {
  return adminHttp.post(
    `/v1/admin/showcase-reports/appeals/${encodeURIComponent(appealId)}/decide`,
    input,
  )
}

/**
 * SH-A-001 — envelope backend getRelatedReports (verified):
 * `{ reportId, showcaseId, ownerId, total, reports }`.
 * Key "related" TIDAK ada di backend — baca `reports`.
 */
export type RelatedReportsResult = {
  reportId: string
  showcaseId: string
  ownerId: string
  total: number
  reports: ShowcaseReport[]
  [key: string]: unknown
}

/** G414 — laporan lain untuk item/pemilik yang sama. */
export function getRelatedReports(
  reportId: string,
): Promise<RelatedReportsResult> {
  return adminHttp.get(
    `/v1/admin/showcase-reports/${encodeURIComponent(reportId)}/related`,
  )
}

/**
 * SH-A-004 — envelope backend getReviewerSummary (verified):
 * `{ report, itemSnapshot, snapshotSource, itemLive, moderationEvents,
 *    appeals, cluster }`. PII reporter diminimalkan backend (id+username).
 */
export type ReviewerSummaryResult = {
  report: {
    id: string
    showcaseId: string
    reason: string
    description?: string | null
    status: ShowcaseReportStatus
    resolution?: string | null
    reviewedBy?: string | null
    reviewedAt?: string | null
    createdAt: string
    reporter?: { id: string; username?: string | null }
    [key: string]: unknown
  }
  itemSnapshot: unknown
  snapshotSource: string
  itemLive: { [key: string]: unknown }
  moderationEvents: ModerationEvent[]
  appeals: ReportAppeal[]
  cluster: unknown
  [key: string]: unknown
}

/** G418 — ringkasan bukti untuk reviewer kedua (PII diminimalkan). */
export function getReviewerSummary(
  reportId: string,
): Promise<ReviewerSummaryResult> {
  return adminHttp.get(
    `/v1/admin/showcase-reports/${encodeURIComponent(reportId)}/reviewer-summary`,
  )
}

/**
 * SH-A-002 — envelope backend getSnapshotDiff (verified):
 * `{ reportId, snapshotAt, snapshotBy, decisionEventId, itemDeleted?,
 *    changedFields: [{ field, snapshot, current }], changedCount }`.
 * `itemDeleted: true` bila item dihapus setelah snapshot.
 */
export type SnapshotDiffField = {
  field: string
  snapshot: unknown
  current: unknown
}

export type SnapshotDiffResult = {
  reportId: string
  snapshotAt?: string | null
  snapshotBy?: string | null
  decisionEventId?: string
  itemDeleted?: boolean
  changedFields: SnapshotDiffField[]
  changedCount: number
  [key: string]: unknown
}

/** G409/G410 — diff snapshot keputusan vs kondisi item saat ini. */
export function getSnapshotDiff(
  reportId: string,
): Promise<SnapshotDiffResult> {
  return adminHttp.get(
    `/v1/admin/showcase-reports/${encodeURIComponent(reportId)}/snapshot-diff`,
  )
}

/** SH-A-007 — item antrean prioritas (G411/G419): skor risiko + overdue. */
export type ModerationQueueItem = ShowcaseReport & {
  riskScore: number
  riskTier: string
  assigneeAdminId?: string | null
  slaDueAt?: string | null
  isOverdue: boolean
  escalated?: boolean
  [key: string]: unknown
}

/** G411/G419 — antrean prioritas moderasi (skor risiko + overdue). */
export function getModerationQueue(params?: {
  page?: number
  limit?: number
  riskTier?: string
  overdueOnly?: boolean
  sort?: string
  assigneeAdminId?: string
}): Promise<Paginated<ModerationQueueItem>> {
  return adminHttp.get("/v1/admin/showcase-reports/queue", { query: params })
}

/** SH-A-010 — parameter export audit G421 (teredaksi backend). */
export type ExportShowcaseReportsParams = {
  format?: "csv" | "json"
  status?: ShowcaseReportStatus | "ALL"
  from?: string
  to?: string
  limit?: number
}

/**
 * SH-A-010 — unduh export audit G421 (CSV/JSON teredaksi; event EXPORTED
 * tercatat backend). `adminHttp` berorientasi JSON sehingga dipakai fetch
 * mentah untuk blob — pola sama seperti `downloadQaAuditExport`.
 * Hanya untuk SUPER_ADMIN (backend juga guard method-level).
 */
export async function downloadShowcaseReportsExport(
  params: ExportShowcaseReportsParams = {},
): Promise<void> {
  const token = getAdminAccessToken()
  const url = new URL(`${API_BASE_URL}/v1/admin/showcase-reports/export`)
  if (params.format) url.searchParams.set("format", params.format)
  if (params.status && params.status !== "ALL")
    url.searchParams.set("status", params.status)
  if (params.from) url.searchParams.set("from", params.from)
  if (params.to) url.searchParams.set("to", params.to)
  if (params.limit) url.searchParams.set("limit", String(params.limit))
  const res = await fetch(url.toString(), {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    credentials: "include",
  })
  if (!res.ok) throw new Error(`Ekspor gagal (${res.status})`)
  const blob = await res.blob()
  const objectUrl = URL.createObjectURL(blob)
  const disposition = res.headers.get("Content-Disposition") ?? ""
  const filename =
    disposition.match(/filename="?([^";]+)"?/)?.[1] ??
    `showcase-reports-export.${params.format ?? "csv"}`
  const a = document.createElement("a")
  a.href = objectUrl
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(objectUrl)
}
