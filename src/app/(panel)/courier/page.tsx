"use client"

/**
 * Admin — Kurir & pengiriman (GAP-D G242–G250).
 * Tab: Pengiriman (booking gagal / tracking basi / filter), Provider (feature flag),
 * Rekonsiliasi ongkir (estimasi vs aktual, refund ongkir).
 */

import { useCallback, useEffect, useState } from "react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { EmptyState } from "@/components/ui/empty-state"
import { Spinner } from "@/components/ui/spinner"
import { DataTable } from "@/components/ui/table"
import { useToast } from "@/components/ui/toast"
import { Pagination } from "@/components/admin/pagination"
import { RoleGate } from "@/components/admin/role-gate"
import { Select } from "@/components/admin/select"
import { Input } from "@/components/ui/input"
import {
  listAdminShipments,
  listCourierProviders,
  updateCourierProviderFlag,
  retryShipmentBooking,
  refreshShipmentTrackingAdmin,
  getShippingReconciliation,
  approveShippingRefund,
  type AdminShipmentItem,
  type CourierProviderInfo,
  type ShippingReconciliationRow,
} from "@/lib/api/admin/courier"
import { userMessage } from "@/lib/api/response"
import { formatDateTimeWIB, formatIDR } from "@/lib/format"

const PAGE_SIZE = 20
/** F04: ambang "tracking basi" — sama dengan STALE_EVENT_THRESHOLD_HOURS backend. */
const STALE_HOURS = 48

/** F01/F02: biaya ongkir = RUPIAH utuh (string BigInt) — jangan formatIdrSen (÷100). */
function formatCost(value: string | number | null | undefined): string {
  if (value == null || value === "") return "—"
  const n = Number(value)
  return Number.isFinite(n) ? formatIDR(n) : "—"
}

type Tab = "shipments" | "providers" | "reconciliation"

function ShipmentsTab() {
  const toast = useToast()
  const [bookingState, setBookingState] = useState("")
  const [searchInput, setSearchInput] = useState("")
  const [search, setSearch] = useState("")
  // F04: filter tracking basi (API `staleHours` sudah ada, UI-nya belum).
  const [staleOnly, setStaleOnly] = useState(false)
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [rows, setRows] = useState<AdminShipmentItem[]>([])
  const [totalPages, setTotalPages] = useState(1)

  const load = useCallback(
    async (p = page, bs = bookingState, s = search, stale = staleOnly) => {
      setLoading(true)
      setError(null)
      try {
        const res = await listAdminShipments({
          page: p,
          limit: PAGE_SIZE,
          bookingState: bs || undefined,
          search: s || undefined,
          staleHours: stale ? STALE_HOURS : undefined,
        })
        setRows(res.data ?? [])
        setTotalPages(res.totalPages ?? 1)
      } catch (e) {
        setError(userMessage(e))
      } finally {
        setLoading(false)
      }
    },
    [page, bookingState, search, staleOnly],
  )

  useEffect(() => { void load() }, [load])

  async function act(id: string, label: string, fn: () => Promise<unknown>, confirm?: string) {
    if (confirm && !window.confirm(confirm)) return
    try {
      await fn()
      toast.show({ title: `Berhasil: ${label}`, tone: "success" })
      await load()
    } catch (e) {
      toast.show({ title: `Gagal: ${label}`, description: userMessage(e), tone: "danger" })
    }
  }

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <Select label="Status booking" value={bookingState}
          options={[
            { value: "", label: "Semua" },
            { value: "DRAFT", label: "Draf" },
            { value: "BOOKED", label: "Ter-booking" },
            { value: "FAILED", label: "Gagal" },
            { value: "VOIDED", label: "Dibatalkan" },
          ]}
          onChange={(e) => { setBookingState(e.target.value); setPage(1); void load(1, e.target.value, search) }} className="w-52" />
        <form className="flex flex-1 flex-wrap items-end gap-2" onSubmit={(e) => { e.preventDefault(); const q = searchInput.trim(); setSearch(q); setPage(1); void load(1, bookingState, q) }}>
          <Input label="Cari pengiriman" value={searchInput} onChange={(e) => setSearchInput(e.target.value)} placeholder="ID / resi / order…" className="min-w-52 flex-1" />
          <Button type="submit" variant="secondary" size="md" fullWidth={false}>Cari</Button>
        </form>
        <label className="flex items-center gap-2 pb-2 text-body">
          <input
            type="checkbox"
            checked={staleOnly}
            onChange={(e) => { setStaleOnly(e.target.checked); setPage(1); void load(1, bookingState, search, e.target.checked) }}
          />
          Hanya tracking basi (&gt;{STALE_HOURS} jam)
        </label>
      </div>
      {loading ? (
        <div className="flex min-h-[30vh] items-center justify-center gap-2"><Spinner size="md" /><p className="text-body text-text-secondary">Memuat…</p></div>
      ) : error ? (
        <Card><EmptyState title="Gagal memuat" description={error} action={<Button variant="secondary" fullWidth={false} onClick={() => load()}>Coba lagi</Button>} /></Card>
      ) : (
        <>
          <DataTable<AdminShipmentItem>
            columns={[
              { key: "id", header: "Pengiriman", render: (r) => (
                <div><div className="font-semibold">{String(r.trackingNumber ?? r.id).slice(0, 24)}</div>
                {/* F05: orderId kini kode publik ORD-… (bukan cuid internal). */}
                <div className="text-small text-text-secondary">{String(r.providerCode).toUpperCase()} · Order {String(r.orderId)}</div></div>) },
              { key: "bookingState", header: "Booking", render: (r) => <Badge>{String(r.bookingState)}</Badge> },
              { key: "status", header: "Status", render: (r) => (
                <div className="flex flex-wrap gap-1">
                  <Badge>{String(r.status)}</Badge>
                  {r.slaBreached ? <Badge tone="danger">Terlambat</Badge> : null}
                </div>) },
              { key: "cost", header: "Estimasi → Aktual", render: (r) => (
                <span>{formatCost(r.estimatedCost)} → {formatCost(r.actualCost)}</span>) },
              { key: "lastEventAt", header: "Event terakhir", render: (r) => <span>{r.lastEventAt ? formatDateTimeWIB(String(r.lastEventAt)) : "—"}</span> },
              { key: "actions", header: "Aksi", render: (r) => (
                <div className="flex flex-wrap gap-1">
                  {String(r.bookingState) === "FAILED" ? (
                    <Button size="sm" variant="secondary" fullWidth={false} onClick={() => act(r.id, "retry booking", () => retryShipmentBooking(r.id), "Coba ulang booking kurir?")}>Retry booking</Button>
                  ) : null}
                  <Button size="sm" variant="secondary" fullWidth={false} onClick={() => act(r.id, "refresh tracking", () => refreshShipmentTrackingAdmin(r.id))}>Segarkan</Button>
                </div>) },
            ]}
            rows={rows}
            emptyText="Tidak ada pengiriman."
          />
          <div className="mt-4 flex justify-end"><Pagination page={page} totalPages={totalPages} onPageChange={(p: number) => { setPage(p); void load(p) }} /></div>
        </>
      )}
    </div>
  )
}

function ProvidersTab() {
  const toast = useToast()
  const [loading, setLoading] = useState(true)
  const [providers, setProviders] = useState<CourierProviderInfo[]>([])
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      setProviders(await listCourierProviders())
    } catch (e) {
      setError(userMessage(e))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  async function toggle(p: CourierProviderInfo) {
    try {
      await updateCourierProviderFlag(p.providerCode, { enabled: !p.enabled })
      toast.show({ title: p.enabled ? "Provider dimatikan" : "Provider dinyalakan", tone: "success" })
      await load()
    } catch (e) {
      toast.show({ title: "Gagal mengubah flag", description: userMessage(e), tone: "danger" })
    }
  }

  return (
    <div>
      <p className="mb-4 text-body text-text-secondary">
        Feature flag per provider (G246). Provider yang dimatikan tidak dipakai untuk quote/booking baru.
        Mock provider hanya aktif di non-produksi.
      </p>
      {loading ? (
        <div className="flex min-h-[30vh] items-center justify-center gap-2"><Spinner size="md" /><p className="text-body text-text-secondary">Memuat…</p></div>
      ) : error ? (
        <Card><EmptyState title="Gagal memuat" description={error} action={<Button variant="secondary" fullWidth={false} onClick={() => load()}>Coba lagi</Button>} /></Card>
      ) : (
        <DataTable<CourierProviderInfo>
          columns={[
            { key: "providerCode", header: "Provider", render: (r) => <span className="font-semibold">{r.name ?? r.providerCode}</span> },
            { key: "enabled", header: "Status", render: (r) => <Badge>{r.enabled ? "Aktif" : "Mati"}</Badge> },
            { key: "priority", header: "Prioritas", render: (r) => <span>{r.priority ?? "—"}</span> },
            { key: "regions", header: "Wilayah", render: (r) => (
              <span className="text-small">{(r.regionWhitelist ?? []).length > 0 ? `Allowlist: ${(r.regionWhitelist ?? []).join(", ")}` : (r.regionBlacklist ?? []).length > 0 ? `Blocklist: ${(r.regionBlacklist ?? []).join(", ")}` : "Semua"}</span>) },
            { key: "actions", header: "Aksi", render: (r) => (
              // BAI-011: PATCH providers/:providerCode SUPER_ADMIN-only
              // (backend @AdminRoles) — sembunyikan toggle dari
              // FINANCE_ADMIN/CUSTOMER_SUPPORT agar tidak 403.
              <RoleGate roles={["SUPER_ADMIN"]}>
                <Button size="sm" variant="secondary" fullWidth={false} onClick={() => toggle(r)}>
                  {r.enabled ? "Matikan" : "Nyalakan"}
                </Button>
              </RoleGate>) },
          ]}
          rows={providers}
          emptyText="Tidak ada provider."
        />
      )}
    </div>
  )
}

function ReconciliationTab() {
  const toast = useToast()
  const [onlyMismatch, setOnlyMismatch] = useState(true)
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)
  const [rows, setRows] = useState<ShippingReconciliationRow[]>([])
  const [totalPages, setTotalPages] = useState(1)

  const load = useCallback(
    async (p = page, om = onlyMismatch) => {
      setLoading(true)
      try {
        const res = await getShippingReconciliation({ page: p, limit: PAGE_SIZE, onlyMismatch: om })
        setRows(res.data ?? [])
        setTotalPages(res.totalPages ?? 1)
      } catch (e) {
        toast.show({ title: "Gagal memuat rekonsiliasi", description: userMessage(e), tone: "danger" })
      } finally {
        setLoading(false)
      }
    },
    [page, onlyMismatch, toast],
  )

  useEffect(() => { void load() }, [load])

  /**
   * F03: refund ongkir hanya bila pembayar KELEBIHAN bayar — estimasi
   * (yang ditagih) lebih besar dari aktual. `diff` backend = aktual −
   * estimasi, jadi kelebihan = −diff. Logika lama terbalik (refund saat
   * aktual > estimasi) dan nominalnya dianggap sen.
   */
  function overcharge(r: ShippingReconciliationRow): number {
    const diff = Number(r.diff ?? 0)
    return Number.isFinite(diff) && diff < 0 ? -diff : 0
  }

  async function refund(r: ShippingReconciliationRow) {
    const amount = overcharge(r)
    if (!(amount > 0)) {
      toast.show({ title: "Tidak ada kelebihan bayar ongkir", tone: "danger" })
      return
    }
    const reason = window.prompt("Alasan refund ongkir:", "Ongkir aktual lebih rendah dari estimasi yang ditagih")
    if (!reason) return
    try {
      await approveShippingRefund(r.shipmentId, { amount, reason })
      toast.show({ title: "Refund ongkir disetujui", tone: "success" })
      await load()
    } catch (e) {
      toast.show({ title: "Gagal refund", description: userMessage(e), tone: "danger" })
    }
  }

  return (
    <div>
      <div className="mb-4 flex items-center gap-3">
        <label className="flex items-center gap-2 text-body">
          <input type="checkbox" checked={onlyMismatch} onChange={(e) => { setOnlyMismatch(e.target.checked); setPage(1); void load(1, e.target.checked) }} />
          Hanya tampilkan yang berselisih
        </label>
      </div>
      {loading ? (
        <div className="flex min-h-[30vh] items-center justify-center gap-2"><Spinner size="md" /><p className="text-body text-text-secondary">Memuat…</p></div>
      ) : (
        <>
          <DataTable<ShippingReconciliationRow>
            columns={[
              { key: "shipmentId", header: "Pengiriman", render: (r) => <span className="font-semibold">{String(r.shipmentId).slice(0, 16)}…</span> },
              { key: "providerCode", header: "Kurir", render: (r) => <span>{String(r.providerCode).toUpperCase()}</span> },
              { key: "orderId", header: "Order", render: (r) => <span className="text-small">{String(r.orderId)}</span> },
              { key: "estimated", header: "Estimasi", render: (r) => <span>{formatCost(r.estimatedCost)}</span> },
              { key: "actual", header: "Aktual", render: (r) => <span>{formatCost(r.actualCost)}</span> },
              { key: "diff", header: "Aktual − Estimasi", render: (r) => <span className={overcharge(r) > 0 ? "font-bold text-text-danger" : ""}>{formatCost(r.diff)}</span> },
              { key: "actions", header: "Aksi", render: (r) => (
                overcharge(r) > 0 ? (
                  <Button size="sm" variant="secondary" fullWidth={false} onClick={() => refund(r)}>Refund {formatIDR(overcharge(r))}</Button>
                ) : <span className="text-small text-text-secondary">—</span>) },
            ]}
            rows={rows}
            emptyText="Tidak ada data rekonsiliasi."
          />
          <div className="mt-4 flex justify-end"><Pagination page={page} totalPages={totalPages} onPageChange={(p: number) => { setPage(p); void load(p) }} /></div>
        </>
      )}
    </div>
  )
}

export default function CourierAdminPage() {
  const [tab, setTab] = useState<Tab>("shipments")
  return (
    <RoleGate href="/courier">
      <div className="mb-6">
        <h1 className="text-h2 font-bold text-text-primary">Kurir & Pengiriman</h1>
        <p className="mt-1 text-body text-text-secondary">
          Operasional pengiriman: booking gagal, tracking basi, feature flag provider, rekonsiliasi ongkir.
        </p>
      </div>
      <div className="mb-4 flex gap-2">
        {([["shipments", "Pengiriman"], ["providers", "Provider"], ["reconciliation", "Rekonsiliasi"]] as [Tab, string][]).map(([v, label]) => (
          <Button key={v} variant={tab === v ? "primary" : "secondary"} size="sm" fullWidth={false} onClick={() => setTab(v)}>
            {label}
          </Button>
        ))}
      </div>
      <Card>
        {tab === "shipments" ? <ShipmentsTab /> : tab === "providers" ? <ProvidersTab /> : <ReconciliationTab />}
      </Card>
    </RoleGate>
  )
}
