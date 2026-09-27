/** Kahade admin — antrean verifikasi badan usaha. */
import { API_BASE_URL } from "@/lib/api/config"
import { adminHttp, getAdminAccessToken, AdminAuthError } from "@/lib/api/admin-client"
import type { Paginated } from "@/lib/api/admin/kyc"

export type BusinessVerificationStatus = "PENDING" | "APPROVED" | "REJECTED" | "REVOKED"

export type BusinessVerificationItem = {
  id: string
  verificationId?: string
  userId: string
  status: BusinessVerificationStatus
  businessName?: string
  legalEntityType?: string
  deedNumber?: string | null
  siupNumber?: string | null
  docCount?: number
  documentsComplete?: boolean
  /** NPWP versi MASKED untuk preview minim-PII (detail saja). */
  npwpMasked?: string | null
  /** ISO date: approvedAt + LEGALITY_VALIDITY_DAYS (alarm kedaluwarsa legalitas). */
  legalitasValidUntil?: string | null
  legalitasExpired?: boolean
  rejectionReason: string | null
  adminNotes?: string | null
  attemptNumber?: number
  createdAt: string
  reviewedAt: string | null
  approvedAt?: string | null
  revokedAt?: string | null
  slaStartedAt?: string | null
  assignedReviewerId?: string | null
  assignedReviewer?: { id?: string; adminId: string; fullName: string } | null
  reviewer?: { adminId: string; fullName: string } | null
  user?: { userId: string; email: string; fullName: string | null }
  [key: string]: unknown
}

export type BusinessQueueFilters = {
  page?: number
  limit?: number
  status?: BusinessVerificationStatus
  legalEntityType?: string
  docsComplete?: "true" | "false"
  awaitingDocs?: "true"
  /** Filter alarm: hanya yang masa berlaku legalitasnya kedaluwarsa. */
  legalitasExpired?: "true"
}

export function getBusinessQueue(params?: BusinessQueueFilters): Promise<Paginated<BusinessVerificationItem>> {
  return adminHttp.get<Paginated<BusinessVerificationItem>>("/v1/admin/business-verifications", {
    query: params,
  })
}

export function getBusinessDetail(verificationId: string): Promise<BusinessVerificationItem> {
  return adminHttp.get<BusinessVerificationItem>(
    `/v1/admin/business-verifications/${encodeURIComponent(verificationId)}`,
  )
}

/**
 * Respons backend: { npwpNumber, documentUrls, partialErrors? }.
 * (Sebelumnya adapter salah mengetik `{ urls }` sehingga URL dokumen
 * tidak pernah tampil — kontrak drift dari rekonstruksi backend.)
 */
export type BusinessDocumentUrlsResult = {
  npwpNumber: string | null
  documentUrls: string[]
  partialErrors?: string[]
}

export function getBusinessDocumentUrls(
  verificationId: string,
  password: string,
): Promise<BusinessDocumentUrlsResult> {
  return adminHttp.post<BusinessDocumentUrlsResult>(
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

export function revokeBusiness(
  verificationId: string,
  reason: string,
  notes?: string,
): Promise<unknown> {
  return adminHttp.post(
    `/v1/admin/business-verifications/${encodeURIComponent(verificationId)}/revoke`,
    { reason, notes },
  )
}

export type BulkBusinessResult = {
  batchId: string
  approved?: string[]
  rejected?: string[]
  failed: Array<{ id: string; reason: string }>
}

/**
 * Bulk approve — batas 50/batch ditegakkan backend (slice). Payload memakai
 * `verificationIds` (sebelumnya adapter salah mengirim `ids` → 500).
 */
export function bulkApproveBusiness(ids: string[], notes?: string): Promise<BulkBusinessResult> {
  return adminHttp.post<BulkBusinessResult>("/v1/admin/business-verifications/bulk/approve", {
    verificationIds: ids,
    notes,
  })
}

/** Bulk reject — alasan WAJIB (sama untuk seluruh batch, dikirim ke tiap pemohon). */
export function bulkRejectBusiness(
  ids: string[],
  reason: string,
  notes?: string,
): Promise<BulkBusinessResult> {
  return adminHttp.post<BulkBusinessResult>("/v1/admin/business-verifications/bulk/reject", {
    verificationIds: ids,
    reason,
    notes,
  })
}

export type BusinessSummary = {
  period: string
  approved: number
  rejected: number
  revoked: number
  pending: number
  totalReviewed: number
}

/** Ringkasan volume disetujui/ditolak/dicabut per periode. */
export function getBusinessSummary(period: "7d" | "30d" | "90d" = "30d"): Promise<BusinessSummary> {
  return adminHttp.get<BusinessSummary>("/v1/admin/business-verifications/summary", {
    query: { period },
  })
}

/** Tugaskan reviewer (admin aktif) ke satu pengajuan — tercatat di audit. */
export function assignBusinessReviewer(
  verificationId: string,
  adminId: string,
): Promise<{ assignedReviewer?: { adminId: string; fullName: string } }> {
  return adminHttp.post(
    `/v1/admin/business-verifications/${encodeURIComponent(verificationId)}/assign`,
    { adminId },
  )
}

export type BusinessHistoryEntry = {
  id: string
  action: string
  description: string
  ipAddress: string
  createdAt: string
  admin: { adminId: string; fullName: string } | null
}

/** Riwayat perubahan/audit satu pengajuan (penugasan, akses dokumen, keputusan). */
export function getBusinessHistory(verificationId: string): Promise<BusinessHistoryEntry[]> {
  return adminHttp.get<BusinessHistoryEntry[]>(
    `/v1/admin/business-verifications/${encodeURIComponent(verificationId)}/history`,
  )
}

/**
 * Ekspor CSV antrean — TANPA NPWP (backend tidak pernah men-select kolomnya).
 * Endpoint mengembalikan `text/csv`, bukan JSON — tidak lewat `adminHttp`.
 */
export async function exportBusinessCsv(
  query: Omit<BusinessQueueFilters, "page" | "limit"> = {},
): Promise<string> {
  const token = await getAdminAccessToken()
  const url = new URL(`${API_BASE_URL}/v1/admin/business-verifications/export`)
  if (query.status) url.searchParams.set("status", query.status)
  if (query.legalEntityType) url.searchParams.set("legalEntityType", query.legalEntityType)
  if (query.docsComplete) url.searchParams.set("docsComplete", query.docsComplete)
  if (query.awaitingDocs) url.searchParams.set("awaitingDocs", query.awaitingDocs)
  if (query.legalitasExpired) url.searchParams.set("legalitasExpired", query.legalitasExpired)
  const res = await fetch(url.toString(), {
    headers: {
      Accept: "text/csv",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    credentials: "include",
  })
  if (res.status === 401) throw new AdminAuthError()
  if (!res.ok) throw new Error(`Ekspor CSV gagal (${res.status})`)
  return res.text()
}

export type BusinessSlaConfig = {
  slaHours: number
  useBusinessHours: boolean
  /** "config" bila dibaca dari server, "fallback" bila endpoint belum tersedia. */
  source: "config" | "fallback"
}

/**
 * Baca SLA scope BUSINESS_VERIFICATION dari endpoint worker E1
 * (GET /v1/admin/kyc/sla-config — mengembalikan `configs` per scope).
 * Bila endpoint belum tersedia / tidak bisa dibaca, fallback 48 jam
 * kalender — TIDAK menduplikasi endpoint, hanya try/catch.
 */
export async function getBusinessSlaConfig(): Promise<BusinessSlaConfig> {
  try {
    const res = await adminHttp.get<{
      configs?: Record<string, { slaHours?: number; useBusinessHours?: boolean }>
    }>("/v1/admin/kyc/sla-config")
    const cfg = res?.configs?.BUSINESS_VERIFICATION
    const slaHours =
      typeof cfg?.slaHours === "number" && cfg.slaHours > 0 ? cfg.slaHours : 48
    return { slaHours, useBusinessHours: cfg?.useBusinessHours === true, source: "config" }
  } catch {
    return { slaHours: 48, useBusinessHours: false, source: "fallback" }
  }
}
