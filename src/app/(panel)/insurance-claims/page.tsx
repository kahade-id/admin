/**
 * Admin — Review klaim asuransi Kahade+.
 *
 * Daftar klaim dengan filter status (DRAFT/SUBMITTED/APPROVED/REJECTED/PAID)
 * + paginasi bernomor. Tombol "Tinjau" membuka detail klaim (pengguna, order
 * terkait, tipe, nominal, cap, catatan) beserta aksi review:
 * setujui → APPROVED, tolak → REJECTED (keduanya dari status SUBMITTED),
 * dan tandai dibayar → PAID (dari status APPROVED), dengan catatan opsional.
 *
 * Kontrak backend (Kahade+, tetap):
 * - GET /v1/admin/insurance-claims?page&limit&status → {data, pagination}
 * - PATCH /v1/admin/insurance-claims/:id {status: 'APPROVED'|'REJECTED'|'PAID', note?}
 */
"use client"

import { useCallback, useEffect, useState, type ReactNode } from "react"

import { Badge, type BadgeTone } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Dialog } from "@/components/ui/dialog"
import { EmptyState } from "@/components/ui/empty-state"
import { TextArea } from "@/components/ui/input"
import { Spinner } from "@/components/ui/spinner"
import { DataTable } from "@/components/ui/table"
import { useToast } from "@/components/ui/toast"
import { Pagination } from "@/components/admin/pagination"
import { RoleGate } from "@/components/admin/role-gate"
import { Select } from "@/components/admin/select"
import {
  listInsuranceClaims,
  updateInsuranceClaimStatus,
  type InsuranceClaim,
  type InsuranceClaimStatus,
} from "@/lib/api/admin/insurance-claims"
import { userMessage } from "@/lib/api/response"
import { formatDateTimeWIB } from "@/lib/format"

const PAGE_SIZE = 20

type StatusFilter = "all" | InsuranceClaimStatus

const STATUS_OPTIONS = [
  { value: "all", label: "Semua status" },
  { value: "SUBMITTED", label: "Diajukan" },
  { value: "DRAFT", label: "Draf" },
  { value: "APPROVED", label: "Disetujui" },
  { value: "REJECTED", label: "Ditolak" },
  { value: "PAID", label: "Dibayar" },
]

const STATUS_LABEL: Record<string, string> = {
  DRAFT: "Draf",
  SUBMITTED: "Diajukan",
  APPROVED: "Disetujui",
  REJECTED: "Ditolak",
  PAID: "Dibayar",
}

const STATUS_TONE: Record<string, BadgeTone> = {
  DRAFT: "neutral",
  SUBMITTED: "warning",
  APPROVED: "info",
  REJECTED: "danger",
  PAID: "success",
}

/** Aliases respons backend → nilai tampilan. */
function claimType(c: InsuranceClaim): string {
  return String(c.type ?? c.claimType ?? "—")
}

function claimAmount(c: InsuranceClaim): number | null {
  const n = c.amount ?? c.nominal
  return typeof n === "number" && Number.isFinite(n) ? n : null
}

function claimCap(c: InsuranceClaim): number | null {
  const n = c.cap ?? c.claimCap
  return typeof n === "number" && Number.isFinite(n) ? n : null
}

function claimNote(c: InsuranceClaim): string {
  return String(c.note ?? c.notes ?? "—")
}

function claimUser(c: InsuranceClaim): string {
  return (
    c.user?.fullName ?? c.user?.username ?? c.user?.email ?? c.userId ?? "—"
  )
}

function claimOrder(c: InsuranceClaim): string {
  return String(c.order?.orderNumber ?? c.order?.id ?? c.orderId ?? "—")
}

function formatRupiah(n: number | null): string {
  if (n == null) return "—"
  return `Rp${Math.trunc(n).toLocaleString("id-ID")}`
}

function KeyValue({ label, value }: { label: string; value: ReactNode }) {
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

type Action = "APPROVED" | "REJECTED" | "PAID"

const ACTION_META: Record<
  Action,
  { label: string; description: string; variant: "primary" | "destructive" }
> = {
  APPROVED: {
    label: "Setujui klaim",
    description: "Klaim disetujui dan siap dibayar. Tindakan ini tercatat di audit log.",
    variant: "primary",
  },
  REJECTED: {
    label: "Tolak klaim",
    description: "Klaim ditolak. Pengguna akan menerima notifikasi penolakan.",
    variant: "destructive",
  },
  PAID: {
    label: "Tandai dibayar",
    description: "Klaim ditandai sudah dibayar ke pengguna.",
    variant: "primary",
  },
}

/** Aksi yang valid dari status saat ini (alur: SUBMITTED → APPROVED/REJECTED → PAID). */
function allowedActions(status: string): Action[] {
  if (status === "SUBMITTED") return ["APPROVED", "REJECTED"]
  if (status === "APPROVED") return ["PAID"]
  return []
}

export default function InsuranceClaimsPage() {
  const toast = useToast()

  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [rows, setRows] = useState<InsuranceClaim[]>([])
  const [total, setTotal] = useState(0)
  const [totalPages, setTotalPages] = useState(1)
  const [page, setPage] = useState(1)

  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all")

  const [selected, setSelected] = useState<InsuranceClaim | null>(null)
  const [note, setNote] = useState("")
  const [acting, setActing] = useState<Action | null>(null)

  const load = useCallback(
    async (
      mode: "initial" | "refresh" = "initial",
      targetPage = page,
      targetStatus = statusFilter,
    ) => {
      if (mode === "initial") setLoading(true)
      else setRefreshing(true)
      setError(null)
      try {
        const res = await listInsuranceClaims({
          page: targetPage,
          limit: PAGE_SIZE,
          status: targetStatus === "all" ? undefined : targetStatus,
        })
        setRows(res.data ?? [])
        const t = res.total ?? res.data?.length ?? 0
        setTotal(t)
        setTotalPages(res.totalPages ?? Math.max(1, Math.ceil(t / PAGE_SIZE)))
      } catch (e) {
        const msg = userMessage(e)
        setError(msg)
        toast.show({
          title: "Gagal memuat klaim asuransi",
          description: msg,
          tone: "danger",
        })
      } finally {
        setLoading(false)
        setRefreshing(false)
      }
    },
    [page, statusFilter, toast],
  )

  useEffect(() => {
    void load("initial")
  }, [load])

  const handleStatusChange = (v: StatusFilter) => {
    setStatusFilter(v)
    setPage(1)
    void load("initial", 1, v)
  }

  const handlePageChange = (p: number) => {
    setPage(p)
    void load("initial", p, statusFilter)
  }

  const openReview = (claim: InsuranceClaim) => {
    setSelected(claim)
    setNote("")
    setActing(null)
  }

  const closeReview = () => {
    if (acting) return
    setSelected(null)
    setNote("")
  }

  const handleAction = async (action: Action) => {
    if (!selected || acting) return
    setActing(action)
    try {
      await updateInsuranceClaimStatus(selected.id, {
        status: action,
        note: note.trim() || undefined,
      })
      toast.show({
        title: ACTION_META[action].label,
        description: `Klaim ${selected.id} → ${STATUS_LABEL[action]}.`,
        tone: "success",
      })
      setSelected(null)
      setNote("")
      await load("refresh")
    } catch (e) {
      toast.show({
        title: `Gagal ${ACTION_META[action].label.toLowerCase()}`,
        description: userMessage(e),
        tone: "danger",
      })
    } finally {
      setActing(null)
    }
  }

  const reviewStatus = selected ? String(selected.status ?? "") : ""
  const actions = allowedActions(reviewStatus)

  return (
    <RoleGate href="/insurance-claims">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-h2 font-bold text-text-primary">Klaim Asuransi</h1>
          <p className="mt-1 text-body text-text-secondary">
            Tinjau klaim asuransi Kahade+ — setujui, tolak, atau tandai dibayar.
          </p>
        </div>
        <Button
          variant="secondary"
          size="sm"
          fullWidth={false}
          loading={refreshing}
          onClick={() => load("refresh")}
        >
          Muat ulang
        </Button>
      </div>

      <div className="mb-4 flex flex-wrap items-end gap-3">
        <Select
          label="Status"
          options={STATUS_OPTIONS}
          value={statusFilter}
          onChange={(e) => handleStatusChange(e.target.value as StatusFilter)}
          className="w-52"
        />
      </div>

      {loading ? (
        <div className="flex min-h-[40vh] items-center justify-center gap-2">
          <Spinner size="md" />
          <p className="text-body text-text-secondary">Memuat klaim asuransi…</p>
        </div>
      ) : error ? (
        <Card>
          <EmptyState
            title="Gagal memuat klaim asuransi"
            description={error}
            action={
              <Button
                variant="secondary"
                fullWidth={false}
                onClick={() => load("initial")}
              >
                Coba lagi
              </Button>
            }
          />
        </Card>
      ) : (
        <>
          <DataTable<InsuranceClaim>
            columns={[
              {
                key: "id",
                header: "Klaim",
                render: (c) => (
                  <div className="min-w-40">
                    <p className="font-mono text-[13px] font-semibold">{c.id}</p>
                    <p className="text-caption text-text-secondary">
                      {formatDateTimeWIB(c.createdAt)}
                    </p>
                  </div>
                ),
              },
              {
                key: "user",
                header: "Pengguna",
                render: (c) => <span>{claimUser(c)}</span>,
              },
              {
                key: "order",
                header: "Order",
                render: (c) => (
                  <span className="whitespace-nowrap">{claimOrder(c)}</span>
                ),
              },
              {
                key: "type",
                header: "Tipe",
                render: (c) => <span>{claimType(c)}</span>,
              },
              {
                key: "amount",
                header: "Nominal",
                align: "right",
                render: (c) => (
                  <span className="whitespace-nowrap font-semibold">
                    {formatRupiah(claimAmount(c))}
                  </span>
                ),
              },
              {
                key: "cap",
                header: "Cap",
                align: "right",
                render: (c) => (
                  <span className="whitespace-nowrap">
                    {formatRupiah(claimCap(c))}
                  </span>
                ),
              },
              {
                key: "status",
                header: "Status",
                render: (c) => (
                  <Badge tone={STATUS_TONE[String(c.status)] ?? "neutral"}>
                    {STATUS_LABEL[String(c.status)] ?? String(c.status ?? "—")}
                  </Badge>
                ),
              },
              {
                key: "action",
                header: "",
                align: "right",
                render: (c) => (
                  <Button
                    variant="secondary"
                    size="sm"
                    fullWidth={false}
                    onClick={() => openReview(c)}
                  >
                    Tinjau
                  </Button>
                ),
              },
            ]}
            rows={rows}
            rowKey={(c) => c.id}
            emptyText="Tidak ada klaim asuransi pada filter ini."
          />
          <div className="mt-4">
            <Pagination
              page={page}
              totalPages={totalPages}
              total={total}
              pageSize={PAGE_SIZE}
              onPageChange={handlePageChange}
            />
          </div>
        </>
      )}

      {/* Detail + aksi review */}
      <Dialog
        open={selected != null}
        onClose={closeReview}
        title="Tinjau klaim asuransi"
        description={
          selected ? `ID klaim: ${selected.id}` : undefined
        }
      >
        {selected ? (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <Badge tone={STATUS_TONE[reviewStatus] ?? "neutral"}>
                {STATUS_LABEL[reviewStatus] ?? reviewStatus}
              </Badge>
            </div>
            <dl>
              <KeyValue label="Pengguna" value={claimUser(selected)} />
              {selected.user?.email ? (
                <KeyValue label="Email" value={selected.user.email} />
              ) : null}
              <KeyValue label="Order terkait" value={claimOrder(selected)} />
              <KeyValue label="Tipe klaim" value={claimType(selected)} />
              <KeyValue label="Nominal" value={formatRupiah(claimAmount(selected))} />
              <KeyValue label="Cap pertanggungan" value={formatRupiah(claimCap(selected))} />
              <KeyValue label="Diajukan" value={formatDateTimeWIB(selected.createdAt)} />
            </dl>

            <div>
              <p className="text-caption font-semibold text-text-secondary">
                Catatan review admin
              </p>
              <p className="mt-1 rounded-sm bg-surface px-4 py-3 text-body text-text-primary">
                {claimNote(selected)}
              </p>
            </div>

            {actions.length > 0 ? (
              <>
                <TextArea
                  label="Catatan review (opsional)"
                  rows={3}
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="Cth. Bukti kerusakan valid, disetujui sesuai cap…"
                  maxLength={1000}
                  disabled={acting != null}
                />
                <div className="flex flex-col gap-2">
                  {actions.map((action) => (
                    <Button
                      key={action}
                      variant={ACTION_META[action].variant}
                      loading={acting === action}
                      disabled={acting != null}
                      onClick={() => handleAction(action)}
                      title={ACTION_META[action].description}
                    >
                      {ACTION_META[action].label}
                    </Button>
                  ))}
                  <Button
                    variant="ghost"
                    disabled={acting != null}
                    onClick={closeReview}
                  >
                    Tutup
                  </Button>
                </div>
              </>
            ) : (
              <>
                <p className="text-caption text-text-secondary">
                  Klaim pada status ini tidak memiliki aksi review
                  {reviewStatus === "DRAFT" ? " (masih draf, belum diajukan pengguna)" : ""}.
                </p>
                <Button variant="ghost" onClick={closeReview}>
                  Tutup
                </Button>
              </>
            )}
          </div>
        ) : null}
      </Dialog>
    </RoleGate>
  )
}
