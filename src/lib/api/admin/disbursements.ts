/**
 * Kahade admin — klien antrean lifecycle EscrowDisbursement DANA.
 *
 * Endpoint: `/v1/admin/finance/disbursements/*`
 * (lihat `backend/src/modules/admin/finance/admin-disbursement.controller.ts`).
 *
 * Gabungan merge 2026-10-01:
 * - Basis be-admin (BAI-043/044/045/050): endpoint & bentuk respons selaras
 *   backend (sumber kebenaran). Endpoint fe-admin `/v1/admin/disbursements`
 *   SALAH (404 di backend) — jangan dipakai.
 * - Plus fe-admin (MFE-015): label scope/status + tone badge, dan alias tipe
 *   `AdminDisbursement`/`AdminDisbursementStatus` untuk halaman
 *   `/disbursements` (read-only). Kueri `q` dipetakan ke `search` backend;
 *   `sortBy`/`sortOrder` diabaikan (backend selalu `updatedAt` desc —
 *   jangan kirim parameter fiktif, pelajaran BAI-061).
 *
 * Ini satu-satunya permukaan admin untuk aliran uang aktual era tanpa-wallet:
 * escrow order, milestone, cashback, referral, dispute release, legacy payout.
 *
 * Prinsip keamanan uang (fail-closed):
 * - List & detail: murni baca.
 * - `recheckDisbursement`: query status ke DANA (read terhadap provider) +
 *   transisi yang SAMA dengan cron otomatis — TIDAK PERNAH mengirim transfer baru.
 * - `reviewDisbursement` (NEEDS_REVIEW → RETRY/CANCEL/FORCE_SUCCESS):
 *   SUPER_ADMIN only, reason min 10 karakter, audit trail di backend.
 * - `requeueDisbursement` (HELD_NO_BANK → PENDING): SUPER_ADMIN/FINANCE_ADMIN;
 *   hanya mengubah status lokal agar cron retryDue memproses ulang via
 *   settle() yang fail-closed (inquiry bank + verifikasi nama).
 */
import { adminHttp } from "@/lib/api/admin-client"
import { newIdempotencyKey } from "@/lib/api/admin/finance"
import { STEP_UP_HEADER } from "@/lib/api/admin/step-up"
import type { Paginated } from "@/lib/api/admin/kyc"
import type { BadgeTone } from "@/components/ui/badge"

export type DisbursementStatus =
  | "PENDING"
  | "HELD_NO_BANK"
  | "PROCESSING"
  | "SUCCESS"
  | "FAILED"
  | "CANCELLED"
  | "NEEDS_REVIEW"

/** Alias untuk halaman `/disbursements` (gaya penamaan fe-admin). */
export type AdminDisbursementStatus = DisbursementStatus

export type DisbursementScope =
  | "ORDER_ESCROW"
  | "MILESTONE"
  | "LEGACY_WALLET_PAYOUT"
  | "CASHBACK"
  | "REFERRAL"
  | "DISPUTE_RELEASE"

export const DISBURSEMENT_STATUSES: DisbursementStatus[] = [
  "PENDING",
  "HELD_NO_BANK",
  "PROCESSING",
  "SUCCESS",
  "FAILED",
  "CANCELLED",
  "NEEDS_REVIEW",
]

/** BAI-050: filter scope mencakup CASHBACK & REFERRAL. */
export const DISBURSEMENT_SCOPES: DisbursementScope[] = [
  "ORDER_ESCROW",
  "MILESTONE",
  "LEGACY_WALLET_PAYOUT",
  "CASHBACK",
  "REFERRAL",
  "DISPUTE_RELEASE",
]

export type DisbursementListItem = {
  id: string
  idempotencyKey: string
  scope: DisbursementScope
  orderId: string | null
  orderPublicId: string | null
  sellerId: string
  sellerName: string | null
  /** Sen (string BigInt). */
  amountSen: string
  /** Rupiah (number, bisa pecahan — jangan Math.trunc). */
  amountIdr: number
  status: DisbursementStatus
  danaReferenceNo: string | null
  danaPartnerReferenceNo: string | null
  attemptCount: number
  createdAt: string
  updatedAt: string
}

/**
 * Bentuk tampilan untuk halaman `/disbursements` (MFE-015): bentuk
 * `DisbursementListItem` backend (sumber kebenaran) + field turunan.
 * `heldReason`/`lastError` hanya dikirim endpoint detail — di daftar selalu
 * null (kolom "Keterangan" menampilkan "—" dengan jujur).
 */
export type AdminDisbursement = DisbursementListItem & {
  /** Rupiah — alias `amountIdr` agar konsisten dengan halaman lain. */
  amount: number
  seller: {
    userId: string
    username: string | null
    fullName: string | null
    email: string | null
  } | null
  heldReason: string | null
  lastError: string | null
}

export type DisbursementDetail = DisbursementListItem & {
  scopeRefId: string | null
  bankAccount: {
    id: string
    bankCode: string
    /** Ter-masking (****1234); null bila decrypt gagal. */
    accountNameMasked: string | null
    accountNumberMasked: string | null
  } | null
  heldReason: string | null
  lastError: string | null
  releasedAt: string | null
}

export type DisbursementQuery = {
  page?: number
  limit?: number
  status?: DisbursementStatus
  scope?: DisbursementScope
  /** idempotencyKey, danaReferenceNo, danaPartnerReferenceNo, sellerId, atau orderId publik. */
  search?: string
}

/**
 * Kueri daftar disbursement gabungan: bentuk backend (`search`) + alias
 * fe-admin (`q`). Hanya parameter yang didukung backend yang dikirim.
 */
export type ListDisbursementsQuery = {
  page?: number
  limit?: number
  status?: DisbursementStatus | ""
  scope?: DisbursementScope | string
  /** Pencarian backend: idempotencyKey, danaReferenceNo, danaPartnerReferenceNo, sellerId, orderId publik. */
  search?: string
  /** Alias `search` — dipetakan ke `search` (`search` eksplisit menang). */
  q?: string
  /** Diabaikan: backend selalu mengurutkan `updatedAt` desc. */
  sortBy?: "createdAt" | "updatedAt" | "amountSen"
  /** Diabaikan: backend selalu mengurutkan `updatedAt` desc. */
  sortOrder?: "asc" | "desc"
}

/** Turunkan bentuk tampilan `/disbursements` dari item backend (tanpa field fiktif). */
function toAdminDisbursement(item: DisbursementListItem): AdminDisbursement {
  return {
    ...item,
    amount: item.amountIdr,
    seller: {
      userId: item.sellerId,
      username: null,
      fullName: item.sellerName,
      email: null,
    },
    heldReason: null,
    lastError: null,
  }
}

/**
 * Daftar disbursement (read-only) dengan filter status & scope.
 * Endpoint backend: `GET /v1/admin/finance/disbursements`.
 */
export function listDisbursements(
  query: ListDisbursementsQuery = {},
): Promise<Paginated<AdminDisbursement>> {
  // BAI-061: hanya teruskan parameter yang didukung backend.
  const params: Record<string, string | number> = {}
  if (query.page) params.page = query.page
  if (query.limit) params.limit = query.limit
  if (query.status) params.status = query.status
  if (query.scope) params.scope = query.scope
  const search = (query.search ?? query.q)?.trim()
  if (search) params.search = search
  return adminHttp
    .get<Paginated<DisbursementListItem>>("/v1/admin/finance/disbursements", {
      query: params,
    })
    .then((res) => ({
      ...res,
      data: (res.data ?? []).map(toAdminDisbursement),
    }))
}

/** Detail satu disbursement (tercatat di audit trail backend). */
export function getDisbursement(id: string): Promise<DisbursementDetail> {
  return adminHttp.get<DisbursementDetail>(
    `/v1/admin/finance/disbursements/${encodeURIComponent(id)}`,
  )
}

/**
 * BAI-042 (arahan DANA): cek ulang SATU disbursement PROCESSING ke DANA.
 * Hanya query status — tidak pernah mengirim transfer baru.
 */
export function recheckDisbursement(
  id: string,
  idempotencyKey?: string,
): Promise<DisbursementRecheckResult> {
  return adminHttp.post<DisbursementRecheckResult>(
    `/v1/admin/finance/disbursements/${encodeURIComponent(id)}/recheck`,
    {},
    { headers: { "Idempotency-Key": idempotencyKey ?? newIdempotencyKey() } },
  )
}

/**
 * BAI-044: review manual baris NEEDS_REVIEW — SUPER_ADMIN only (backend
 * menegakkan role). `reason` min 10 karakter; untuk FORCE_SUCCESS wajib
 * memuat bukti transfer nyata (mis. referensi DANA dashboard).
 *
 * SEC-501: backend mewajibkan `@RequireStepUp` — pemanggil wajib meminta
 * token via `useStepUp().requestStepUp()` dan meneruskannya di opts.
 */
export function reviewDisbursement(
  id: string,
  decision: DisbursementReviewDecision,
  reason: string,
  idempotencyKey?: string,
  opts?: { stepUpToken?: string },
): Promise<DisbursementReviewResult> {
  const headers: Record<string, string> = {
    "Idempotency-Key": idempotencyKey ?? newIdempotencyKey(),
  }
  if (opts?.stepUpToken) {
    headers[STEP_UP_HEADER] = opts.stepUpToken
  }
  return adminHttp.post<DisbursementReviewResult>(
    `/v1/admin/finance/disbursements/${encodeURIComponent(id)}/review`,
    { decision, reason },
    { headers },
  )
}

/**
 * BAI-045: cairkan ulang baris HELD_NO_BANK → PENDING (setelah seller
 * mendaftarkan rekening terverifikasi). Cron retryDue memprosesnya via
 * settle() yang fail-closed.
 *
 * SEC-501: backend mewajibkan `@RequireStepUp` — pemanggil wajib meminta
 * token via `useStepUp().requestStepUp()` dan meneruskannya di opts.
 */
export function requeueDisbursement(
  id: string,
  idempotencyKey?: string,
  opts?: { stepUpToken?: string },
): Promise<{ id: string; idempotencyKey: string; status: DisbursementStatus }> {
  const headers: Record<string, string> = {
    "Idempotency-Key": idempotencyKey ?? newIdempotencyKey(),
  }
  if (opts?.stepUpToken) {
    headers[STEP_UP_HEADER] = opts.stepUpToken
  }
  return adminHttp.post(
    `/v1/admin/finance/disbursements/${encodeURIComponent(id)}/requeue`,
    {},
    { headers },
  )
}

export type DisbursementRecheckResult = {
  id: string
  idempotencyKey: string
  /** Status mentah dari DANA Transfer-to-Bank Status API (null bila query gagal). */
  providerStatus: string | null
  /** CONFIRMED | FAILED | STILL_PROCESSING | QUERY_FAILED */
  outcome: string
  status: DisbursementStatus
}

export type DisbursementReviewDecision = "RETRY" | "CANCEL" | "FORCE_SUCCESS"

export type DisbursementReviewResult = {
  id: string
  idempotencyKey: string
  status: DisbursementStatus
  decision: DisbursementReviewDecision
  /**
   * P1-11 (audit integrasi 2026-10-06): untuk FORCE_SUCCESS, backend via dual
   * control mengembalikan {approvalId,status,expiresAt,message} — bukan
   * {id,idempotencyKey,decision}. UI wajib tampilkan pesan dual-control.
   */
  approvalId?: string
  expiresAt?: string
  message?: string
}

/** Label ringkas scope (tanpa jargon enum backend) — MFE-015. */
export function disbursementScopeLabel(scope: string): string {
  switch (scope) {
    case "ORDER_ESCROW":
      return "Dana order"
    case "MILESTONE":
      return "Milestone"
    case "DISPUTE_RELEASE":
      return "Lepas sengketa"
    case "CASHBACK":
      return "Cashback"
    case "REFERRAL":
      return "Referral"
    case "LEGACY_WALLET_PAYOUT":
      return "Payout lama"
    default:
      return scope
  }
}

/** Label Indonesia untuk status disbursement — MFE-015. */
export const DISBURSEMENT_STATUS_LABEL: Record<DisbursementStatus, string> = {
  PENDING: "Menunggu",
  HELD_NO_BANK: "Tertahan — tanpa rekening",
  PROCESSING: "Diproses",
  SUCCESS: "Berhasil",
  FAILED: "Gagal",
  CANCELLED: "Dibatalkan",
  NEEDS_REVIEW: "Perlu review",
}

/** Tone badge untuk status disbursement — MFE-015. */
export const DISBURSEMENT_STATUS_TONE: Record<DisbursementStatus, BadgeTone> = {
  PENDING: "neutral",
  HELD_NO_BANK: "warning",
  PROCESSING: "info",
  SUCCESS: "success",
  FAILED: "danger",
  CANCELLED: "neutral",
  NEEDS_REVIEW: "warning",
}
