"use client"

/**
 * Admin — Antrean retur (GAP-D G214–G217, G224).
 * Filter status + umur pengajuan (sorot SLA), aksi: eskalasi, setujui refund,
 * perpanjang deadline penjual, paksa tutup. Mutasi dengan Idempotency-Key.
 */

import Link from "next/link"
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
  listAdminReturns,
  adminEscalateReturn,
  adminApproveReturnRefund,
  adminExtendSellerDeadline,
  adminForceCloseReturn,
  ADMIN_RETURN_STATUS_LABEL,
  type AdminReturnItem,
  type AdminReturnStatus,
} from "@/lib/api/admin/returns"
import { userMessage } from "@/lib/api/response"
import { formatDateTimeWIB, formatIdrSen } from "@/lib/format"

const PAGE_SIZE = 20
/** SLA respons penjual backend — lihat RETURNS_SLA_HOURS (default 72 jam). */
const SELLER_SLA_HOURS = 72

const STATUS_OPTIONS = [
  { value: "ALL", label: "Semua status" },
  ...Object.entries(ADMIN_RETURN_STATUS_LABEL).map(([value, label]) => ({ value, label })),
]

const AGE_OPTIONS = [
  { value: "0", label: "Semua umur" },
  { value: "24", label: "> 24 jam" },
  { value: "48", label: "> 48 jam" },
  { value: SELLER_SLA_HOURS.toString(), label: `> ${SELLER_SLA_HOURS} jam (lewat SLA)` },
]

function ageHours(createdAt: string): number {
  const ms = Date.now() - new Date(createdAt).getTime()
  return Math.max(0, Math.floor(ms / 3_600_000))
}

export default function ReturnsListPage() {
  const toast = useToast()
  const [statusFilter, setStatusFilter] = useState("ALL")
  const [ageFilter, setAgeFilter] = useState("0")
  const [searchInput, setSearchInput] = useState("")
  const [search, setSearch] = useState("")
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [rows, setRows] = useState<AdminReturnItem[]>([])
  const [total, setTotal] = useState(0)
  const [totalPages, setTotalPages] = useState(1)
  const [acting, setActing] = useState<string | null>(null)

  const load = useCallback(
    async (targetPage = page, targetStatus = statusFilter, targetAge = ageFilter, targetSearch = search) => {
      setLoading(true)
      setError(null)
      try {
        const res = await listAdminReturns({
          page: targetPage,
          limit: PAGE_SIZE,
          status: targetStatus === "ALL" ? undefined : targetStatus,
          minAgeHours: Number(targetAge) > 0 ? Number(targetAge) : undefined,
          search: targetSearch.trim() || undefined,
        })
        setRows(res.data ?? [])
        const t = res.total ?? res.data?.length ?? 0
        setTotal(t)
        setTotalPages(res.totalPages ?? Math.max(1, Math.ceil(t / PAGE_SIZE)))
      } catch (e) {
        const msg = userMessage(e)
        setError(msg)
        toast.show({ title: "Gagal memuat antrean retur", description: msg, tone: "danger" })
      } finally {
        setLoading(false)
      }
    },
    [page, statusFilter, ageFilter, search, toast],
  )

  useEffect(() => {
    void load()
  }, [load])

  async function runAction(id: string, label: string, fn: () => Promise<unknown>, confirm?: string) {
    const go = async () => {
      setActing(id)
      try {
        await fn()
        toast.show({ title: `Berhasil: ${label}`, tone: "success" })
        await load()
      } catch (e) {
        toast.show({ title: `Gagal: ${label}`, description: userMessage(e), tone: "danger" })
      } finally {
        setActing(null)
      }
    }
    if (confirm) {
      if (!window.confirm(confirm)) return
    }
    await go()
  }

  return (
    <RoleGate href="/returns">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-h2 font-bold text-text-primary">Retur</h1>
          <p className="mt-1 text-body text-text-secondary">
            Antrean pengajuan retur/tukar barang. SLA respons penjual {SELLER_SLA_HOURS} jam.
          </p>
        </div>
        <Button variant="secondary" size="sm" fullWidth={false} loading={loading} onClick={() => load()}>
          Muat ulang
        </Button>
      </div>

      <div className="mb-4 flex flex-wrap items-end gap-3">
        <Select label="Status" options={STATUS_OPTIONS} value={statusFilter}
          onChange={(e) => { setStatusFilter(e.target.value); setPage(1); void load(1, e.target.value, ageFilter, search) }} className="w-52" />
        <Select label="Umur pengajuan" options={AGE_OPTIONS} value={ageFilter}
          onChange={(e) => { setAgeFilter(e.target.value); setPage(1); void load(1, statusFilter, e.target.value, search) }} className="w-52" />
        <form className="flex flex-1 flex-wrap items-end gap-2" onSubmit={(e) => { e.preventDefault(); const q = searchInput.trim(); setSearch(q); setPage(1); void load(1, statusFilter, ageFilter, q) }}>
          <Input label="Cari retur / order" value={searchInput} onChange={(e) => setSearchInput(e.target.value)} placeholder="ID retur atau ID order…" className="min-w-52 flex-1" />
          <Button type="submit" variant="secondary" size="md" fullWidth={false}>Cari</Button>
        </form>
      </div>

      {loading ? (
        <div className="flex min-h-[40vh] items-center justify-center gap-2">
          <Spinner size="md" /><p className="text-body text-text-secondary">Memuat retur…</p>
        </div>
      ) : error ? (
        <Card><EmptyState title="Gagal memuat retur" description={error} action={<Button variant="secondary" fullWidth={false} onClick={() => load()}>Coba lagi</Button>} /></Card>
      ) : (
        <>
          <DataTable<AdminReturnItem>
            columns={[
              {
                key: "returnId",
                header: "Retur",
                render: (r) => (
                  <div>
                    <Link href={`/returns/${encodeURIComponent(r.id)}`} className="font-semibold text-text-link hover:underline">
                      {String(r.returnId ?? r.id)}
                    </Link>
                    <div className="text-small text-text-secondary">Order {String(r.orderId ?? "—")}</div>
                  </div>
                ),
              },
              {
                key: "status",
                header: "Status",
                render: (r) => <Badge>{ADMIN_RETURN_STATUS_LABEL[r.status as AdminReturnStatus] ?? String(r.status)}</Badge>,
              },
              {
                key: "age",
                header: "Umur",
                render: (r) => {
                  const h = ageHours(String(r.createdAt))
                  const slaBreach = h >= SELLER_SLA_HOURS && ["REQUESTED", "SELLER_REVIEW"].includes(String(r.status))
                  return (
                    <span className={slaBreach ? "font-bold text-text-danger" : ""}>
                      {h} jam{slaBreach ? " (lewat SLA)" : ""}
                    </span>
                  )
                },
              },
              {
                key: "refund",
                header: "Refund",
                render: (r) => <span>{r.refundAmount != null ? formatIdrSen(r.refundAmount as string | number) : "—"}</span>,
              },
              {
                key: "createdAt",
                header: "Diajukan",
                render: (r) => <span>{formatDateTimeWIB(String(r.createdAt))}</span>,
              },
              {
                key: "actions",
                header: "Aksi",
                render: (r) => (
                  <div className="flex flex-wrap gap-1">
                    {["REQUESTED", "SELLER_REVIEW"].includes(String(r.status)) ? (
                      <Button size="sm" variant="secondary" fullWidth={false} loading={acting === r.id}
                        onClick={() => runAction(r.id, "eskalasi", () => adminEscalateReturn(r.id), "Eskalasi retur ini ke sengketa? Sengketa yang sudah ada akan dipakai ulang.")}>
                        Eskalasi
                      </Button>
                    ) : null}
                    {["APPROVED", "RECEIVED"].includes(String(r.status)) ? (
                      <Button size="sm" variant="secondary" fullWidth={false} loading={acting === r.id}
                        onClick={() => runAction(r.id, "setujui refund", () => adminApproveReturnRefund(r.id), "Setujui refund retur ini? Refund dieksekusi sekali (idempoten).")}>
                        Setujui refund
                      </Button>
                    ) : null}
                    {["REQUESTED", "SELLER_REVIEW"].includes(String(r.status)) ? (
                      <Button size="sm" variant="secondary" fullWidth={false} loading={acting === r.id}
                        onClick={() => runAction(r.id, "perpanjang deadline", () => adminExtendSellerDeadline(r.id, 24))}>
                        +24 jam
                      </Button>
                    ) : null}
                    {!["RESOLVED_REFUND", "RESOLVED_EXCHANGE", "RESOLVED_REPAIR", "CANCELLED", "EXPIRED"].includes(String(r.status)) ? (
                      <Button size="sm" variant="secondary" fullWidth={false} loading={acting === r.id}
                        onClick={() => {
                          const note = window.prompt("Catatan penutupan paksa (wajib):", "")
                          if (!note) return
                          void runAction(r.id, "tutup paksa", () => adminForceCloseReturn(r.id, { resolution: "ADMIN_CLOSED", note }))
                        }}>
                        Tutup paksa
                      </Button>
                    ) : null}
                  </div>
                ),
              },
            ]}
            rows={rows}
            emptyText="Tidak ada retur."
          />
          <div className="mt-4 flex items-center justify-between">
            <p className="text-small text-text-secondary">Total {total} retur</p>
            <Pagination page={page} totalPages={totalPages} onPageChange={(p) => { setPage(p); void load(p) }} />
          </div>
        </>
      )}
    </RoleGate>
  )
}
