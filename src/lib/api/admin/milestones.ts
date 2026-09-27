/** Kahade admin — dasbor milestone & rekonsiliasi escrow per tahap.
 *
 * KONTRAK (asumsi sementara; endpoint backend sedang dibangun worker lain —
 * sesuaikan bila final berbeda):
 * - GET /v1/admin/milestones?status&page&limit → Paginated<MilestoneAdminItem>
 * - GET /v1/admin/milestones/reconcile
 *   → { orders: MilestoneReconcileRow[] } — satu baris per order yang punya
 *   milestone, berisi invariant check dengan status LULUS/GAGAL.
 *
 * Nominal BigInt backend dapat tiba sebagai number atau string; admin
 * menampilkannya via `formatNumberID`-style helper di bawah tanpa float math.
 */
import { adminHttp } from "@/lib/api/admin-client"
import type { Paginated } from "@/lib/api/admin/kyc"

export type MilestoneStatus =
  | "DRAFT"
  | "AWAITING_ACTIVATION"
  | "SUBMITTED"
  | "REVISION_REQUESTED"
  | "ACCEPTED"
  | "RELEASED"
  | "CANCELLED"
  | "DISPUTED"
  | string

export type MilestoneMoney = number | string

export type MilestoneAdminItem = {
  id: string
  orderId: string
  orderTitle?: string | null
  seq: number
  title: string
  amount: MilestoneMoney
  sellerAmount?: MilestoneMoney | null
  escrowHeld: MilestoneMoney
  status: MilestoneStatus
  deadline?: string | null
  reviewDeadline?: string | null
  submittedAt?: string | null
  acceptedAt?: string | null
  releasedAt?: string | null
  revisionRounds: number
  maxRevisionRounds: number
  createdAt: string
  [key: string]: unknown
}

type MilestoneAdminRowRaw = {
  id: string
  seq: number
  title: string
  amount: MilestoneMoney
  sellerAmount?: MilestoneMoney | null
  escrowHeld: MilestoneMoney
  status: MilestoneStatus
  deadline?: string | null
  reviewDeadline?: string | null
  submittedAt?: string | null
  acceptedAt?: string | null
  releasedAt?: string | null
  revisionRounds: number
  maxRevisionRounds: number
  createdAt: string
  order?: { orderId: string; title?: string | null } | null
  [key: string]: unknown
}

export function listMilestones(params?: {
  status?: string
  orderId?: string
  page?: number
  limit?: number
}): Promise<Paginated<MilestoneAdminItem>> {
  return adminHttp
    .get<{
      page: number
      limit: number
      total: number
      totalPages: number
      milestones: MilestoneAdminRowRaw[]
    }>("/v1/admin/milestones", { query: params })
    .then((res) => ({
      data: (res.milestones ?? []).map((m) => ({
        ...m,
        orderId: m.order?.orderId ?? "",
        orderTitle: m.order?.title ?? null,
      })),
      total: res.total ?? 0,
      page: res.page ?? 1,
      limit: res.limit ?? params?.limit ?? 20,
      totalPages: res.totalPages ?? 1,
    }))
}

/** Ringkasan escrow milestone — GET /v1/admin/milestones/escrow-summary. */
export type MilestoneEscrowSummary = {
  totalMilestones: number
  totalEscrowHeld: MilestoneMoney
  releasedCount: number
  totalReleasedSellerAmount: MilestoneMoney
  byStatus: { status: MilestoneStatus; count: number; escrowHeld: MilestoneMoney }[]
}

export function getMilestoneEscrowSummary(): Promise<MilestoneEscrowSummary> {
  return adminHttp.get<MilestoneEscrowSummary>("/v1/admin/milestones/escrow-summary")
}

export type MilestoneCheckResult = {
  name: string
  ok: boolean
  expected: string
  actual: string
}

export type MilestoneReconcileViolation = {
  orderId: string
  checks: MilestoneCheckResult[]
}

/**
 * Rekonsiliasi massal — GET /v1/admin/milestones/reconcile/recent.
 * Mengembalikan order yang invariant-nya GAGAL (24 jam terakhir).
 */
export function reconcileRecentMilestones(limit?: number): Promise<{
  scanned: number
  violations: MilestoneReconcileViolation[]
}> {
  return adminHttp.get<{ scanned: number; violations: MilestoneReconcileViolation[] }>(
    "/v1/admin/milestones/reconcile/recent",
    { query: limit ? { limit } : undefined },
  )
}

/** Rekonsiliasi satu order — GET /v1/admin/milestones/reconcile/:orderDbId. */
export function reconcileMilestoneOrder(orderDbId: string): Promise<{
  orderId: string
  hasMilestones: boolean
  ok: boolean
  checks: MilestoneCheckResult[]
}> {
  return adminHttp.get(`/v1/admin/milestones/reconcile/${encodeURIComponent(orderDbId)}`)
}

export type MilestoneReconcileRow = {
  orderId: string
  checks: MilestoneCheckResult[]
  /** LULUS bila semua check true. */
  status: "LULUS" | "GAGAL"
  failedChecks: string[]
}

/** Nominal aman untuk tampilan (mendukung number|string dari JSON). */
export function milestoneMoneyToNumber(v: MilestoneMoney | null | undefined): number | null {
  if (v === null || v === undefined) return null
  const n = typeof v === "string" ? Number(v) : v
  return Number.isSafeInteger(n) ? n : null
}

export function formatMilestoneRupiah(v: MilestoneMoney | null | undefined): string {
  const n = milestoneMoneyToNumber(v)
  if (n === null) return "—"
  return `Rp${n.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".")}`
}
