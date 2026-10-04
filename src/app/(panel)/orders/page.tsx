/**
 * Admin — Order: daftar order + intervensi darurat escrow.
 *
 * - Tabel order: pencarian (debounce ~400ms) + filter status + Pagination.
 * - Klik "Detail" pada baris → Dialog detail: pembeli, penjual, nominal,
 *   status escrow (diturunkan dari transaksi ORDER_LOCK / ORDER_RELEASE /
 *   ORDER_REFUND / DISPUTE_RELEASE), timeline dari riwayat status.
 * - Aksi darurat "Paksa batal" / "Paksa selesai": KONFIRMASI GANDA —
 *   Dialog pertama wajib alasan (min 10 karakter) → dialog konfirmasi kedua
 *   (+ re-auth password, AUT-013)
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
import { Dialog } from "@/components/ui/dialog"
import { Input, TextArea } from "@/components/ui/input"
import { Spinner } from "@/components/ui/spinner"
import { DataTable } from "@/components/ui/table"
import { useToast } from "@/components/ui/toast"

import { Pagination } from "@/components/admin/pagination"
import { RoleGate } from "@/components/admin/role-gate"
// Lokasi presisi order: helper format + link Maps (dipakai juga di detail user).
import {
  formatCoordinates,
  googleMapsLink,
} from "@/components/admin/action-location-view"
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
import { newIdempotencyKey } from "@/lib/api/admin/finance"
import { getRoomIdByOrder, getRoomMessages } from "@/lib/api/admin/chat"
import { userMessage } from "@/lib/api/response"
import { downloadCsv } from "@/lib/csv"
import { fetchAllPages } from "@/lib/fetch-all-pages"
import { formatDateTimeWIB, formatNumber, messageFallbackLabel } from "@/lib/format"
// ADM-405: PII pihak transaksi di-mask secara default (mask-only, tanpa unmask).
import { maskEmail, maskName } from "@/lib/pii"
// POIN 2 (unifikasi transaksi escrow): tipe transaksi order.
import {
  ORDER_KIND_FILTER_OPTIONS,
  orderKindLabel,
  type OrderKind,
} from "@/lib/order-kind"

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
  WAITING_CONFIRMATION: "Menunggu konfirmasi penjual",
  WAITING_PAYMENT: "Menunggu pembayaran",
  PROCESSING: "Diproses penjual",
  IN_DELIVERY: "Dalam pengiriman",
  COMPLETED: "Selesai",
  DISPUTED: "Sengketa",
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
  { value: "PROCESSING", label: "Diproses penjual" },
  { value: "IN_DELIVERY", label: "Dalam pengiriman" },
  { value: "DISPUTED", label: "Sengketa" },
  { value: "WAITING_PAYMENT", label: "Menunggu pembayaran" },
  { value: "WAITING_CONFIRMATION", label: "Menunggu konfirmasi penjual" },
  { value: "COMPLETED", label: "Selesai" },
  { value: "CANCELLED", label: "Dibatalkan" },
]

// POIN 2 (unifikasi transaksi escrow): filter + badge tipe transaksi.
// Nilai enum asumsi (lihat src/lib/order-kind.ts) — diselaraskan ke kontrak
// final backend bila berbeda.
const KIND_FILTERS = [
  { value: "", label: "Semua tipe" },
  ...ORDER_KIND_FILTER_OPTIONS.filter((o) => o.value !== "ALL"),
]

const KIND_TONE: Record<string, BadgeTone> = {
  DIRECT: "neutral",
  JASTIP: "info",
  PATUNGAN: "accent",
  SERVICE_BOOKING: "warning",
}

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

/**
 * Status escrow diturunkan dari transaksi wallet order (yang terbaru relevan)
 * ATAU — di mode tanpa-wallet (DANA-direct) — dari `detail.danaPayments`.
 * MFE-012: tanpa wallet, `walletTransactions` tidak memuat escrow sama
 * sekali, sehingga badge lama selalu "Tanpa escrow" walau dana nyata
 * tertahan di DANA. DANA-direct kini sumber kebenaran pertama.
 */
function escrowStateOf(detail: AdminOrderDetail): {
  label: string
  tone: BadgeTone
} {
  // DANA-direct dulu (mode tanpa-wallet): charge SUCCESS = escrow terkunci;
  // REFUNDED = dana kembali; FAILED/EXPIRED/CANCELLED = charge mati.
  const dana = (detail.danaPayments ?? [])[0]
  if (dana) {
    switch (dana.status) {
      case "SUCCESS":
        return { label: "Escrow DANA terkunci", tone: "warning" }
      case "REFUNDED":
        return { label: "Escrow DANA refund", tone: "info" }
      case "PENDING":
        return { label: "Bayar DANA pending", tone: "neutral" }
      case "PROCESSING":
        return { label: "Bayar DANA diproses", tone: "neutral" }
      default:
        return { label: "Bayar DANA gagal", tone: "danger" }
    }
  }
  const txs = detail.walletTransactions ?? []
  const relevant = txs.find((t) =>
    ["ORDER_LOCK", "ORDER_RELEASE", "ORDER_REFUND", "DISPUTE_RELEASE"].includes(
      String(t.type),
    ),
  )
  switch (String(relevant?.type)) {
    case "ORDER_LOCK":
      return { label: "Escrow (rekening bersama) terkunci", tone: "warning" }
    case "ORDER_RELEASE":
      return { label: "Dana dicairkan ke penjual", tone: "success" }
    case "ORDER_REFUND":
      return { label: "Dana escrow dikembalikan", tone: "info" }
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
    kind: "",
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
  // POIN 2: filter tipe transaksi → diteruskan sebagai param `kind` backend.
  const kindFilter = (f.kind || "") as OrderKind | ""
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
  /** Progres ekspor CSV: {done, total} halaman — null bila tidak mengekspor. */
  const [csvProgress, setCsvProgress] = useState<{ done: number; total: number } | null>(null)
  const FETCH_ALL_MAX_PAGES = 50

  /** Export CSV order sesuai filter aktif (pencarian/status/tipe/escrow/tanggal/urut). */
  const handleExportCsv = async () => {
    setCsvLoading(true)
    setCsvProgress(null)
    try {
      // AW-006 (perf-fix): ambil halaman paralel per batch (maks 4 konkuren)
      // + tampilkan progres — bukan loop sekuensial 50 halaman.
      const all = await fetchAllPages<AdminOrderItem>(
        (page, limit) =>
          listAdminOrders({
            page,
            limit,
            status: statusFilter || undefined,
            kind: kindFilter || undefined,
            q: f.search.trim() || undefined,
            hasEscrow: escrowOnly || undefined,
            startDate: startDate || undefined,
            endDate: endDate || undefined,
            sortBy: sortBy as "createdAt" | "updatedAt" | "orderValue" | "buyerPayAmount" | "completedAt",
            sortOrder: sortOrder as "asc" | "desc",
          }),
        {
          maxPages: FETCH_ALL_MAX_PAGES,
          limit: 100,
          concurrency: 4,
          onProgress: (done, total) => setCsvProgress({ done, total }),
        },
      )
      const stamp = new Date().toISOString().slice(0, 10)
      downloadCsv(
        `order-${stamp}.csv`,
        ["ID Order", "Judul", "Tipe", "Status", "Pembeli", "Penjual", "Nilai", "Dibayar pembeli", "Diterima penjual", "Dibuat"],
        all.items.map((r) => [
          r.orderId,
          r.title ?? "",
          orderKindLabel(r.orderKind),
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
        // BAD-032: jujur bila terpotong di batas 5.000 baris.
        description: all.truncated
          ? `${all.items.length} order sesuai filter aktif — PERHATIAN: hanya ${FETCH_ALL_MAX_PAGES * 100} baris pertama diekspor (data melebihi batas).`
          : `${all.items.length} order sesuai filter aktif.`,
        tone: all.truncated ? "info" : "success",
      })
    } catch (e) {
      toast.show({
        title: "Gagal mengekspor CSV",
        description: userMessage(e),
        tone: "danger",
      })
    } finally {
      setCsvLoading(false)
      setCsvProgress(null)
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
          kind: kindFilter || undefined,
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
    [statusFilter, kindFilter, f.search, escrowOnly, startDate, endDate, sortBy, sortOrder, toast],
  )

  useEffect(() => {
    void loadOrders(page)
  }, [page, loadOrders])

  const handleStatusChange = (value: string) => {
    // H01: filter status tersimpan di URL.
    setF({ status: value, page: "1" })
  }

  // POIN 2: filter tipe transaksi tersimpan di URL (diteruskan sebagai `kind`).
  const handleKindChange = (value: string) => {
    setF({ kind: value, page: "1" })
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
  // SEC-504: satu kunci idempotency per sesi dialog konfirmasi — dibuat saat
  // dialog dibuka, dibuang saat ditutup; retry memakai kunci yang sama.
  const forceKey = useMemo(
    () => (confirmOpen ? newIdempotencyKey() : null),
    [confirmOpen],
  )
  const [reason, setReason] = useState("")
  const [reasonError, setReasonError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  // AUT-013: re-auth password di dialog konfirmasi kedua — backend menolak
  // force-cancel/force-complete tanpa password yang benar.
  const [reauthPassword, setReauthPassword] = useState("")
  const [reauthError, setReauthError] = useState<string | null>(null)

  /** Langkah 1: validasi alasan → buka dialog konfirmasi kedua. */
  const proceedToConfirm = () => {
    if (reason.trim().length < 10) {
      setReasonError("Alasan minimal 10 karakter.")
      return
    }
    setReauthPassword("")
    setReauthError(null)
    setConfirmOpen(true)
  }

  /** Langkah 2: eksekusi setelah konfirmasi kedua (+ password re-auth). */
  const executeForceAction = useCallback(async () => {
    if (!detail || !forceAction || submitting) return
    if (!reauthPassword) {
      setReauthError("Masukkan kata sandi Anda untuk mengonfirmasi.")
      return
    }
    setSubmitting(true)
    try {
      if (forceAction === "cancel") {
        await forceCancelOrder(detail.orderId, reason.trim(), reauthPassword)
        toast.show({
          title: "Order dibatalkan",
          description: detail.orderId,
          tone: "success",
        })
      } else {
        await forceCompleteOrder(detail.orderId, reason.trim(), reauthPassword)
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
  }, [detail, forceAction, submitting, reason, reauthPassword, toast, loadOrders, page])

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

  /**
   * Lokasi presisi pembeli (fraud checking). Backend mengembalikan string
   * hasil dekripsi — parse defensif; null bila data tidak tersedia agar
   * tampilan tetap netral ("Tidak tersedia").
   */
  const buyerLocation = useMemo(() => {
    const loc = detail?.buyerLocation
    if (!loc) return null
    const toNumber = (v: string | number | null | undefined): number | null => {
      if (v == null || v === "") return null
      const n = typeof v === "number" ? v : Number(String(v).trim())
      return Number.isFinite(n) ? n : null
    }
    const lat = toNumber(loc.latitude)
    const lng = toNumber(loc.longitude)
    const coords = formatCoordinates(lat, lng)
    if (coords === null || lat == null || lng == null) return null
    return {
      coords,
      mapsUrl: googleMapsLink(lat, lng),
      accuracy: toNumber(loc.accuracy),
      capturedAt: loc.capturedAt ?? null,
    }
  }, [detail?.buyerLocation])
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
      // POIN 2 (unifikasi transaksi escrow): badge tipe transaksi dari
      // `orderKind` respons backend (tampil "—" sampai backend mengirimnya).
      {
        key: "kind",
        header: "Tipe",
        defaultVisible: true,
        render: (r) => {
          const k = typeof r.orderKind === "string" ? r.orderKind : ""
          return k ? (
            <Badge tone={KIND_TONE[k] ?? "neutral"}>{orderKindLabel(k)}</Badge>
          ) : (
            <span className="text-caption text-text-secondary">—</span>
          )
        },
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
              {csvLoading && csvProgress && csvProgress.total > 1
                ? `Mengambil ${csvProgress.done}/${csvProgress.total}…`
                : "Unduh CSV"}
            </Button>
          }
        />
        <CardBody>
          <div className="mb-4 grid grid-cols-1 gap-3 md:grid-cols-4">
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
            {/* POIN 2: filter tipe transaksi → param `kind` backend. */}
            <Select
              label="Tipe transaksi"
              value={kindFilter}
              onChange={(e) => handleKindChange(e.target.value)}
              options={KIND_FILTERS}
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

            {/* MFE-013: jejak finansial DANA-direct — lifecycle charge per
                order (payKind, partnerReferenceNo, providerFee, grossAmount,
                refundedAmount, status). Di mode tanpa-wallet ini adalah sumber
                kebenaran pembayaran (bukan walletTransactions). */}
            {(detail.danaPayments ?? []).length > 0 ? (
              <div>
                <p className="mb-2 text-label font-semibold text-text-secondary">
                  Pembayaran DANA
                </p>
                <div className="space-y-3">
                  {(detail.danaPayments ?? []).map((p) => (
                    <dl key={p.id}>
                      <KeyValue label="Metode" value={p.payKind} />
                      <KeyValue label="Status" value={p.status} />
                      <KeyValue
                        label="Referensi partner"
                        value={p.danaPartnerReferenceNo ?? p.partnerReferenceNo}
                      />
                      {p.danaReferenceNo ? (
                        <KeyValue label="Referensi DANA" value={p.danaReferenceNo} />
                      ) : null}
                      <KeyValue label="Escrow" value={formatRupiah(p.amount)} />
                      <KeyValue label="Fee provider" value={formatRupiah(p.providerFee)} />
                      <KeyValue label="Total tagihan" value={formatRupiah(p.grossAmount)} />
                      {p.refundedAmount > 0 ? (
                        <>
                          <KeyValue
                            label="Dana dikembalikan"
                            value={formatRupiah(p.refundedAmount)}
                          />
                          {p.refundReference ? (
                            <KeyValue label="Referensi refund" value={p.refundReference} />
                          ) : null}
                        </>
                      ) : null}
                      {p.paidAt ? (
                        <KeyValue label="Dibayar" value={formatDateTimeWIB(p.paidAt)} />
                      ) : null}
                      {p.failedAt ? (
                        <KeyValue label="Gagal/kedaluwarsa" value={formatDateTimeWIB(p.failedAt)} />
                      ) : null}
                    </dl>
                  ))}
                </div>
              </div>
            ) : null}

            {/* Lokasi presisi pembeli (fraud checking) — dari backend terdekripsi fail-closed. */}
            <div>
              <p className="mb-2 text-label font-semibold text-text-secondary">
                Lokasi
              </p>
              {buyerLocation ? (
                <div>
                  <dl>
                    <KeyValue label="Koordinat" value={buyerLocation.coords} />
                    <KeyValue
                      label="Akurasi"
                      value={
                        buyerLocation.accuracy != null
                          ? `± ${buyerLocation.accuracy} meter`
                          : "Tidak tersedia"
                      }
                    />
                    <KeyValue
                      label="Waktu capture"
                      value={
                        buyerLocation.capturedAt
                          ? formatDateTimeWIB(buyerLocation.capturedAt)
                          : "Tidak tersedia"
                      }
                    />
                  </dl>
                  <a
                    href={buyerLocation.mapsUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-1.5 inline-block text-caption text-info-text underline"
                  >
                    Buka di Maps
                  </a>
                </div>
              ) : (
                <p className="text-body text-text-secondary">Tidak tersedia</p>
              )}
            </div>

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
                            {/* FAL-004: label per tipe (Gambar/Video/Dokumen/…),
                                bukan "Pesan tanpa teks" generik. */}
                            {text ?? messageFallbackLabel(rec)}
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

      {/* Konfirmasi kedua — ganda + re-auth password (AUT-013) */}
      <Dialog
        open={confirmOpen}
        onClose={() => {
          if (!submitting) {
            setConfirmOpen(false)
            setReauthPassword("")
            setReauthError(null)
          }
        }}
        title={confirmTitle}
        description={confirmDescription}
        footer={
          <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
            <Button
              variant="ghost"
              fullWidth={false}
              disabled={submitting}
              onClick={() => {
                setConfirmOpen(false)
                setReauthPassword("")
                setReauthError(null)
              }}
            >
              Batal
            </Button>
            <Button
              variant="destructive"
              fullWidth={false}
              loading={submitting}
              onClick={() => void executeForceAction()}
            >
              {forceAction === "cancel" ? "Ya, batalkan" : "Ya, selesaikan"}
            </Button>
          </div>
        }
      >
        <div className="pt-2">
          <p className="mb-2 text-caption text-text-secondary">
            Tindakan ini memengaruhi dana escrow. Masukkan kata sandi Anda
            sebagai konfirmasi identitas — password tidak disimpan.
          </p>
          <Input
            type="password"
            value={reauthPassword}
            onChange={(e) => {
              setReauthPassword(e.target.value)
              if (reauthError) setReauthError(null)
            }}
            placeholder="Kata sandi Anda"
            autoComplete="current-password"
            autoFocus
          />
          {reauthError ? (
            <p role="alert" className="mt-1 text-caption text-danger-text">
              {reauthError}
            </p>
          ) : null}
        </div>
      </Dialog>
      {/* H02: dialog kustomisasi kolom */}
      <ColumnCustomizer prefs={cols} />
    </RoleGate>
  )
}
