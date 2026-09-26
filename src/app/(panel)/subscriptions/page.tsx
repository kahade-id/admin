/**
 * Admin — Subscription: daftar subscription + pembatalan paksa.
 *
 * Tabel langganan (pengguna, paket, status, harga, periode, tanggal berakhir)
 * + filter status & plan + pencarian lokal + paginasi bernomor.
 * Aksi "Batalkan" (hanya status ACTIVE/PENDING) via ConfirmDialog destruktif.
 *
 * Port dari frontend/app/admin/(panel)/subscriptions.tsx → web desktop.
 */
"use client"

import { useCallback, useEffect, useMemo, useState } from "react"

import { Badge, type BadgeTone } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { ConfirmDialog } from "@/components/ui/dialog"
import { EmptyState } from "@/components/ui/empty-state"
import { Input } from "@/components/ui/input"
import { Spinner } from "@/components/ui/spinner"
import { DataTable } from "@/components/ui/table"
import { useToast } from "@/components/ui/toast"
import { Pagination } from "@/components/admin/pagination"
import { RoleGate } from "@/components/admin/role-gate"
import { Select } from "@/components/admin/select"
import {
  cancelSubscription,
  listSubscriptions,
  type SubscriptionItem,
  type SubscriptionPlan,
  type SubscriptionStatus,
} from "@/lib/api/admin/subscriptions"
import { userMessage } from "@/lib/api/response"
import { formatDateTimeWIB } from "@/lib/format"

const PAGE_SIZE = 20
const SEARCH_DEBOUNCE_MS = 400

type StatusFilter = "all" | SubscriptionStatus
type PlanFilter = "all" | SubscriptionPlan

const STATUS_OPTIONS = [
  { value: "all", label: "Semua status" },
  { value: "ACTIVE", label: "Aktif" },
  { value: "PENDING", label: "Menunggu" },
  { value: "EXPIRED", label: "Kedaluwarsa" },
  { value: "CANCELLED", label: "Dibatalkan" },
  { value: "SUSPENDED", label: "Ditangguhkan" },
]

const PLAN_OPTIONS = [
  { value: "all", label: "Semua plan" },
  { value: "MONTHLY", label: "Bulanan" },
  { value: "ANNUAL", label: "Tahunan" },
]

const STATUS_LABEL: Record<string, string> = {
  ACTIVE: "Aktif",
  CANCELLED: "Dibatalkan",
  EXPIRED: "Kedaluwarsa",
  PENDING: "Menunggu",
  SUSPENDED: "Ditangguhkan",
}

const STATUS_TONE: Record<string, BadgeTone> = {
  ACTIVE: "success",
  CANCELLED: "neutral",
  EXPIRED: "neutral",
  PENDING: "warning",
  SUSPENDED: "danger",
}

const PLAN_LABEL: Record<string, string> = {
  MONTHLY: "Bulanan",
  ANNUAL: "Tahunan",
}

/** Status yang boleh dibatalkan paksa (aturan backend: 400 untuk lainnya). */
const CANCELLABLE: string[] = ["ACTIVE", "PENDING"]

function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs)
    return () => clearTimeout(timer)
  }, [value, delayMs])
  return debounced
}

/** "Rp1.234.567" — non-finite → "—". */
function formatRupiah(n: unknown): string {
  if (typeof n !== "number" || !Number.isFinite(n)) return "—"
  return `Rp${Math.trunc(n).toLocaleString("id-ID")}`
}

function userDisplay(s: SubscriptionItem): string {
  return s.user?.fullName ?? s.user?.username ?? "—"
}

function periodLabel(s: SubscriptionItem): string {
  if (!s.currentPeriodStart && !s.currentPeriodEnd) return "—"
  return `${formatDateTimeWIB(s.currentPeriodStart)} — ${formatDateTimeWIB(s.currentPeriodEnd)}`
}

export default function SubscriptionsPage() {
  const toast = useToast()

  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [rows, setRows] = useState<SubscriptionItem[]>([])
  const [total, setTotal] = useState(0)
  const [totalPages, setTotalPages] = useState(1)
  const [page, setPage] = useState(1)

  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all")
  const [planFilter, setPlanFilter] = useState<PlanFilter>("all")
  const [search, setSearch] = useState("")
  const debouncedSearch = useDebouncedValue(search, SEARCH_DEBOUNCE_MS)

  const [target, setTarget] = useState<SubscriptionItem | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const load = useCallback(
    async (
      mode: "initial" | "refresh" = "initial",
      targetPage = page,
      targetStatus = statusFilter,
      targetPlan = planFilter,
    ) => {
      if (mode === "initial") setLoading(true)
      else setRefreshing(true)
      setError(null)
      try {
        const res = await listSubscriptions({
          page: targetPage,
          limit: PAGE_SIZE,
          status: targetStatus === "all" ? undefined : targetStatus,
          plan: targetPlan === "all" ? undefined : targetPlan,
        })
        setRows(res.data ?? [])
        const t = res.meta?.total ?? res.total ?? res.data?.length ?? 0
        setTotal(t)
        setTotalPages(
          res.meta?.totalPages ?? Math.max(1, Math.ceil(t / PAGE_SIZE)),
        )
      } catch (e) {
        const msg = userMessage(e)
        setError(msg)
        toast.show({
          title: "Gagal memuat subscription",
          description: msg,
          tone: "danger",
        })
      } finally {
        setLoading(false)
        setRefreshing(false)
      }
    },
    [page, statusFilter, planFilter, toast],
  )

  useEffect(() => {
    void load("initial")
  }, [load])

  const handleStatusChange = (v: StatusFilter) => {
    setStatusFilter(v)
    setPage(1)
    void load("initial", 1, v, planFilter)
  }

  const handlePlanChange = (v: PlanFilter) => {
    setPlanFilter(v)
    setPage(1)
    void load("initial", 1, statusFilter, v)
  }

  const handlePageChange = (p: number) => {
    setPage(p)
    void load("initial", p, statusFilter, planFilter)
  }

  // Backend tidak mendukung pencarian — saring lokal pada halaman yang dimuat.
  const filteredRows = useMemo(() => {
    const q = debouncedSearch.trim().toLowerCase()
    if (!q) return rows
    return rows.filter((s) => {
      const haystack = [
        s.user?.fullName ?? "",
        s.user?.username ?? "",
        s.user?.email ?? "",
        String(s.plan ?? ""),
      ]
        .join(" ")
        .toLowerCase()
      return haystack.includes(q)
    })
  }, [rows, debouncedSearch])

  const closeCancel = useCallback(() => {
    if (submitting) return
    setTarget(null)
  }, [submitting])

  const confirmCancel = useCallback(async () => {
    if (!target || submitting) return
    setSubmitting(true)
    try {
      await cancelSubscription(target.id)
      toast.show({
        title: "Subscription dibatalkan",
        description: userDisplay(target),
        tone: "success",
      })
      setTarget(null)
      await load("refresh")
    } catch (e) {
      toast.show({
        title: "Gagal membatalkan subscription",
        description: userMessage(e),
        tone: "danger",
      })
    } finally {
      setSubmitting(false)
    }
  }, [target, submitting, toast, load])

  return (
    <RoleGate href="/subscriptions">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-h2 font-bold text-text-primary">Subscription</h1>
          <p className="mt-1 text-body text-text-secondary">
            Daftar langganan pengguna. Pembatalan paksa hanya untuk status
            Aktif/Menunggu dan tercatat di audit log.
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
        <Select
          label="Plan"
          options={PLAN_OPTIONS}
          value={planFilter}
          onChange={(e) => handlePlanChange(e.target.value as PlanFilter)}
          className="w-52"
        />
        <div className="min-w-64 flex-1">
          <Input
            label="Cari"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Nama pengguna, email…"
          />
        </div>
      </div>

      {loading ? (
        <div className="flex min-h-[40vh] items-center justify-center gap-2">
          <Spinner size="md" />
          <p className="text-body text-text-secondary">
            Memuat subscription…
          </p>
        </div>
      ) : error ? (
        <Card>
          <EmptyState
            title="Gagal memuat subscription"
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
          <DataTable<SubscriptionItem>
            columns={[
              {
                key: "user",
                header: "Pengguna",
                render: (s) => (
                  <div className="min-w-44">
                    <p className="font-semibold">{userDisplay(s)}</p>
                    {s.user?.email ? (
                      <p className="text-caption text-text-secondary">
                        {s.user.email}
                      </p>
                    ) : null}
                  </div>
                ),
              },
              {
                key: "plan",
                header: "Paket",
                render: (s) => (
                  <Badge tone="info">
                    {PLAN_LABEL[String(s.plan)] ?? String(s.plan ?? "—")}
                  </Badge>
                ),
              },
              {
                key: "status",
                header: "Status",
                render: (s) => (
                  <Badge tone={STATUS_TONE[String(s.status)] ?? "neutral"}>
                    {STATUS_LABEL[String(s.status)] ?? String(s.status ?? "—")}
                  </Badge>
                ),
              },
              {
                key: "price",
                header: "Harga",
                align: "right",
                render: (s) => (
                  <span className="whitespace-nowrap font-semibold">
                    {formatRupiah(s.price)}
                  </span>
                ),
              },
              {
                key: "period",
                header: "Periode",
                render: (s) => (
                  <span className="whitespace-nowrap">{periodLabel(s)}</span>
                ),
              },
              {
                key: "currentPeriodEnd",
                header: "Berakhir",
                render: (s) => (
                  <span className="whitespace-nowrap">
                    {formatDateTimeWIB(s.currentPeriodEnd)}
                  </span>
                ),
              },
              {
                key: "action",
                header: "",
                align: "right",
                render: (s) => {
                  const canCancel = CANCELLABLE.includes(String(s.status))
                  return (
                    <Button
                      variant="destructive"
                      size="sm"
                      fullWidth={false}
                      disabled={!canCancel}
                      title={
                        canCancel
                          ? "Batalkan subscription ini"
                          : "Hanya subscription Aktif/Menunggu yang bisa dibatalkan"
                      }
                      onClick={() => setTarget(s)}
                    >
                      Batalkan
                    </Button>
                  )
                },
              },
            ]}
            rows={filteredRows}
            rowKey={(s) => s.id}
            emptyText={
              debouncedSearch.trim()
                ? "Tidak ada subscription yang cocok dengan pencarian pada halaman ini."
                : "Tidak ada subscription pada filter ini."
            }
          />
          {debouncedSearch.trim() ? (
            <p className="mt-2 text-caption text-text-secondary">
              Pencarian hanya berlaku pada halaman yang dimuat (backend belum
              mendukung pencarian global).
            </p>
          ) : null}
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

      <ConfirmDialog
        open={target != null}
        onClose={closeCancel}
        title="Batalkan subscription?"
        description={
          target
            ? `Subscription ${PLAN_LABEL[String(target.plan)] ?? target.plan ?? ""} milik ${userDisplay(target)} akan dibatalkan segera. Tindakan ini tidak bisa dibatalkan.`
            : undefined
        }
        confirmLabel="Ya, batalkan"
        cancelLabel="Batal"
        onConfirm={() => void confirmCancel()}
        loading={submitting}
        destructive
      />
    </RoleGate>
  )
}
