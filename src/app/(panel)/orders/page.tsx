/**
 * Admin — Order: daftar order + intervensi darurat escrow.
 *
 * - Tabel order: pencarian (debounce ~400ms) + filter status + Pagination.
 * - Klik "Detail" pada baris → Dialog detail: pembeli, penjual, nominal,
 *   status escrow (diturunkan dari transaksi ORDER_LOCK / ORDER_RELEASE /
 *   ORDER_REFUND / DISPUTE_RELEASE), timeline dari riwayat status.
 * - Aksi darurat "Paksa batal" / "Paksa selesai": KONFIRMASI GANDA —
 *   Dialog pertama wajib alasan (min 10 karakter) → ConfirmDialog kedua
 *   ("Tindakan ini tidak bisa dibatalkan"). Tombol hanya aktif untuk status
 *   yang valid (batal: WAITING_CONFIRMATION / WAITING_PAYMENT / PROCESSING /
 *   IN_DELIVERY / DISPUTED; selesai: PROCESSING / IN_DELIVERY).
 * - forceCancelOrder / forceCompleteOrder sudah menyertakan header
 *   `Idempotency-Key` per panggilan (lihat src/lib/api/admin/orders.ts).
 */
"use client"

import { Suspense, useCallback, useEffect, useMemo, useState } from "react"

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
import { useAuth } from "@/lib/auth-context"
import { Select } from "@/components/admin/select"
// H01: filter di URL. H02: preferensi kolom per admin.
import { parsePage, useUrlFilters } from "@/components/admin/batch139/use-url-filters"
import {
  ColumnCustomizer,
  useColumnPrefs,
  type PrefsColumnDef,
} from "@/components/admin/batch139/column-prefs"

import {
  forceCancelOrder,
  forceCompleteOrder,
  getAdminOrderDetail,
  listAdminOrders,
  type AdminOrderDetail,
  type AdminOrderItem,
  type AdminOrderStatus,
} from "@/lib/api/admin/orders"
import { getRoomIdByOrder, getRoomMessages } from "@/lib/api/admin/chat"
import { userMessage } from "@/lib/api/response"
import { downloadCsv } from "@/lib/csv"
import { formatDateTimeWIB, formatNumber } from "@/lib/format"
// ADM-405: PII pihak transaksi di-mask secara default (mask-only, tanpa unmask).
import { maskEmail, maskName } from "@/lib/pii"

const PAGE_SIZE = 20

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

const STATUS_LABEL: Record<string, string> = {
  WAITING_CONFIRMATION: "Menunggu konfirmasi",
  WAITING_PAYMENT: "Menunggu pembayaran",
  PROCESSING: "Diproses",
  IN_DELIVERY: "Dikirim",
  COMPLETED: "Selesai",
  DISPUTED: "Disengketakan",
  CANCELLED: "Dibatalkan",
}

const STATUS_TONE: Record<string, BadgeTone> = {
  WAITING_CONFIRMATION: "warning",
  WAITING_PAYMENT: "warning",
  PROCESSING: "info",
  IN_DELIVERY: "info",
  COMPLETED: "success",
  DISPUTED: "danger",
  CANCELLED: "neutral",
}

const STATUS_FILTERS: Array<{ value: AdminOrderStatus | ""; label: string }> = [
  { value: "", label: "Semua status" },
  { value: "PROCESSING", label: "Diproses" },
  { value: "IN_DELIVERY", label: "Dikirim" },
  { value: "DISPUTED", label: "Disengketakan" },
  { value: "WAITING_PAYMENT", label: "Menunggu bayar" },
  { value: "WAITING_CONFIRMATION", label: "Menunggu konfirmasi" },
  { value: "COMPLETED", label: "Selesai" },
  { value: "CANCELLED", label: "Dibatalkan" },
]

/**
 * Status order yang masih boleh dibatalkan paksa.
 * ADM-107: DISPUTED dikeluarkan — backend menolak force-cancel saat order
 * disengketakan; intervensi wajib lewat alur sengketa (lihat hint di bawah).
 */
const CANCELLABLE: AdminOrderStatus[] = [
  "WAITING_CONFIRMATION",
  "WAITING_PAYMENT",
  "PROCESSING",
  "IN_DELIVERY",
]

/** Status order yang boleh diselesaikan paksa (DISPUTED wajib lewat alur sengketa). */
const COMPLETABLE: AdminOrderStatus[] = ["PROCESSING", "IN_DELIVERY"]

/** Status escrow diturunkan dari transaksi wallet order (yang terbaru relevan). */
function escrowStateOf(detail: AdminOrderDetail): {
  label: string
  tone: BadgeTone
} {
  const txs = detail.walletTransactions ?? []
  const relevant = txs.find((t) =>
    ["ORDER_LOCK", "ORDER_RELEASE", "ORDER_REFUND", "DISPUTE_RELEASE"].includes(
      String(t.type),
    ),
  )
  switch (String(relevant?.type)) {
    case "ORDER_LOCK":
      return { label: "Escrow terkunci", tone: "warning" }
    case "ORDER_RELEASE":
      return { label: "Escrow cair", tone: "success" }
    case "ORDER_REFUND":
      return { label: "Escrow refund", tone: "info" }
    case "DISPUTE_RELEASE":
      return { label: "Cair via sengketa", tone: "info" }
    default:
      return { label: "Tanpa escrow", tone: "neutral" }
  }
}

function partyName(
  p: {
    fullName?: string | null
    username?: string | null
    email?: string | null
  } | null | undefined,
): string {
  // ADM-405: nama pihak di-mask; username bukan PII langsung sehingga tetap tampil.
  const masked = maskName(p?.fullName ?? null)
  return masked !== "—" ? masked : (p?.username ?? "—")
}

function KeyValue({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-2 border-b border-border py-2.5 last:border-b-0">
      <dt className="shrink-0 text-caption font-semibold text-text-secondary">
        {label}
      </dt>
      <dd className="min-w-0 flex-1 text-right text-body text-text-primary">
        {value}
      </dd>
    </div>
  )
}

export default function OrdersPage() {
  return (
    <Suspense>
      <OrdersPageContent />
    </Suspense>
  )
}

const SORT_BY_OPTIONS = [
  { value: "createdAt", label: "Terbaru dibuat" },
  { value: "updatedAt", label: "Terbaru diperbarui" },
  { value: "orderValue", label: "Nilai order" },
  { value: "buyerPayAmount", label: "Bayar pembeli" },
  { value: "completedAt", label: "Waktu selesai" },
]

const SORT_ORDER_OPTIONS = [
  { value: "desc", label: "Menurun" },
  { value: "asc", label: "Menaik" },
]

function OrdersPageContent() {
  const toast = useToast()
  // A5 (audit 2026-09-26): role dipakai untuk menyembunyikan tombol intervensi
  // yang pasti ditolak backend (403) — backend tetap gate utama.
  const { role } = useAuth()
  // H01: filter/sort/pencarian/halaman disinkronkan ke URL — deep-link
  // ?search=<orderId> (ADM-116) tetap jalan, plus share/back-forward aman.
  const { values: f, set: setF } = useUrlFilters({
    search: "",
    status: "",
    escrow: "",
    start: "",
    end: "",
    sortBy: "createdAt",
    sortOrder: "desc",
    page: "1",
  })
  const [searchInput, setSearchInput] = useState(f.search)
  const debouncedSearch = useDebouncedValue(searchInput, 400)

  const statusFilter = (f.status || "") as AdminOrderStatus | ""
  // AW-016: backend hanya menerapkan filter saat hasEscrow === true
  // (admin-orders.service.ts) — UI berupa pilihan "Dengan escrow" saja.
  const escrowOnly = f.escrow === "yes"
  // ADM-117: rentang tanggal + pengurutan (didukung backend).
  const startDate = f.start
  const endDate = f.end
  const sortBy = f.sortBy || "createdAt"
  const sortOrder = f.sortOrder || "desc"
  const page = parsePage(f.page)

  // Komit pencarian debounce ke URL (+ reset ke halaman 1).
  useEffect(() => {
    if (debouncedSearch !== f.search) setF({ search: debouncedSearch, page: "1" })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedSearch])

  const [rows, setRows] = useState<AdminOrderItem[]>([])
  const [total, setTotal] = useState(0)
  const [totalPages, setTotalPages] = useState(1)
  const [loading, setLoading] = useState(true)
  const [csvLoading, setCsvLoading] = useState(false)
  const FETCH_ALL_MAX_PAGES = 50

  /** Export CSV order sesuai filter aktif (pencarian/status/escrow/tanggal/urut). */
  const handleExportCsv = async () => {
    setCsvLoading(true)
    try {
      const all: AdminOrderItem[] = []
      for (let p = 1; p <= FETCH_ALL_MAX_PAGES; p++) {
        const res = await listAdminOrders({
          page: p,
          limit: 100,
          status: statusFilter || undefined,
          q: f.search.trim() || undefined,
          hasEscrow: escrowOnly || undefined,
          startDate: startDate || undefined,
          endDate: endDate || undefined,
          sortBy: sortBy as "createdAt" | "updatedAt" | "orderValue" | "buyerPayAmount" | "completedAt",
          sortOrder: sortOrder as "asc" | "desc",
        })
        const items = res.data ?? []
        all.push(...items)
        if (p >= (res.totalPages ?? 1) || items.length === 0) break
      }
      const stamp = new Date().toISOString().slice(0, 10)
      downloadCsv(
        `order-${stamp}.csv`,
        ["ID Order", "Judul", "Status", "Pembeli", "Penjual", "Nilai", "Dibayar pembeli", "Diterima penjual", "Dibuat"],
        all.map((r) => [
          r.orderId,
          r.title ?? "",
          STATUS_LABEL[String(r.status)] ?? String(r.status),
          partyName(r.buyer),
          partyName(r.seller),
          typeof r.orderValue === "number" ? r.orderValue : "",
          r.buyerPayAmount ?? "",
          r.sellerReceiveAmount ?? "",
          formatDateTimeWIB(r.createdAt),
        ]),
      )
      toast.show({
        title: "CSV diunduh",
        description: `${all.length} order sesuai filter aktif.`,
        tone: "success",
      })
    } catch (e) {
      toast.show({
        title: "Gagal mengekspor CSV",
        description: userMessage(e),
        tone: "danger",
      })
    } finally {
      setCsvLoading(false)
    }
  }

  const loadOrders = useCallback(
    async (targetPage: number) => {
      setLoading(true)
      try {
        const res = await listAdminOrders({
          page: targetPage,
          limit: PAGE_SIZE,
          status: statusFilter || undefined,
          // H01: pakai nilai pencarian yang sudah terkomit ke URL.
          q: f.search.trim() || undefined,
          hasEscrow: escrowOnly || undefined,
          startDate: startDate || undefined,
          endDate: endDate || undefined,
          sortBy: sortBy as "createdAt" | "updatedAt" | "orderValue" | "buyerPayAmount" | "completedAt",
          sortOrder: sortOrder as "asc" | "desc",
        })
        setRows(res.data ?? [])
        const t = res.total ?? res.data?.length ?? 0
        setTotal(t)
        setTotalPages(res.totalPages ?? Math.max(1, Math.ceil(t / PAGE_SIZE)))
      } catch (e) {
        toast.show({
          title: "Gagal memuat order",
          description: userMessage(e),
          tone: "danger",
        })
      } finally {
        setLoading(false)
      }
    },
    [statusFilter, f.search, escrowOnly, startDate, endDate, sortBy, sortOrder, toast],
  )

  useEffect(() => {
    void loadOrders(page)
  }, [page, loadOrders])

  const handleStatusChange = (value: string) => {
    // H01: filter status tersimpan di URL.
    setF({ status: value, page: "1" })
  }

  const handleEscrowChange = (value: string) => {
    setF({ escrow: value === "yes" ? "yes" : "", page: "1" })
  }

  // ------------------------------------------------------------------
  // Dialog detail
  // ------------------------------------------------------------------
  const [detailOpen, setDetailOpen] = useState(false)
  const [detail, setDetail] = useState<AdminOrderDetail | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [detailError, setDetailError] = useState<string | null>(null)

  const openDetail = useCallback((order: AdminOrderItem) => {
    setDetailOpen(true)
    setDetail(null)
    setDetailError(null)
    setDetailLoading(true)
    setForceAction(null)
    setConfirmOpen(false)
    setReason("")
    setReasonError(null)
    // ADM-115: reset penampil percakapan order.
    setConvMessages(null)
    setConvError(null)
    setConvRoomId(null)
    void (async () => {
      try {
        const d = await getAdminOrderDetail(order.orderId || order.id)
        setDetail(d)
      } catch (e) {
        setDetailError(userMessage(e))
      } finally {
        setDetailLoading(false)
      }
    })()
  }, [])

  // ADM-115: penampil percakapan room ORDER dari detail order.
  // Backend hanya mengembalikan room bertipe ORDER — DM pribadi tidak bocor.
  const [convRoomId, setConvRoomId] = useState<string | null>(null)
  const [convMessages, setConvMessages] = useState<unknown[] | null>(null)
  const [convLoading, setConvLoading] = useState(false)
  const [convError, setConvError] = useState<string | null>(null)

  const loadConversation = useCallback(async () => {
    if (!detail || convLoading) return
    setConvLoading(true)
    setConvError(null)
    try {
      const resolved = await getRoomIdByOrder(detail.orderId)
      setConvRoomId(resolved.roomId)
      const res = await getRoomMessages(resolved.roomId, { limit: 50 })
      setConvMessages(res.messages)
    } catch (e) {
      setConvError(userMessage(e))
      setConvMessages(null)
    } finally {
      setConvLoading(false)
    }
  }, [detail, convLoading])

  const closeDetail = () => {
    if (submitting) return
    setDetailOpen(false)
    setDetail(null)
    setForceAction(null)
    setConfirmOpen(false)
  }

  // ------------------------------------------------------------------
  // Intervensi darurat — konfirmasi ganda
  // ------------------------------------------------------------------
  const [forceAction, setForceAction] = useState<"cancel" | "complete" | null>(
    null,
  )
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [reason, setReason] = useState("")
  const [reasonError, setReasonError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  /** Langkah 1: validasi alasan → buka ConfirmDialog kedua. */
  const proceedToConfirm = () => {
    if (reason.trim().length < 10) {
      setReasonError("Alasan minimal 10 karakter.")
      return
    }
    setConfirmOpen(true)
  }

  /** Langkah 2: eksekusi setelah konfirmasi kedua. */
  const executeForceAction = useCallback(async () => {
    if (!detail || !forceAction || submitting) return
    setSubmitting(true)
    try {
      if (forceAction === "cancel") {
        await forceCancelOrder(detail.orderId, reason.trim())
        toast.show({
          title: "Order dibatalkan",
          description: detail.orderId,
          tone: "success",
        })
      } else {
        await forceCompleteOrder(detail.orderId, reason.trim())
        toast.show({
          title: "Order diselesaikan",
          description: detail.orderId,
          tone: "success",
        })
      }
      setConfirmOpen(false)
      closeDetail()
      await loadOrders(page)
    } catch (e) {
      toast.show({
        title: "Gagal memproses order",
        description: userMessage(e),
        tone: "danger",
      })
    } finally {
      setSubmitting(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detail, forceAction, submitting, reason, toast, loadOrders, page])

  const detailStatus = detail ? String(detail.status) : ""
  const canCancel =
    detail != null && (CANCELLABLE as string[]).includes(detailStatus)
  const canComplete =
    detail != null && (COMPLETABLE as string[]).includes(detailStatus)
  // A5 (audit 2026-09-26): backend membatasi force-cancel ke SUPER_ADMIN +
  // DISPUTE_ADMIN dan force-complete ke SUPER_ADMIN saja. Sembunyikan tombol
  // yang pasti 403 agar tidak menyesatkan (backend tetap memvalidasi).
  const mayForceCancel = role === "SUPER_ADMIN" || role === "DISPUTE_ADMIN"
  const mayForceComplete = role === "SUPER_ADMIN"
  const showForceCancel = canCancel && mayForceCancel
  const showForceComplete = canComplete && mayForceComplete
  const escrow = detail ? escrowStateOf(detail) : null
  const confirmTitle =
    forceAction === "cancel" ? "Paksa batalkan order?" : "Paksa selesaikan order?"
  const confirmDescription =
    forceAction === "cancel"
      ? "Order akan dibatalkan dan escrow (bila ada) dikembalikan ke pembeli. Tindakan ini tidak bisa dibatalkan."
      : "Order akan diselesaikan dan escrow dicairkan ke penjual. Tindakan ini tidak bisa dibatalkan."

  // H02: kolom tabel order bisa dipilih/diurutkan — preferensi per admin.
  const columnDefs = useMemo<PrefsColumnDef<AdminOrderItem>[]>(
    () => [
      {
        key: "orderId",
        header: "Order",
        defaultVisible: true,
        render: (r) => (
          <div>
            <p className="font-semibold">{r.title ?? r.orderId}</p>
            <p className="break-all font-mono text-caption text-text-secondary">
              {r.orderId}
            </p>
          </div>
        ),
      },
      {
        key: "buyer",
        header: "Pembeli",
        defaultVisible: true,
        render: (r) => partyName(r.buyer),
      },
      {
        key: "seller",
        header: "Penjual",
        defaultVisible: true,
        render: (r) => partyName(r.seller),
      },
      {
        key: "orderValue",
        header: "Nilai",
        defaultVisible: true,
        align: "right",
        render: (r) => (
          <span className="font-semibold">{formatRupiah(r.orderValue)}</span>
        ),
      },
      {
        key: "status",
        header: "Status",
        defaultVisible: true,
        render: (r) => (
          <Badge tone={STATUS_TONE[String(r.status)] ?? "neutral"}>
            {STATUS_LABEL[String(r.status)] ?? String(r.status)}
          </Badge>
        ),
      },
      {
        key: "createdAt",
        header: "Dibuat",
        defaultVisible: true,
        render: (r) => formatDateTimeWIB(r.createdAt),
      },
      {
        key: "action",
        header: "",
        defaultVisible: true,
        align: "right",
        render: (r) => (
          <Button
            variant="ghost"
            size="sm"
            fullWidth={false}
            onClick={() => openDetail(r)}
          >
            Detail
          </Button>
        ),
      },
    ],
    [openDetail],
  )
  const cols = useColumnPrefs<AdminOrderItem>("orders", columnDefs)

  return (
    <RoleGate href="/orders">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-h2 font-bold text-text-primary">Order</h1>
          <p className="mt-1 text-body text-text-secondary">
            Daftar semua order dan intervensi darurat escrow.
          </p>
        </div>
        <Button
          variant="secondary"
          size="sm"
          fullWidth={false}
          loading={loading}
          onClick={() => loadOrders(page)}
        >
          Muat ulang
        </Button>
        {/* H02: kustomisasi kolom tabel order. */}
        <Button
          variant="secondary"
          size="sm"
          fullWidth={false}
          onClick={() => cols.setCustomizerOpen(true)}
        >
          Kolom
        </Button>
      </div>

      <Card>
        <CardHeader
          title="Daftar order"
          subtitle="Klik Detail untuk melihat pihak, nominal, status escrow, dan timeline."
          action={
            <Button
              variant="secondary"
              size="sm"
              fullWidth={false}
              loading={csvLoading}
              onClick={() => void handleExportCsv()}
              title="Unduh CSV sesuai filter aktif"
            >
              Unduh CSV
            </Button>
          }
        />
        <CardBody>
          <div className="mb-4 grid grid-cols-1 gap-3 md:grid-cols-3">
            <Input
              label="Cari"
              placeholder="Cari orderId / judul / nomor resi…"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
            />
            <Select
              label="Status"
              value={statusFilter}
              onChange={(e) => handleStatusChange(e.target.value)}
              options={STATUS_FILTERS}
            />
            <Select
              label="Escrow"
              value={escrowOnly ? "yes" : ""}
              onChange={(e) => handleEscrowChange(e.target.value)}
              options={[
                { value: "", label: "Semua order" },
                { value: "yes", label: "Dengan escrow" },
              ]}
            />
          </div>

          {/* ADM-117: rentang tanggal + pengurutan (didukung backend). */}
          <div className="mb-4 grid grid-cols-1 gap-3 md:grid-cols-4">
            <Input
              label="Dari tanggal"
              type="date"
              value={startDate}
              onChange={(e) => setF({ start: e.target.value, page: "1" })}
            />
            <Input
              label="Sampai tanggal"
              type="date"
              value={endDate}
              onChange={(e) => setF({ end: e.target.value, page: "1" })}
            />
            <Select
              label="Urutkan"
              value={sortBy}
              onChange={(e) => setF({ sortBy: e.target.value, page: "1" })}
              options={SORT_BY_OPTIONS}
            />
            <Select
              label="Arah"
              value={sortOrder}
              onChange={(e) => setF({ sortOrder: e.target.value, page: "1" })}
              options={SORT_ORDER_OPTIONS}
            />
          </div>

          <DataTable<AdminOrderItem>
            columns={cols.visible}
            rows={rows}
            rowKey={(r) => r.id}
            loading={loading}
            emptyText="Tidak ada order pada filter & pencarian ini."
          />
          <div className="mt-4">
            <Pagination
              page={page}
              totalPages={totalPages}
              total={total}
              pageSize={PAGE_SIZE}
              onPageChange={(p) => setF({ page: String(p) })}
              disabled={loading}
            />
          </div>
        </CardBody>
      </Card>

      {/* Dialog detail order */}
      <Dialog
        open={detailOpen}
        onClose={closeDetail}
        title="Detail order"
        description={detail?.orderId}
        className="max-w-2xl"
      >
        {detailLoading ? (
          <div className="flex items-center justify-center gap-2 py-10 text-body text-text-secondary">
            <Spinner size="sm" />
            Memuat detail order…
          </div>
        ) : detailError ? (
          <div className="py-6 text-center">
            <p className="text-body font-semibold text-text-primary">
              Gagal memuat detail
            </p>
            <p className="mt-1 text-body text-text-secondary">{detailError}</p>
            <Button
              variant="secondary"
              size="sm"
              fullWidth={false}
              className="mt-4"
              onClick={() => detail && openDetail(detail)}
            >
              Coba lagi
            </Button>
          </div>
        ) : detail ? (
          <div className="space-y-5">
            <div className="flex flex-wrap gap-2">
              <Badge tone={STATUS_TONE[detailStatus] ?? "neutral"}>
                {STATUS_LABEL[detailStatus] ?? detailStatus}
              </Badge>
              {escrow ? <Badge tone={escrow.tone}>{escrow.label}</Badge> : null}
              {detail.dispute ? (
                <Badge tone="danger">Ada sengketa</Badge>
              ) : null}
            </div>

            <div>
              <p className="text-h3 font-semibold text-text-primary">
                {formatRupiah(detail.orderValue)}
              </p>
              <p className="mt-1 text-caption text-text-secondary">
                Bayar pembeli: {formatRupiah(detail.buyerPayAmount)} · Terima
                penjual: {formatRupiah(detail.sellerReceiveAmount)} · Fee:{" "}
                {formatRupiah(detail.feeAmount)}
              </p>
            </div>

            <dl>
              <KeyValue label="Pembeli" value={partyName(detail.buyer)} />
              {detail.buyer?.email ? (
                <KeyValue label="Email pembeli" value={maskEmail(detail.buyer.email)} />
              ) : null}
              <KeyValue label="Penjual" value={partyName(detail.seller)} />
              {detail.seller?.email ? (
                <KeyValue label="Email penjual" value={maskEmail(detail.seller.email)} />
              ) : null}
              <KeyValue
                label="Dibuat"
                value={formatDateTimeWIB(detail.createdAt)}
              />
              {detail.completedAt ? (
                <KeyValue
                  label="Selesai"
                  value={formatDateTimeWIB(detail.completedAt)}
                />
              ) : null}
            </dl>

            {/* ADM-118: info pengiriman dari detail order backend. */}
            {detail.trackingNumber || detail.courierName || detail.shippedAt ? (
              <div>
                <p className="mb-2 text-label font-semibold text-text-secondary">
                  Pengiriman
                </p>
                <dl>
                  {detail.trackingNumber ? (
                    <KeyValue label="Nomor resi" value={String(detail.trackingNumber)} />
                  ) : null}
                  {detail.courierName ? (
                    <KeyValue label="Kurir" value={String(detail.courierName)} />
                  ) : null}
                  {detail.shippedAt ? (
                    <KeyValue label="Dikirim" value={formatDateTimeWIB(String(detail.shippedAt))} />
                  ) : null}
                  {detail.trackingNotes ? (
                    <KeyValue label="Catatan resi" value={String(detail.trackingNotes)} />
                  ) : null}
                </dl>
              </div>
            ) : null}

            {/* ADM-115: percakapan room ORDER — hanya room transaksi, DM tidak bocor. */}
            <div>
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <p className="text-label font-semibold text-text-secondary">
                  Percakapan order
                </p>
                {convMessages === null && !convLoading ? (
                  <Button
                    variant="secondary"
                    size="sm"
                    fullWidth={false}
                    onClick={() => void loadConversation()}
                  >
                    Lihat percakapan
                  </Button>
                ) : null}
              </div>
              {convLoading ? (
                <div className="flex items-center gap-2 py-3">
                  <Spinner size="sm" />
                  <p className="text-body text-text-secondary">Memuat percakapan…</p>
                </div>
              ) : convError ? (
                <p className="text-body text-danger-text">{convError}</p>
              ) : convMessages ? (
                convMessages.length === 0 ? (
                  <p className="text-caption text-text-secondary">
                    Belum ada pesan di room order.
                  </p>
                ) : (
                  <ul className="max-h-64 space-y-2 overflow-y-auto">
                    {convMessages.map((m, i) => {
                      const rec = (m ?? {}) as Record<string, unknown>
                      const text = ["content", "text", "body", "message"]
                        .map((k) => rec[k])
                        .find((v) => typeof v === "string" && (v as string).trim()) as string | undefined
                      return (
                        <li key={i} className="rounded-sm bg-surface px-3 py-2">
                          <p className="text-caption text-text-tertiary">
                            {typeof rec.createdAt === "string" ? formatDateTimeWIB(rec.createdAt) : ""}
                          </p>
                          <p className="mt-0.5 text-body text-text-primary">
                            {text ?? "Pesan tanpa teks"}
                          </p>
                        </li>
                      )
                    })}
                  </ul>
                )
              ) : (
                <p className="text-caption text-text-secondary">
                  Percakapan buyer–seller di room transaksi order ini.
                </p>
              )}
            </div>

            {(detail.statusHistories?.length ?? 0) > 0 ? (
              <div>
                <p className="mb-2 text-label font-semibold text-text-secondary">
                  Timeline
                </p>
                <div className="space-y-2.5">
                  {detail.statusHistories!.map((h, i) => (
                    <div key={i} className="flex items-start gap-2.5">
                      <span
                        aria-hidden="true"
                        className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-primary"
                      />
                      <div className="min-w-0 flex-1">
                        <p className="text-body text-text-primary">
                          {STATUS_LABEL[String(h.status)] ??
                            String(h.status ?? "—")}
                        </p>
                        {h.createdAt ? (
                          <p className="text-caption text-text-secondary">
                            {formatDateTimeWIB(String(h.createdAt))}
                          </p>
                        ) : null}
                        {h.note ? (
                          <p className="text-caption text-text-secondary">
                            {h.note}
                          </p>
                        ) : null}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}

            {!forceAction ? (
              <div className="rounded-sm border border-danger bg-danger-soft p-4">
                <p className="text-label font-semibold text-danger-text">
                  Intervensi darurat
                </p>
                <p className="mt-1 text-caption text-text-secondary">
                  Hanya dipakai saat alur normal macet. Setiap aksi tercatat di
                  audit log.
                </p>
                <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                  {showForceCancel ? (
                    <Button
                      variant="secondary"
                      size="sm"
                      fullWidth={false}
                      onClick={() => setForceAction("cancel")}
                    >
                      Paksa batal
                    </Button>
                  ) : null}
                  {showForceComplete ? (
                    <Button
                      variant="secondary"
                      size="sm"
                      fullWidth={false}
                      onClick={() => setForceAction("complete")}
                    >
                      Paksa selesai
                    </Button>
                  ) : null}
                </div>
                {!showForceCancel && !showForceComplete ? (
                  <p className="mt-2 text-caption text-text-secondary">
                    {detailStatus === "DISPUTED"
                      ? // ADM-107: DISPUTED tidak bisa dibatalkan paksa —
                        // intervensi wajib lewat alur sengketa di halaman Disputes.
                        "Order sedang disengketakan — batal paksa tidak tersedia. Selesaikan lewat alur sengketa di halaman Sengketa."
                      : canCancel || canComplete
                        ? "Role admin Anda tidak memiliki izin intervensi darurat untuk order ini."
                        : "Order pada status ini tidak bisa diintervensi (selesai/dibatalkan)."}
                  </p>
                ) : null}
              </div>
            ) : (
              <div>
                <p className="text-body font-semibold text-danger-text">
                  {forceAction === "cancel"
                    ? "Paksa batal — tulis alasan"
                    : "Paksa selesai — tulis alasan"}
                </p>
                <div className="mt-3">
                  <TextArea
                    label="Alasan intervensi"
                    required
                    rows={3}
                    value={reason}
                    onChange={(e) => {
                      setReason(e.target.value)
                      if (reasonError) setReasonError(null)
                    }}
                    error={reasonError ?? undefined}
                    hint="Setelah lanjut, akan ada dialog konfirmasi kedua."
                    placeholder="Minimal 10 karakter, contoh: penjual tidak merespons 7 hari…"
                  />
                </div>
                <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:justify-end">
                  <Button
                    variant="ghost"
                    fullWidth={false}
                    disabled={submitting}
                    onClick={() => {
                      setForceAction(null)
                      setReason("")
                      setReasonError(null)
                    }}
                  >
                    Batal
                  </Button>
                  <Button
                    variant="destructive"
                    fullWidth={false}
                    loading={submitting}
                    onClick={proceedToConfirm}
                  >
                    Lanjut
                  </Button>
                </div>
              </div>
            )}
          </div>
        ) : null}
      </Dialog>

      {/* Konfirmasi kedua — ganda */}
      <ConfirmDialog
        open={confirmOpen}
        onClose={() => {
          if (!submitting) setConfirmOpen(false)
        }}
        title={confirmTitle}
        description={confirmDescription}
        confirmLabel={
          forceAction === "cancel" ? "Ya, batalkan" : "Ya, selesaikan"
        }
        cancelLabel="Batal"
        destructive
        loading={submitting}
        onConfirm={() => void executeForceAction()}
      />
      {/* H02: dialog kustomisasi kolom */}
      <ColumnCustomizer prefs={cols} />
    </RoleGate>
  )
}
