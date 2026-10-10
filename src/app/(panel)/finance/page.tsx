/**
 * Admin — Keuangan: ringkasan, antrean penarikan legacy, dan transaksi.
 *
 * - (a) Kartu ringkasan: escrow aktif (BAI-047: label sumber angka —
 *   ORDER_BASED bila dana dipegang DANA era tanpa-wallet), revenue hari ini,
 *   revenue bulan ini, antrean penarikan (dari getFinancialSummary +
 *   getEscrowSummary).
 * - (b) Antrean withdrawal pending (LEGACY wallet): tombol "Setujui"
 *   DITAMPILKAN tetapi backend selalu 410 GONE (IRIS_PAYOUT_SUNSET, BAI-041)
 *   — jalur payout legacy di-sunset, jangan eksekusi Midtrans; UI
 *   menampilkan 410 apa adanya. Hanya "Tolak" yang benar-benar memproses
 *   (refund saldo). Pencairan dana aktual kini via halaman Disbursement
 *   DANA (`/finance/disbursements`). Kuorum dual-approval (ADM-205) tetap
 *   ditampilkan dari `approvalInfo` backend sebagai informasi.
 * - (c) Tabel transaksi: pencarian client-side (debounce ~400ms), filter tipe,
 *   filter rentang tanggal (default 30 hari terakhir, maks 90 hari —
 *   rentang wajib di backend).
 * - BAI-042: tombol recheck legacy ("Cek status") DIHAPUS — backend 501;
 *   recheck payout DANA ada di halaman Disbursement DANA.
 */
"use client"

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react"

import { Badge, type BadgeTone } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardBody, CardHeader } from "@/components/ui/card"
import { Dialog } from "@/components/ui/dialog"
import { Input, TextArea } from "@/components/ui/input"
import { Spinner } from "@/components/ui/spinner"
import { DataTable } from "@/components/ui/table"
import { useToast } from "@/components/ui/toast"
import { useAuth } from "@/lib/auth-context"

import { Pagination } from "@/components/admin/pagination"
import { RoleGate } from "@/components/admin/role-gate"
import { useStepUp } from "@/components/admin/step-up-gate"
import { Select } from "@/components/admin/select"
// SEC-503: step-up server-side per aksi sebelum approve/tolak penarikan —
// tiap aksi meminta kata sandi baru; server menerbitkan token sekali pakai
// via header X-Step-Up-Token (fail-closed, tanpa jendela waktu client-side).
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
} from "@/lib/api/admin/finance"
import { userMessage } from "@/lib/api/response"
import { TX_META, txLabel } from "@/lib/tx-labels"
import { formatDateTimeWIB, formatIDR, formatNumber, wibDayRangeToIso } from "@/lib/format"
// ADM-405: PII (nama, email, rekening) di-mask secara default — mask-only, tanpa unmask.
import { maskAccountNumber, maskEmail, maskName } from "@/lib/pii"

const PAGE_SIZE = 20
const PENDING_PAGE_SIZE = 20
const MAX_RANGE_DAYS = 90
const DEFAULT_RANGE_DAYS = 30

/** "Rp1.234.567" — non-finite → "—". */
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
  // BAD-019: sinkron dengan backend enum WalletTransactionType (16 nilai) —
  // sebelumnya 9 tipe hilang dari filter termasuk MILESTONE_RELEASE.
  { value: "REFERRAL_REWARD", label: "Reward referral" },
  { value: "SUBSCRIPTION_PAYMENT", label: "Pembayaran langganan" },
  { value: "ADMIN_CREDIT", label: "Kredit admin" },
  { value: "ADMIN_DEBIT", label: "Debit admin" },
  { value: "TRANSFER_SENT", label: "Transfer terkirim" },
  { value: "TRANSFER_RECEIVED", label: "Transfer diterima" },
  { value: "CAMPAIGN_CASHBACK", label: "Cashback kampanye" },
  { value: "TOPUP_BONUS", label: "Bonus top-up" },
  { value: "MILESTONE_RELEASE", label: "Cair milestone" },
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

/** Input "YYYY-MM-DD" → ISO 8601 (awal/akhir hari WIB — P2-F4, bukan zona perangkat). */
function rangeToIso(start: string, end: string): { start: string; end: string } {
  return wibDayRangeToIso(start, end)
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

/**
 * BAI-041: deteksi 410 GONE (IRIS_PAYOUT_SUNSET) dari error adminHttp/ApiError
 * agar aksi payout legacy menampilkan 410 apa adanya (jangan eksekusi Midtrans).
 */
function isGoneError(e: unknown): boolean {
  if (typeof e !== "object" || e === null) return false
  const rec = e as { status?: unknown; code?: unknown; backendCode?: unknown }
  return (
    rec.status === 410 ||
    rec.code === "IRIS_PAYOUT_SUNSET" ||
    rec.backendCode === "IRIS_PAYOUT_SUNSET"
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
  const { role } = useAuth()
  const { requestStepUp, stepUpDialog } = useStepUp()
  // BAD-018: tab "Jejak Audit" & "Rekonsiliasi" backend-nya SUPER_ADMIN-only
  // (403 untuk FINANCE_ADMIN) — sembunyikan dari role lain agar tidak ada
  // tombol yang selalu gagal.

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

  // Dialog Setujui / Tolak penarikan (legacy). BAI-041: "Setujui" selalu
  // 410 GONE (IRIS_PAYOUT_SUNSET) dari backend — ditampilkan apa adanya,
  // jangan eksekusi Midtrans.
  const [actionTx, setActionTx] = useState<PendingWithdrawal | null>(null)
  const [actionKind, setActionKind] = useState<"approve" | "reject" | null>(null)
  const [note, setNote] = useState("")
  const [noteError, setNoteError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  // H05: re-auth gate untuk aksi penarikan kritis.
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
    // "Tolak" wajib alasan (min 5, sesuai WithdrawalRejectDto); "Setujui"
    // catatannya opsional.
    if (actionKind === "reject" && trimmed.length < 5) {
      setNoteError("Alasan minimal 5 karakter.")
      return
    }
    setSubmitting(true)
    const mapKey = `${actionKind}:${actionTx.txId}`
    try {
      if (actionKind === "approve") {
        // BAI-041: jalur payout legacy DI-SUNSET — backend selalu melempar
        // 410 GONE (IRIS_PAYOUT_SUNSET) dan TIDAK mengeksekusi payout ke
        // provider mana pun. Panggil apa adanya agar 410 tampil jujur di UI;
        // JANGAN pernah mengeksekusi Midtrans dari sini. Respons sukses
        // dual-approval (AWAITING_SECOND_APPROVAL dsb.) tidak lagi dikirim
        // backend — jangan baca field fiktif (pelajaran BAI-061).
        // K13 (audit 2026-10-10): backend mewajibkan step-up server-side
        // (withdrawal.approve, target txId) SEBELUM service — tanpa token
        // request selalu 403 STEP_UP_REQUIRED, 410 jujur tidak pernah tampil.
        const approveToken = await requestStepUp({
          action: "withdrawal.approve",
          targetId: actionTx.txId,
          title: "Setujui penarikan",
          description: `Setujui penarikan ${formatIDR(actionTx.amount)}.`,
        })
        if (!approveToken) return
        await approveWithdrawal(actionTx.txId, trimmed || undefined, actionKeyFor(actionTx.txId, actionKind), {
          stepUpToken: approveToken,
        })
        toast.show({
          title: "Penarikan disetujui",
          description: formatIDR(actionTx.amount),
          tone: "success",
        })
      } else {
        const token = await requestStepUp({
          action: "withdrawal.reject",
          targetId: actionTx.txId,
          title: "Tolak penarikan",
          description: `Tolak penarikan ${formatIDR(actionTx.amount)} dan kembalikan saldo ke wallet pengguna.`,
        })
        if (!token) return
        await rejectWithdrawal(actionTx.txId, trimmed, actionKeyFor(actionTx.txId, actionKind), {
          stepUpToken: token,
        })
        toast.show({
          title: "Penarikan ditolak, saldo dikembalikan",
          description: formatIDR(actionTx.amount),
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
      // BAI-041: aksi "Setujui" legacy selalu 410 GONE dari backend —
      // tampilkan 410 apa adanya (tone info, bukan danger), jangan
      // eksekusi Midtrans.
      const gone = actionKind === "approve" && isGoneError(e)
      toast.show({
        title: gone ? "410 GONE — payout legacy dinonaktifkan" : "Gagal memproses penarikan",
        description: userMessage(e),
        tone: gone ? "info" : "danger",
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

  // BAI-042: recheck legacy DIHAPUS — backend 501 (men-query Midtrans Iris,
  // provider yang salah untuk payout DANA). Recheck payout DANA ada di
  // halaman Disbursement DANA (/finance/disbursements).

  // ADM-215: unduh export CSV ledger (terotentikasi, rentang = filter tanggal).
  const [csvLoading, setCsvLoading] = useState(false)
  const handleCsvExport = async () => {
    setCsvLoading(true)
    try {
      // Audit 2026-10-10: param backend = startDate/endDate (+ filter aktif
      // type/status/q), bukan from/to.
      await downloadFinanceCsv({
        startDate: range.start,
        endDate: range.end,
        type: typeFilter || undefined,
        status: f.status || undefined,
        q: debouncedSearch.trim() || undefined,
      })
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
                  // P1-12 (audit integrasi 2026-10-06): backend listTransactions
                  // hanya select bankAccount:{id,bankCode} — accountNumber/
                  // accountName tidak dikirim (PII). Tampilkan yang ada.
                  render: (r) => (
                    <div>
                      <p>
                        {r.bankAccount?.bankCode ?? "—"}
                        {r.bankAccount?.accountNumber ? (
                          <>
                            {" "}·{" "}
                            {maskAccountNumber(r.bankAccount.accountNumber)}
                          </>
                        ) : null}
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
                      {formatIDR(r.amount)}
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
                          {/* BAI-041: tombol "Setujui" legacy DITAMPILKAN, tetapi backend
                              selalu 410 GONE (IRIS_PAYOUT_SUNSET) — submit menampilkan
                              410 apa adanya; jangan eksekusi Midtrans. */}
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
                  // SEC-505: identitas di-mask (nama/email tidak tampil mentah).
                  render: (r) => {
                    const u = r.wallet?.user
                    if (u?.fullName) return maskName(u.fullName)
                    if (u?.email) return maskEmail(u.email)
                    return "—"
                  },
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
                        {formatIDR(r.amount)}
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
                      {/* BAI-042: tombol "Cek status" legacy dihapus (backend 501) — recheck payout DANA di halaman Disbursement DANA. */}
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

      {/* Tab navigasi — BAD-018: "Jejak Audit" & "Rekonsiliasi" hanya untuk
          SUPER_ADMIN (backend menolak 403 untuk FINANCE_ADMIN). */}
      <div className="mb-6 flex gap-2" role="tablist" aria-label="Navigasi keuangan">
        {(
          [
            { id: "overview", label: "Ringkasan & Transaksi", roles: ["SUPER_ADMIN", "FINANCE_ADMIN"] },
            { id: "audit", label: "Jejak Audit", roles: ["SUPER_ADMIN"] },
            { id: "rekonsiliasi", label: "Rekonsiliasi", roles: ["SUPER_ADMIN"] },
          ] as const
        )
          .filter((tab) => (tab.roles as readonly string[]).includes(role ?? ""))
          .map((tab) => (
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
              value={formatIDR(escrow?.totalEscrowBalance)}
              hint={
                escrow?.source === "ORDER_BASED"
                  ? `${formatNumber(escrow?.activeEscrowOrders ?? 0)} order aktif — dihitung dari order (dana dipegang DANA)`
                  : `${formatNumber(escrow?.activeEscrowOrders ?? 0)} order aktif — dari saldo wallet escrow`
              }
            />
            {/* MFE-011: escrow DANA-direct (mode tanpa-wallet) — sumber
                kebenaran escrow saat ini; kartu lama hanya menghitung
                wallet.escrowBalance sehingga selalu Rp0 tanpa wallet. */}
            <StatCard
              label="Escrow DANA aktif"
              value={formatIDR(escrow?.danaEscrowBalance ?? 0)}
              hint={`${formatNumber(escrow?.danaEscrowPayments ?? 0)} pembayaran DANA · ${formatNumber(
                escrow?.danaDisbursementsPending ?? 0,
              )} pencairan tertunda`}
            />
            {/* ADM-211: revenue gabungan (fee + langganan) dengan breakdown — kartu
                lama hanya menampilkan fee platform sehingga pendapatan mengecil. */}
            <StatCard
              label="Revenue hari ini"
              value={formatIDR(summary?.totalRevenueToday)}
              hint={`Fee ${formatIDR(summary?.totalPlatformFeeToday)} + langganan ${formatIDR(summary?.totalSubscriptionRevenueToday)}`}
            />
            <StatCard
              label="Revenue bulan ini"
              value={formatIDR(summary?.totalRevenueThisMonth)}
              hint={`Fee ${formatIDR(summary?.totalPlatformFeeThisMonth)} + langganan ${formatIDR(summary?.totalSubscriptionRevenueThisMonth)}`}
            />
            <StatCard
              label="Antrean penarikan"
              value={formatIDR(summary?.pendingWithdrawalsAmount)}
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
                value={formatIDR(revenue.totalRevenue)}
                hint="Fee transaksi + subscription"
              />
              <StatCard
                label="Fee transaksi"
                value={formatIDR(revenue.breakdown?.transactionFees?.total)}
                hint={`${formatNumber(revenue.breakdown?.transactionFees?.count ?? 0)} order selesai`}
              />
              <StatCard
                label="Pembayaran subscription"
                value={formatIDR(revenue.breakdown?.subscriptionPayments?.total)}
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
                          <span className="font-semibold">{formatIDR(r.total)}</span>
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

      {/* (b) Antrean penarikan (LEGACY wallet) */}
      <section aria-label="Antrean penarikan" className="mt-8">
        <Card>
          <CardHeader
            title="Antrean penarikan (legacy)"
            subtitle={
              pendingTotal > 0
                ? `${pendingTotal.toLocaleString("id-ID")} menunggu persetujuan`
                : undefined
            }
          />
          <CardBody>
            {/* BAI-041: jalur payout legacy di-sunset (backend 410 GONE). Pencairan
                dana aktual kini via halaman Disbursement DANA. */}
            <div className="mb-4 rounded-md border border-warning-border bg-warning-bg p-3">
              <p className="text-body text-text-primary">
                <span className="font-semibold">Antrean legacy dinonaktifkan.</span>{" "}
                Tombol persetujuan penarikan dihapus — payout kini berjalan via{" "}
                <a href="/finance/disbursements" className="font-semibold text-primary-text underline">
                  Disbursement DANA
                </a>
                . Hanya penolakan (refund saldo) yang masih tersedia di sini.
              </p>
            </div>
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
            subtitle="Pencarian server-side: txId, deskripsi, order, referensi eksternal (DANA/legacy). Klik Detail untuk timeline."
            action={
              <Button
                variant="secondary"
                size="sm"
                fullWidth={false}
                loading={csvLoading}
                onClick={() => void handleCsvExport()}
                title="Unduh export CSV ledger untuk rentang tanggal terpilih. Catatan: filter tipe/status/pencarian TIDAK ikut — selalu seluruh transaksi pada rentang."
              >
                Unduh CSV (semua)
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
                      {formatIDR(txAggregate.masuk)}
                    </span>
                  </p>
                  <p className="text-body">
                    <span className="text-text-secondary">Keluar: </span>
                    <span className="font-semibold text-danger-text">
                      {formatIDR(txAggregate.keluar)}
                    </span>
                  </p>
                  <p className="text-body">
                    <span className="text-text-secondary">Bersih: </span>
                    <span className="font-semibold text-text-primary">
                      {formatIDR(txAggregate.masuk - txAggregate.keluar)}
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

      {/* Dialog Setujui / Tolak penarikan (legacy) */}
      <Dialog
        open={actionTx !== null}
        onClose={closeAction}
        title={actionTitle}
        description={
          actionTx
            ? `${withdrawUserName(actionTx)} • ${formatIDR(actionTx.amount)}`
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
              // Audit 2026-10-10: dulu dibungkus reauth.require (kata sandi #1,
              // token legacy dibuang) lalu handleSubmitAction meminta step-up
              // lagi (kata sandi #2). Satu step-up per aksi di handleSubmitAction.
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
          <div className="flex flex-col gap-2">
            {/* BAI-041: jalur payout legacy di-sunset — backend selalu 410 GONE
                (IRIS_PAYOUT_SUNSET). Dialog ini jujur: tidak ada payout yang
                dieksekusi; pencairan dana kini via Disbursement DANA. */}
            <p className="text-body text-text-secondary">
              Jalur payout legacy sudah dinonaktifkan (410 GONE — IRIS_PAYOUT_SUNSET):
              penarikan ini tidak dapat disetujui atau dicairkan dari sini.
              Pencairan dana kini berjalan via Disbursement DANA.
            </p>
            {actionTx?.approvalInfo ? (
              <p className="text-caption text-text-secondary">
                Riwayat persetujuan: {actionTx.approvalInfo.approvals}/
                {actionTx.approvalInfo.requiredApprovals} admin.
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
            placeholder="Contoh: nama rekening tidak sesuai…"
          />
        </div>
      </Dialog>
      {/* H05: dialog verifikasi ulang untuk aksi penarikan kritis. */}
      {/* H02: dialog kustomisasi kolom */}
      <ColumnCustomizer prefs={pendingCols} />
      <ColumnCustomizer prefs={txCols} />
      {stepUpDialog}
    </RoleGate>
  )
}
