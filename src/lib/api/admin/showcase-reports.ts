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
import { adminHttp } from "@/lib/api/admin-client"
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
