/** Kahade admin — laporan pengguna (user reports). */
import { adminHttp } from "@/lib/api/admin-client"
import type { Paginated } from "@/lib/api/admin/kyc"

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
  return adminHttp.post(`/v1/admin/reports/${encodeURIComponent(reportId)}/dismiss`, { notes })
}

export function resolveReport(reportId: string, notes?: string): Promise<unknown> {
  return adminHttp.post(`/v1/admin/reports/${encodeURIComponent(reportId)}/resolve`, { notes })
}
