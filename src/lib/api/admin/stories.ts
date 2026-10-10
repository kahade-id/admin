/**
 * Kahade admin — moderasi Story.
 *
 * Kontrak backend (otoritatif, diverifikasi 2026-10-10):
 * `backend/src/modules/admin/stories/admin-stories.controller.ts` +
 * `admin-stories.service.ts` + `dto/*.ts`. Role class-level:
 * SUPER_ADMIN, CUSTOMER_SUPPORT.
 *
 *   GET    /v1/admin/stories                 → { stories, total, page, limit }
 *   GET    /v1/admin/stories/metrics         → AdminStoryMetrics
 *   GET    /v1/admin/stories/reports         → { reports, total, page, limit }
 *   GET    /v1/admin/stories/reports/:id     → AdminStoryReport
 *   PATCH  /v1/admin/stories/reports/:id     { action, internalNote, durationDays? }
 *   POST   /v1/admin/stories/users/:userId/ban   { reason, durationDays? }
 *   DELETE /v1/admin/stories/users/:userId/ban
 *   GET    /v1/admin/stories/:id             → AdminStoryDetail
 *   GET    /v1/admin/stories/:id/viewers     → { viewers, total, page, limit }
 *   GET    /v1/admin/stories/:id/replies     → { rooms } (403 bila tak ada laporan terbuka)
 *   DELETE /v1/admin/stories/:id             { reason }
 *   POST   /v1/admin/stories/:id/hide        { reason, durationDays? 1–30 }
 *   POST   /v1/admin/stories/:id/restore
 *
 * Paginasi di modul ini BUKAN `Paginated<T>` (`data[]`) — backend memakai
 * kunci domain (`stories`, `reports`, `viewers`) tanpa `totalPages`.
 *
 * Step-up (SEC-503): endpoint Story BELUM memakai `@RequireStepUp` di
 * backend (guard no-op), tetapi aksi destruktif (hapus, ban, review
 * delete/ban) tetap meminta token step-up di UI dan mengirimnya via header
 * `X-Step-Up-Token` agar siap saat backend mengaktifkan guard. Nama aksi
 * di `STORY_STEP_UP_ACTION` adalah asumsi frontend sampai backend
 * mendeklarasikannya.
 */
import { adminHttp } from "@/lib/api/admin-client"
import { stepUpHeaders } from "@/lib/api/admin/step-up"

// ---------------------------------------------------------------------------
// Tipe
// ---------------------------------------------------------------------------

export type StoryKind = "image" | "video" | "text"

export type StoryListStatus = "all" | "active" | "expired" | "deleted" | "hidden" | "banned"

export type StoryReportStatus = "open" | "in_review" | "resolved_action" | "resolved_dismissed"

export type StoryReportAction = "in_review" | "delete" | "hide" | "ban" | "dismiss"

/** Backend enum StoryReportCategory, di-lowercase oleh `serializeReport`. */
export type StoryReportCategory = "spam" | "harassment" | "offensive" | "irrelevant" | "other"

/** `publicAuthor()` backend — `username` fallback ke `userId`. */
export type StoryAuthor = {
  userId: string
  username: string
  fullName: string | null
  avatarUrl: string | null
}

/** Baris `listStories` (admin-stories.service.ts:182). */
export type AdminStoryListItem = {
  id: string
  author: StoryAuthor
  kind: StoryKind
  durationMs: number | null
  createdAt: string
  expiresAt: string
  deletedAt: string | null
  hiddenAt: string | null
  hiddenUntil: string | null
  hiddenReason: string | null
  /** Penulis sedang kena ban fitur Story (aktif & belum lewat). */
  featureBanned: boolean
  viewCount: number
  reactionCount: number
  replyCount: number
  reportCount: number
}

export type AdminStoryListResult = {
  stories: AdminStoryListItem[]
  total: number
  page: number
  limit: number
}

export type AdminStoryListParams = {
  page?: number
  limit?: number
  authorUserId?: string
  kind?: StoryKind
  status?: StoryListStatus
  /** ISO date string. */
  from?: string
  /** ISO date string. */
  to?: string
}

/** `getMetrics` — semua angka agregat 30 hari kecuali `storiesToday`. */
export type AdminStoryMetrics = {
  storiesToday: number
  storiesLast30Days: number
  averageViewersPerStory: number
  /** Rasio reaksi/view (0–1). */
  reactionRate: number
  reportsPer1000Stories: number
  averageReportResolutionHours: number
}

export type StoryProductTag = {
  productId: string
  title: string
  coverUrl: string | null
  priceAmount: number | null
  x: number
  y: number
}

export type StoryAudience =
  | { mode: "all_savers" }
  | { mode: "savers_except"; excludedUserIds: string[] }

/** `StoriesService.getAdminStoryRecord` — URL media bertanda tangan 300 dtk. */
export type AdminStoryDetail = {
  id: string
  author: StoryAuthor | null
  kind: StoryKind
  mediaUrl: string | null
  /** VIDEO: poster JPEG (dipakai `<video poster>`). */
  thumbnailUrl: string | null
  durationMs: number | null
  text: string | null
  backgroundColor: string | null
  productTags: StoryProductTag[]
  priceSticker: { amount: number; currency: "IDR" } | null
  askStock: { productId: string | null } | null
  audience: StoryAudience
  createdAt: string
  expiresAt: string
  deletedAt: string | null
  hiddenAt: string | null
  hiddenUntil: string | null
  hiddenReason: string | null
  viewCount: number
  reactionCount: number
}

export type AdminStoryViewer = {
  user: StoryAuthor | null
  viewedAt: string
  reaction: string | null
}

export type AdminStoryViewersResult = {
  viewers: AdminStoryViewer[]
  total: number
  page: number
  limit: number
}

export type AdminStoryReplyMessage = {
  id: string
  storyId: string | null
  sender: { userId: string; username: string | null; fullName: string | null }
  messageType: string
  /** null bila pesan dihapus. */
  text: string | null
  deleted: boolean
  createdAt: string
}

export type AdminStoryReplyRoom = {
  roomId: string
  type: string
  subject: string | null
  messages: AdminStoryReplyMessage[]
}

export type AdminStoryRepliesResult = { rooms: AdminStoryReplyRoom[] }

/**
 * Snapshot Story saat dilaporkan (`serializeReport`): `mediaKey`/
 * `thumbnailKey` dibuang dan diganti URL bertanda tangan 900 dtk. Field
 * lain berasal dari JSON snapshot — pertahankan `[key: string]: unknown`.
 */
export type StoryReportSnapshot = {
  id?: string
  author?: StoryAuthor | null
  kind?: StoryKind
  mediaUrl: string | null
  thumbnailUrl: string | null
  durationMs?: number | null
  text?: string | null
  backgroundColor?: string | null
  createdAt?: string
  expiresAt?: string
  [key: string]: unknown
}

export type AdminStoryReport = {
  id: string
  storyId: string
  /** ID internal penulis (bukan `userId` publik). */
  authorId: string
  reporter: StoryAuthor | null
  category: StoryReportCategory | string
  note: string | null
  storySnapshot: StoryReportSnapshot
  status: StoryReportStatus
  internalNote: string | null
  reviewedByAdminId: string | null
  reviewedAt: string | null
  createdAt: string
  /** Umur laporan dalam jam (2 desimal), dihitung backend. */
  ageHours: number
}

export type AdminStoryReportListResult = {
  reports: AdminStoryReport[]
  total: number
  page: number
  limit: number
}

export type ReviewStoryReportInput = {
  action: StoryReportAction
  /** Wajib, ≤1000 karakter (dipakai sebagai alasan hide/ban). */
  internalNote: string
  /** hide: 1–3650 (default backend 7); ban: kosong = permanen. */
  durationDays?: number
}

export type ReviewStoryReportResult = {
  reportId: string
  storyId: string
  status: StoryReportStatus
  reviewedAt: string | null
}

export type HideStoryResult = { storyId: string; hidden: true; hiddenUntil: string }
export type RestoreStoryResult = { storyId: string; restored: true }
export type DeleteStoryResult = { deleted: true }
export type BanStoryFeatureResult = { userId: string; bannedUntil: string | null }
export type UnbanStoryFeatureResult = { userId: string; isBanned: false }

export type StoryStepUpOpts = { stepUpToken?: string }

/** Nama aksi step-up (asumsi frontend — backend belum mendeklarasikan). */
export const STORY_STEP_UP_ACTION = {
  delete: "story.delete",
  ban: "story.feature-ban",
  review: "story.report.review",
} as const

const BASE = "/v1/admin/stories"
const enc = encodeURIComponent

function stepUp(opts?: StoryStepUpOpts): { headers?: Record<string, string> } {
  return opts?.stepUpToken ? { headers: stepUpHeaders(opts.stepUpToken) } : {}
}

// ---------------------------------------------------------------------------
// Daftar & metrik
// ---------------------------------------------------------------------------

export function listAdminStories(params?: AdminStoryListParams): Promise<AdminStoryListResult> {
  return adminHttp.get<AdminStoryListResult>(BASE, { query: params })
}

export function getAdminStoryMetrics(): Promise<AdminStoryMetrics> {
  return adminHttp.get<AdminStoryMetrics>(`${BASE}/metrics`)
}

// ---------------------------------------------------------------------------
// Laporan
// ---------------------------------------------------------------------------

export function listStoryReports(params?: {
  page?: number
  limit?: number
  status?: StoryReportStatus
}): Promise<AdminStoryReportListResult> {
  return adminHttp.get<AdminStoryReportListResult>(`${BASE}/reports`, { query: params })
}

export function getStoryReport(reportId: string): Promise<AdminStoryReport> {
  return adminHttp.get<AdminStoryReport>(`${BASE}/reports/${enc(reportId)}`)
}

/**
 * Tinjau laporan. Backend menolak 409 STORY_REPORT_ALREADY_RESOLVED bila
 * status sudah final; `delete`/`hide` toleran bila Story sudah tidak ada.
 */
export function reviewStoryReport(
  reportId: string,
  input: ReviewStoryReportInput,
  opts?: StoryStepUpOpts,
): Promise<ReviewStoryReportResult> {
  return adminHttp.patch<ReviewStoryReportResult>(
    `${BASE}/reports/${enc(reportId)}`,
    input,
    stepUp(opts),
  )
}

// ---------------------------------------------------------------------------
// Ban fitur Story per pengguna (userId publik)
// ---------------------------------------------------------------------------

/** `durationDays` kosong = permanen; 1–3650 = sementara. */
export function banStoryFeature(
  userId: string,
  input: { reason: string; durationDays?: number },
  opts?: StoryStepUpOpts,
): Promise<BanStoryFeatureResult> {
  return adminHttp.post<BanStoryFeatureResult>(
    `${BASE}/users/${enc(userId)}/ban`,
    input,
    stepUp(opts),
  )
}

export function unbanStoryFeature(userId: string): Promise<UnbanStoryFeatureResult> {
  return adminHttp.delete<UnbanStoryFeatureResult>(`${BASE}/users/${enc(userId)}/ban`)
}

// ---------------------------------------------------------------------------
// Detail, viewer, balasan
// ---------------------------------------------------------------------------

export function getAdminStoryDetail(storyId: string): Promise<AdminStoryDetail> {
  return adminHttp.get<AdminStoryDetail>(`${BASE}/${enc(storyId)}`)
}

export function getAdminStoryViewers(
  storyId: string,
  params?: { page?: number; limit?: number },
): Promise<AdminStoryViewersResult> {
  return adminHttp.get<AdminStoryViewersResult>(`${BASE}/${enc(storyId)}/viewers`, {
    query: params,
  })
}

/** 403 FORBIDDEN bila Story tidak punya laporan OPEN/IN_REVIEW. */
export function getAdminStoryReplies(storyId: string): Promise<AdminStoryRepliesResult> {
  return adminHttp.get<AdminStoryRepliesResult>(`${BASE}/${enc(storyId)}/replies`)
}

// ---------------------------------------------------------------------------
// Aksi per Story
// ---------------------------------------------------------------------------

/** Hapus permanen Story + media. 503 UPLOAD_STORAGE_UNAVAILABLE bila storage gagal. */
export function deleteAdminStory(
  storyId: string,
  input: { reason: string },
  opts?: StoryStepUpOpts,
): Promise<DeleteStoryResult> {
  return adminHttp.delete<DeleteStoryResult>(`${BASE}/${enc(storyId)}`, {
    body: input,
    ...stepUp(opts),
  })
}

/** Sembunyikan sementara; `durationDays` 1–30 (default backend 7). */
export function hideAdminStory(
  storyId: string,
  input: { reason: string; durationDays?: number },
): Promise<HideStoryResult> {
  return adminHttp.post<HideStoryResult>(`${BASE}/${enc(storyId)}/hide`, input)
}

/** Pulihkan Story tersembunyi — hanya dalam 7 hari sejak disembunyikan (404 bila lewat). */
export function restoreAdminStory(storyId: string): Promise<RestoreStoryResult> {
  return adminHttp.post<RestoreStoryResult>(`${BASE}/${enc(storyId)}/restore`, {})
}
