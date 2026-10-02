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
import { STEP_UP_HEADER } from "@/lib/api/admin/step-up"

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
  /**
   * SEC-502: admin yang MENYETUJUI klaim (diisi backend saat APPROVED).
   * PAID dinonaktifkan di UI bila admin yang login === approvedBy
   * (pemisahan tugas: yang menyetujui tidak boleh mengeksekusi payout).
   * Backend belum tentu mengirim field ini — UI defensif (bila tidak ada,
   * pemeriksaan dinonaktifkan, bukan fail-open pada aksi).
   */
  approvedBy?: string | null
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
  /**
   * SEC-502: true bila backend menahan payout menunggu persetujuan admin
   * kedua (nominal besar) — UI wajib menampilkan "Menunggu persetujuan
   * kedua", bukan sukses.
   */
  pendingSecondApproval?: boolean
}

export type UpdateInsuranceClaimOpts = {
  /**
   * SEC-504: kunci idempotency dibuat SEKALI per sesi dialog di pemanggil —
   * retry memakai kunci yang sama. Bila tidak diberi, dibuatkan (fallback).
   */
  idempotencyKey?: string
  /** SEC-502: token verifikasi ulang server (header X-Step-Up-Token) untuk PAID. */
  stepUpToken?: string
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
 * SEC-502: PAID wajib menyertakan stepUpToken (verifikasi ulang server).
 */
export function updateInsuranceClaimStatus(
  claimId: string,
  input: UpdateInsuranceClaimInput,
  opts?: UpdateInsuranceClaimOpts,
): Promise<UpdateInsuranceClaimResult> {
  const body: { status: string; note?: string } = { status: input.status }
  const note = input.note?.trim()
  if (note) body.note = note
  const headers: Record<string, string> = {
    "Idempotency-Key": opts?.idempotencyKey ?? newIdempotencyKey(),
  }
  if (opts?.stepUpToken) {
    headers[STEP_UP_HEADER] = opts.stepUpToken
  }
  return adminHttp.patch<UpdateInsuranceClaimResult>(
    `/v1/admin/insurance-claims/${encodeURIComponent(claimId)}`,
    body,
    { headers },
  )
}
