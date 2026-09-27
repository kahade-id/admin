/**
 * Admin — Referral: statistik platform + daftar kode referral.
 *
 * Kartu ringkasan (total kode, kode aktif, relasi, reward, reward terbayar)
 * + tabel kode referral (kode, pengundang, pendaftar, status, komisi) dengan
 * filter status, pencarian lokal, dan paginasi bernomor.
 *
 * Port dari frontend/app/admin/(panel)/referral.tsx → web desktop.
 */
"use client"

import { useCallback, useEffect, useRef, useState } from "react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { EmptyState } from "@/components/ui/empty-state"
import { Input } from "@/components/ui/input"
import { Spinner } from "@/components/ui/spinner"
import { DataTable } from "@/components/ui/table"
import { useToast } from "@/components/ui/toast"
import { Pagination } from "@/components/admin/pagination"
import { RoleGate } from "@/components/admin/role-gate"
import { Select } from "@/components/admin/select"
import {
  getReferralStats,
  listReferralCodes,
  type ReferralCodeItem,
  type ReferralStats,
} from "@/lib/api/admin/referral"
import { userMessage } from "@/lib/api/response"
import { formatDateTimeWIB, formatNumber, num } from "@/lib/format"
// ADM-405: email pengguna di-mask secara default (mask-only, tanpa unmask).
import { maskEmail } from "@/lib/pii"

const PAGE_SIZE = 20
const SEARCH_DEBOUNCE_MS = 400

type ActiveFilter = "all" | "active" | "inactive"

const ACTIVE_OPTIONS = [
  { value: "all", label: "Semua kode" },
  { value: "active", label: "Aktif" },
  { value: "inactive", label: "Nonaktif" },
]

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

function ownerName(c: ReferralCodeItem): string {
  return c.user?.fullName ?? c.user?.username ?? "—"
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

export default function ReferralPage() {
  const toast = useToast()

  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [stats, setStats] = useState<ReferralStats | null>(null)
  const [rows, setRows] = useState<ReferralCodeItem[]>([])
  const [total, setTotal] = useState(0)
  const [totalPages, setTotalPages] = useState(1)
  const [page, setPage] = useState(1)

  const [activeFilter, setActiveFilter] = useState<ActiveFilter>("all")
  const [search, setSearch] = useState("")
  const debouncedSearch = useDebouncedValue(search, SEARCH_DEBOUNCE_MS)

  const load = useCallback(
    async (
      mode: "initial" | "refresh" = "initial",
      targetPage = page,
      targetActive = activeFilter,
      targetSearch = debouncedSearch,
    ) => {
      if (mode === "initial") setLoading(true)
      else setRefreshing(true)
      setError(null)
      try {
        const [s, res] = await Promise.all([
          getReferralStats(),
          listReferralCodes({
            page: targetPage,
            limit: PAGE_SIZE,
            active:
              targetActive === "all" ? undefined : targetActive === "active",
            // ADM-221: pencarian server-side (kode / nama / username pemilik).
            q: targetSearch.trim() ? targetSearch.trim() : undefined,
          }),
        ])
        setStats(s)
        setRows(res.data ?? [])
        const t = res.total ?? res.data?.length ?? 0
        setTotal(t)
        setTotalPages(
          res.totalPages ?? Math.max(1, Math.ceil(t / PAGE_SIZE)),
        )
      } catch (e) {
        const msg = userMessage(e)
        setError(msg)
        toast.show({
          title: "Gagal memuat data referral",
          description: msg,
          tone: "danger",
        })
      } finally {
        setLoading(false)
        setRefreshing(false)
      }
    },
    [page, activeFilter, debouncedSearch, toast],
  )

  useEffect(() => {
    void load("initial")
  }, [load])

  // ADM-221: pencarian server-side — kembali ke halaman 1 saat kata kunci berubah.
  const searchMounted = useRef(false)
  useEffect(() => {
    if (!searchMounted.current) {
      searchMounted.current = true
      return
    }
    setPage(1)
    void load("initial", 1, activeFilter, debouncedSearch)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedSearch])

  const handleActiveChange = (v: ActiveFilter) => {
    setActiveFilter(v)
    setPage(1)
    void load("initial", 1, v)
  }

  const handlePageChange = (p: number) => {
    setPage(p)
    void load("initial", p, activeFilter)
  }



  return (
    <RoleGate href="/referral">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-h2 font-bold text-text-primary">Referral</h1>
          <p className="mt-1 text-body text-text-secondary">
            Statistik referral platform dan daftar kode referral pengguna.
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
          <p className="text-body text-text-secondary">
            Memuat data referral…
          </p>
        </div>
      ) : error ? (
        <Card>
          <EmptyState
            title="Gagal memuat data referral"
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
          {stats ? (
            <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-3">
              <StatCard
                label="Total kode"
                value={formatNumber(num(stats.totalCodes))}
              />
              <StatCard
                label="Kode aktif"
                value={formatNumber(num(stats.activeCodes))}
              />
              <StatCard
                label="Relasi referral"
                value={formatNumber(num(stats.totalRelations))}
              />
              <StatCard
                label="Jumlah reward"
                value={formatNumber(num(stats.totalRewards))}
              />
              <StatCard
                label="Reward menunggu"
                value={formatNumber(num(stats.pendingRewards))}
              />
              <StatCard
                label="Komisi dibayar"
                value={formatRupiah(stats.totalRewardsPaid)}
              />
            </div>
          ) : null}

          <div className="mb-4 flex flex-wrap items-end gap-3">
            <Select
              label="Status"
              options={ACTIVE_OPTIONS}
              value={activeFilter}
              onChange={(e) => handleActiveChange(e.target.value as ActiveFilter)}
              className="w-52"
            />
            <div className="min-w-64 flex-1">
              <Input
                label="Cari"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Kode referral, nama pengundang…"
              />
            </div>
          </div>

          <DataTable<ReferralCodeItem>
            columns={[
              {
                key: "code",
                header: "Kode",
                render: (c) => (
                  <span className="font-mono font-semibold">
                    {c.code ?? "—"}
                  </span>
                ),
              },
              {
                key: "user",
                header: "Pengundang",
                render: (c) => (
                  <div className="min-w-44">
                    <p className="font-semibold">{ownerName(c)}</p>
                    {c.user?.email ? (
                      <p className="text-caption text-text-secondary">
                        {maskEmail(c.user.email)}
                      </p>
                    ) : null}
                  </div>
                ),
              },
              {
                key: "totalReferrals",
                header: "Pendaftar",
                render: (c) => formatNumber(num(c.totalReferrals)),
              },
              {
                key: "status",
                header: "Status",
                render: (c) =>
                  c.isActive ? (
                    <Badge tone="success">Aktif</Badge>
                  ) : (
                    <Badge tone="neutral">Nonaktif</Badge>
                  ),
              },
              {
                key: "totalRewardEarned",
                header: "Komisi",
                align: "right",
                render: (c) => (
                  <span className="whitespace-nowrap font-semibold">
                    {formatRupiah(c.totalRewardEarned)}
                  </span>
                ),
              },
              {
                key: "createdAt",
                header: "Dibuat",
                render: (c) => (
                  <span className="whitespace-nowrap">
                    {formatDateTimeWIB(c.createdAt)}
                  </span>
                ),
              },
            ]}
            rows={rows}
            rowKey={(c) => c.id}
            emptyText={
              debouncedSearch.trim()
                ? "Tidak ada kode yang cocok dengan pencarian."
                : "Tidak ada kode referral pada filter ini."
            }
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
    </RoleGate>
  )
}
