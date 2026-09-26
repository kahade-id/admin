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
import {
  getDashboardOrderStats,
  getDashboardSummary,
  getRecentActivity,
  type DashboardSummary,
  type OrderStats,
  type RecentActivityItem,
} from "@/lib/api/admin/dashboard"
import { userMessage } from "@/lib/api/response"
import { useAuth } from "@/lib/auth-context"
import { formatDateTimeWIB, formatNumber, num } from "@/lib/format"
import { menuForRole } from "@/lib/rbac"

const ORDER_LABEL: Record<string, string> = {
  WAITING_CONFIRMATION: "Menunggu konfirmasi",
  WAITING_PAYMENT: "Menunggu pembayaran",
  PROCESSING: "Diproses",
  IN_DELIVERY: "Dikirim",
  COMPLETED: "Selesai",
  DISPUTED: "Disengketakan",
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

const MENU_DESC: Record<string, string> = {
  "/kyc": "Antrean verifikasi identitas pengguna",
  "/business": "Antrean verifikasi badan usaha",
  "/disputes": "Sengketa escrow yang perlu putusan",
  "/tickets": "Tiket dukungan pengguna",
  "/reports": "Laporan konten & akun",
  "/chat": "Pantau percakapan pengguna",
  "/badges": "Kelola badge verifikasi",
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <Card>
      <p className="text-caption text-text-secondary">{label}</p>
      <p className="mt-1 text-h3 font-bold text-text-primary">{value}</p>
    </Card>
  )
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

  const load = useCallback(
    async (mode: "initial" | "refresh" = "initial") => {
      if (mode === "initial") setLoading(true)
      else setRefreshing(true)
      setError(null)
      try {
        const [sum, stats, act] = await Promise.all([
          getDashboardSummary(),
          getDashboardOrderStats(),
          getRecentActivity({ limit: 10 }),
        ])
        setSummary(sum)
        setOrderStats(Array.isArray(stats) ? stats : [])
        setActivity(Array.isArray(act) ? act : [])
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
                <StatCard label="Total pengguna" value={formatNumber(num(summary.totalUsers))} />
                <StatCard label="Total order" value={formatNumber(num(summary.totalOrders))} />
                <StatCard label="Escrow aktif" value={formatNumber(num(summary.activeEscrow))} />
                <StatCard label="KYC menunggu" value={formatNumber(num(summary.pendingKyc))} />
                <StatCard
                  label="Sengketa menunggu"
                  value={formatNumber(num(summary.pendingDisputes))}
                />
                <StatCard
                  label="Penarikan menunggu"
                  value={formatNumber(num(summary.pendingWithdrawals))}
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
