/**
 * Kahade admin — ringkasan & operasi keuangan.
 *
 * Endpoint: GET/POST `/v1/admin/finance/*`
 * (lihat `backend/src/modules/admin/finance/admin-finance.controller.ts`).
 *
 * Catatan kontrak:
 * - `listTransactions` mewajibkan `startDate` & `endDate` (ISO 8601, rentang
 *   maks 90 hari). Bila tidak diisi, default 30 hari terakhir.
 * - `listTransactions` mendukung pencarian server-side via param `q`
 *   (txId, deskripsi, orderId, midtransOrderId, flashTransactionId,
 *   irisPayoutId, irisRef).
 * - `approveWithdrawal` / `rejectWithdrawal` mewajibkan header
 *   `Idempotency-Key: <UUID v4>` (interceptor idempotency global) — kunci
 *   dibuat per panggilan agar double-tap tidak mengeksekusi dua payout.
 * - Nominal sudah dikonversi backend dari sen (BigInt) ke Rupiah (number).
 */
import {
  adminHttp,
  AdminAuthError,
  getAdminAccessToken,
} from "@/lib/api/admin-client"
import { API_BASE_URL } from "@/lib/api/config"
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
  owner?: AdminTransactionUser | null
  externalRefs?: TransactionExternalRefs | null
  providerStatus?: {
    provider?: string | null
    status?: string | null
    fraudStatus?: string | null
    webhookReceivedAt?: string | null
    paidAt?: string | null
    settledAt?: string | null
    failedAt?: string | null
    expiredAt?: string | null
  } | null
  webhooks?: Array<{
    id: string
    source: string
    event: string
    receivedAt: string
    processingStatus?: string | null
  }>
  paymentTx?: {
    id?: string
    midtransOrderId?: string | null
    flashTransactionId?: string | null
    vaNumber?: string | null
    vaBank?: string | null
    provider?: string | null
    method?: string | null
    status?: string | null
  } | null
  reversalTx?: AdminTransactionItem | null
  reversals?: AdminTransactionItem[]
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
 *
 * Diekspor agar pemanggil bisa memegang satu kunci per sesi aksi
 * (mis. satu dialog Setujui/Tolak) dan memakainya ulang saat retry,
 * sehingga proteksi double-submit tetap berlaku setelah timeout.
 */
export function newIdempotencyKey(): string {
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
   * Pencarian server-side (E3): cocok dengan txId, deskripsi, orderId,
   * midtransOrderId, flashTransactionId, irisPayoutId, atau irisRef.
   */
  q?: string
}

/** Daftar transaksi wallet; `startDate`/`endDate` wajib (default 30 hari terakhir, maks 90 hari). */
export async function listTransactions(
  query: ListTransactionsQuery = {},
): Promise<Paginated<AdminTransactionItem>> {
  const { startDate, endDate, ...rest } = query
  return adminHttp.get<Paginated<AdminTransactionItem>>(
    "/v1/admin/finance/transactions",
    {
      query: {
        ...rest,
        startDate: startDate ?? isoDateDaysAgo(30),
        endDate: endDate ?? new Date().toISOString(),
      },
    },
  )
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
  idempotencyKey?: string,
): Promise<WithdrawalActionResult> {
  return adminHttp.post<WithdrawalActionResult>(
    `/v1/admin/finance/withdrawals/${encodeURIComponent(txId)}/approve`,
    note ? { adminNote: note } : {},
    { headers: { "Idempotency-Key": idempotencyKey ?? newIdempotencyKey() } },
  )
}

/**
 * Tolak penarikan pending dan refund saldo (idempoten).
 * `reason` wajib (min 5 karakter, maks 1000) sesuai WithdrawalRejectDto.
 */
export function rejectWithdrawal(
  txId: string,
  reason: string,
  idempotencyKey?: string,
): Promise<WithdrawalActionResult> {
  return adminHttp.post<WithdrawalActionResult>(
    `/v1/admin/finance/withdrawals/${encodeURIComponent(txId)}/reject`,
    { adminNote: reason },
    { headers: { "Idempotency-Key": idempotencyKey ?? newIdempotencyKey() } },
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
 * Rekonsiliasi satu wallet user: hitung ulang saldo ekspektasi
 * dari transaksi dan bandingkan dengan saldo aktual.
 *
 * E3: hasil selisih kini disimpan sebagai temuan rekonsiliasi
 * (dedup per user) dan dapat dilihat di daftar temuan.
 * Hanya SUPER_ADMIN (lihat backend @AdminRoles).
 */
export function reconcileUser(userId: string): Promise<ReconcileResult> {
  return adminHttp.post<ReconcileResult>(
    `/v1/admin/finance/reconcile/user/${encodeURIComponent(userId)}`,
    {},
  )
}

// ============================================================
// E3 (G326–G350): detail & timeline transaksi, temuan,
// koreksi ledger dual-approval, batch rekonsiliasi.
// ============================================================

export type TimelineEventKind = "LEDGER" | "WEBHOOK" | "PROVIDER" | "REVERSAL"

export type TimelineEvent = {
  at: string
  kind: TimelineEventKind
  label: string
  detail: string | null
}

export type TransactionTimeline = {
  txId: string
  events: TimelineEvent[]
}

export type TransactionExternalRefs = {
  midtransOrderId: string | null
  irisPayoutId: string | null
  irisRef: string | null
  flashTransactionId: string | null
  vaNumber: string | null
  vaBank: string | null
}

/** Timeline kronologis satu transaksi: ledger + provider + webhook + reversal. */
export function getTransactionTimeline(txId: string): Promise<TransactionTimeline> {
  return adminHttp.get<TransactionTimeline>(
    `/v1/admin/finance/transactions/${encodeURIComponent(txId)}/timeline`,
  )
}

export type FindingStatus = "NEW" | "INVESTIGATING" | "RESOLVED" | "ACCEPTED"

export type ReconciliationFinding = {
  id: string
  userId: string
  recordedBalanceIdr: number
  computedBalanceIdr: number
  differenceIdr: number
  urgent: boolean
  violatedInvariants: string[]
  status: FindingStatus
  batchId: string | null
  acknowledgedBy: string | null
  acknowledgedAt: string | null
  notes: string | null
  ageDays: number
  createdAt: string
  updatedAt: string
}

export type FindingsQuery = {
  page?: number
  limit?: number
  status?: FindingStatus
  minDifferenceIdr?: number
  maxAgeDays?: number
  invariant?: string
  urgentOnly?: boolean
}

/** Daftar temuan rekonsiliasi (tanpa PII di payload). */
export function listFindings(
  query: FindingsQuery = {},
): Promise<Paginated<ReconciliationFinding>> {
  return adminHttp.get<Paginated<ReconciliationFinding>>("/v1/admin/finance/findings", {
    query: query as Record<string, string | number | boolean | undefined>,
  })
}

/**
 * Acknowledge temuan: NEW → INVESTIGATING|RESOLVED|ACCEPTED,
 * INVESTIGATING → RESOLVED|ACCEPTED.
 */
export function acknowledgeFinding(
  id: string,
  body: { status: "INVESTIGATING" | "RESOLVED" | "ACCEPTED"; notes?: string },
): Promise<ReconciliationFinding> {
  return adminHttp.post<ReconciliationFinding>(
    `/v1/admin/finance/findings/${encodeURIComponent(id)}/acknowledge`,
    body,
  )
}

/** Unduh CSV temuan (tanpa PII — nama pengguna menjadi inisial). */
export function exportFindingsCsvUrl(query: FindingsQuery = {}): string {
  const params = new URLSearchParams()
  for (const [k, v] of Object.entries(query)) {
    if (v !== undefined && v !== null && v !== "") params.set(k, String(v))
  }
  const qs = params.toString()
  return `/v1/admin/finance/reconcile/findings/export/csv${qs ? `?${qs}` : ""}`
}

export type CorrectionType = "CREDIT" | "DEBIT"
export type CorrectionDecision = "APPROVE" | "REJECT"
export type CorrectionStatus = "PENDING_APPROVAL" | "APPROVED" | "REJECTED"

export type LedgerCorrection = {
  id: string
  userId: string
  amountIdr: number
  type: CorrectionType
  reason: string
  ticketRef: string
  idempotencyKey: string
  status: CorrectionStatus
  requestedBy: string
  requestedAt: string
  decidedBy: string | null
  decidedAt: string | null
  decisionNotes: string | null
  executedTxId: string | null
}

/**
 * Minta kata sandi admin sebelum submit koreksi.
 *
 * PERINGATAN: verifikasi kata sandi ini HANYA di sisi UI (konfirmasi
 * sadar). Verifikasi server-side terhadap hash kata sandi admin BELUM
 * tersedia — dicatat sebagai tindak lanjut (follow-up) di backend.
 */
export type RequestCorrectionInput = {
  userId: string
  amountIdr: number
  type: CorrectionType
  reason: string
  ticketRef: string
  idempotencyKey: string
  /** Diteruskan ke backend; belum diverifikasi server-side (follow-up). */
  reauthToken?: string
}

/**
 * Ajukan koreksi ledger (langkah 1 dari 2). TIDAK memutasi saldo —
 * hanya membuat request PENDING_APPROVAL yang butuh persetujuan
 * admin BERBEDA.
 */
export function requestCorrection(
  input: RequestCorrectionInput,
): Promise<LedgerCorrection> {
  return adminHttp.post<LedgerCorrection>("/v1/admin/finance/corrections", input, {
    headers: { "Idempotency-Key": input.idempotencyKey },
  })
}

/** Daftar pengajuan koreksi (filter status opsional). */
export function listCorrections(
  query: { page?: number; limit?: number; status?: CorrectionStatus } = {},
): Promise<Paginated<LedgerCorrection>> {
  return adminHttp.get<Paginated<LedgerCorrection>>("/v1/admin/finance/corrections", {
    query: query as Record<string, string | number | undefined>,
  })
}

/** Detail satu pengajuan koreksi beserta keputusannya (bila ada). */
export function getCorrection(id: string): Promise<LedgerCorrection> {
  return adminHttp.get<LedgerCorrection>(
    `/v1/admin/finance/corrections/${encodeURIComponent(id)}`,
  )
}

/**
 * Putuskan koreksi (langkah 2 dari 2). APPROVE mengeksekusi mutasi ledger;
 * REJECT membatalkan. Approver HARUS berbeda dari requester (self-approve
 * ditolak 403) — UI menonaktifkan tombol untuk requester sendiri.
 */
export function decideCorrection(
  id: string,
  body: { decision: CorrectionDecision; notes?: string; reauthToken?: string },
  idempotencyKey?: string,
): Promise<LedgerCorrection> {
  return adminHttp.post<LedgerCorrection>(
    `/v1/admin/finance/corrections/${encodeURIComponent(id)}/approve`,
    body,
    { headers: { "Idempotency-Key": idempotencyKey ?? newIdempotencyKey() } },
  )
}

export type ReconciliationBatch = {
  id: string
  startedAt: string
  finishedAt: string
  triggeredBy: string
  checked: number
  clean: number
  problematic: number
  findingsCreated: number
  durationMs: number
}

/** Snapshot batch rekonsiliasi terjadwal (terbaru dulu, maks 20). */
export function listReconciliationBatches(): Promise<{ batches: ReconciliationBatch[] }> {
  return adminHttp.get<{ batches: ReconciliationBatch[] }>(
    "/v1/admin/finance/reconcile/batches",
  )
}

/** Drill-down: temuan yang tercatat untuk satu batch. */
export function getBatchDiscrepancies(
  batchId: string,
  query: { page?: number; limit?: number } = {},
): Promise<Paginated<ReconciliationFinding>> {
  return adminHttp.get<Paginated<ReconciliationFinding>>(
    `/v1/admin/finance/reconcile/batches/${encodeURIComponent(batchId)}/discrepancies`,
    { query: query as Record<string, number | undefined> },
  )
}

/**
 * Unduh CSV temuan rekonsiliasi via jalur authenticated (bearer token +
 * cookie, bukan URL polos). Backend mengembalikan `text/csv` yang memakai
 * inisial — tanpa userId/email/nama.
 */
export function downloadFindingsCsv(query: FindingsQuery = {}): Promise<string> {
  const token = getAdminAccessToken()
  const url = new URL(`${API_BASE_URL}/v1/admin/finance/reconcile/findings/export/csv`)
  if (query.status) url.searchParams.set("status", query.status)
  if (query.urgentOnly) url.searchParams.set("urgentOnly", "true")
  if (query.minDifferenceIdr !== undefined) {
    url.searchParams.set("minDifferenceIdr", String(query.minDifferenceIdr))
  }
  if (query.maxAgeDays !== undefined) {
    url.searchParams.set("maxAgeDays", String(query.maxAgeDays))
  }
  if (query.invariant) url.searchParams.set("invariant", query.invariant)
  return fetch(url.toString(), {
    headers: {
      Accept: "text/csv",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    credentials: "include",
  }).then(async (res) => {
    if (res.status === 401) throw new AdminAuthError()
    if (!res.ok) throw new Error(`Unduhan CSV temuan gagal (${res.status})`)
    return res.text()
  })
}
