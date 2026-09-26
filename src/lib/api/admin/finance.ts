/**
 * Kahade admin — ringkasan & operasi keuangan.
 *
 * Endpoint: GET/POST `/v1/admin/finance/*`
 * (lihat `backend/src/modules/admin/finance/admin-finance.controller.ts`).
 *
 * Catatan kontrak:
 * - `listTransactions` mewajibkan `startDate` & `endDate` (ISO 8601, rentang
 *   maks 90 hari). Bila tidak diisi, default 30 hari terakhir.
 * - Backend TIDAK menyediakan pencarian server-side untuk transaksi; param
 *   `q` difilter client-side terhadap halaman yang diambil ("pencarian
 *   sederhana").
 * - `approveWithdrawal` / `rejectWithdrawal` mewajibkan header
 *   `Idempotency-Key: <UUID v4>` (interceptor idempotency global) — kunci
 *   dibuat per panggilan agar double-tap tidak mengeksekusi dua payout.
 * - Nominal sudah dikonversi backend dari sen (BigInt) ke Rupiah (number).
 */
import { adminHttp } from "@/lib/api/admin-client"
import type { Paginated } from "@/lib/api/admin/kyc"

export type WalletTransactionType =
  | "TOP_UP"
  | "WITHDRAW"
  | "ORDER_LOCK"
  | "ORDER_RELEASE"
  | "ORDER_REFUND"
  | "FEE_DEDUCT"
  | "REFERRAL_REWARD"
  | "SUBSCRIPTION_PAYMENT"
  | "ADMIN_CREDIT"
  | "ADMIN_DEBIT"
  | "DISPUTE_RELEASE"
  | "TRANSFER_SENT"
  | "TRANSFER_RECEIVED"
  | "CAMPAIGN_CASHBACK"
  | "TOPUP_BONUS"

export type WalletTransactionStatus = "PENDING" | "SUCCESS" | "FAILED"

export type WithdrawStatus =
  | "PENDING_OTP"
  | "PENDING_PROCESS"
  | "PROCESSING"
  | "SUCCESS"
  | "FAILED"

export type FinancialSummary = {
  totalTopup: number
  totalTopupCount: number
  totalWithdrawal: number
  totalWithdrawalCount: number
  totalFees: number
  totalFeeCount: number
  totalPlatformFeeToday: number
  totalPlatformFeeThisMonth: number
  totalWithdrawalsToday: number
  totalEscrowBalance: number
  pendingWithdrawals: number
  pendingWithdrawalsAmount: number
}

export type EscrowSummary = {
  totalEscrowBalance: number
  walletsWithEscrow: number
  activeEscrowOrders: number
}

export type RevenueBreakdown = {
  totalRevenue: number
  breakdown: {
    transactionFees: { total: number; count: number }
    subscriptionPayments: { total: number; count: number }
  }
  monthlyRevenue: Array<{
    month: string
    total: number
    count: number
    source: "fee" | "subscription" | string
  }>
}

export type AdminTransactionUser = {
  userId: string
  fullName?: string | null
  email?: string | null
}

export type AdminTransactionItem = {
  id: string
  txId: string
  type: WalletTransactionType | string
  status: WalletTransactionStatus | string
  withdrawStatus?: WithdrawStatus | string | null
  amount: number
  balanceBefore?: number
  balanceAfter?: number
  description?: string | null
  createdAt: string
  wallet?: { userId?: string; user?: AdminTransactionUser | null } | null
  order?: { id?: string; orderId?: string; status?: string } | null
  bankAccount?: {
    id?: string
    bankCode?: string
    accountName?: string | null
    accountNumber?: string | null
  } | null
  [key: string]: unknown
}

export type AdminTransactionDetail = AdminTransactionItem & {
  paymentTx?: {
    id?: string
    midtransOrderId?: string | null
    method?: string | null
    status?: string | null
  } | null
}

export type PendingWithdrawal = AdminTransactionItem & {
  withdrawStatus: WithdrawStatus | string
  wallet: { userId?: string; user?: AdminTransactionUser | null }
}

export type AuditTrailRow = {
  txId: string
  type: string
  status: string
  amount: number
  balanceBefore: number
  balanceAfter: number
  totalBalanceDelta: number
  runningTotalBalance: number
  description: string
  createdAt: string
}

export type AuditTrail = {
  userId: string
  from: string
  to: string
  openingTotalBalance: number
  closingTotalBalance: number
  transactions: AuditTrailRow[]
}

export type WalletDiscrepancy = {
  walletId: string
  userId: string
  actualAvailable: number
  actualEscrow: number
  actualTotal: number
  expectedTotal: number
  discrepancy: number
  invariantViolation: boolean
}

export type ReconcileResult = {
  userId: string
  reconciledAt: string
  clean: boolean
  discrepancy?: WalletDiscrepancy
}

export type WithdrawalActionResult = {
  txId?: string
  status?: string
  [key: string]: unknown
}

/**
 * UUID v4 sederhana untuk `Idempotency-Key`. Tidak memakai
 * `crypto.randomUUID` karena ketersediaannya di Hermes tidak dijamin;
 * keacakan di sini hanya untuk kunci idempotency, bukan keamanan.
 */
function newIdempotencyKey(): string {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = Math.floor(Math.random() * 16)
    const v = c === "x" ? r : (r & 0x3) | 0x8
    return v.toString(16)
  })
}

const idempotencyHeaders = (): Record<string, string> => ({
  "Idempotency-Key": newIdempotencyKey(),
})

function isoDateDaysAgo(days: number): string {
  const d = new Date()
  d.setDate(d.getDate() - days)
  return d.toISOString()
}

/** Ringkasan keuangan agregat (topup, withdrawal, fee, escrow). */
export function getFinancialSummary(): Promise<FinancialSummary> {
  return adminHttp.get<FinancialSummary>("/v1/admin/finance/summary")
}

/** Total escrow aktif di seluruh wallet. */
export function getEscrowSummary(): Promise<EscrowSummary> {
  return adminHttp.get<EscrowSummary>("/v1/admin/finance/escrow-summary")
}

/** Rincian pendapatan platform (fee transaksi + subscription). */
export function getRevenue(): Promise<RevenueBreakdown> {
  return adminHttp.get<RevenueBreakdown>("/v1/admin/finance/revenue")
}

export type ListTransactionsQuery = {
  page?: number
  limit?: number
  type?: WalletTransactionType
  status?: WalletTransactionStatus
  /** Tanggal ISO 8601; wajib di backend — default 30 hari terakhir. */
  startDate?: string
  endDate?: string
  /**
   * Pencarian sederhana (client-side, terhadap halaman yang diambil):
   * cocok dengan txId, deskripsi, nama/email user, atau nominal.
   */
  q?: string
}

/** Daftar transaksi wallet; `startDate`/`endDate` wajib (default 30 hari terakhir, maks 90 hari). */
export async function listTransactions(
  query: ListTransactionsQuery = {},
): Promise<Paginated<AdminTransactionItem>> {
  const { q, startDate, endDate, ...rest } = query
  const page = await adminHttp.get<Paginated<AdminTransactionItem>>(
    "/v1/admin/finance/transactions",
    {
      query: {
        ...rest,
        startDate: startDate ?? isoDateDaysAgo(30),
        endDate: endDate ?? new Date().toISOString(),
      },
    },
  )
  const term = q?.trim().toLowerCase()
  if (!term) return page
  return {
    ...page,
    data: page.data.filter((tx) => {
      const haystack = [
        tx.txId,
        tx.description ?? "",
        String(tx.amount),
        tx.wallet?.user?.fullName ?? "",
        tx.wallet?.user?.email ?? "",
        tx.order?.orderId ?? "",
      ]
        .join(" ")
        .toLowerCase()
      return haystack.includes(term)
    }),
  }
}

/** Detail satu transaksi wallet (termasuk pemilik wallet & entitas terkait). */
export function getTransactionDetail(txId: string): Promise<AdminTransactionDetail> {
  return adminHttp.get<AdminTransactionDetail>(
    `/v1/admin/finance/transactions/${encodeURIComponent(txId)}`,
  )
}

/** Antrean penarikan berstatus pending (terlama dulu). */
export function listPendingWithdrawals(params?: {
  page?: number
  limit?: number
}): Promise<Paginated<PendingWithdrawal>> {
  return adminHttp.get<Paginated<PendingWithdrawal>>(
    "/v1/admin/finance/withdrawals/pending",
    { query: params },
  )
}

/** Setujui penarikan pending (idempoten). Catatan admin opsional. */
export function approveWithdrawal(
  txId: string,
  note?: string,
): Promise<WithdrawalActionResult> {
  return adminHttp.post<WithdrawalActionResult>(
    `/v1/admin/finance/withdrawals/${encodeURIComponent(txId)}/approve`,
    note ? { adminNote: note } : {},
    { headers: idempotencyHeaders() },
  )
}

/**
 * Tolak penarikan pending dan refund saldo (idempoten).
 * `reason` wajib (min 5 karakter, maks 1000) sesuai WithdrawalRejectDto.
 */
export function rejectWithdrawal(
  txId: string,
  reason: string,
): Promise<WithdrawalActionResult> {
  return adminHttp.post<WithdrawalActionResult>(
    `/v1/admin/finance/withdrawals/${encodeURIComponent(txId)}/reject`,
    { adminNote: reason },
    { headers: idempotencyHeaders() },
  )
}

export type AuditTrailQuery = {
  /** ISO 8601 — wajib di backend. */
  from: string
  /** ISO 8601 — wajib di backend (rentang maks 365 hari). */
  to: string
}

/**
 * Jejak audit keuangan satu user: semua transaksi dalam rentang tanggal
 * dengan saldo berjalan per baris.
 */
export function getAuditTrail(
  userId: string,
  query: AuditTrailQuery,
): Promise<AuditTrail> {
  return adminHttp.get<AuditTrail>(
    `/v1/admin/finance/audit-trail/${encodeURIComponent(userId)}`,
    { query: { from: query.from, to: query.to } },
  )
}

/**
 * Rekonsiliasi satu wallet user (SUPER_ADMIN): hitung ulang saldo ekspektasi
 * dari transaksi dan bandingkan dengan saldo aktual.
 */
export function reconcileUser(userId: string): Promise<ReconcileResult> {
  return adminHttp.post<ReconcileResult>(
    `/v1/admin/finance/reconcile/user/${encodeURIComponent(userId)}`,
    {},
  )
}
