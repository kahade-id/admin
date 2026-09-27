/**
 * Kahade admin — review klaim asuransi Kahade+.
 *
 * Endpoint: GET/PATCH `/v1/admin/insurance-claims/*`
 *
 * Kontrak backend (Kahade+, tetap):
 * - GET /v1/admin/insurance-claims?page&limit&status → list klaim
 * - PATCH /v1/admin/insurance-claims/:id
 *   {status: 'APPROVED'|'REJECTED'|'PAID', note?}
 *
 * Status klaim: DRAFT, SUBMITTED, APPROVED, REJECTED, PAID.
 * Alur review normal: SUBMITTED → APPROVED/REJECTED → PAID.
 */
import { newIdempotencyKey } from "@/lib/api/admin/finance"
import { adminHttp } from "@/lib/api/admin-client"
import type { Paginated } from "@/lib/api/admin/kyc"

export type InsuranceClaimStatus =
  | "DRAFT"
  | "SUBMITTED"
  | "APPROVED"
  | "REJECTED"
  | "PAID"

export type InsuranceClaimUser = {
  id?: string
  userId?: string
  username?: string | null
  fullName?: string | null
  email?: string | null
  [key: string]: unknown
}

export type InsuranceClaimOrder = {
  id?: string
  orderNumber?: string | null
  [key: string]: unknown
}

export type InsuranceClaim = {
  id: string
  userId?: string
  user?: InsuranceClaimUser | null
  orderId?: string | null
  order?: InsuranceClaimOrder | null
  /** Tipe klaim (alias: claimType). */
  type?: string | null
  claimType?: string | null
  /** Nominal klaim (alias: nominal), dalam rupiah. */
  amount?: number | null
  nominal?: number | null
  /** Cap/maksimal pertanggungan (alias: claimCap), dalam rupiah. */
  cap?: number | null
  claimCap?: number | null
  status?: InsuranceClaimStatus | string
  /** Catatan klaim dari pengguna (alias: notes). */
  note?: string | null
  notes?: string | null
  /** Catatan review admin. */
  adminNote?: string | null
  reviewNote?: string | null
  reviewedBy?: string | null
  reviewedAt?: string | null
  createdAt?: string
  updatedAt?: string
  [key: string]: unknown
}

export type UpdateInsuranceClaimInput = {
  status: "APPROVED" | "REJECTED" | "PAID"
  note?: string
}

export type UpdateInsuranceClaimResult = {
  message: string
  claimId: string
  status: string
}

/** Daftar klaim asuransi; filter status. */
export function listInsuranceClaims(query?: {
  page?: number
  limit?: number
  status?: InsuranceClaimStatus
}): Promise<Paginated<InsuranceClaim>> {
  return adminHttp.get<Paginated<InsuranceClaim>>(
    "/v1/admin/insurance-claims",
    {
      query: {
        page: query?.page,
        limit: query?.limit,
        status: query?.status,
      },
    },
  )
}

/**
 * Ubah status klaim (setujui / tolak / tandai dibayar) + catatan opsional.
 * ADM-227: idempoten — backend @Idempotency(); satu kunci stabil per sesi
 * dialog review agar retry tidak mengeksekusi payout ganda.
 */
export function updateInsuranceClaimStatus(
  claimId: string,
  input: UpdateInsuranceClaimInput,
  idempotencyKey?: string,
): Promise<UpdateInsuranceClaimResult> {
  const body: { status: string; note?: string } = { status: input.status }
  const note = input.note?.trim()
  if (note) body.note = note
  return adminHttp.patch<UpdateInsuranceClaimResult>(
    `/v1/admin/insurance-claims/${encodeURIComponent(claimId)}`,
    body,
    { headers: { "Idempotency-Key": idempotencyKey ?? newIdempotencyKey() } },
  )
}
