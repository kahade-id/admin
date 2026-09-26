/** Kahade admin — antrean verifikasi identitas (KYC). */
import { adminHttp } from "@/lib/api/admin-client"

export type KycStatus = "PENDING" | "APPROVED" | "REJECTED" | "REVOKED"

export type KycQueueItem = {
  id: string
  kycId: string
  userId: string
  status: KycStatus
  rejectionReason: string | null
  attemptNumber: number
  createdAt: string
  reviewedAt: string | null
  reviewedBy: string | null
  user: { userId: string; email: string; fullName: string | null }
  reviewer: { adminId: string; fullName: string } | null
}

export type KycDetail = KycQueueItem & {
  adminNotes: string | null
  submittedIp: string | null
}

export type KycDocumentUrls = {
  ktpUrl: string | null
  selfieUrl: string | null
  partialErrors?: string[]
}

export type Paginated<T> = {
  data: T[]
  meta?: { page: number; limit: number; total: number; totalPages?: number }
  total?: number
}

export function getKycQueue(params?: {
  page?: number
  limit?: number
  status?: KycStatus
}): Promise<Paginated<KycQueueItem>> {
  return adminHttp.get<Paginated<KycQueueItem>>("/v1/admin/kyc", { query: params })
}

export function getKycDetail(kycId: string): Promise<KycDetail> {
  return adminHttp.get<KycDetail>(`/v1/admin/kyc/${encodeURIComponent(kycId)}`)
}

/** Perlu re-autentikasi password admin — mengembalikan URL 5 menit. */
export function getKycDocumentUrls(kycId: string, password: string): Promise<KycDocumentUrls> {
  return adminHttp.post<KycDocumentUrls>(
    `/v1/admin/kyc/${encodeURIComponent(kycId)}/document-urls`,
    { password },
  )
}

export function approveKyc(kycId: string, notes?: string): Promise<unknown> {
  return adminHttp.post(`/v1/admin/kyc/${encodeURIComponent(kycId)}/approve`, { notes })
}

export function rejectKyc(kycId: string, reason: string, notes?: string): Promise<unknown> {
  return adminHttp.post(`/v1/admin/kyc/${encodeURIComponent(kycId)}/reject`, { reason, notes })
}

export function revokeKyc(kycId: string, reason?: string): Promise<unknown> {
  return adminHttp.post(`/v1/admin/kyc/${encodeURIComponent(kycId)}/revoke`, { reason })
}

export function bulkApproveKyc(ids: string[]): Promise<unknown> {
  return adminHttp.post("/v1/admin/kyc/bulk/approve", { ids })
}

export function bulkRejectKyc(ids: string[], reason: string): Promise<unknown> {
  return adminHttp.post("/v1/admin/kyc/bulk/reject", { ids, reason })
}
