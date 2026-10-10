/**
 * Admin — Antrean Disbursement (DANA payouts).
 *
 * MFE-015: visibilitas operasional atas lifecycle disbursement DANA-direct
 * (escrow → rekening bank seller). Filter ditekankan pada status yang butuh
 * tindak lanjut manual:
 * - HELD_NO_BANK — fail-closed: seller belum punya rekening terverifikasi.
 * - NEEDS_REVIEW — status DANA tak dikenal; backend sengaja tidak
 *   auto-FAILED.
 *
 * Read-only: tidak ada aksi mutasi di halaman ini.
 */

"use client"

import { useCallback, useEffect, useMemo, useState } from "react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { EmptyState } from "@/components/ui/empty-state"
import { Spinner } from "@/components/ui/spinner"
import { DataTable, type DataTableColumn } from "@/components/ui/table"
import { useToast } from "@/components/ui/toast"
import { Pagination } from "@/components/admin/pagination"
import { RoleGate } from "@/components/admin/role-gate"
import { Select } from "@/components/admin/select"
import {
  DISBURSEMENT_STATUS_LABEL,
  DISBURSEMENT_STATUS_TONE,
  disbursementScopeLabel,
  listDisbursements,
  type AdminDisbursement,
  type AdminDisbursementStatus,
} from "@/lib/api/admin/disbursements"
import { userMessage } from "@/lib/api/response"
import { formatDateTimeWIB, formatIDR } from "@/lib/format"
import { maskName } from "@/lib/pii"

const PAGE_SIZE = 20

/** Alias lokal agar konsisten dengan gaya halaman lain ("Rp1.234.567"). */
const formatRupiah = formatIDR

const STATUS_OPTIONS = [
  { value: "", label: "Semua status" },
  { value: "PENDING", label: "Menunggu" },
  { value: "HELD_NO_BANK", label: "Tertahan — tanpa rekening" },
  { value: "PROCESSING", label: "Diproses" },
  { value: "NEEDS_REVIEW", label: "Perlu review" },
  { value: "SUCCESS", label: "Berhasil" },
  { value: "FAILED", label: "Gagal" },
  { value: "CANCELLED", label: "Dibatalkan" },
]

const SCOPE_OPTIONS = [
  { value: "", label: "Semua scope" },
  { value: "ORDER_ESCROW", label: "Dana order" },
  { value: "MILESTONE", label: "Milestone" },
  { value: "DISPUTE_RELEASE", label: "Lepas sengketa" },
  { value: "CASHBACK", label: "Cashback" },
  { value: "REFERRAL", label: "Referral" },
]

export default function DisbursementsPage() {
  const toast = useToast()
  const [rows, setRows] = useState<AdminDisbursement[]>([])
  const [total, setTotal] = useState(0)
  const [totalPages, setTotalPages] = useState(1)
  const [page, setPage] = useState(1)
  const [status, setStatus] = useState<string>("")
  const [scope, setScope] = useState<string>("")
  const [q, setQ] = useState("")
  const [qCommitted, setQCommitted] = useState("")
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(
    async (p: number, st: string, sc: string, query: string) => {
      setLoading(true)
      setError(null)
      try {
        const res = await listDisbursements({
          page: p,
          limit: PAGE_SIZE,
          status: (st || undefined) as AdminDisbursementStatus | undefined,
          scope: sc || undefined,
          q: query || undefined,
          sortBy: "updatedAt",
          sortOrder: "desc",
        })
        setRows(res.data ?? [])
        setTotal(res.total ?? 0)
        setTotalPages(Math.max(1, res.totalPages ?? 1))
      } catch (err) {
        const msg = userMessage(err)
        setError(msg)
        toast.show({ tone: "danger", title: "Gagal memuat disbursement", description: msg })
      } finally {
        setLoading(false)
      }
    },
    [toast],
  )

  useEffect(() => {
    void load(page, status, scope, qCommitted)
  }, [load, page, status, scope, qCommitted])

  const columns = useMemo<DataTableColumn<Record<string, unknown>>[]>(
    () => [
      {
        key: "scope",
        header: "Scope",
        render: (r) => disbursementScopeLabel(String(r.scope)),
      },
      {
        key: "seller",
        header: "Penjual",
        render: (r) => {
          const s = r.seller as AdminDisbursement["seller"]
          if (!s) return "—"
          const name = maskName(s.fullName)
          return name !== "—" ? name : (s.username ?? s.userId.slice(0, 8))
        },
      },
      {
        key: "amount",
        header: "Nominal",
        align: "right",
        render: (r) => <span className="font-semibold">{formatRupiah(Number(r.amount))}</span>,
      },
      {
        key: "status",
        header: "Status",
        render: (r) => {
          const st = String(r.status) as AdminDisbursementStatus
          return (
            <Badge tone={DISBURSEMENT_STATUS_TONE[st] ?? "neutral"}>
              {DISBURSEMENT_STATUS_LABEL[st] ?? st}
            </Badge>
          )
        },
      },
      {
        key: "reason",
        header: "Keterangan",
        render: (r) => {
          const d = r as unknown as AdminDisbursement
          const text = d.heldReason ?? d.lastError
          if (!text) return "—"
          return (
            <span className="block max-w-64 truncate" title={text}>
              {text}
            </span>
          )
        },
      },
      {
        key: "danaReferenceNo",
        header: "Ref DANA",
        render: (r) => {
          const d = r as unknown as AdminDisbursement
          const ref = d.danaReferenceNo ?? d.danaPartnerReferenceNo
          return ref ? (
            <span className="block max-w-48 truncate font-mono text-caption" title={ref}>
              {ref}
            </span>
          ) : (
            "—"
          )
        },
      },
      {
        key: "updatedAt",
        header: "Diperbarui",
        render: (r) => formatDateTimeWIB(String(r.updatedAt)),
      },
    ],
    [],
  )

  const needsAttention = status === "HELD_NO_BANK" || status === "NEEDS_REVIEW"

  return (
    <RoleGate href="/disbursements">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-h2 font-bold text-text-primary">Disbursement</h1>
          <p className="mt-1 text-body text-text-secondary">
            Antrean pencairan dana DANA ke rekening bank seller — read-only.
            Filter{" "}
            <strong>Tertahan — tanpa rekening</strong> dan{" "}
            <strong>Perlu review</strong> menandai kasus yang butuh tindak
            lanjut manual.
          </p>
        </div>
      </div>

      <Card className="mb-4">
        <div className="flex flex-wrap items-end gap-3">
          <Select
            label="Status"
            options={STATUS_OPTIONS}
            value={status}
            onChange={(e) => {
              setStatus(e.target.value)
              setPage(1)
            }}
            className="min-w-56"
          />
          <Select
            label="Scope"
            options={SCOPE_OPTIONS}
            value={scope}
            onChange={(e) => {
              setScope(e.target.value)
              setPage(1)
            }}
            className="min-w-48"
          />
          <div className="flex min-w-64 flex-1 flex-col gap-1.5">
            <label
              htmlFor="disb-search"
              className="text-label font-semibold text-text-secondary"
            >
              Cari
            </label>
            <div className="flex gap-2">
              <input
                id="disb-search"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    setQCommitted(q)
                    setPage(1)
                  }
                }}
                placeholder="orderId / userId / referensi DANA"
                className="min-h-12 w-full rounded-sm border border-border-control bg-surface px-4 text-body text-text-primary placeholder:text-text-tertiary"
              />
              <Button
                variant="secondary"
                fullWidth={false}
                onClick={() => {
                  setQCommitted(q)
                  setPage(1)
                }}
              >
                Cari
              </Button>
            </div>
          </div>
          <Button
            variant="ghost"
            fullWidth={false}
            onClick={() => void load(page, status, scope, qCommitted)}
            disabled={loading}
          >
            Muat ulang
          </Button>
        </div>
      </Card>

      {needsAttention && !loading && rows.length > 0 ? (
        <div
          role="note"
          className="mb-4 rounded-md border border-warning/40 bg-warning/5 px-4 py-3 text-body text-text-primary"
        >
          {rows.length} disbursement berstatus{" "}
          <strong>{DISBURSEMENT_STATUS_LABEL[status as AdminDisbursementStatus]}</strong>{" "}
          menunggu tindak lanjut.
        </div>
      ) : null}

      <Card>
        {loading ? (
          <div className="flex items-center justify-center gap-2 py-10 text-body text-text-secondary">
            <Spinner size="sm" /> Memuat disbursement…
          </div>
        ) : error ? (
          <EmptyState
            title="Gagal memuat"
            description={error}
            action={<Button onClick={() => void load(page, status, scope, qCommitted)}>Coba lagi</Button>}
          />
        ) : (
          <>
            <DataTable
              columns={columns}
              rows={rows as unknown as Record<string, unknown>[]}
              rowKey={(r) => String(r.id)}
              emptyText="Belum ada disbursement."
              caption="Antrean disbursement DANA"
              rowClassName={(r) => {
                const st = String(r.status)
                return st === "HELD_NO_BANK" || st === "NEEDS_REVIEW"
                  ? "bg-warning-soft"
                  : undefined
              }}
            />
            <div className="mt-4 flex justify-end">
              <Pagination
                page={page}
                totalPages={totalPages}
                total={total}
                pageSize={PAGE_SIZE}
                onPageChange={setPage}
                disabled={loading}
              />
            </div>
          </>
        )}
      </Card>
    </RoleGate>
  )
}
