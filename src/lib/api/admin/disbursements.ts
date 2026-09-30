/**
 * Kahade admin — antrean lifecycle EscrowDisbursement DANA (BAI-043/044/045/050).
 *
 * Endpoint: `/v1/admin/finance/disbursements/*`
 * (lihat `backend/src/modules/admin/finance/admin-disbursement.controller.ts`).
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
import type { Paginated } from "@/lib/api/admin/kyc"

export type DisbursementStatus =
  | "PENDING"
  | "HELD_NO_BANK"
  | "PROCESSING"
  | "SUCCESS"
  | "FAILED"
  | "CANCELLED"
  | "NEEDS_REVIEW"

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
}

/** Daftar disbursement (read-only) dengan filter status & scope. */
export function listDisbursements(
  query: DisbursementQuery = {},
): Promise<Paginated<DisbursementListItem>> {
  return adminHttp.get<Paginated<DisbursementListItem>>(
    "/v1/admin/finance/disbursements",
    { query },
  )
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
 */
export function reviewDisbursement(
  id: string,
  decision: DisbursementReviewDecision,
  reason: string,
  idempotencyKey?: string,
): Promise<DisbursementReviewResult> {
  return adminHttp.post<DisbursementReviewResult>(
    `/v1/admin/finance/disbursements/${encodeURIComponent(id)}/review`,
    { decision, reason },
    { headers: { "Idempotency-Key": idempotencyKey ?? newIdempotencyKey() } },
  )
}

/**
 * BAI-045: cairkan ulang baris HELD_NO_BANK → PENDING (setelah seller
 * mendaftarkan rekening terverifikasi). Cron retryDue memprosesnya via
 * settle() yang fail-closed.
 */
export function requeueDisbursement(
  id: string,
  idempotencyKey?: string,
): Promise<{ id: string; idempotencyKey: string; status: DisbursementStatus }> {
  return adminHttp.post(
    `/v1/admin/finance/disbursements/${encodeURIComponent(id)}/requeue`,
    {},
    { headers: { "Idempotency-Key": idempotencyKey ?? newIdempotencyKey() } },
  )
}
