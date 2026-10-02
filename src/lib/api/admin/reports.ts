/** Kahade admin — laporan pengguna (user reports). */
import { adminHttp } from "@/lib/api/admin-client"
import type { Paginated } from "@/lib/api/admin/kyc"

/**
 * UUID v4 untuk `Idempotency-Key`. Backend mewajibkan header ini pada
 * endpoint mutasi (`@Idempotency()`): dismiss & resolve report — tanpa
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

export type ReportStatus = "PENDING" | "DISMISSED" | "RESOLVED" | string

export type ReportUser = {
  id?: string
  userId?: string
  username?: string | null
  fullName?: string | null
  avatarUrl?: string | null
  isBanned?: boolean | null
  [key: string]: unknown
}

export type UserReport = {
  id: string
  reporterId: string
  /**
   * BAI-123/BAI-025: backend mengirim `targetId` + relasi `target`
   * (tidak ada kolom `reportedUserId`) — UI sebelumnya membaca field yang
   * tidak pernah ada sehingga "ID Terlapor" tidak pernah tampil.
   */
  targetId?: string
  target?: ReportUser | null
  reporter?: ReportUser | null
  /**
   * BAI-024: backend (model UserReport) tidak punya field `reason`; yang ada
   * `category` (enum ReportCategory) + `description`. Kolom "Alasan" di UI
   * dirender dari keduanya.
   */
  category: string
  description?: string
  /** BAI-035 — URL bukti yang dilampirkan pelapor. */
  evidenceUrls?: string[]
  /** BAI-035 — order / pesan terkait (bila laporan berasal dari transaksi/chat). */
  relatedOrderId?: string | null
  relatedMessageId?: string | null
  status: ReportStatus
  /** BAI-035 — catatan penanganan (diisi saat resolve / dismiss). */
  resolution?: string | null
  /** BAI-035 — admin peninjau + waktu peninjauan. */
  reviewedBy?: string | null
  reviewedAt?: string | null
  createdAt: string
  [key: string]: unknown
}

export function listReports(params?: {
  page?: number
  limit?: number
  status?: string
}): Promise<Paginated<UserReport>> {
  return adminHttp.get<Paginated<UserReport>>("/v1/admin/reports", { query: params })
}

export function getReportDetail(reportId: string): Promise<UserReport> {
  return adminHttp.get<UserReport>(`/v1/admin/reports/${encodeURIComponent(reportId)}`)
}

export function dismissReport(reportId: string, notes?: string): Promise<unknown> {
  return adminHttp.post(
    `/v1/admin/reports/${encodeURIComponent(reportId)}/dismiss`,
    { notes },
    { headers: idempotencyHeaders() },
  )
}

export function resolveReport(
  reportId: string,
  resolution: string,
  resolveStatus?: "RESOLVED_ACTION_TAKEN" | "RESOLVED_NO_ACTION",
): Promise<unknown> {
  return adminHttp.post(
    `/v1/admin/reports/${encodeURIComponent(reportId)}/resolve`,
    { resolution, resolveStatus },
    { headers: idempotencyHeaders() },
  )
}
