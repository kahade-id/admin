"use client"

/**
 * Admin — Antrean retur.
 *
 * ADM-101/105: kontrak diselaraskan ke backend nyata —
 * list → GET /v1/admin/returns/queue (adaptor items → data),
 * aksi → POST /v1/admin/returns/:id/action { action, ... } + Idempotency-Key.
 * ADM-113: konfirmasi aksi via dialog (nominal + catatan tervalidasi),
 * bukan window.confirm/prompt.
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
import { useAuth } from "@/lib/auth-context"
import { Input } from "@/components/ui/input"
import {
  listAdminReturns,
  adminEscalateReturn,
  adminApproveReturnRefund,
  adminRejectReturn,
  adminExtendSellerDeadline,
  adminForceResolveReturn,
  ADMIN_RETURN_STATUS_LABEL,
  type AdminReturnItem,
  type AdminReturnStatus,
} from "@/lib/api/admin/returns"
import { ReturnActionDialog, type ReturnActionKind, type ReturnActionConfirmInput } from "./action-dialog"
// BAD-002: konstanta status retur — satu sumber kebenaran (lihat status-constants.ts).
import {
  APPROVABLE_STATUSES,
  EARLY_STATUSES,
  FORCEABLE_STATUSES,
} from "./status-constants"
import { userMessage } from "@/lib/api/response"
import { downloadCsv } from "@/lib/csv"
import { formatDateTimeWIB, formatIdrSen } from "@/lib/format"
// POIN 2 (unifikasi transaksi escrow): filter tipe transaksi (client-side —
// backend antrean retur belum mendukung filter server-side `kind`).
import {
  ORDER_KIND_FILTER_OPTIONS,
  orderKindLabel,
  rowOrderKind,
} from "@/lib/order-kind"

const PAGE_SIZE = 20

const STATUS_OPTIONS = [
  { value: "ALL", label: "Semua status" },
  ...Object.entries(ADMIN_RETURN_STATUS_LABEL).map(([value, label]) => ({ value, label })),
]

// BAI-096: filter umur murni numerik — klaim "lewat SLA" dihapus karena SLA
// dihitung per-baris dari sellerRespondBy backend (bukan konstanta 72 jam di
// UI; kebijakan bisa berubah tanpa UI ikut berubah).
const AGE_OPTIONS = [
  { value: "0", label: "Semua umur" },
  { value: "24", label: "> 24 jam" },
  { value: "48", label: "> 48 jam" },
  { value: "72", label: "> 72 jam" },
]

/** BAI-096: true bila deadline respons penjual (per-baris, dari backend) sudah lewat. */
function isPastSellerSla(row: { sellerRespondBy?: string | null; status: unknown }): boolean {
  if (!row.sellerRespondBy) return false
  if (!["REQUESTED", "SELLER_REVIEW"].includes(String(row.status))) return false
  return new Date(String(row.sellerRespondBy)).getTime() < Date.now()
}

function ageHours(createdAt: string): number {
  const ms = Date.now() - new Date(createdAt).getTime()
  return Math.max(0, Math.floor(ms / 3_600_000))
}

function senOf(v: unknown): number | null {
  if (v == null) return null
  const n = typeof v === "string" ? Number(v) : typeof v === "number" ? v : NaN
  return Number.isFinite(n) ? Math.round(n) : null
}

export default function ReturnsListPage() {
  const toast = useToast()
  const { role } = useAuth()
  // BAD-023: cermin halaman detail — Eskalasi/Tolak boleh untuk semua role
  // pengakses halaman (backend mengizinkan CUSTOMER_SUPPORT); hanya aksi
  // uang (extend deadline, approve, tutup paksa) yang butuh
  // SUPER_ADMIN/DISPUTE_ADMIN.
  const canMoneyAction = role === "SUPER_ADMIN" || role === "DISPUTE_ADMIN"
  const [statusFilter, setStatusFilter] = useState("ALL")
  const [ageFilter, setAgeFilter] = useState("0")
  // POIN 2: filter tipe transaksi — client-side dari field `orderKind`
  // respons (backend /v1/admin/returns belum mendukung filter `kind`).
  const [kindFilter, setKindFilter] = useState("ALL")
  const [searchInput, setSearchInput] = useState("")
  const [search, setSearch] = useState("")
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [rows, setRows] = useState<AdminReturnItem[]>([])
  const [total, setTotal] = useState(0)
  const [totalPages, setTotalPages] = useState(1)

  // ADM-113: dialog aksi (pengganti window.confirm/prompt).
  const [actionKind, setActionKind] = useState<ReturnActionKind | null>(null)
  const [actionTarget, setActionTarget] = useState<AdminReturnItem | null>(null)
  const [confirming, setConfirming] = useState(false)

  const load = useCallback(
    async (targetPage = page, targetStatus = statusFilter, targetAge = ageFilter, targetSearch = search, targetKind = kindFilter) => {
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
        // POIN 2: filter tipe diterapkan client-side pada halaman ini —
        // backend /v1/admin/returns belum mendukung filter `kind`.
        const items = (res.data ?? []).filter(
          (r) => targetKind === "ALL" || rowOrderKind(r) === targetKind,
        )
        setRows(items)
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
    [page, statusFilter, ageFilter, kindFilter, search, toast],
  )

  useEffect(() => {
    void load()
  }, [load])

  const openAction = (kind: ReturnActionKind, row: AdminReturnItem) => {
    setActionKind(kind)
    setActionTarget(row)
  }

  const closeAction = () => {
    if (confirming) return
    setActionKind(null)
    setActionTarget(null)
  }

  const confirmAction = async (input: ReturnActionConfirmInput) => {
    if (!actionTarget || !actionKind) return
    const id = actionTarget.id
    const label = String(actionTarget.returnId ?? id)
    setConfirming(true)
    try {
      switch (actionKind) {
        case "escalate":
          await adminEscalateReturn(id, input.note || undefined)
          break
        case "approve":
          await adminApproveReturnRefund(id, {
            refundAmountSen: input.refundAmountSen,
            note: input.note || undefined,
          })
          break
        case "reject":
          await adminRejectReturn(id, {
            rejectReasonCode: input.rejectReasonCode ?? "LAINNYA",
            note: input.note || undefined,
          })
          break
        case "force-resolve":
          await adminForceResolveReturn(id, input.resolution ?? "REFUND", input.note)
          break
        case "extend":
          await adminExtendSellerDeadline(id)
          break
      }
      toast.show({ title: `Berhasil: ${label}`, tone: "success" })
      setActionKind(null)
      setActionTarget(null)
      await load()
    } catch (e) {
      toast.show({ title: `Gagal: ${label}`, description: userMessage(e), tone: "danger" })
    } finally {
      setConfirming(false)
    }
  }

  /** ADM-125: ekspor CSV baris yang tampil (agregat, tanpa dokumen bukti). */
  const exportCsv = () => {
    if (rows.length === 0) return
    downloadCsv(
      `retur-antrean-${new Date().toISOString().slice(0, 10)}.csv`,
      ["ID Retur", "ID Order", "Tipe", "Status", "Alasan", "Refund (sen)", "Umur (jam)", "Diajukan"],
      rows.map((r) => [
        String(r.returnId ?? r.id),
        String(r.orderId ?? ""),
        orderKindLabel(rowOrderKind(r)),
        ADMIN_RETURN_STATUS_LABEL[r.status as AdminReturnStatus] ?? String(r.status),
        String(r.reasonCode ?? ""),
        r.refundAmount != null ? String(r.refundAmount) : "",
        String(ageHours(String(r.createdAt))),
        formatDateTimeWIB(String(r.createdAt)),
      ]),
    )
    toast.show({ title: "CSV antrean retur diunduh", tone: "success" })
  }

  return (
    <RoleGate href="/returns">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-h2 font-bold text-text-primary">Retur</h1>
          <p className="mt-1 text-body text-text-secondary">
            Antrean pengajuan retur/tukar barang. Batas respons penjual mengikuti deadline per-pengajuan.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" size="sm" fullWidth={false} disabled={rows.length === 0} onClick={exportCsv}>
            Ekspor CSV
          </Button>
          <Button variant="secondary" size="sm" fullWidth={false} loading={loading} onClick={() => load()}>
            Muat ulang
          </Button>
        </div>
      </div>

      <div className="mb-4 flex flex-wrap items-end gap-3">
        <Select label="Status" options={STATUS_OPTIONS} value={statusFilter}
          onChange={(e) => { setStatusFilter(e.target.value); setPage(1); void load(1, e.target.value, ageFilter, search, kindFilter) }} className="w-52" />
        <Select label="Umur pengajuan" options={AGE_OPTIONS} value={ageFilter}
          onChange={(e) => { setAgeFilter(e.target.value); setPage(1); void load(1, statusFilter, e.target.value, search, kindFilter) }} className="w-52" />
        {/* POIN 2: filter tipe transaksi — client-side (backend belum mendukung `kind`). */}
        <Select label="Tipe transaksi" options={ORDER_KIND_FILTER_OPTIONS} value={kindFilter}
          onChange={(e) => { setKindFilter(e.target.value); setPage(1); void load(1, statusFilter, ageFilter, search, e.target.value) }} className="w-52" />
        <form className="flex flex-1 flex-wrap items-end gap-2" onSubmit={(e) => { e.preventDefault(); const q = searchInput.trim(); setSearch(q); setPage(1); void load(1, statusFilter, ageFilter, q, kindFilter) }}>
          <Input label="Cari retur / order" value={searchInput} onChange={(e) => setSearchInput(e.target.value)} placeholder="ID retur atau ID order…" className="min-w-52 flex-1" />
          <Button type="submit" variant="secondary" size="md" fullWidth={false}>Cari</Button>
        </form>
      </div>
      {kindFilter !== "ALL" ? (
        <p className="mb-4 -mt-2 text-caption text-text-secondary">
          Filter tipe diterapkan pada data halaman ini — backend retur belum mendukung filter tipe server-side.
        </p>
      ) : null}

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
                  const slaBreach = isPastSellerSla(r)
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
                render: (r) => {
                  const s = String(r.status)
                  // BAD-023: cermin halaman detail (returns/[id]/page.tsx) —
                  // Eskalasi/Tolak tampil untuk semua role pengakses halaman
                  // (backend mengizinkan CUSTOMER_SUPPORT); hanya aksi uang
                  // yang di-gate ke SUPER_ADMIN/DISPUTE_ADMIN.
                  return (
                    <div className="flex flex-wrap gap-1">
                      {EARLY_STATUSES.includes(s) ? (
                        <>
                          <Button size="sm" variant="secondary" fullWidth={false} onClick={() => openAction("escalate", r)}>
                            Eskalasi
                          </Button>
                          <Button size="sm" variant="secondary" fullWidth={false} onClick={() => openAction("reject", r)}>
                            Tolak
                          </Button>
                          {canMoneyAction ? (
                            <Button size="sm" variant="secondary" fullWidth={false} onClick={() => openAction("extend", r)}>
                              +24 jam
                            </Button>
                          ) : null}
                        </>
                      ) : null}
                      {canMoneyAction && APPROVABLE_STATUSES.includes(s) ? (
                        <Button size="sm" variant="secondary" fullWidth={false} onClick={() => openAction("approve", r)}>
                          Setujui refund
                        </Button>
                      ) : null}
                      {/* BAD-003: "Tutup paksa" hanya di FORCEABLE_STATUSES
                          (dulu muncul di semua status non-terminal). */}
                      {canMoneyAction && FORCEABLE_STATUSES.includes(s) ? (
                        <Button size="sm" variant="secondary" fullWidth={false} onClick={() => openAction("force-resolve", r)}>
                          Tutup paksa
                        </Button>
                      ) : null}
                    </div>
                  )
                },
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

      <ReturnActionDialog
        open={actionKind !== null}
        kind={actionKind}
        returnLabel={actionTarget ? String(actionTarget.returnId ?? actionTarget.id) : ""}
        currentDeadline={actionTarget?.sellerRespondBy ? formatDateTimeWIB(String(actionTarget.sellerRespondBy)) : null}
        currentRefundSen={senOf(actionTarget?.refundAmount)}
        buyerPaySen={senOf(actionTarget?.order?.buyerPayAmount)}
        confirming={confirming}
        onClose={closeAction}
        onConfirm={(input) => void confirmAction(input)}
      />
    </RoleGate>
  )
}
