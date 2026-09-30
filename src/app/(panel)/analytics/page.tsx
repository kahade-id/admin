/**
 * Admin — Analitik: ringkasan platform (baca-saja).
 *
 * Kartu KPI dari endpoint overview (pengguna, transaksi, GMV, dsb.), filter
 * rentang tanggal preset 7/30/90 hari, tabel breakdown per periode (order),
 * pengguna teratas, dan pertumbuhan pengguna. Tanpa aksi mutasi.
 *
 * Port dari frontend/app/admin/(panel)/analytics.tsx → web desktop.
 */
"use client"

import { useCallback, useEffect, useMemo, useState } from "react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardBody, CardHeader } from "@/components/ui/card"
import { EmptyState } from "@/components/ui/empty-state"
import { Spinner } from "@/components/ui/spinner"
import { DataTable } from "@/components/ui/table"
import { useToast } from "@/components/ui/toast"
import { Pagination } from "@/components/admin/pagination"
import { RoleGate } from "@/components/admin/role-gate"
import { Select } from "@/components/admin/select"
import {
  getAnalyticsOverview,
  getOrderStats,
  getTopUsers,
  getUserGrowth,
  type AnalyticsOverview,
  type OrderStatRow,
  type OrderStatsGroupBy,
  type TopUser,
  type TopUserMetric,
  type UserGrowthRow,
} from "@/lib/api/admin/analytics"
import { userMessage } from "@/lib/api/response"
import { formatDateTimeWIB, formatNumber, num } from "@/lib/format"

const PAGE_SIZE = 20

/** Batas rentang kustom (hari). Backend tidak membatasi rentang maksimum
 * (`assertDateRange` hanya menolak startDate > endDate), jadi batas 365 hari
 * ditegakkan di UI agar query tetap wajar. */
const MAX_CUSTOM_RANGE_DAYS = 365

const RANGE_OPTIONS = [
  { value: "7", label: "7 hari terakhir" },
  { value: "30", label: "30 hari terakhir" },
  { value: "90", label: "90 hari terakhir" },
]

const GROUP_BY_OPTIONS = [
  { value: "day", label: "Harian" },
  { value: "week", label: "Mingguan" },
  { value: "month", label: "Bulanan" },
]

const METRIC_OPTIONS = [
  { value: "orders", label: "Order terbanyak" },
  { value: "volume", label: "Volume terbesar" },
  { value: "rating", label: "Rating tertinggi" },
]

/** "Rp1.234.567" — non-finite → "—". */
function formatRupiah(n: unknown): string {
  if (typeof n !== "number" || !Number.isFinite(n)) return "—"
  return `Rp${Math.trunc(n).toLocaleString("id-ID")}`
}

function toISODate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
}

function rangeDates(days: number): { startDate: string; endDate: string } {
  const end = new Date()
  const start = new Date(end.getTime() - (days - 1) * 86_400_000)
  return { startDate: toISODate(start), endDate: toISODate(end) }
}

/** "1 Sep 2026 – 26 Sep 2026". */
function formatRangeLabel(range: {
  startDate: string
  endDate: string
}): string {
  const fmt = (iso: string) =>
    new Date(`${iso}T00:00:00`).toLocaleDateString("id-ID", {
      day: "numeric",
      month: "short",
      year: "numeric",
    })
  return `${fmt(range.startDate)} – ${fmt(range.endDate)}`
}

/** Validasi input kustom. Mengembalikan pesan error, atau null bila valid. */
function validateCustomRange(start: string, end: string): string | null {
  if (!start || !end) return "Isi tanggal mulai dan tanggal akhir."
  const s = new Date(`${start}T00:00:00`)
  const e = new Date(`${end}T00:00:00`)
  if (Number.isNaN(s.getTime()) || Number.isNaN(e.getTime()))
    return "Format tanggal tidak valid."
  if (s.getTime() > e.getTime())
    return "Tanggal mulai tidak boleh lebih besar dari tanggal akhir."
  const days = Math.floor((e.getTime() - s.getTime()) / 86_400_000) + 1
  if (days > MAX_CUSTOM_RANGE_DAYS)
    return `Rentang maksimal ${MAX_CUSTOM_RANGE_DAYS} hari.`
  return null
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <Card>
      <p className="text-caption text-text-secondary">{label}</p>
      <p className="mt-1 truncate text-h3 font-semibold text-text-primary">
        {value}
      </p>
    </Card>
  )
}

function topUserMetricLabel(metric: TopUserMetric, u: TopUser): string {
  if (metric === "orders") return `${formatNumber(num(u.totalOrders))} order`
  if (metric === "volume") return formatRupiah(u.totalVolume)
  return `${num(u.avgRating).toFixed(1)} (${formatNumber(num(u.ratingCount))})`
}

export default function AnalyticsPage() {
  const toast = useToast()

  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [rangeDays, setRangeDays] = useState("30")
  const [groupBy, setGroupBy] = useState<OrderStatsGroupBy>("day")
  const [metric, setMetric] = useState<TopUserMetric>("orders")

  // Mode rentang: bila `customRange` terisi, rentang kustom aktif dan preset
  // 7/30/90 dinonaktifkan. Bila null, rentang berasal dari preset `rangeDays`.
  const [customStart, setCustomStart] = useState("")
  const [customEnd, setCustomEnd] = useState("")
  const [customError, setCustomError] = useState<string | null>(null)
  const [customRange, setCustomRange] = useState<{
    startDate: string
    endDate: string
  } | null>(null)
  const activeRange = useMemo(
    () => customRange ?? rangeDates(Number(rangeDays)),
    [customRange, rangeDays],
  )

  const [overview, setOverview] = useState<AnalyticsOverview | null>(null)
  const [orderStats, setOrderStats] = useState<OrderStatRow[]>([])
  const [topUsers, setTopUsers] = useState<TopUser[]>([])
  const [growth, setGrowth] = useState<UserGrowthRow[]>([])

  const [statsPage, setStatsPage] = useState(1)
  const [growthPage, setGrowthPage] = useState(1)

  const load = useCallback(
    async (
      mode: "initial" | "refresh" = "initial",
      targetRange: { startDate: string; endDate: string },
      targetGroupBy = groupBy,
      targetMetric = metric,
    ) => {
      if (mode === "initial") setLoading(true)
      else setRefreshing(true)
      setError(null)
      try {
        const { startDate, endDate } = targetRange
        // NB: `top-users` tidak menerima startDate/endDate di backend
        // (dihitung dari counter all-time), sehingga tetap tanpa rentang.
        const [ov, os, tu, ug] = await Promise.all([
          getAnalyticsOverview({ startDate, endDate }),
          getOrderStats({
            groupBy: targetGroupBy,
            startDate,
            endDate,
          }),
          getTopUsers({ limit: 10, metric: targetMetric }),
          getUserGrowth({ startDate, endDate }),
        ])
        setOverview(ov)
        setOrderStats(Array.isArray(os) ? os : [])
        setTopUsers(Array.isArray(tu) ? tu : [])
        setGrowth(Array.isArray(ug) ? ug : [])
        setStatsPage(1)
        setGrowthPage(1)
      } catch (e) {
        const msg = userMessage(e)
        setError(msg)
        toast.show({
          title: "Gagal memuat analitik",
          description: msg,
          tone: "danger",
        })
      } finally {
        setLoading(false)
        setRefreshing(false)
      }
    },
    [groupBy, metric, toast],
  )

  useEffect(() => {
    void load("initial", activeRange)
  }, [load, activeRange])

  const handleRangeChange = (v: string) => {
    // Pemuatan dipicu oleh useEffect lewat perubahan `activeRange`.
    setRangeDays(v)
  }

  const handleGroupByChange = (v: OrderStatsGroupBy) => {
    setGroupBy(v)
    setStatsPage(1)
    void load("initial", activeRange, v, metric)
  }

  const handleMetricChange = (v: TopUserMetric) => {
    setMetric(v)
    void load("initial", activeRange, groupBy, v)
  }

  const handleCustomApply = () => {
    const err = validateCustomRange(customStart, customEnd)
    setCustomError(err)
    if (err) {
      toast.show({
        title: "Rentang tanggal tidak valid",
        description: err,
        tone: "danger",
      })
      return
    }
    const range = { startDate: customStart, endDate: customEnd }
    setCustomRange(range)
    void load("initial", range, groupBy, metric)
  }

  const handleCustomReset = () => {
    setCustomStart("")
    setCustomEnd("")
    setCustomError(null)
    setCustomRange(null)
    // Kembali ke preset: pemuatan dipicu oleh useEffect.
  }

  // API mengembalikan array tanpa paginasi — paginasi di sisi klien.
  const statsTotalPages = useMemo(
    () => Math.max(1, Math.ceil(orderStats.length / PAGE_SIZE)),
    [orderStats],
  )
  const statsPageRows = useMemo(
    () => orderStats.slice((statsPage - 1) * PAGE_SIZE, statsPage * PAGE_SIZE),
    [orderStats, statsPage],
  )
  const growthTotalPages = useMemo(
    () => Math.max(1, Math.ceil(growth.length / PAGE_SIZE)),
    [growth],
  )
  const growthPageRows = useMemo(
    () => growth.slice((growthPage - 1) * PAGE_SIZE, growthPage * PAGE_SIZE),
    [growth, growthPage],
  )
  const rankedTopUsers = useMemo(
    () => topUsers.map((u, i) => ({ ...u, __rank: i + 1 })),
    [topUsers],
  )

  return (
    <RoleGate href="/analytics">
      <div className="mb-6 flex flex-col gap-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-h2 font-bold text-text-primary">Analitik</h1>
            <p className="mt-1 text-body text-text-secondary">
              Ringkasan platform — baca-saja, tanpa aksi perubahan data.
            </p>
          </div>
          <Button
            variant="secondary"
            size="sm"
            fullWidth={false}
            loading={refreshing}
            onClick={() => load("refresh", activeRange)}
          >
            Muat ulang
          </Button>
        </div>
        <Card>
          <div className="flex flex-wrap items-end gap-3">
            <div className={customRange ? "opacity-50" : ""}>
              <label
                htmlFor="analytics-preset"
                className="mb-1 block text-caption font-semibold text-text-secondary"
              >
                Preset
              </label>
              <Select
                id="analytics-preset"
                options={RANGE_OPTIONS}
                value={rangeDays}
                onChange={(e) => handleRangeChange(e.target.value)}
                className="w-48"
                aria-label="Rentang tanggal preset"
                disabled={customRange !== null}
              />
            </div>
            <span
              className="pb-2 text-caption text-text-tertiary"
              aria-hidden="true"
            >
              atau
            </span>
            <div>
              <label
                htmlFor="analytics-start"
                className="mb-1 block text-caption font-semibold text-text-secondary"
              >
                Dari
              </label>
              <input
                id="analytics-start"
                type="date"
                value={customStart}
                onChange={(e) => {
                  setCustomStart(e.target.value)
                  setCustomError(null)
                }}
                className="rounded-sm border border-border bg-surface px-2.5 py-1.5 text-body text-text-primary"
              />
            </div>
            <div>
              <label
                htmlFor="analytics-end"
                className="mb-1 block text-caption font-semibold text-text-secondary"
              >
                Sampai
              </label>
              <input
                id="analytics-end"
                type="date"
                value={customEnd}
                onChange={(e) => {
                  setCustomEnd(e.target.value)
                  setCustomError(null)
                }}
                className="rounded-sm border border-border bg-surface px-2.5 py-1.5 text-body text-text-primary"
              />
            </div>
            <Button
              variant="primary"
              size="sm"
              fullWidth={false}
              onClick={handleCustomApply}
            >
              Terapkan
            </Button>
            {customRange ? (
              <Button
                variant="ghost"
                size="sm"
                fullWidth={false}
                onClick={handleCustomReset}
              >
                Reset
              </Button>
            ) : null}
          </div>
          {customError ? (
            <p className="mt-2 text-caption text-danger-text">{customError}</p>
          ) : null}
          <p className="mt-2 text-caption text-text-secondary">
            Rentang aktif:{" "}
            <span className="font-semibold text-text-primary">
              {customRange ? "Kustom" : "Preset"}{" "}
              {formatRangeLabel(activeRange)}
            </span>
            {customRange ? " · preset dinonaktifkan" : ""}
            {" · "}pengguna teratas selalu dihitung sepanjang waktu.
          </p>
        </Card>
      </div>

      {loading ? (
        <div className="flex min-h-[40vh] items-center justify-center gap-2">
          <Spinner size="md" />
          <p className="text-body text-text-secondary">Memuat analitik…</p>
        </div>
      ) : error ? (
        <Card>
          <EmptyState
            title="Gagal memuat analitik"
            description={error}
            action={
              <Button
                variant="secondary"
                fullWidth={false}
                onClick={() => load("initial", activeRange)}
              >
                Coba lagi
              </Button>
            }
          />
        </Card>
      ) : overview ? (
        <div className="flex flex-col gap-6">
          <section aria-label="Indikator kinerja">
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
              <StatCard
                label="Total pengguna"
                value={formatNumber(num(overview.users?.total))}
              />
              <StatCard
                label="Pengguna baru"
                value={formatNumber(num(overview.users?.new))}
              />
              <StatCard
                label="Pengguna aktif"
                value={formatNumber(num(overview.activeUsers))}
              />
              <StatCard
                label="Total order"
                value={formatNumber(num(overview.orders?.total))}
              />
              <StatCard
                label="Order selesai"
                value={formatNumber(num(overview.orders?.completed))}
              />
              <StatCard
                label="Sengketa"
                value={formatNumber(num(overview.orders?.disputed))}
              />
              <StatCard
                label="Dibatalkan"
                value={formatNumber(num(overview.orders?.cancelled))}
              />
              <StatCard
                label="Dispute rate"
                value={`${num(overview.orders?.disputeRate).toFixed(1)}%`}
              />
              <StatCard
                label="GMV"
                value={formatRupiah(overview.financial?.gmv)}
              />
              <StatCard
                label="Revenue"
                value={formatRupiah(overview.financial?.revenue)}
              />
            </div>
          </section>

          <Card padded={false}>
            <CardHeader
              title="Statistik order"
              subtitle={`Periode ${formatRangeLabel(activeRange)}`}
              action={
                <Select
                  options={GROUP_BY_OPTIONS}
                  value={groupBy}
                  onChange={(e) =>
                    handleGroupByChange(e.target.value as OrderStatsGroupBy)
                  }
                  className="w-40"
                  aria-label="Kelompokkan per"
                />
              }
            />
            <CardBody>
              <DataTable<OrderStatRow>
                columns={[
                  {
                    key: "period",
                    header: "Periode",
                    render: (r) => (
                      <span className="whitespace-nowrap">
                        {r.period ? formatDateTimeWIB(r.period) : "—"}
                      </span>
                    ),
                  },
                  {
                    key: "totalOrders",
                    header: "Total order",
                    align: "right",
                    render: (r) => formatNumber(num(r.totalOrders)),
                  },
                  {
                    key: "completed",
                    header: "Selesai",
                    align: "right",
                    render: (r) => formatNumber(num(r.completed)),
                  },
                  {
                    key: "disputed",
                    header: "Sengketa",
                    align: "right",
                    render: (r) => formatNumber(num(r.disputed)),
                  },
                  {
                    key: "cancelled",
                    header: "Batal",
                    align: "right",
                    render: (r) => formatNumber(num(r.cancelled)),
                  },
                  {
                    key: "gmv",
                    header: "GMV",
                    align: "right",
                    render: (r) => (
                      <span className="whitespace-nowrap">
                        {formatRupiah(r.gmv)}
                      </span>
                    ),
                  },
                  {
                    key: "revenue",
                    header: "Revenue",
                    align: "right",
                    render: (r) => (
                      <span className="whitespace-nowrap">
                        {formatRupiah(r.revenue)}
                      </span>
                    ),
                  },
                ]}
                rows={statsPageRows}
                rowKey={(r, i) => `${r.period ?? "row"}-${i}`}
                emptyText="Belum ada statistik order pada rentang ini."
              />
              <div className="mt-4">
                <Pagination
                  page={statsPage}
                  totalPages={statsTotalPages}
                  total={orderStats.length}
                  pageSize={PAGE_SIZE}
                  onPageChange={setStatsPage}
                />
              </div>
            </CardBody>
          </Card>

          <Card padded={false}>
            <CardHeader
              title="Pengguna teratas"
              subtitle="Sepanjang waktu — tidak terpengaruh rentang tanggal"
              action={
                <Select
                  options={METRIC_OPTIONS}
                  value={metric}
                  onChange={(e) =>
                    handleMetricChange(e.target.value as TopUserMetric)
                  }
                  className="w-48"
                  aria-label="Metrik pengguna teratas"
                />
              }
            />
            <CardBody>
              <DataTable<TopUser & { __rank: number }>
                columns={[
                  {
                    key: "__rank",
                    header: "#",
                    render: (u) => (
                      <span className="text-text-secondary">{u.__rank}</span>
                    ),
                  },
                  {
                    key: "user",
                    header: "Pengguna",
                    render: (u) => (
                      <div className="min-w-44">
                        <p className="font-semibold">
                          {u.fullName ?? u.username ?? "—"}
                        </p>
                        {u.membershipRank ? (
                          <p className="text-caption text-text-secondary">
                            {u.membershipRank}
                          </p>
                        ) : null}
                      </div>
                    ),
                  },
                  {
                    key: "metric",
                    header: "Nilai",
                    render: (u) => topUserMetricLabel(metric, u),
                  },
                  {
                    key: "kyc",
                    header: "KYC",
                    render: (u) =>
                      u.isKycVerified ? (
                        <Badge tone="success">Terverifikasi</Badge>
                      ) : (
                        <Badge tone="neutral">Belum</Badge>
                      ),
                  },
                ]}
                rows={rankedTopUsers}
                rowKey={(u, i) => u.userId ?? `user-${i}`}
                emptyText="Belum ada data pengguna teratas."
              />
            </CardBody>
          </Card>

          <Card padded={false}>
            <CardHeader title="Pertumbuhan pengguna" />
            <CardBody>
              <DataTable<UserGrowthRow>
                columns={[
                  {
                    key: "day",
                    header: "Tanggal",
                    render: (r) => (
                      <span className="whitespace-nowrap">
                        {r.day ? formatDateTimeWIB(r.day) : "—"}
                      </span>
                    ),
                  },
                  {
                    key: "newUsers",
                    header: "Pengguna baru",
                    align: "right",
                    render: (r) => `+${formatNumber(num(r.newUsers))}`,
                  },
                  {
                    key: "cumulative",
                    header: "Kumulatif",
                    align: "right",
                    render: (r) => formatNumber(num(r.cumulative)),
                  },
                ]}
                rows={growthPageRows}
                rowKey={(r, i) => `${r.day ?? "day"}-${i}`}
                emptyText="Belum ada data pertumbuhan pada rentang ini."
              />
              <div className="mt-4">
                <Pagination
                  page={growthPage}
                  totalPages={growthTotalPages}
                  total={growth.length}
                  pageSize={PAGE_SIZE}
                  onPageChange={setGrowthPage}
                />
              </div>
            </CardBody>
          </Card>
        </div>
      ) : null}
    </RoleGate>
  )
}
