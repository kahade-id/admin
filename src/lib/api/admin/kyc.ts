/** Kahade admin — antrean verifikasi identitas (KYC). */
import { adminHttp } from "@/lib/api/admin-client"

/** BAI-065/BAI-069: UNVERIFIED adalah status awal setiap pengajuan baru. */
export type KycStatus = "UNVERIFIED" | "PENDING" | "APPROVED" | "REJECTED" | "REVOKED"

export type SlaStatus = "OK" | "MENDEKATI" | "BREACHED"

export type KycSlaView = {
  startedAt: string | null
  paused: boolean
  breachedAt: string | null
  elapsedMs: number | null
  remainingMs: number | null
  status: SlaStatus
  slaHours: number
  useBusinessHours: boolean
}

export type KycReviewerRef = {
  adminId: string
  fullName: string | null
}

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
  /** BAI-068: backend mengirim fullName: null bila nama reviewer tak ditemukan. */
  reviewer: { adminId: string; fullName: string | null } | null
  /** GAP-E: tampilan SLA live + reviewer yang ditugaskan. */
  sla?: KycSlaView | null
  assignedReviewer?: KycReviewerRef | null
}

export type KycAssignmentHistoryItem = {
  id: string
  admin: KycReviewerRef
  assignedBy: KycReviewerRef
  assignedAt: string
  releasedAt: string | null
  active: boolean
}

export type KycReviewerNote = {
  id: string
  admin: KycReviewerRef | null
  action: string
  /** Sudah di-mask (NIK/nomor telepon). */
  description: string
  createdAt: string
}

export type KycDetail = KycQueueItem & {
  adminNotes: string | null
  submittedIp: string | null
  /** BAI-072: jenis dokumen (KTP|PASSPORT). */
  documentType: string | null
  assignmentHistory?: KycAssignmentHistoryItem[]
  reviewerNotes?: KycReviewerNote[]
}

export type KycDocumentUrls = {
  ktpUrl: string | null
  selfieUrl: string | null
  /** BAI-063: video liveness + jenis dokumen — sebelumnya di-drop admin. */
  livenessUrl: string | null
  documentType: string | null
  partialErrors?: string[]
}

export type SlaScope = "KYC_PERSONAL" | "BUSINESS_VERIFICATION"

export type SlaConfigItem = {
  scope: SlaScope
  slaHours: number
  useBusinessHours: boolean
  updatedAt: string | null
  updatedBy: string | null
}

export type SlaConfigResponse = {
  configs: Record<SlaScope, SlaConfigItem>
  businessHoursDefinition: string
  defaultSlaHours: number
}

export type KycAttentionItem = KycQueueItem & {
  lastFailureAt?: string | null
  lastErrors?: string | null
  ageDays?: number
}

export type KycAttentionResponse = {
  generatedAt: string
  sla: {
    breached: KycQueueItem[]
    warning: KycQueueItem[]
  }
  docFailures: KycAttentionItem[]
  recheckQueue: KycAttentionItem[]
  recheckThresholdDays: number
}

export type KycReviewStats = {
  count: number
  p50: number | null
  p95: number | null
  avg: number | null
  min: number | null
  max: number | null
}

export type KycMetricsResponse = {
  period: { from: string; to: string }
  reviewTimeHours: Record<string, KycReviewStats>
  queue: {
    pending: number
    breached: number
    warning: number
    oldestElapsedMs: number
    slaHours: number
    useBusinessHours: boolean
  }
}

export type BulkKycResult = {
  approved?: string[]
  rejected?: string[]
  failed: { id: string; reason: string }[]
}

/**
 * AW-019: SATU konvensi paginasi — bentuk `createPaginatedResponse` backend
 * (`{ data, total, page, limit, totalPages }` di root). Wrapper `meta?` /
 * `pagination?` yang lama tidak pernah dikembalikan backend dan sudah dihapus;
 * semua halaman membaca `res.total` / `res.totalPages` langsung.
 */
export type Paginated<T> = {
  data: T[]
  total: number
  page: number
  limit: number
  totalPages: number
  hasNext?: boolean
  hasPrev?: boolean
}

export function getKycQueue(params?: {
  page?: number
  limit?: number
  status?: KycStatus
  /** true = hanya yang lewat SLA. */
  slaBreached?: boolean
  minAgeHours?: number
  maxAgeHours?: number
  /** ID admin reviewer, atau "unassigned". */
  assigned?: string
  /** ADM-006: filter status SLA di sisi server. */
  slaStatus?: "OK" | "MENDEKATI" | "BREACHED" | "PAUSED"
  /** ADM-015: pencarian teks (kycId / nama / email / userId / username). */
  search?: string
}): Promise<Paginated<KycQueueItem>> {
  return adminHttp.get<Paginated<KycQueueItem>>("/v1/admin/kyc", { query: params })
}

/**
 * ADM-004: daftar reviewer (KYC_ADMIN/SUPER_ADMIN aktif) — tanpa email/PII.
 * Boleh dibaca KYC_ADMIN (tidak seperti GET /v1/admin/management).
 */
export type KycReviewer = {
  id: string
  adminId: string
  fullName: string | null
  role: "KYC_ADMIN" | "SUPER_ADMIN"
}

export function listKycReviewers(): Promise<{ data: KycReviewer[]; total: number }> {
  return adminHttp.get<{ data: KycReviewer[]; total: number }>("/v1/admin/kyc/reviewers")
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

/**
 * BAI-008: backend RevokeKycDto mewajibkan `reason` (min 10 karakter).
 * Jangan pernah mengirim `reason: undefined` — gagal cepat di sisi klien
 * agar tidak menjadi 400 yang membingungkan. Dialog input alasan (min 10)
 * ditambahkan di halaman detail KYC (domain 4).
 */
export function revokeKyc(kycId: string, reason?: string): Promise<unknown> {
  const r = (reason ?? "").trim()
  if (r.length < 10) {
    return Promise.reject(
      new Error("Alasan pencabutan KYC wajib diisi (minimal 10 karakter)."),
    )
  }
  return adminHttp.post(`/v1/admin/kyc/${encodeURIComponent(kycId)}/revoke`, {
    reason: r,
  })
}

/**
 * GAP-E: bulk dengan guard expectedStatus — backend membatalkan per ID bila
 * status berubah sejak daftar dimuat.
 */
export function bulkApproveKyc(
  ids: string[],
  opts?: { notes?: string; expectedStatus?: "PENDING" },
): Promise<BulkKycResult> {
  return adminHttp.post<BulkKycResult>("/v1/admin/kyc/bulk/approve", {
    kycIds: ids,
    notes: opts?.notes,
    expectedStatus: opts?.expectedStatus,
  })
}

export function bulkRejectKyc(
  ids: string[],
  reason: string,
  opts?: { notes?: string; expectedStatus?: "PENDING" },
): Promise<BulkKycResult> {
  return adminHttp.post<BulkKycResult>("/v1/admin/kyc/bulk/reject", {
    kycIds: ids,
    reason,
    notes: opts?.notes,
    expectedStatus: opts?.expectedStatus,
  })
}

/** GET /v1/admin/kyc/sla-config — config efektif per scope (seed 48 jam kalender). */
export function getSlaConfig(): Promise<SlaConfigResponse> {
  return adminHttp.get<SlaConfigResponse>("/v1/admin/kyc/sla-config")
}

/** PUT /v1/admin/kyc/sla-config — changeReason wajib. */
export function updateSlaConfig(input: {
  scope: SlaScope
  slaHours: number
  useBusinessHours: boolean
  changeReason: string
}): Promise<SlaConfigItem> {
  return adminHttp.put<SlaConfigItem>("/v1/admin/kyc/sla-config", input)
}

/** GET /v1/admin/kyc/metrics — agregat waktu review (tanpa NIK). */
export function getKycMetrics(params?: { from?: string; to?: string }): Promise<KycMetricsResponse> {
  return adminHttp.get<KycMetricsResponse>("/v1/admin/kyc/metrics", { query: params })
}

/** GET /v1/admin/kyc/attention — daftar "perlu perhatian". */
export function getKycAttention(): Promise<KycAttentionResponse> {
  return adminHttp.get<KycAttentionResponse>("/v1/admin/kyc/attention")
}

/** POST /v1/admin/kyc/:id/assign — tugaskan reviewer (audit). */
export function assignKycReviewer(
  kycId: string,
  adminId: string,
): Promise<{ assignmentId: string; kycRequestId: string }> {
  return adminHttp.post(`/v1/admin/kyc/${encodeURIComponent(kycId)}/assign`, { adminId })
}

/** DELETE /v1/admin/kyc/:id/assign — lepas penugasan reviewer. */
export function releaseKycReviewer(kycId: string): Promise<{ released: boolean }> {
  return adminHttp.delete(`/v1/admin/kyc/${encodeURIComponent(kycId)}/assign`)
}

/** POST /v1/admin/kyc/:id/request-documents — minta dokumen tambahan (SLA dijeda). */
export function requestKycDocuments(
  kycId: string,
  message: string,
  notes?: string,
): Promise<{ paused: boolean }> {
  return adminHttp.post(`/v1/admin/kyc/${encodeURIComponent(kycId)}/request-documents`, {
    message,
    notes,
  })
}

/** POST /v1/admin/kyc/:id/resume-sla — lanjutkan SLA yang dijeda. */
export function resumeKycSla(kycId: string): Promise<{ resumed: boolean }> {
  return adminHttp.post(`/v1/admin/kyc/${encodeURIComponent(kycId)}/resume-sla`, {})
}
