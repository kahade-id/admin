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
import { formatDateTimeWIB, formatIdrSen } from "@/lib/format"

const PAGE_SIZE = 20

type Tab = "shipments" | "providers" | "reconciliation"

function ShipmentsTab() {
  const toast = useToast()
  const [bookingState, setBookingState] = useState("")
  const [searchInput, setSearchInput] = useState("")
  const [search, setSearch] = useState("")
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [rows, setRows] = useState<AdminShipmentItem[]>([])
  const [totalPages, setTotalPages] = useState(1)

  const load = useCallback(
    async (p = page, bs = bookingState, s = search) => {
      setLoading(true)
      setError(null)
      try {
        const res = await listAdminShipments({ page: p, limit: PAGE_SIZE, bookingState: bs || undefined, search: s || undefined })
        setRows(res.data ?? [])
        setTotalPages(res.totalPages ?? 1)
      } catch (e) {
        setError(userMessage(e))
      } finally {
        setLoading(false)
      }
    },
    [page, bookingState, search],
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
                <div className="text-small text-text-secondary">{String(r.providerCode).toUpperCase()} · Order {String(r.orderId).slice(0, 8)}…</div></div>) },
              { key: "bookingState", header: "Booking", render: (r) => <Badge>{String(r.bookingState)}</Badge> },
              { key: "status", header: "Status", render: (r) => <Badge>{String(r.status)}</Badge> },
              { key: "cost", header: "Estimasi → Aktual", render: (r) => (
                <span>{r.estimatedCost != null ? formatIdrSen(r.estimatedCost as string | number) : "—"} → {r.actualCost != null ? formatIdrSen(r.actualCost as string | number) : "—"}</span>) },
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
              <Button size="sm" variant="secondary" fullWidth={false} onClick={() => toggle(r)}>
                {r.enabled ? "Matikan" : "Nyalakan"}
              </Button>) },
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

  async function refund(r: ShippingReconciliationRow) {
    const amount = Number(r.diffSen ?? 0)
    if (!(amount > 0)) {
      toast.show({ title: "Tidak ada selisih positif", tone: "danger" })
      return
    }
    const reason = window.prompt("Alasan refund ongkir:", "Selisih ongkir aktual < estimasi")
    if (!reason) return
    try {
      await approveShippingRefund(r.shipmentId, { amountSen: amount, reason })
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
              { key: "estimated", header: "Estimasi", render: (r) => <span>{r.estimatedCostSen != null ? formatIdrSen(r.estimatedCostSen as string | number) : "—"}</span> },
              { key: "actual", header: "Aktual", render: (r) => <span>{r.actualCostSen != null ? formatIdrSen(r.actualCostSen as string | number) : "—"}</span> },
              { key: "diff", header: "Selisih", render: (r) => <span className={Number(r.diffSen ?? 0) > 0 ? "font-bold text-text-danger" : ""}>{r.diffSen != null ? formatIdrSen(r.diffSen as string | number) : "—"}</span> },
              { key: "actions", header: "Aksi", render: (r) => (
                Number(r.diffSen ?? 0) > 0 ? (
                  <Button size="sm" variant="secondary" fullWidth={false} onClick={() => refund(r)}>Refund ongkir</Button>
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
