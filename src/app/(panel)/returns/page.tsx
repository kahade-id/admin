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
import { userMessage } from "@/lib/api/response"
import { downloadCsv } from "@/lib/csv"
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

/** Status yang masih bisa dieskalasi / ditolak / diperpanjang deadline-nya. */
const EARLY_STATUSES = ["REQUESTED", "SELLER_REVIEW"]
/** Status yang refund-nya bisa disetujui admin. */
const APPROVABLE_STATUSES = ["APPROVED", "RECEIVED"]
/** Status terminal — tidak ada aksi tersisa. */
const TERMINAL_STATUSES = [
  "RESOLVED_REFUND",
  "RESOLVED_EXCHANGE",
  "RESOLVED_REPAIR",
  "CANCELLED",
  "EXPIRED",
]

function senOf(v: unknown): number | null {
  if (v == null) return null
  const n = typeof v === "string" ? Number(v) : typeof v === "number" ? v : NaN
  return Number.isFinite(n) ? Math.round(n) : null
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

  // ADM-113: dialog aksi (pengganti window.confirm/prompt).
  const [actionKind, setActionKind] = useState<ReturnActionKind | null>(null)
  const [actionTarget, setActionTarget] = useState<AdminReturnItem | null>(null)
  const [confirming, setConfirming] = useState(false)

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
      ["ID Retur", "ID Order", "Status", "Alasan", "Refund (sen)", "Umur (jam)", "Diajukan"],
      rows.map((r) => [
        String(r.returnId ?? r.id),
        String(r.orderId ?? ""),
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
            Antrean pengajuan retur/tukar barang. SLA respons penjual {SELLER_SLA_HOURS} jam.
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
                render: (r) => {
                  const s = String(r.status)
                  const terminal = TERMINAL_STATUSES.includes(s)
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
                          <Button size="sm" variant="secondary" fullWidth={false} onClick={() => openAction("extend", r)}>
                            +24 jam
                          </Button>
                        </>
                      ) : null}
                      {APPROVABLE_STATUSES.includes(s) ? (
                        <Button size="sm" variant="secondary" fullWidth={false} onClick={() => openAction("approve", r)}>
                          Setujui refund
                        </Button>
                      ) : null}
                      {!terminal ? (
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
