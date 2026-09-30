"use client"

/**
 * Admin — Dasbor: ringkasan platform + navigasi ke tiap antrean.
 *
 * - Kartu ringkasan: total pengguna, total order, escrow aktif, serta
 *   antrean menunggu (KYC, sengketa, penarikan) dari getDashboardSummary().
 * - Distribusi status order dari getDashboardOrderStats().
 * - Aktivitas terbaru dari getRecentActivity().
 * - Menu navigasi difilter per RBAC (menuForRole).
 *
 * Port dari frontend/app/admin/(panel)/index.tsx → web desktop.
 */

import Link from "next/link"
import { useCallback, useEffect, useState } from "react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card"
import { EmptyState } from "@/components/ui/empty-state"
import { Spinner } from "@/components/ui/spinner"
import { useToast } from "@/components/ui/toast"
import { RoleGate } from "@/components/admin/role-gate"
import { Select } from "@/components/admin/select"
import {
  getDashboardCharts,
  getDashboardOrderStats,
  getDashboardSummary,
  getRecentActivity,
  type DashboardChartParams,
  type DashboardChartPoint,
  type DashboardSummary,
  type OrderStats,
  type RecentActivityItem,
} from "@/lib/api/admin/dashboard"
import { getFinancialSummary } from "@/lib/api/admin/finance"
import { userMessage } from "@/lib/api/response"
import { useAuth } from "@/lib/auth-context"
import { formatDateTimeWIB, formatIDR, formatNumber, num } from "@/lib/format"
import { menuForRole } from "@/lib/rbac"

const ORDER_LABEL: Record<string, string> = {
  WAITING_CONFIRMATION: "Menunggu konfirmasi penjual",
  WAITING_PAYMENT: "Menunggu pembayaran",
  PROCESSING: "Diproses penjual",
  IN_DELIVERY: "Dalam pengiriman",
  COMPLETED: "Selesai",
  DISPUTED: "Sengketa",
  CANCELLED: "Dibatalkan",
}

const ORDER_TONE: Record<
  string,
  "neutral" | "info" | "success" | "warning" | "danger" | "accent"
> = {
  WAITING_CONFIRMATION: "warning",
  WAITING_PAYMENT: "warning",
  PROCESSING: "info",
  IN_DELIVERY: "info",
  COMPLETED: "success",
  DISPUTED: "danger",
  CANCELLED: "neutral",
}

const CHART_PERIODS = [
  { value: "7d", label: "7 hari" },
  { value: "30d", label: "30 hari" },
  { value: "90d", label: "90 hari" },
  { value: "1y", label: "1 tahun" },
  { value: "custom", label: "Rentang khusus" },
] as const

const MENU_DESC: Record<string, string> = {
  "/kyc": "Antrean verifikasi identitas pengguna",
  "/business": "Antrean verifikasi badan usaha",
  "/disputes": "Sengketa escrow yang perlu putusan",
  "/tickets": "Tiket dukungan pengguna",
  "/reports": "Laporan konten & akun",
  "/chat": "Pantau percakapan pengguna",
  "/badges": "Kelola badge verifikasi",
}

function StatCard({
  label,
  value,
  hint,
}: {
  label: string
  value: string
  /** Penjelasan definisi metrik (BAI-122/124/134) — tampil sebagai hint kecil. */
  hint?: string
}) {
  return (
    <Card>
      <p className="text-caption text-text-secondary">
        {label}
        {hint ? (
          <span
            className="ml-1 cursor-help text-text-tertiary underline decoration-dotted underline-offset-2"
            title={hint}
            aria-label={hint}
          >
            ?
          </span>
        ) : null}
      </p>
      <p className="mt-1 text-h3 font-bold text-text-primary">{value}</p>
    </Card>
  )
}

/**
 * ADM-011: metrik yang hilang (undefined/null) tampil "—", bukan "0" —
 * "0 pengguna" adalah angka palsu. Nilai 0 yang valid tetap tampil "0".
 */
function statNum(value: unknown): string {
  return value == null ? "—" : formatNumber(num(value))
}

export default function DashboardPage() {
  const toast = useToast()
  const { role } = useAuth()

  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [summary, setSummary] = useState<DashboardSummary | null>(null)
  const [orderStats, setOrderStats] = useState<OrderStats>([])
  const [activity, setActivity] = useState<RecentActivityItem[]>([])
  // AW-001: summary dashboard backend tidak punya `pendingWithdrawals` —
  // diambil dari GET /v1/admin/finance/summary (SUPER_ADMIN boleh keduanya).
  const [pendingWithdrawals, setPendingWithdrawals] = useState<number | null>(null)
  const [chartPeriod, setChartPeriod] = useState<string>("30d")
  const [chartStart, setChartStart] = useState("")
  const [chartEnd, setChartEnd] = useState("")
  const [chartData, setChartData] = useState<DashboardChartPoint[]>([])
  const [chartLoading, setChartLoading] = useState(false)

  const load = useCallback(
    async (mode: "initial" | "refresh" = "initial") => {
      if (mode === "initial") setLoading(true)
      else setRefreshing(true)
      setError(null)
      try {
        // AW-002: ambil keempatnya paralel — getFinancialSummary gagal (mis. role
      // tanpa akses keuangan) → null, tampil "—" bukan 0 palsu.
      const [sum, stats, act, fin] = await Promise.all([
        // BAI-125: mode "refresh" (tombol "Muat ulang") kirim refresh=true
        // agar backend melewati cache 5 menit dan menghitung ulang dari DB.
        getDashboardSummary(mode === "refresh" ? { refresh: true } : undefined),
        getDashboardOrderStats(),
        getRecentActivity({ limit: 10 }),
        getFinancialSummary().catch(() => null),
      ])
      setSummary(sum)
      setOrderStats(stats)
      setActivity(Array.isArray(act) ? act : [])
      // Penarikan menunggu tidak ada di summary dashboard — ambil dari
      // ringkasan keuangan. Gagal → null (tampil "—", bukan 0 palsu).
      setPendingWithdrawals(
        typeof fin?.pendingWithdrawals === "number" ? fin.pendingWithdrawals : null,
      )
      } catch (e) {
        const msg = userMessage(e)
        setError(msg)
        toast.show({ title: "Gagal memuat dasbor", description: msg, tone: "danger" })
      } finally {
        setLoading(false)
        setRefreshing(false)
      }
    },
    [toast],
  )

  useEffect(() => {
    void load("initial")
  }, [load])

  const loadCharts = useCallback(
    async (period: string, start: string, end: string) => {
      setChartLoading(true)
      try {
        const params: DashboardChartParams =
          period === "custom"
            ? {
                ...(start ? { startDate: start } : {}),
                ...(end ? { endDate: end } : {}),
              }
            : { period }
        const res = await getDashboardCharts(params)
        setChartData(Array.isArray(res?.data) ? res.data : [])
      } catch (e) {
        toast.show({
          title: "Gagal memuat tren",
          description: userMessage(e),
          tone: "danger",
        })
        setChartData([])
      } finally {
        setChartLoading(false)
      }
    },
    [toast],
  )

  useEffect(() => {
    void loadCharts(chartPeriod, chartStart, chartEnd)
  }, [loadCharts, chartPeriod])

  const handleChartPeriodChange = (p: string) => {
    setChartPeriod(p)
    if (p !== "custom") void loadCharts(p, "", "")
  }

  const handleCustomRangeApply = () => {
    if (chartPeriod === "custom") void loadCharts("custom", chartStart, chartEnd)
  }

  const maxOrders = Math.max(1, ...chartData.map((d) => d.orders))
  // ADM-012: judul kartu menyebut "pendapatan" — render seri pendapatan
  // (batang kedua per hari), bukan hanya order. Pendapatan dalam IDR.
  const maxRevenue = Math.max(1, ...chartData.map((d) => d.revenue ?? 0))

  const menu = menuForRole(role).filter((m) => m.href !== "/")

  return (
    <RoleGate href="/">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-h2 font-bold text-text-primary">Dasbor Admin</h1>
          <p className="mt-1 text-body text-text-secondary">
            Ringkasan platform dan antrean yang membutuhkan tindakan.
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

      {loading ? (
        <div className="flex min-h-[40vh] items-center justify-center gap-2">
          <Spinner size="md" />
          <p className="text-body text-text-secondary">Memuat dasbor…</p>
        </div>
      ) : error && !summary ? (
        <Card>
          <EmptyState
            title="Gagal memuat dasbor"
            description={error}
            action={
              <Button variant="secondary" fullWidth={false} onClick={() => load("initial")}>
                Coba lagi
              </Button>
            }
          />
        </Card>
      ) : (
        <div className="space-y-6">
          {summary ? (
            <section aria-label="Ringkasan">
              <div className="grid grid-cols-2 gap-3 xl:grid-cols-3">
                <StatCard label="Total pengguna" value={statNum(summary.users?.total)} />
                <StatCard label="Total order" value={statNum(summary.orders?.total)} />
                <StatCard
                  label="Escrow aktif"
                  value={statNum(summary.orders?.active)}
                  hint="Order yang belum final: menunggu konfirmasi penjual, menunggu pembayaran, diproses, atau dikirim. Tidak termasuk selesai/dibatalkan/disengketakan."
                />
                <StatCard label="KYC menunggu" value={statNum(summary.kyc?.pending)} />
                <StatCard
                  label="Sengketa menunggu"
                  value={statNum(summary.disputes?.open)}
                />
                <StatCard
                  label="Penarikan menunggu"
                  value={pendingWithdrawals == null ? "—" : formatNumber(pendingWithdrawals)}
                />
              </div>
            </section>
          ) : null}

          <Card padded={false}>
            <CardHeader title="Status order" />
            <CardBody>
              {orderStats.length === 0 ? (
                <EmptyState
                  compact
                  title="Belum ada data"
                  description="Belum ada order tercatat."
                />
              ) : (
                <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                  {orderStats.map((s) => (
                    <div
                      key={String(s.status)}
                      className="flex items-center justify-between gap-2 rounded-sm border border-border px-4 py-3"
                    >
                      <Badge tone={ORDER_TONE[String(s.status)] ?? "neutral"}>
                        {ORDER_LABEL[String(s.status)] ?? String(s.status)}
                      </Badge>
                      <span className="text-body font-bold text-text-primary">
                        {formatNumber(typeof s.count === "number" ? s.count : 0)}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </CardBody>
          </Card>

          <Card padded={false}>
            <CardHeader title="Tren order & pendapatan" />
            <CardBody>
              <div className="mb-4 flex flex-wrap items-end gap-3">
                <Select
                  label="Periode"
                  options={CHART_PERIODS.map((p) => ({ value: p.value, label: p.label }))}
                  value={chartPeriod}
                  onChange={(e) => handleChartPeriodChange(e.target.value)}
                  className="w-44"
                />
                {chartPeriod === "custom" ? (
                  <>
                    <label className="flex flex-col gap-1 text-caption text-text-secondary">
                      Dari tanggal
                      <input
                        type="date"
                        value={chartStart}
                        max={chartEnd || undefined}
                        onChange={(e) => setChartStart(e.target.value)}
                        className="rounded-sm border border-border bg-surface px-3 py-2 text-body text-text-primary"
                      />
                    </label>
                    <label className="flex flex-col gap-1 text-caption text-text-secondary">
                      Sampai tanggal
                      <input
                        type="date"
                        value={chartEnd}
                        min={chartStart || undefined}
                        onChange={(e) => setChartEnd(e.target.value)}
                        className="rounded-sm border border-border bg-surface px-3 py-2 text-body text-text-primary"
                      />
                    </label>
                    <Button
                      variant="secondary"
                      size="sm"
                      fullWidth={false}
                      onClick={handleCustomRangeApply}
                      disabled={!chartStart && !chartEnd}
                    >
                      Terapkan
                    </Button>
                  </>
                ) : null}
              </div>
              {chartLoading ? (
                <div className="flex items-center justify-center gap-2 py-8">
                  <Spinner size="md" />
                  <p className="text-body text-text-secondary">Memuat tren…</p>
                </div>
              ) : chartData.length === 0 ? (
                <EmptyState
                  compact
                  title="Belum ada data"
                  description="Tidak ada order pada periode ini."
                />
              ) : (
                <div
                  className="flex items-end gap-1 overflow-x-auto pb-2"
                  role="img"
                  aria-label={`Grafik order & pendapatan per hari, ${chartData.length} hari`}
                >
                  {chartData.map((d) => {
                    const revenue = d.revenue ?? null
                    const revenueTitle =
                      revenue == null
                        ? "pendapatan tidak tersedia"
                        : `${formatIDR(revenue)} pendapatan`
                    return (
                      <div
                        key={d.date}
                        className="flex min-w-[28px] flex-1 flex-col items-center gap-1"
                        title={`${d.date}: ${d.orders} order • ${revenueTitle}`}
                      >
                        <div className="flex h-32 w-full items-end justify-center gap-1 rounded-sm bg-surface px-1">
                          <div
                            className="w-1/2 max-w-[10px] rounded-sm bg-info"
                            style={{ height: `${Math.max(4, (d.orders / maxOrders) * 100)}%` }}
                            aria-hidden
                          />
                          {revenue == null ? (
                            <div className="w-1/2 max-w-[10px] rounded-sm border border-dashed border-border" style={{ height: "6%" }} aria-hidden title="Data pendapatan hilang — tidak digambar sebagai 0" />
                          ) : (
                            <div
                              className="w-1/2 max-w-[10px] rounded-sm bg-success"
                              style={{ height: `${Math.max(4, (revenue / maxRevenue) * 100)}%` }}
                              aria-hidden
                            />
                          )}
                        </div>
                        <span className="text-caption tabular-nums text-text-tertiary">
                          {d.date.slice(5)}
                        </span>
                      </div>
                    )
                  })}
                </div>
              )}
              <div className="mt-2 flex gap-4" aria-hidden>
                <span className="flex items-center gap-1.5 text-caption text-text-tertiary">
                  <span className="inline-block h-2.5 w-2.5 rounded-sm bg-info" /> Order
                </span>
                <span className="flex items-center gap-1.5 text-caption text-text-tertiary">
                  <span className="inline-block h-2.5 w-2.5 rounded-sm bg-success" /> Pendapatan
                </span>
              </div>
            </CardBody>
          </Card>

          <Card padded={false}>
            <CardHeader title="Aktivitas terbaru" />
            <CardBody>
              {activity.length === 0 ? (
                <EmptyState
                  compact
                  title="Belum ada data"
                  description="Belum ada aktivitas admin tercatat."
                />
              ) : (
                <ul className="space-y-2">
                  {activity.map((item) => (
                    <li key={item.id} className="rounded-sm border border-border px-4 py-3">
                      <p className="text-body font-semibold text-text-primary">{item.action}</p>
                      {item.description ? (
                        <p className="mt-0.5 text-caption text-text-secondary">
                          {item.description}
                        </p>
                      ) : null}
                      <p className="mt-0.5 text-caption text-text-tertiary">
                        {[item.adminName, formatDateTimeWIB(item.createdAt)]
                          .filter(Boolean)
                          .join(" · ")}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </CardBody>
          </Card>

          <section aria-label="Menu admin">
            <CardTitle className="mb-3">Menu admin</CardTitle>
            <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
              {menu.map((m) => (
                <Link
                  key={m.href}
                  href={m.href}
                  className="rounded-md border border-border bg-surface px-4 py-3 transition-colors hover:bg-surface-elevated"
                >
                  <p className="text-body font-semibold text-text-primary">{m.label}</p>
                  <p className="mt-0.5 text-caption text-text-secondary">
                    {MENU_DESC[m.href] ?? ""}
                  </p>
                </Link>
              ))}
            </div>
          </section>
        </div>
      )}
    </RoleGate>
  )
}
