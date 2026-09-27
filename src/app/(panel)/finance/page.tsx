/**
 * Admin — Keuangan: ringkasan, antrean penarikan, dan transaksi.
 *
 * - (a) Kartu ringkasan: escrow aktif, revenue hari ini, revenue bulan ini,
 *   antrean penarikan (dari getFinancialSummary + getEscrowSummary).
 * - (b) Antrean withdrawal pending: DataTable + Pagination; tiap baris bisa
 *   Setujui (catatan opsional) / Tolak (alasan min 5 karakter) lewat Dialog.
 *   approveWithdrawal / rejectWithdrawal sudah menyertakan header
 *   `Idempotency-Key` per panggilan (lihat src/lib/api/admin/finance.ts) —
 *   halaman ini tidak perlu meneruskannya manual.
 * - (c) Tabel transaksi: pencarian client-side (debounce ~400ms), filter tipe,
 *   filter rentang tanggal (default 30 hari terakhir, maks 90 hari —
 *   rentang wajib di backend).
 */
"use client"

import { useCallback, useEffect, useRef, useState } from "react"

import { Badge, type BadgeTone } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardBody, CardHeader } from "@/components/ui/card"
import { Dialog } from "@/components/ui/dialog"
import { Input, TextArea } from "@/components/ui/input"
import { Spinner } from "@/components/ui/spinner"
import { DataTable } from "@/components/ui/table"
import { useToast } from "@/components/ui/toast"

import { Pagination } from "@/components/admin/pagination"
import { RoleGate } from "@/components/admin/role-gate"
import { Select } from "@/components/admin/select"
import { AuditTrailPanel } from "./audit-trail-panel"
import { ReconciliationPanel } from "./reconciliation-panel"
import { TransactionDetailDialog } from "./transaction-detail-dialog"

import {
  approveWithdrawal,
  getEscrowSummary,
  getFinancialSummary,
  getRevenue,
  listPendingWithdrawals,
  listTransactions,
  newIdempotencyKey,
  rejectWithdrawal,
  type AdminTransactionItem,
  type EscrowSummary,
  type FinancialSummary,
  type PendingWithdrawal,
  type RevenueBreakdown,
  type WalletTransactionType,
} from "@/lib/api/admin/finance"
import { userMessage } from "@/lib/api/response"
import { formatDateTimeWIB, formatNumber } from "@/lib/format"

const PAGE_SIZE = 20
const PENDING_PAGE_SIZE = 20
const MAX_RANGE_DAYS = 90
const DEFAULT_RANGE_DAYS = 30

/** "Rp1.234.567" — non-finite → "—". */
function formatRupiah(n: unknown): string {
  if (typeof n !== "number" || !Number.isFinite(n)) return "—"
  return `Rp${formatNumber(n)}`
}

function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs)
    return () => clearTimeout(timer)
  }, [value, delayMs])
  return debounced
}

type TxMeta = { label: string; sign: "+" | "−" | "" }

const TX_META: Record<string, TxMeta> = {
  TOP_UP: { label: "Top up", sign: "+" },
  WITHDRAW: { label: "Penarikan", sign: "−" },
  ORDER_LOCK: { label: "Escrow dikunci", sign: "−" },
  ORDER_RELEASE: { label: "Escrow cair", sign: "+" },
  ORDER_REFUND: { label: "Refund order", sign: "+" },
  FEE_DEDUCT: { label: "Fee platform", sign: "−" },
  REFERRAL_REWARD: { label: "Reward referral", sign: "+" },
  SUBSCRIPTION_PAYMENT: { label: "Langganan", sign: "−" },
  ADMIN_CREDIT: { label: "Kredit admin", sign: "+" },
  ADMIN_DEBIT: { label: "Debit admin", sign: "−" },
  DISPUTE_RELEASE: { label: "Cair sengketa", sign: "+" },
  TRANSFER_SENT: { label: "Transfer keluar", sign: "−" },
  TRANSFER_RECEIVED: { label: "Transfer masuk", sign: "+" },
  CAMPAIGN_CASHBACK: { label: "Cashback", sign: "+" },
  TOPUP_BONUS: { label: "Bonus top up", sign: "+" },
}

const TX_STATUS_TONE: Record<string, BadgeTone> = {
  SUCCESS: "success",
  PENDING: "warning",
  FAILED: "danger",
}

const WITHDRAW_STATUS_LABEL: Record<string, string> = {
  PENDING_OTP: "Menunggu OTP",
  PENDING_PROCESS: "Menunggu proses",
  PROCESSING: "Diproses",
  SUCCESS: "Berhasil",
  FAILED: "Gagal",
}

const TYPE_FILTERS: Array<{ value: WalletTransactionType | ""; label: string }> = [
  { value: "", label: "Semua tipe" },
  { value: "TOP_UP", label: "Top up" },
  { value: "WITHDRAW", label: "Penarikan" },
  { value: "ORDER_LOCK", label: "Escrow dikunci" },
  { value: "ORDER_RELEASE", label: "Escrow cair" },
  { value: "ORDER_REFUND", label: "Refund order" },
  { value: "FEE_DEDUCT", label: "Fee platform" },
  { value: "DISPUTE_RELEASE", label: "Cair sengketa" },
]

/** "YYYY-MM-DD" lokal dari Date. */
function dateInputOf(d: Date): string {
  const mm = String(d.getMonth() + 1).padStart(2, "0")
  const dd = String(d.getDate()).padStart(2, "0")
  return `${d.getFullYear()}-${mm}-${dd}`
}

function defaultDateInputs(): { start: string; end: string } {
  const end = new Date()
  const start = new Date()
  start.setDate(start.getDate() - DEFAULT_RANGE_DAYS)
  return { start: dateInputOf(start), end: dateInputOf(end) }
}

/** Input "YYYY-MM-DD" → ISO 8601 (awal/akhir hari waktu lokal). */
function rangeToIso(start: string, end: string): { start: string; end: string } {
  return {
    start: new Date(`${start}T00:00:00`).toISOString(),
    end: new Date(`${end}T23:59:59`).toISOString(),
  }
}

function daysBetween(a: string, b: string): number {
  return Math.round((new Date(b).getTime() - new Date(a).getTime()) / 86_400_000)
}

function StatCard({
  label,
  value,
  hint,
}: {
  label: string
  value: string
  hint?: string
}) {
  return (
    <Card>
      <CardBody>
        <p className="text-caption text-text-secondary">{label}</p>
        <p className="mt-1 text-h3 font-semibold text-text-primary">{value}</p>
        {hint ? (
          <p className="mt-1 text-caption text-text-secondary">{hint}</p>
        ) : null}
      </CardBody>
    </Card>
  )
}

function withdrawUserName(tx: PendingWithdrawal): string {
  return (
    tx.wallet?.user?.fullName ??
    tx.wallet?.user?.email ??
    tx.wallet?.userId ??
    "—"
  )
}

export default function FinancePage() {
  const toast = useToast()

  // Tab: ringkasan+antrean+transaksi vs jejak audit vs rekonsiliasi E3.
  const [activeTab, setActiveTab] = useState<"overview" | "audit" | "rekonsiliasi">("overview")
  // E3: tx yang dibuka di dialog detail (dengan timeline).
  const [detailTxId, setDetailTxId] = useState<string | null>(null)

  // ------------------------------------------------------------------
  // (a) Ringkasan
  // ------------------------------------------------------------------
  const [summary, setSummary] = useState<FinancialSummary | null>(null)
  const [escrow, setEscrow] = useState<EscrowSummary | null>(null)
  // AW-014: revenue breakdown (fee transaksi + pembayaran subscription).
  const [revenue, setRevenue] = useState<RevenueBreakdown | null>(null)
  const [summaryLoading, setSummaryLoading] = useState(true)

  const loadSummary = useCallback(async () => {
    setSummaryLoading(true)
    try {
      const [sum, esc, rev] = await Promise.all([
        getFinancialSummary(),
        getEscrowSummary(),
        getRevenue(),
      ])
      setSummary(sum)
      setEscrow(esc)
      setRevenue(rev)
    } catch (e) {
      toast.show({
        title: "Gagal memuat ringkasan keuangan",
        description: userMessage(e),
        tone: "danger",
      })
    } finally {
      setSummaryLoading(false)
    }
  }, [toast])

  useEffect(() => {
    void loadSummary()
  }, [loadSummary])

  // ------------------------------------------------------------------
  // (b) Antrean penarikan
  // ------------------------------------------------------------------
  const [pendingRows, setPendingRows] = useState<PendingWithdrawal[]>([])
  const [pendingPage, setPendingPage] = useState(1)
  const [pendingTotal, setPendingTotal] = useState(0)
  const [pendingTotalPages, setPendingTotalPages] = useState(1)
  const [pendingLoading, setPendingLoading] = useState(true)

  const loadPending = useCallback(
    async (page: number) => {
      setPendingLoading(true)
      try {
        const res = await listPendingWithdrawals({
          page,
          limit: PENDING_PAGE_SIZE,
        })
        setPendingRows(res.data ?? [])
        const total = res.total ?? res.data?.length ?? 0
        setPendingTotal(total)
        setPendingTotalPages(
          res.totalPages ?? Math.max(1, Math.ceil(total / PENDING_PAGE_SIZE)),
        )
      } catch (e) {
        toast.show({
          title: "Gagal memuat antrean penarikan",
          description: userMessage(e),
          tone: "danger",
        })
      } finally {
        setPendingLoading(false)
      }
    },
    [toast],
  )

  useEffect(() => {
    void loadPending(pendingPage)
  }, [pendingPage, loadPending])

  // Dialog Setujui / Tolak
  const [actionTx, setActionTx] = useState<PendingWithdrawal | null>(null)
  const [actionKind, setActionKind] = useState<"approve" | "reject" | null>(null)
  const [note, setNote] = useState("")
  const [noteError, setNoteError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  // Satu Idempotency-Key per sesi dialog (kind+txId): retry setelah timeout
  // memakai kunci yang sama sehingga proteksi double-submit tetap berlaku.
  // Kunci dihapus setelah sukses agar sesi berikutnya selalu dapat kunci baru.
  const actionKeyRef = useRef(new Map<string, string>())
  const actionKeyFor = (txId: string, kind: "approve" | "reject") => {
    const mapKey = `${kind}:${txId}`
    let key = actionKeyRef.current.get(mapKey)
    if (!key) {
      key = newIdempotencyKey()
      actionKeyRef.current.set(mapKey, key)
    }
    return key
  }

  const openAction = (tx: PendingWithdrawal, kind: "approve" | "reject") => {
    setActionTx(tx)
    setActionKind(kind)
    setNote("")
    setNoteError(null)
  }

  const closeAction = () => {
    if (submitting) return
    setActionTx(null)
    setActionKind(null)
  }

  const handleSubmitAction = useCallback(async () => {
    if (!actionTx || !actionKind || submitting) return
    const trimmed = note.trim()
    if (actionKind === "reject" && trimmed.length < 5) {
      setNoteError("Alasan minimal 5 karakter.")
      return
    }
    setSubmitting(true)
    const mapKey = `${actionKind}:${actionTx.txId}`
    try {
      if (actionKind === "approve") {
        await approveWithdrawal(actionTx.txId, trimmed || undefined, actionKeyFor(actionTx.txId, actionKind))
        toast.show({
          title: "Penarikan disetujui",
          description: formatRupiah(actionTx.amount),
          tone: "success",
        })
      } else {
        await rejectWithdrawal(actionTx.txId, trimmed, actionKeyFor(actionTx.txId, actionKind))
        toast.show({
          title: "Penarikan ditolak, saldo dikembalikan",
          description: formatRupiah(actionTx.amount),
          tone: "success",
        })
      }
      actionKeyRef.current.delete(mapKey)
      setActionTx(null)
      setActionKind(null)
      setNote("")
      await loadSummary()
      await loadPending(pendingPage)
    } catch (e) {
      toast.show({
        title: "Gagal memproses penarikan",
        description: userMessage(e),
        tone: "danger",
      })
    } finally {
      setSubmitting(false)
    }
  }, [actionTx, actionKind, submitting, note, toast, loadSummary, loadPending, pendingPage])

  // ------------------------------------------------------------------
  // (c) Tabel transaksi
  // ------------------------------------------------------------------
  const [search, setSearch] = useState("")
  const debouncedSearch = useDebouncedValue(search, 400)
  const [typeFilter, setTypeFilter] = useState<WalletTransactionType | "">("")
  const [dateInputs, setDateInputs] = useState(defaultDateInputs)
  const [dateError, setDateError] = useState<string | null>(null)
  const [range, setRange] = useState(() =>
    rangeToIso(dateInputs.start, dateInputs.end),
  )

  const [txRows, setTxRows] = useState<AdminTransactionItem[]>([])
  const [txPage, setTxPage] = useState(1)
  const [txTotal, setTxTotal] = useState(0)
  const [txTotalPages, setTxTotalPages] = useState(1)
  const [txLoading, setTxLoading] = useState(true)

  const loadTransactions = useCallback(
    async (page: number) => {
      setTxLoading(true)
      try {
        const res = await listTransactions({
          page,
          limit: PAGE_SIZE,
          type: typeFilter || undefined,
          q: debouncedSearch.trim() || undefined,
          startDate: range.start,
          endDate: range.end,
        })
        setTxRows(res.data ?? [])
        const total = res.total ?? res.data?.length ?? 0
        setTxTotal(total)
        setTxTotalPages(
          res.totalPages ?? Math.max(1, Math.ceil(total / PAGE_SIZE)),
        )
      } catch (e) {
        toast.show({
          title: "Gagal memuat transaksi",
          description: userMessage(e),
          tone: "danger",
        })
      } finally {
        setTxLoading(false)
      }
    },
    [debouncedSearch, typeFilter, range, toast],
  )

  useEffect(() => {
    void loadTransactions(txPage)
  }, [txPage, loadTransactions])

  const handleTypeChange = (value: string) => {
    setTypeFilter(value as WalletTransactionType | "")
    setTxPage(1)
  }

  const handleDateChange = (nextStart: string, nextEnd: string) => {
    setDateInputs({ start: nextStart, end: nextEnd })
    if (!nextStart || !nextEnd) {
      setDateError("Isi tanggal mulai dan tanggal selesai.")
      return
    }
    if (nextStart > nextEnd) {
      setDateError("Tanggal mulai tidak boleh setelah tanggal selesai.")
      return
    }
    if (daysBetween(nextStart, nextEnd) > MAX_RANGE_DAYS) {
      setDateError(`Rentang tanggal maksimal ${MAX_RANGE_DAYS} hari.`)
      return
    }
    setDateError(null)
    setRange(rangeToIso(nextStart, nextEnd))
    setTxPage(1)
  }

  const handleRefresh = () => {
    void loadSummary()
    void loadPending(pendingPage)
    void loadTransactions(txPage)
  }

  const refreshing = summaryLoading || pendingLoading || txLoading
  const actionTitle =
    actionKind === "reject" ? "Tolak penarikan" : "Setujui penarikan"

  return (
    <RoleGate href="/finance">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-h2 font-bold text-text-primary">Keuangan</h1>
          <p className="mt-1 text-body text-text-secondary">
            Ringkasan, antrean penarikan, dan riwayat transaksi wallet.
          </p>
        </div>
        <Button
          variant="secondary"
          size="sm"
          fullWidth={false}
          loading={refreshing}
          onClick={handleRefresh}
        >
          Muat ulang
        </Button>
      </div>

      {/* Tab navigasi */}
      <div className="mb-6 flex gap-2" role="tablist" aria-label="Navigasi keuangan">
        {(
          [
            { id: "overview", label: "Ringkasan & Transaksi" },
            { id: "audit", label: "Jejak Audit" },
            { id: "rekonsiliasi", label: "Rekonsiliasi" },
          ] as const
        ).map((tab) => (
          <Button
            key={tab.id}
            variant={activeTab === tab.id ? "primary" : "secondary"}
            size="sm"
            fullWidth={false}
            onClick={() => setActiveTab(tab.id)}
            role="tab"
            aria-selected={activeTab === tab.id}
          >
            {tab.label}
          </Button>
        ))}
      </div>

      {activeTab === "audit" ? (
        <AuditTrailPanel />
      ) : activeTab === "rekonsiliasi" ? (
        <ReconciliationPanel />
      ) : (
        <>
      {/* (a) Ringkasan */}
      <section aria-label="Ringkasan keuangan">
        <h2 className="mb-3 text-h3 font-semibold text-text-primary">Ringkasan</h2>
        {summaryLoading && !summary ? (
          <div className="flex items-center gap-2 py-6 text-body text-text-secondary">
            <Spinner size="sm" />
            Memuat ringkasan…
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard
              label="Escrow aktif"
              value={formatRupiah(escrow?.totalEscrowBalance)}
              hint={`${formatNumber(escrow?.activeEscrowOrders ?? 0)} order aktif`}
            />
            <StatCard
              label="Revenue hari ini"
              value={formatRupiah(summary?.totalPlatformFeeToday)}
              hint="Fee platform"
            />
            <StatCard
              label="Revenue bulan ini"
              value={formatRupiah(summary?.totalPlatformFeeThisMonth)}
              hint="Fee platform"
            />
            <StatCard
              label="Antrean penarikan"
              value={formatRupiah(summary?.pendingWithdrawalsAmount)}
              hint={`${formatNumber(summary?.pendingWithdrawals ?? 0)} menunggu persetujuan`}
            />
          </div>
        )}
      </section>

      {/* (a2) Revenue platform — AW-014: getRevenue() sebelumnya tidak dipakai */}
      <section aria-label="Revenue platform" className="mt-8">
        <h2 className="mb-3 text-h3 font-semibold text-text-primary">Revenue platform</h2>
        {summaryLoading && !revenue ? (
          <div className="flex items-center gap-2 py-6 text-body text-text-secondary">
            <Spinner size="sm" />
            Memuat revenue…
          </div>
        ) : revenue ? (
          <>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <StatCard
                label="Total revenue"
                value={formatRupiah(revenue.totalRevenue)}
                hint="Fee transaksi + subscription"
              />
              <StatCard
                label="Fee transaksi"
                value={formatRupiah(revenue.breakdown?.transactionFees?.total)}
                hint={`${formatNumber(revenue.breakdown?.transactionFees?.count ?? 0)} order selesai`}
              />
              <StatCard
                label="Pembayaran subscription"
                value={formatRupiah(revenue.breakdown?.subscriptionPayments?.total)}
                hint={`${formatNumber(revenue.breakdown?.subscriptionPayments?.count ?? 0)} pembayaran`}
              />
            </div>
            {revenue.monthlyRevenue && revenue.monthlyRevenue.length > 0 ? (
              <Card className="mt-4">
                <CardHeader title="Revenue per bulan" />
                <CardBody>
                  <DataTable<{ month: string; total: number; count: number; source: string }>
                    columns={[
                      {
                        key: "month",
                        header: "Bulan",
                        render: (r) => String(r.month).slice(0, 7),
                      },
                      {
                        key: "total",
                        header: "Total",
                        align: "right",
                        render: (r) => (
                          <span className="font-semibold">{formatRupiah(r.total)}</span>
                        ),
                      },
                      {
                        key: "count",
                        header: "Transaksi",
                        align: "right",
                        render: (r) => formatNumber(r.count),
                      },
                      {
                        key: "source",
                        header: "Sumber",
                        render: (r) => (
                          <Badge tone={r.source === "subscription" ? "info" : "neutral"}>
                            {r.source === "subscription" ? "Subscription" : "Fee transaksi"}
                          </Badge>
                        ),
                      },
                    ]}
                    rows={revenue.monthlyRevenue}
                    rowKey={(r, i) => `${r.month}-${r.source}-${i}`}
                  />
                </CardBody>
              </Card>
            ) : null}
          </>
        ) : (
          <p className="py-4 text-body text-text-secondary">
            Data revenue tidak tersedia.
          </p>
        )}
      </section>

      {/* (b) Antrean penarikan */}
      <section aria-label="Antrean penarikan" className="mt-8">
        <Card>
          <CardHeader
            title="Antrean penarikan"
            subtitle={
              pendingTotal > 0
                ? `${pendingTotal.toLocaleString("id-ID")} menunggu persetujuan`
                : undefined
            }
          />
          <CardBody>
            <DataTable<PendingWithdrawal>
              columns={[
                {
                  key: "user",
                  header: "Pengguna",
                  render: (r) => (
                    <div>
                      <p className="font-semibold">{withdrawUserName(r)}</p>
                      {r.wallet?.user?.email ? (
                        <p className="text-caption text-text-secondary">
                          {r.wallet.user.email}
                        </p>
                      ) : null}
                    </div>
                  ),
                },
                {
                  key: "bankAccount",
                  header: "Rekening tujuan",
                  render: (r) => (
                    <div>
                      <p>
                        {r.bankAccount?.bankCode ?? "—"} ·{" "}
                        {r.bankAccount?.accountNumber
                          ? `••••${r.bankAccount.accountNumber.slice(-4)}`
                          : "—"}
                      </p>
                      {r.bankAccount?.accountName ? (
                        <p className="text-caption text-text-secondary">
                          {r.bankAccount.accountName}
                        </p>
                      ) : null}
                    </div>
                  ),
                },
                {
                  key: "amount",
                  header: "Nominal",
                  align: "right",
                  render: (r) => (
                    <span className="font-semibold">
                      {formatRupiah(r.amount)}
                    </span>
                  ),
                },
                {
                  key: "withdrawStatus",
                  header: "Status",
                  render: (r) => {
                    const status = String(r.withdrawStatus)
                    const tone =
                      status === "PENDING_OTP" || status === "PENDING_PROCESS"
                        ? "warning"
                        : status === "PROCESSING" || status === "COMPLETED" || status === "SUCCESS"
                          ? "success"
                          : "danger"
                    return (
                      <Badge tone={tone}>
                        {WITHDRAW_STATUS_LABEL[status] ?? status}
                      </Badge>
                    )
                  },
                },
                {
                  key: "createdAt",
                  header: "Diajukan",
                  render: (r) => formatDateTimeWIB(r.createdAt),
                },
                {
                  key: "action",
                  header: "",
                  align: "right",
                  // Tombol aksi hanya untuk baris yang masih pending —
                  // pertahanan UI agar baris non-pending tidak bisa di-aksi.
                  render: (r) => {
                    const status = String(r.withdrawStatus)
                    if (status !== "PENDING_PROCESS" && status !== "PENDING_OTP") return null
                    return (
                      <div className="flex justify-end gap-2">
                        <Button
                          variant="secondary"
                          size="sm"
                          fullWidth={false}
                          onClick={() => openAction(r, "reject")}
                        >
                          Tolak
                        </Button>
                        <Button
                          variant="primary"
                          size="sm"
                          fullWidth={false}
                          onClick={() => openAction(r, "approve")}
                        >
                          Setujui
                        </Button>
                      </div>
                    )
                  },
                },
              ]}
              rows={pendingRows}
              rowKey={(r) => r.txId}
              loading={pendingLoading}
              emptyText="Tidak ada penarikan yang menunggu persetujuan."
            />
            <div className="mt-4">
              <Pagination
                ariaLabel="Paginasi antrean penarikan"
                page={pendingPage}
                totalPages={pendingTotalPages}
                total={pendingTotal}
                pageSize={PENDING_PAGE_SIZE}
                onPageChange={setPendingPage}
                disabled={pendingLoading}
              />
            </div>
          </CardBody>
        </Card>
      </section>

      {/* (c) Tabel transaksi */}
      <section aria-label="Transaksi" className="mt-8">
        <Card>
          <CardHeader
            title="Transaksi"
            subtitle="Pencarian server-side: txId, deskripsi, order, referensi eksternal (Midtrans/Flash/Iris). Klik Detail untuk timeline."
          />
          <CardBody>
            <div className="mb-4 grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
              <Input
                label="Cari"
                placeholder="Cari txId, nama, nominal…"
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value)
                  setTxPage(1)
                }}
              />
              <Select
                label="Tipe"
                value={typeFilter}
                onChange={(e) => handleTypeChange(e.target.value)}
                options={TYPE_FILTERS}
              />
              <Input
                label="Dari"
                type="date"
                value={dateInputs.start}
                max={dateInputs.end || undefined}
                onChange={(e) => handleDateChange(e.target.value, dateInputs.end)}
              />
              <Input
                label="Sampai"
                type="date"
                value={dateInputs.end}
                min={dateInputs.start || undefined}
                onChange={(e) => handleDateChange(dateInputs.start, e.target.value)}
                error={dateError ?? undefined}
              />
            </div>

            <DataTable<AdminTransactionItem>
              columns={[
                {
                  key: "type",
                  header: "Tipe",
                  render: (r) => {
                    const meta = TX_META[String(r.type)] ?? {
                      label: String(r.type),
                      sign: "" as const,
                    }
                    return (
                      <div>
                        <p className="font-semibold">{meta.label}</p>
                        <p className="text-caption text-text-secondary">
                          {r.txId}
                        </p>
                      </div>
                    )
                  },
                },
                {
                  key: "user",
                  header: "Pengguna",
                  render: (r) =>
                    r.wallet?.user?.fullName ??
                    r.wallet?.user?.email ??
                    "—",
                },
                {
                  key: "description",
                  header: "Deskripsi",
                  render: (r) => (
                    <span className="block max-w-xs truncate">
                      {r.description ?? "—"}
                    </span>
                  ),
                },
                {
                  key: "order",
                  header: "Order",
                  render: (r) => r.order?.orderId ?? "—",
                },
                {
                  key: "amount",
                  header: "Nominal",
                  align: "right",
                  render: (r) => {
                    const meta = TX_META[String(r.type)] ?? { sign: "" as const }
                    return (
                      <span
                        className={
                          meta.sign === "+"
                            ? "font-semibold text-success-text"
                            : "font-semibold"
                        }
                      >
                        {meta.sign}
                        {formatRupiah(r.amount)}
                      </span>
                    )
                  },
                },
                {
                  key: "status",
                  header: "Status",
                  render: (r) => (
                    <Badge tone={TX_STATUS_TONE[String(r.status)] ?? "neutral"}>
                      {String(r.status)}
                    </Badge>
                  ),
                },
                {
                  key: "createdAt",
                  header: "Waktu",
                  render: (r) => formatDateTimeWIB(r.createdAt),
                },
                {
                  key: "aksi",
                  header: "Aksi",
                  render: (r) => (
                    <Button variant="secondary" size="sm" fullWidth={false} onClick={() => setDetailTxId(r.txId)}>
                      Detail
                    </Button>
                  ),
                },
              ]}
              rows={txRows}
              rowKey={(r) => r.txId}
              loading={txLoading}
              emptyText="Tidak ada transaksi pada rentang & filter ini."
            />
            <div className="mt-4">
              <Pagination
                ariaLabel="Paginasi riwayat transaksi"
                page={txPage}
                totalPages={txTotalPages}
                total={txTotal}
                pageSize={PAGE_SIZE}
                onPageChange={setTxPage}
                disabled={txLoading}
              />
            </div>
          </CardBody>
        </Card>
      </section>
        </>
      )}

      {/* E3: Dialog detail transaksi + timeline */}
      <TransactionDetailDialog txId={detailTxId} onClose={() => setDetailTxId(null)} />

      {/* Dialog Setujui / Tolak penarikan */}
      <Dialog
        open={actionTx !== null}
        onClose={closeAction}
        title={actionTitle}
        description={
          actionTx
            ? `${withdrawUserName(actionTx)} • ${formatRupiah(actionTx.amount)}`
            : undefined
        }
        footer={
          <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
            <Button
              variant="ghost"
              fullWidth={false}
              disabled={submitting}
              onClick={closeAction}
            >
              Batal
            </Button>
            <Button
              variant={actionKind === "reject" ? "destructive" : "primary"}
              fullWidth={false}
              loading={submitting}
              onClick={() => void handleSubmitAction()}
            >
              {actionKind === "reject" ? "Tolak penarikan" : "Setujui penarikan"}
            </Button>
          </div>
        }
      >
        {actionKind === "reject" ? (
          <p className="text-body text-text-secondary">
            Penarikan yang ditolak akan mengembalikan saldo ke wallet pengguna.
            Tulis alasan yang jelas.
          </p>
        ) : (
          <p className="text-body text-text-secondary">
            Penarikan yang disetujui akan diproses ke rekening tujuan. Tindakan
            ini tidak bisa dibatalkan.
          </p>
        )}
        <div className="mt-4">
          <TextArea
            label={actionKind === "reject" ? "Alasan penolakan" : "Catatan (opsional)"}
            required={actionKind === "reject"}
            rows={3}
            value={note}
            onChange={(e) => {
              setNote(e.target.value)
              if (noteError) setNoteError(null)
            }}
            error={noteError ?? undefined}
            placeholder={
              actionKind === "reject"
                ? "Contoh: nama rekening tidak sesuai…"
                : "Contoh: disetujui setelah verifikasi…"
            }
          />
        </div>
      </Dialog>
    </RoleGate>
  )
}
