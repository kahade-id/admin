/**
 * Kahade admin — antrean disbursement escrow (DANA payouts).
 *
 * MFE-015: selama ini admin TIDAK punya visibilitas atas lifecycle
 * disbursement DANA-direct (escrow → rekening bank seller). Endpoint:
 *   GET `/v1/admin/disbursements?page=&limit=&status=&scope=&q=&sortBy=&sortOrder=`
 *     → Paginated<AdminDisbursement>
 * (lihat `backend/src/modules/admin/finance/admin-finance.controller.ts`).
 *
 * Filter yang penting secara operasional:
 * - HELD_NO_BANK — fail-closed: seller belum punya rekening terverifikasi;
 *   dana tertahan, butuh tindak lanjut.
 * - NEEDS_REVIEW — status DANA tak dikenal; backend sengaja TIDAK
 *   auto-FAILED; butuh review manual sebelum retry/FAILED.
 *
 * Read-only: halaman ini tidak punya aksi mutasi.
 */
import { adminHttp } from "@/lib/api/admin-client"
import type { Paginated } from "@/lib/api/admin/kyc"
import type { BadgeTone } from "@/components/ui/badge"

export type AdminDisbursementStatus =
  | "PENDING"
  | "HELD_NO_BANK"
  | "PROCESSING"
  | "SUCCESS"
  | "FAILED"
  | "CANCELLED"
  | "NEEDS_REVIEW"

export type AdminDisbursement = {
  id: string
  scope: string
  scopeRefId: string | null
  orderId: string | null
  /** Rupiah (backend mengonversi dari sen). */
  amount: number
  status: AdminDisbursementStatus
  heldReason: string | null
  lastError: string | null
  danaPartnerReferenceNo: string | null
  danaReferenceNo: string | null
  attemptCount: number
  releasedAt: string | null
  createdAt: string
  updatedAt: string
  seller: {
    userId: string
    username: string | null
    fullName: string | null
    email: string | null
  } | null
  bankAccount: {
    id: string
    bankCode: string
    accountName: string | null
    accountNumber: string
  } | null
}

export type ListDisbursementsQuery = {
  page?: number
  limit?: number
  status?: AdminDisbursementStatus | ""
  scope?: string
  q?: string
  sortBy?: "createdAt" | "updatedAt" | "amountSen"
  sortOrder?: "asc" | "desc"
}

export function listDisbursements(
  q: ListDisbursementsQuery = {},
): Promise<Paginated<AdminDisbursement>> {
  const params = new URLSearchParams()
  if (q.page) params.set("page", String(q.page))
  if (q.limit) params.set("limit", String(q.limit))
  if (q.status) params.set("status", q.status)
  if (q.scope) params.set("scope", q.scope)
  if (q.q?.trim()) params.set("q", q.q.trim())
  if (q.sortBy) params.set("sortBy", q.sortBy)
  if (q.sortOrder) params.set("sortOrder", q.sortOrder)
  const qs = params.toString()
  return adminHttp.get<Paginated<AdminDisbursement>>(
    `/v1/admin/disbursements${qs ? `?${qs}` : ""}`,
  )
}

/** Label ringkas scope (tanpa jargon enum backend). */
export function disbursementScopeLabel(scope: string): string {
  switch (scope) {
    case "ORDER_ESCROW":
      return "Escrow order"
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

export const DISBURSEMENT_STATUS_LABEL: Record<AdminDisbursementStatus, string> = {
  PENDING: "Menunggu",
  HELD_NO_BANK: "Tertahan — tanpa rekening",
  PROCESSING: "Diproses",
  SUCCESS: "Berhasil",
  FAILED: "Gagal",
  CANCELLED: "Dibatalkan",
  NEEDS_REVIEW: "Perlu review",
}

export const DISBURSEMENT_STATUS_TONE: Record<AdminDisbursementStatus, BadgeTone> = {
  PENDING: "neutral",
  HELD_NO_BANK: "warning",
  PROCESSING: "info",
  SUCCESS: "success",
  FAILED: "danger",
  CANCELLED: "neutral",
  NEEDS_REVIEW: "warning",
}
