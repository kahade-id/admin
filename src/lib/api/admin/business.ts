/** Kahade admin — antrean verifikasi badan usaha. */
import { adminHttp } from "@/lib/api/admin-client"
import type { Paginated } from "@/lib/api/admin/kyc"

export type BusinessVerificationStatus = "PENDING" | "APPROVED" | "REJECTED" | "REVOKED"

export type BusinessVerificationItem = {
  id: string
  verificationId?: string
  userId: string
  status: BusinessVerificationStatus
  businessName?: string
  rejectionReason: string | null
  createdAt: string
  reviewedAt: string | null
  user?: { userId: string; email: string; fullName: string | null }
  [key: string]: unknown
}

export function getBusinessQueue(params?: {
  page?: number
  limit?: number
  status?: BusinessVerificationStatus
}): Promise<Paginated<BusinessVerificationItem>> {
  return adminHttp.get<Paginated<BusinessVerificationItem>>("/v1/admin/business-verifications", {
    query: params,
  })
}

export function getBusinessDetail(verificationId: string): Promise<BusinessVerificationItem> {
  return adminHttp.get<BusinessVerificationItem>(
    `/v1/admin/business-verifications/${encodeURIComponent(verificationId)}`,
  )
}

export function getBusinessDocumentUrls(
  verificationId: string,
  password: string,
): Promise<{ urls: string[] }> {
  return adminHttp.post<{ urls: string[] }>(
    `/v1/admin/business-verifications/${encodeURIComponent(verificationId)}/document-urls`,
    { password },
  )
}

export function approveBusiness(verificationId: string, notes?: string): Promise<unknown> {
  return adminHttp.post(
    `/v1/admin/business-verifications/${encodeURIComponent(verificationId)}/approve`,
    { notes },
  )
}

export function rejectBusiness(
  verificationId: string,
  reason: string,
  notes?: string,
): Promise<unknown> {
  return adminHttp.post(
    `/v1/admin/business-verifications/${encodeURIComponent(verificationId)}/reject`,
    { reason, notes },
  )
}

export function revokeBusiness(verificationId: string, reason?: string): Promise<unknown> {
  return adminHttp.post(
    `/v1/admin/business-verifications/${encodeURIComponent(verificationId)}/revoke`,
    { reason },
  )
}

export function bulkApproveBusiness(ids: string[]): Promise<unknown> {
  return adminHttp.post("/v1/admin/business-verifications/bulk/approve", { ids })
}

export function bulkRejectBusiness(ids: string[], reason: string): Promise<unknown> {
  return adminHttp.post("/v1/admin/business-verifications/bulk/reject", { ids, reason })
}
