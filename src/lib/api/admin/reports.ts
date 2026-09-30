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

export type UserReport = {
  id: string
  reporterId: string
  reportedUserId?: string
  reason: string
  description?: string
  status: ReportStatus
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
