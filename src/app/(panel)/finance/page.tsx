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

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react"

import { Badge, type BadgeTone } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardBody, CardHeader } from "@/components/ui/card"
import { ConfirmDialog, Dialog } from "@/components/ui/dialog"
import { Input, TextArea } from "@/components/ui/input"
import { Spinner } from "@/components/ui/spinner"
import { DataTable } from "@/components/ui/table"
import { useToast } from "@/components/ui/toast"

import { Pagination } from "@/components/admin/pagination"
import { RoleGate } from "@/components/admin/role-gate"
import { Select } from "@/components/admin/select"
// H05: step-up re-auth sebelum approve/tolak penarikan (parsial —
// enforcement server per aksi belum ada).
import { ReauthDialog, useReauthGate } from "@/components/admin/batch139/reauth-gate"
// H01: filter transaksi di URL. H02: preferensi kolom per admin.
import { parsePage, useUrlFilters } from "@/components/admin/batch139/use-url-filters"
import {
  ColumnCustomizer,
  useColumnPrefs,
  type PrefsColumnDef,
} from "@/components/admin/batch139/column-prefs"
import { AuditTrailPanel } from "./audit-trail-panel"
import { ReconciliationPanel } from "./reconciliation-panel"
import { TransactionDetailDialog } from "./transaction-detail-dialog"

import {
  approveWithdrawal,
  getEscrowSummary,
  getFinancialSummary,
  getRevenue,
  getTransactionsSummary,
  listPendingWithdrawals,
  listTransactions,
  newIdempotencyKey,
  rejectWithdrawal,
  type AdminTransactionItem,
  type EscrowSummary,
  type FinancialSummary,
  type PendingWithdrawal,
  type RevenueBreakdown,
  type TransactionsAggregate,
  type WalletTransactionStatus,
  type WalletTransactionType,
  downloadFinanceCsv,
  recheckWithdrawal,
  type WithdrawalRecheckResult,
} from "@/lib/api/admin/finance"
import { userMessage } from "@/lib/api/response"
import { TX_META, txLabel } from "@/lib/tx-labels"
import { formatDateTimeWIB, formatNumber } from "@/lib/format"
// ADM-405: PII (nama, email, rekening) di-mask secara default — mask-only, tanpa unmask.
import { maskAccountNumber, maskEmail, maskName } from "@/lib/pii"

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

// ADM-214: filter status transaksi (backend `listTransactions` mendukung `status`).
const TX_STATUS_FILTERS: Array<{ value: WalletTransactionStatus | ""; label: string }> = [
  { value: "", label: "Semua status" },
  { value: "PENDING", label: "Menunggu" },
  { value: "SUCCESS", label: "Berhasil" },
  { value: "FAILED", label: "Gagal" },
]

const TYPE_FILTERS: Array<{ value: WalletTransactionType | ""; label: string }> = [
  { value: "", label: "Semua tipe" },
  { value: "TOP_UP", label: "Top up" },
  // DSC-012: "Penarikan" (noun) disengaja — judul aksi di mobile adalah
  // "Tarik Dana" (verb, app/withdraw.tsx). Bukan inkonsistensi.
  // Glosarium arus uang: "Pencairan" = disbursement DANA ke penjual
  // (ORDER_RELEASE / DISPUTE_RELEASE) — jangan disebut "Payout";
  // "Dana dikembalikan" = refund ke pembeli (ORDER_REFUND);
  // provider pembayaran satu-satunya: "DANA" (bukan Flash).
  { value: "WITHDRAW", label: "Penarikan" },
  { value: "ORDER_LOCK", label: "Escrow dikunci" },
  { value: "ORDER_RELEASE", label: "Dana dicairkan ke penjual" },
  { value: "ORDER_REFUND", label: "Dana order dikembalikan" },
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
  // ADM-405: nama/email pemilik wallet di-mask; fallback ke userId bila keduanya kosong.
  const masked = maskName(tx.wallet?.user?.fullName ?? null)
  return (
    (masked !== "—" ? masked : null) ??
    (tx.wallet?.user?.email ? maskEmail(tx.wallet.user.email) : null) ??
    tx.wallet?.userId ??
    "—"
  )
}

export default function FinancePage() {
  return (
    <Suspense>
      <FinancePageInner />
    </Suspense>
  )
}

function FinancePageInner() {
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
  // H05: re-auth gate untuk aksi penarikan kritis.
  const reauth = useReauthGate()
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
        const res = await approveWithdrawal(actionTx.txId, trimmed || undefined, actionKeyFor(actionTx.txId, actionKind))
        // ADM-205: persetujuan pertama belum mengeksekusi payout.
        if (res?.status === "AWAITING_SECOND_APPROVAL") {
          toast.show({
            title: "Persetujuan tercatat",
            description:
              res.message ??
              `Menunggu persetujuan ${(res.requiredApprovals ?? 2) - (res.approvals ?? 1)} admin lain sebelum pencairan dieksekusi.`,
            tone: "info",
          })
        } else {
          toast.show({
            title: res?.status === "ALREADY_EXECUTED" ? "Pencairan sudah dieksekusi" : "Penarikan disetujui",
            description: formatRupiah(actionTx.amount),
            tone: "success",
          })
        }
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
  // H01: pencarian/tipe/status/halaman disinkronkan ke URL.
  const { values: f, set: setF } = useUrlFilters({ q: "", type: "", status: "", txPage: "1" })
  const [searchInput, setSearchInput] = useState(f.q)
  const debouncedSearch = useDebouncedValue(searchInput, 400)
  const typeFilter = (f.type || "") as WalletTransactionType | ""
  // ADM-214
  const txStatusFilter = (f.status || "") as WalletTransactionStatus | ""
  const txPage = parsePage(f.txPage)

  // Komit pencarian debounce ke URL (+ reset ke halaman 1).
  useEffect(() => {
    if (debouncedSearch !== f.q) setF({ q: debouncedSearch, txPage: "1" })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedSearch])

  const [dateInputs, setDateInputs] = useState(defaultDateInputs)
  const [dateError, setDateError] = useState<string | null>(null)
  const [range, setRange] = useState(() =>
    rangeToIso(dateInputs.start, dateInputs.end),
  )

  const [txRows, setTxRows] = useState<AdminTransactionItem[]>([])
  const [txTotal, setTxTotal] = useState(0)
  const [txTotalPages, setTxTotalPages] = useState(1)
  const [txLoading, setTxLoading] = useState(true)
  // Baris agregat masuk/keluar/bersih — mengikuti filter aktif.
  // AW-002 (perf-fix): dihitung SERVER-SIDE via /transactions/summary dari
  // SEMUA transaksi yang cocok filter (tanpa clamp). Pola lama (fetch massal
  // lalu jumlahkan di browser) SALAH DIAM-DIAM karena backend clamp limit=100.
  const [txAggregate, setTxAggregate] = useState<TransactionsAggregate | null>(
    null,
  )
  const [aggLoading, setAggLoading] = useState(false)

  const loadAggregate = useCallback(
    async (params: {
      type?: WalletTransactionType
      status?: WalletTransactionStatus
      q?: string
      startDate: string
      endDate: string
    }) => {
      setAggLoading(true)
      try {
        // Fail-closed: agregat gagal → tampilkan indikator error, JANGAN angka salah.
        const agg = await getTransactionsSummary(params)
        setTxAggregate(agg)
      } catch {
        setTxAggregate(null)
      } finally {
        setAggLoading(false)
      }
    },
    [],
  )

  const loadTransactions = useCallback(
    async (page: number) => {
      setTxLoading(true)
      try {
        const params = {
          type: typeFilter || undefined,
          status: txStatusFilter || undefined,
          // H01: pakai pencarian yang sudah terkomit ke URL.
          q: f.q.trim() || undefined,
          startDate: range.start,
          endDate: range.end,
        }
        const res = await listTransactions({ ...params, page, limit: PAGE_SIZE })
        setTxRows(res.data ?? [])
        const total = res.total ?? res.data?.length ?? 0
        setTxTotal(total)
        setTxTotalPages(
          res.totalPages ?? Math.max(1, Math.ceil(total / PAGE_SIZE)),
        )
        void loadAggregate(params)
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
    [typeFilter, txStatusFilter, f.q, range, toast, loadAggregate],
  )

  useEffect(() => {
    void loadTransactions(txPage)
  }, [txPage, loadTransactions])

  const handleTypeChange = (value: string) => {
    setF({ type: value, txPage: "1" })
  }

  // ADM-214: filter status transaksi
  const handleTxStatusChange = (value: string) => {
    setF({ status: value, txPage: "1" })
  }

  // ADM-213: recheck manual SATU withdrawal PROCESSING (bukan retry payout).
  const [recheckTx, setRecheckTx] = useState<AdminTransactionItem | null>(null)
  const [rechecking, setRechecking] = useState(false)
  const [recheckKey, setRecheckKey] = useState<string | null>(null)
  const openRecheck = (r: AdminTransactionItem) => {
    setRecheckTx(r)
    setRecheckKey(newIdempotencyKey())
  }
  const closeRecheck = () => {
    if (rechecking) return
    setRecheckTx(null)
    setRecheckKey(null)
  }
  const handleRecheck = async () => {
    if (!recheckTx || rechecking) return
    setRechecking(true)
    try {
      const res: WithdrawalRecheckResult = await recheckWithdrawal(
        recheckTx.txId,
        recheckKey ?? undefined,
      )
      const outcomeMsg: Record<string, string> = {
        CONFIRMED: `Payout dikonfirmasi provider (${res.providerStatus}) — status SUCCESS.`,
        FAILED_REFUNDED: `Payout dinyatakan gagal oleh provider (${res.providerStatus}) — dana dikembalikan ke wallet.`,
        STILL_PROCESSING: `Masih diproses provider (${res.providerStatus}) — tetap PROCESSING, tanpa perubahan.`,
        UNKNOWN: `Status tidak diketahui provider (${res.providerStatus}) — tetap PROCESSING, perlu investigasi manual.`,
      }
      toast.show({
        title: "Hasil cek status payout",
        description: outcomeMsg[String(res.outcome)] ?? String(res.outcome ?? "—"),
        tone: res.outcome === "FAILED_REFUNDED" ? "danger" : res.outcome === "CONFIRMED" ? "success" : "info",
      })
      setRecheckTx(null)
      setRecheckKey(null)
      void loadTransactions(txPage)
    } catch (e) {
      toast.show({
        title: "Gagal mengecek status payout",
        description: userMessage(e),
        tone: "danger",
      })
    } finally {
      setRechecking(false)
    }
  }

  // ADM-215: unduh export CSV ledger (terotentikasi, rentang = filter tanggal).
  const [csvLoading, setCsvLoading] = useState(false)
  const handleCsvExport = async () => {
    setCsvLoading(true)
    try {
      await downloadFinanceCsv(range.start, range.end)
      toast.show({
        title: "CSV diunduh",
        description: "Export ledger untuk rentang tanggal terpilih.",
        tone: "success",
      })
    } catch (e) {
      toast.show({
        title: "Gagal mengunduh CSV",
        description: userMessage(e),
        tone: "danger",
      })
    } finally {
      setCsvLoading(false)
    }
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
    setF({ txPage: "1" })
  }

  const handleRefresh = () => {
    void loadSummary()
    void loadPending(pendingPage)
    void loadTransactions(txPage)
  }

  const refreshing = summaryLoading || pendingLoading || txLoading
  const actionTitle =
    actionKind === "reject" ? "Tolak penarikan" : "Setujui penarikan"


  // H02: kolom bisa dipilih/diurutkan — preferensi per admin (localStorage).
  const pendingColumnDefs: PrefsColumnDef<PendingWithdrawal>[] = [
                {
                  key: "user",
                  header: "Pengguna",
                  render: (r) => (
                    <div>
                      <p className="font-semibold">{withdrawUserName(r)}</p>
                      {r.wallet?.user?.email ? (
                        <p className="text-caption text-text-secondary">
                          {maskEmail(r.wallet.user.email)}
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
                        {maskAccountNumber(r.bankAccount?.accountNumber)}
                      </p>
                      {r.bankAccount?.accountName ? (
                        <p className="text-caption text-text-secondary">
                          {maskName(r.bankAccount.accountName)}
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
                    // ADM-207: PENDING_OTP tidak punya aksi — backend menolaknya
                    // (400). Tampilkan label status, bukan tombol rusak.
                    if (status === "PENDING_OTP") {
                      return (
                        <span className="text-caption text-text-secondary">
                          Menunggu OTP pengguna
                        </span>
                      )
                    }
                    if (status !== "PENDING_PROCESS") return null
                    // ADM-205: tampilkan kuorum dual approval; admin yang sudah
                    // menyetujui tidak bisa menyetujui lagi.
                    const info = r.approvalInfo
                    const quorum = info
                      ? `${info.approvals}/${info.requiredApprovals} persetujuan`
                      : null
                    return (
                      <div className="flex flex-col items-end gap-1">
                        {quorum ? (
                          <span className="text-caption text-text-secondary">{quorum}</span>
                        ) : null}
                        <div className="flex justify-end gap-2">
                          <Button
                            variant="secondary"
                            size="sm"
                            fullWidth={false}
                            onClick={() => openAction(r, "reject")}
                          >
                            Tolak
                          </Button>
                          {info?.approvedByMe ? (
                            <Button
                              variant="secondary"
                              size="sm"
                              fullWidth={false}
                              disabled
                              title="Anda sudah menyetujui — menunggu admin lain"
                            >
                              Sudah disetujui ✓
                            </Button>
                          ) : (
                            <Button
                              variant="primary"
                              size="sm"
                              fullWidth={false}
                              onClick={() => openAction(r, "approve")}
                            >
                              Setujui
                            </Button>
                          )}
                        </div>
                      </div>
                    )
                  },
                },
              ]
  const pendingCols = useColumnPrefs("finance-pending", pendingColumnDefs)
  const txColumnDefs: PrefsColumnDef<AdminTransactionItem>[] = [
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
                    <div className="flex justify-end gap-2">
                      <Button variant="secondary" size="sm" fullWidth={false} onClick={() => setDetailTxId(r.txId)}>
                        Detail
                      </Button>
                      {/* ADM-213: recheck manual — hanya untuk PROCESSING; bukan retry payout */}
                      {String(r.withdrawStatus) === "PROCESSING" ? (
                        <Button
                          variant="secondary"
                          size="sm"
                          fullWidth={false}
                          onClick={() => openRecheck(r)}
                          title="Tanyakan status payout ke Midtrans Iris. Tidak mengirim payout baru."
                        >
                          Cek status
                        </Button>
                      ) : null}
                    </div>
                  ),
                },
              ]
  const txCols = useColumnPrefs("finance-tx", txColumnDefs)

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
            {/* ADM-211: revenue gabungan (fee + langganan) dengan breakdown — kartu
                lama hanya menampilkan fee platform sehingga pendapatan mengecil. */}
            <StatCard
              label="Revenue hari ini"
              value={formatRupiah(summary?.totalRevenueToday)}
              hint={`Fee ${formatRupiah(summary?.totalPlatformFeeToday)} + langganan ${formatRupiah(summary?.totalSubscriptionRevenueToday)}`}
            />
            <StatCard
              label="Revenue bulan ini"
              value={formatRupiah(summary?.totalRevenueThisMonth)}
              hint={`Fee ${formatRupiah(summary?.totalPlatformFeeThisMonth)} + langganan ${formatRupiah(summary?.totalSubscriptionRevenueThisMonth)}`}
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
            <div className="mb-4 flex justify-end">
              {/* H02: kustomisasi kolom antrean penarikan. */}
              <Button
                variant="secondary"
                size="sm"
                fullWidth={false}
                onClick={() => pendingCols.setCustomizerOpen(true)}
              >
                Kolom
              </Button>
            </div>
            <DataTable<PendingWithdrawal>
              columns={pendingCols.visible}
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
            action={
              <Button
                variant="secondary"
                size="sm"
                fullWidth={false}
                loading={csvLoading}
                onClick={() => void handleCsvExport()}
                title="Unduh export CSV ledger untuk rentang tanggal terpilih"
              >
                Unduh CSV
              </Button>
            }
          />
          <CardBody>
            <div className="mb-4 flex justify-end">
              {/* H02: kustomisasi kolom tabel transaksi. */}
              <Button
                variant="secondary"
                size="sm"
                fullWidth={false}
                onClick={() => txCols.setCustomizerOpen(true)}
              >
                Kolom
              </Button>
            </div>
            <div className="mb-4 grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-5">
              <Input
                label="Cari"
                placeholder="Cari txId, nama, nominal…"
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
              />
              <Select
                label="Tipe"
                value={typeFilter}
                onChange={(e) => handleTypeChange(e.target.value)}
                options={TYPE_FILTERS}
              />
              {/* ADM-214: filter status */}
              <Select
                label="Status"
                value={txStatusFilter}
                onChange={(e) => handleTxStatusChange(e.target.value)}
                options={TX_STATUS_FILTERS}
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

            {/* Baris agregat masuk/keluar/bersih — mengikuti filter aktif. */}
            <div
              className="mb-4 flex flex-wrap items-center gap-x-6 gap-y-2 rounded-sm border border-border bg-surface px-4 py-3"
              aria-live="polite"
              aria-label="Agregat transaksi sesuai filter"
            >
              {aggLoading && !txAggregate ? (
                <span className="flex items-center gap-2 text-body text-text-secondary">
                  <Spinner size="sm" /> Menghitung agregat…
                </span>
              ) : txAggregate ? (
                <>
                  <p className="text-body">
                    <span className="text-text-secondary">Masuk: </span>
                    <span className="font-semibold text-success-text">
                      {formatRupiah(txAggregate.masuk)}
                    </span>
                  </p>
                  <p className="text-body">
                    <span className="text-text-secondary">Keluar: </span>
                    <span className="font-semibold text-danger-text">
                      {formatRupiah(txAggregate.keluar)}
                    </span>
                  </p>
                  <p className="text-body">
                    <span className="text-text-secondary">Bersih: </span>
                    <span className="font-semibold text-text-primary">
                      {formatRupiah(txAggregate.masuk - txAggregate.keluar)}
                    </span>
                  </p>
                  <p className="text-caption text-text-secondary">
                    dari {formatNumber(txAggregate.count)} transaksi sesuai filter
                    {aggLoading ? " · memperbarui…" : ""}
                  </p>
                </>
              ) : (
                <p className="text-caption text-text-secondary">
                  Agregat tidak tersedia.
                </p>
              )}
            </div>

            <DataTable<AdminTransactionItem>
              columns={txCols.visible}
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
                onPageChange={(p) => setF({ txPage: String(p) })}
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

      {/* ADM-213: konfirmasi recheck manual payout PROCESSING */}
      <ConfirmDialog
        open={recheckTx !== null}
        onClose={closeRecheck}
        title="Cek status payout ke provider?"
        description={
          recheckTx
            ? `Menanyakan status payout ${recheckTx.txId} (${formatRupiah(recheckTx.amount)}) ke Midtrans Iris. TIDAK mengirim payout baru. ` +
              `Bila provider menyatakan completed → SUCCESS; failed → FAILED + dana dikembalikan; selain itu tetap PROCESSING tanpa perubahan.`
            : undefined
        }
        confirmLabel="Ya, cek status"
        cancelLabel="Batal"
        loading={rechecking}
        onConfirm={() => void handleRecheck()}
      />

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
        dirty={note.trim().length > 0}
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
              onClick={() =>
                reauth.require(
                  () => void handleSubmitAction(),
                  actionKind === "reject"
                    ? `Tolak penarikan ${actionTx ? formatRupiah(actionTx.amount) : ""}`
                    : `Setujui penarikan ${actionTx ? formatRupiah(actionTx.amount) : ""}`,
                )
              }
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
          <div className="flex flex-col gap-2">
            <p className="text-body text-text-secondary">
              {actionTx?.approvalInfo
                ? `Persetujuan ${actionTx.approvalInfo.approvals}/${actionTx.approvalInfo.requiredApprovals} — payout ke rekening tujuan dieksekusi setelah ${actionTx.approvalInfo.requiredApprovals} admin BERBEDA menyetujui. Tindakan ini tidak bisa dibatalkan.`
                : "Penarikan yang disetujui akan diproses ke rekening tujuan. Tindakan ini tidak bisa dibatalkan."}
            </p>
            {actionTx?.approvalInfo?.approvedByMe ? (
              <p className="text-caption text-warning-text">
                Anda sudah menyetujui penarikan ini — menunggu persetujuan admin lain.
              </p>
            ) : null}
          </div>
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
      {/* H05: dialog verifikasi ulang untuk aksi penarikan kritis. */}
      <ReauthDialog {...reauth.dialog} />
      {/* H02: dialog kustomisasi kolom */}
      <ColumnCustomizer prefs={pendingCols} />
      <ColumnCustomizer prefs={txCols} />
    </RoleGate>
  )
}
