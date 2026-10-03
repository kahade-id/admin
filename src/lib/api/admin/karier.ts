/** Kahade admin — manajemen karier (lowongan + pelamar). */
import { adminHttp } from "@/lib/api/admin-client"
import type { Paginated } from "./kyc"

/**
 * AW-019: paginasi mengikuti konvensi repo `{ data, total, page, limit,
 * totalPages }` (lihat Paginated<T> di kyc.ts) — sama seperti yang
 * dikembalikan backend /v1/admin/careers/*.
 */

export type JobApplicationStatus =
  | "BARU"
  | "DIREVIEW"
  | "WAWANCARA"
  | "DITERIMA"
  | "DITOLAK"

export type JobPosting = {
  id: string
  slug: string
  title: string
  location: string
  type: string
  /** Wajib diisi — skema kompensasi saham/equity ditulis eksplisit. */
  equity: string
  summary: string
  description: string
  requirements: string[]
  isActive: boolean
  publishedAt: string | null
  closedAt: string | null
  sortOrder: number
  createdAt: string
  updatedAt: string
  /** Disediakan GET list postings (§3.4). */
  applicationCount: number
}

export type JobPostingInput = {
  /** Opsional — backend auto-slug dari title bila kosong. */
  slug?: string
  title: string
  location: string
  type: string
  equity: string
  summary: string
  description: string
  requirements: string[]
  isActive: boolean
  sortOrder: number
}

export type JobApplicationItem = {
  id: string
  postingId: string
  posting?: { id: string; title: string; slug: string } | null
  fullName: string
  email: string
  phone: string
  status: JobApplicationStatus
  createdAt: string
  updatedAt: string
}

export type JobApplicationStatusHistoryItem = {
  id: string
  applicationId: string
  fromStatus: JobApplicationStatus | null
  toStatus: JobApplicationStatus
  changedBy: string | null
  note: string | null
  createdAt: string
}

export type JobApplicationDetail = JobApplicationItem & {
  coverNote: string | null
  cvFileKey: string
  portfolioUrl: string | null
  /** Catatan admin — TIDAK pernah tampil ke pelamar. */
  internalNote: string | null
  reviewedBy: string | null
  reviewedAt: string | null
  /**
   * Signed URL 15 menit (GET /v1/upload/s?...). JANGAN embed langsung —
   * buka via tautan/tab baru di halaman detail.
   */
  cvDownloadUrl: string | null
  history: JobApplicationStatusHistoryItem[]
}

/** GET /v1/admin/careers/postings?page=&limit=&active= */
export function listPostings(params?: {
  page?: number
  limit?: number
  active?: boolean
}): Promise<Paginated<JobPosting>> {
  return adminHttp.get<Paginated<JobPosting>>("/v1/admin/careers/postings", {
    query: params,
  })
}

/** POST /v1/admin/careers/postings */
export function createPosting(dto: JobPostingInput): Promise<JobPosting> {
  return adminHttp.post<JobPosting>("/v1/admin/careers/postings", dto)
}

/** PATCH /v1/admin/careers/postings/:id — termasuk toggle isActive. */
export function updatePosting(
  id: string,
  dto: Partial<JobPostingInput>,
): Promise<JobPosting> {
  return adminHttp.patch<JobPosting>(
    `/v1/admin/careers/postings/${encodeURIComponent(id)}`,
    dto,
  )
}

/**
 * DELETE /v1/admin/careers/postings/:id — 409 DELETE_BLOCKED_HAS_APPLICATIONS
 * bila masih ada pelamar; tutup via PATCH isActive=false bila begitu.
 */
export function deletePosting(id: string): Promise<{ deleted: boolean }> {
  return adminHttp.delete<{ deleted: boolean }>(
    `/v1/admin/careers/postings/${encodeURIComponent(id)}`,
  )
}

/** GET /v1/admin/careers/applications?postingId=&status=&q=&page=&limit= */
export function listApplications(params?: {
  postingId?: string
  status?: JobApplicationStatus | ""
  q?: string
  page?: number
  limit?: number
}): Promise<Paginated<JobApplicationItem>> {
  const query: Record<string, string | number | undefined> = {
    page: params?.page,
    limit: params?.limit,
  }
  if (params?.postingId) query.postingId = params.postingId
  if (params?.status) query.status = params.status
  if (params?.q?.trim()) query.q = params.q.trim()
  return adminHttp.get<Paginated<JobApplicationItem>>(
    "/v1/admin/careers/applications",
    { query },
  )
}

/** GET /v1/admin/careers/applications/:id — detail + cvDownloadUrl + history[]. */
export function getApplication(id: string): Promise<JobApplicationDetail> {
  return adminHttp.get<JobApplicationDetail>(
    `/v1/admin/careers/applications/${encodeURIComponent(id)}`,
  )
}

/** PATCH /v1/admin/careers/applications/:id/status { status, note? } */
export function updateApplicationStatus(
  id: string,
  input: { status: JobApplicationStatus; note?: string },
): Promise<JobApplicationDetail> {
  return adminHttp.patch<JobApplicationDetail>(
    `/v1/admin/careers/applications/${encodeURIComponent(id)}/status`,
    input,
  )
}

/**
 * DELETE /v1/admin/careers/applications/:id — hard delete + hapus file CV.
 * Untuk permintaan hapus manual / hak penghapusan UU PDP (lihat R1 spec).
 */
export function deleteApplication(id: string): Promise<{ deleted: boolean }> {
  return adminHttp.delete<{ deleted: boolean }>(
    `/v1/admin/careers/applications/${encodeURIComponent(id)}`,
  )
}

/**
 * Peta transisi status yang diizinkan (§2 spec):
 * BARU → DIREVIEW | DITOLAK; DIREVIEW → WAWANCARA | DITOLAK;
 * WAWANCARA → DITERIMA | DITOLAK; terminal dibuka ulang → DIREVIEW (admin + catatan).
 */
export const APPLICATION_STATUS_TRANSITIONS: Record<
  JobApplicationStatus,
  JobApplicationStatus[]
> = {
  BARU: ["DIREVIEW", "DITOLAK"],
  DIREVIEW: ["WAWANCARA", "DITOLAK"],
  WAWANCARA: ["DITERIMA", "DITOLAK"],
  DITERIMA: ["DIREVIEW"],
  DITOLAK: ["DIREVIEW"],
}

/** Transisi terminal yang dibuka ulang (wajib catatan). */
export function isReopenTransition(
  from: JobApplicationStatus,
  to: JobApplicationStatus,
): boolean {
  return (from === "DITERIMA" || from === "DITOLAK") && to === "DIREVIEW"
}
