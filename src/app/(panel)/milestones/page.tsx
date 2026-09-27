/**
 * Admin — Dasbor Milestone: daftar tahap pembayaran per order + tab
 * rekonsiliasi escrow. JANGAN mengubah perilaku escrow satu tahap existing —
 * halaman ini hanya menampilkan tahap yang memang terdaftar di order.
 */

"use client"

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
import {
  formatMilestoneRupiah,
  getMilestoneEscrowSummary,
  listMilestones,
  reconcileRecentMilestones,
  type MilestoneAdminItem,
  type MilestoneEscrowSummary,
  type MilestoneReconcileRow,
} from "@/lib/api/admin/milestones"
import { userMessage } from "@/lib/api/response"
import { formatDateTimeWIB } from "@/lib/format"

import { MILESTONE_STATUS_LABEL, MILESTONE_STATUS_TONE } from "./maps"
import { cn } from "@/lib/cn"

const PAGE_SIZE = 20

const STATUS_OPTIONS = [
  { value: "", label: "Semua status" },
  { value: "AWAITING_ACTIVATION", label: "Menunggu aktivasi" },
  { value: "SUBMITTED", label: "Hasil terkirim" },
  { value: "REVISION_REQUESTED", label: "Revisi diminta" },
  { value: "ACCEPTED", label: "Diterima" },
  { value: "RELEASED", label: "Dicairkan" },
  { value: "CANCELLED", label: "Dibatalkan" },
  { value: "DISPUTED", label: "Disengketa" },
]

const CHECK_LABEL: Record<string, string> = {
  "sum(amount)=orderValue": "Σ tahap = nilai order",
  "sum(buyerAmount)=buyerPayAmount": "Σ buyerAmount = bayar pembeli",
  "sum(sellerAmount)=sellerReceiveAmount": "Σ sellerAmount = net penjual",
  "sum(feeAmount)=feeAmount": "Σ fee = fee order",
  "escrowHeld+released=buyerPayAmount": "escrowHeld + released = bayar pembeli",
}

type Tab = "list" | "reconcile"
function ReconcileTab() {
  const toast = useToast()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [rows, setRows] = useState<MilestoneReconcileRow[]>([])
  const [summary, setSummary] = useState<MilestoneEscrowSummary | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [res, sum] = await Promise.all([reconcileRecentMilestones(), getMilestoneEscrowSummary()])
      setRows(
        (res.violations ?? []).map((v) => ({
          orderId: v.orderId,
          checks: v.checks,
          status: "GAGAL" as const,
          failedChecks: v.checks.filter((c) => !c.ok).map((c) => c.name),
        })),
      )
      setSummary(sum)
    } catch (e) {
      const msg = userMessage(e)
      setError(msg)
      toast.show({ title: "Gagal memuat rekonsiliasi", description: msg, tone: "danger" })
    } finally {
      setLoading(false)
    }
  }, [toast])

  useEffect(() => {
    void load()
  }, [load])

  const failedCount = rows.filter((r) => r.status === "GAGAL").length

  if (loading) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center gap-2">
        <Spinner size="md" />
        <p className="text-body text-text-secondary">Memeriksa invarian…</p>
      </div>
    )
  }
  if (error) {
    return (
      <Card>
        <EmptyState title="Gagal memuat rekonsiliasi" description={error} action={
          <Button variant="secondary" fullWidth={false} onClick={() => load()}>Coba lagi</Button>
        } />
      </Card>
    )
  }
  return (
    <>
      {summary ? (
        <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
          <Card className="p-4">
            <p className="text-caption text-text-secondary">Total tahap</p>
            <p className="text-h3 font-bold">{summary.totalMilestones}</p>
          </Card>
          <Card className="p-4">
            <p className="text-caption text-text-secondary">Escrow ditahan</p>
            <p className="font-mono text-h3 font-bold">{formatMilestoneRupiah(summary.totalEscrowHeld)}</p>
          </Card>
          <Card className="p-4">
            <p className="text-caption text-text-secondary">Tahap dicairkan</p>
            <p className="text-h3 font-bold">{summary.releasedCount}</p>
          </Card>
          <Card className="p-4">
            <p className="text-caption text-text-secondary">Total cair ke penjual</p>
            <p className="font-mono text-h3 font-bold">{formatMilestoneRupiah(summary.totalReleasedSellerAmount)}</p>
          </Card>
        </div>
      ) : null}
      <p className="mb-4 text-body text-text-secondary">
        Invarian yang diperiksa per order: Σ nilai tahap = nilai order · Σ buyerAmount =
        bayar pembeli · Σ sellerAmount = net penjual · Σ fee = fee order ·
        escrowHeld + released = bayar pembeli.{" "}
        {failedCount > 0 ? (
          <span className="font-semibold text-danger-text">
            {failedCount} order GAGAL invarian — tindak lanjuti segera.
          </span>
        ) : (
          <span className="font-semibold text-success-text">
            Semua order yang dipindai (24 jam terakhir) LULUS.
          </span>
        )}
      </p>
      <DataTable<MilestoneReconcileRow>
        columns={[
          {
            key: "order",
            header: "Order",
            render: (r) => (
              <div>
                <p className="font-semibold">
                  <Link href={`/orders/${r.orderId}`} className="text-info-text hover:underline">
                    {r.orderId}
                  </Link>
                </p>
                <p className="text-caption text-text-secondary">
                  Gagal: {r.failedChecks.map((c) => CHECK_LABEL[c] ?? c).join("; ")}
                </p>
              </div>
            ),
          },
          {
            key: "checks",
            header: "Invarian",
            render: (r) => (
              <ul className="space-y-1 text-caption">
                {r.checks.map((c) => (
                  <li key={c.name} className={c.ok ? "text-success-text" : "font-semibold text-danger-text"}>
                    {c.ok ? "✓" : "✗"} {CHECK_LABEL[c.name] ?? c.name}
                    {!c.ok ? (
                      <span className="font-mono text-text-secondary">
                        {" "}(harap {c.expected}, aktual {c.actual})
                      </span>
                    ) : null}
                  </li>
                ))}
              </ul>
            ),
          },
          {
            key: "status",
            header: "Status",
            align: "right",
            render: (r) => (
              <Badge tone={r.status === "LULUS" ? "success" : "danger"}>{r.status}</Badge>
            ),
          },
        ]}
        rows={rows}
        rowKey={(r) => r.orderId}
        emptyText="Tidak ada pelanggaran invarian dalam 24 jam terakhir."
      />
    </>
  )
}

export default function MilestonesPage() {
  const [tab, setTab] = useState<Tab>("list")
  const [statusFilter, setStatusFilter] = useState("")

  return (
    <RoleGate href="/milestones">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-h2 font-bold text-text-primary">Milestone Escrow</h1>
          <p className="mt-1 text-body text-text-secondary">
            Tahapan pembayaran escrow per order dan rekonsiliasi invarian dana.
          </p>
        </div>
        {tab === "list" ? (
          <Select
            label="Status"
            options={STATUS_OPTIONS}
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="w-52"
          />
        ) : null}
      </div>

      <div
        role="tablist"
        aria-label="Tampilan milestone"
        className="mb-4 flex w-fit rounded-sm border border-border bg-surface p-1"
      >
        {(
          [
            { value: "list", label: "Daftar tahap" },
            { value: "reconcile", label: "Rekonsiliasi" },
          ] as { value: Tab; label: string }[]
        ).map((t) => (
          <button
            key={t.value}
            role="tab"
            aria-selected={tab === t.value}
            type="button"
            onClick={() => setTab(t.value)}
            className={cn(
              "rounded-sm px-4 py-1.5 text-body transition-colors",
              tab === t.value
                ? "bg-primary font-semibold text-primary-foreground"
                : "text-text-secondary hover:text-text-primary",
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "list" ? <MilestoneListTabWithStatus status={statusFilter} /> : <ReconcileTab />}
    </RoleGate>
  )
}

function MilestoneListTabWithStatus({ status }: { status: string }) {
  // Filter status diteruskan via key agar daftar dimuat ulang saat berubah.
  return <MilestoneList status={status} key={status} />
}

function MilestoneList({ status }: { status: string }) {
  const toast = useToast()
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [rows, setRows] = useState<MilestoneAdminItem[]>([])
  const [total, setTotal] = useState(0)
  const [totalPages, setTotalPages] = useState(1)

  const load = useCallback(
    async (targetPage = page) => {
      setLoading(true)
      setError(null)
      try {
        const res = await listMilestones({ status: status || undefined, page: targetPage, limit: PAGE_SIZE })
        setRows(res.data ?? [])
        const t = res.total ?? res.data?.length ?? 0
        setTotal(t)
        setTotalPages(res.totalPages ?? Math.max(1, Math.ceil(t / PAGE_SIZE)))
      } catch (e) {
        const msg = userMessage(e)
        setError(msg)
        toast.show({ title: "Gagal memuat milestone", description: msg, tone: "danger" })
      } finally {
        setLoading(false)
      }
    },
    [page, status, toast],
  )

  useEffect(() => {
    void load()
  }, [load])

  if (loading) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center gap-2">
        <Spinner size="md" />
        <p className="text-body text-text-secondary">Memuat milestone…</p>
      </div>
    )
  }
  if (error) {
    return (
      <Card>
        <EmptyState title="Gagal memuat milestone" description={error} action={
          <Button variant="secondary" fullWidth={false} onClick={() => load()}>Coba lagi</Button>
        } />
      </Card>
    )
  }
  return (
    <>
      <DataTable<MilestoneAdminItem>
        columns={[
          {
            key: "order",
            header: "Order",
            render: (r) => (
              <div>
                <p className="font-semibold">
                  Tahap {r.seq}: {r.title}
                </p>
                <p className="text-caption text-text-secondary">
                  <Link href={`/orders/${r.orderId}`} className="text-info-text hover:underline">
                    {r.orderTitle ?? r.orderId}
                  </Link>
                </p>
              </div>
            ),
          },
          {
            key: "amount",
            header: "Nilai",
            render: (r) => <span className="font-mono">{formatMilestoneRupiah(r.amount)}</span>,
          },
          {
            key: "escrowHeld",
            header: "Escrow ditahan",
            render: (r) => <span className="font-mono">{formatMilestoneRupiah(r.escrowHeld)}</span>,
          },
          {
            key: "status",
            header: "Status",
            render: (r) => (
              <Badge tone={MILESTONE_STATUS_TONE[r.status] ?? "neutral"}>
                {MILESTONE_STATUS_LABEL[r.status] ?? r.status}
              </Badge>
            ),
          },
          {
            key: "deadline",
            header: "Tenggat",
            render: (r) =>
              r.deadline ? (
                <span
                  className={
                    new Date(r.deadline).getTime() < Date.now() &&
                    r.status !== "RELEASED" &&
                    r.status !== "CANCELLED"
                      ? "font-semibold text-danger-text"
                      : ""
                  }
                >
                  {formatDateTimeWIB(r.deadline)}
                </span>
              ) : (
                "—"
              ),
          },
        ]}
        rows={rows}
        rowKey={(r) => r.id}
        emptyText="Tidak ada milestone pada filter ini."
      />
      <Pagination
        page={page}
        totalPages={totalPages}
        total={total}
        pageSize={PAGE_SIZE}
        onPageChange={(p) => {
          setPage(p)
          void load(p)
        }}
        className="mt-4"
      />
    </>
  )
}
