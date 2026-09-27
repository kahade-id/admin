/**
 * Admin — Daftar Pengguna (GET /v1/admin/users).
 *
 * Pencarian (debounce 400ms: nama/email/username/userId/HP), filter status
 * via Select, DataTable + Pagination bernomor, klik nama/"Lihat" → detail.
 */
"use client"

import Link from "next/link"
import { useCallback, useEffect, useState } from "react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { DataTable } from "@/components/ui/table"
import { useToast } from "@/components/ui/toast"
import { Pagination } from "@/components/admin/pagination"
import { Select } from "@/components/admin/select"
import { RoleGate } from "@/components/admin/role-gate"
import {
  listAdminUsers,
  type AdminUserStatusFilter,
  type AdminUserSummary,
  type KycStatus,
} from "@/lib/api/admin/users"
import { userMessage } from "@/lib/api/response"
import { formatDateTimeWIB, formatNumber } from "@/lib/format"

import { ErrorBlock, LoadingBlock, PageHeader } from "../_components/admin-ui"
import { ExportUsersDialog } from "./_components/export-users-dialog"

const PAGE_SIZE = 20
const DEBOUNCE_MS = 400

type StatusFilter = "all" | AdminUserStatusFilter

const STATUS_OPTIONS: Array<{ value: StatusFilter; label: string }> = [
  { value: "all", label: "Semua" },
  { value: "active", label: "Aktif" },
  { value: "banned", label: "Diblokir" },
  { value: "kyc_approved", label: "KYC disetujui" },
  { value: "kyc_pending", label: "KYC menunggu" },
  { value: "flagged", label: "Perlu review" },
]

function useDebouncedValue(value: string, delayMs: number): string {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs)
    return () => clearTimeout(timer)
  }, [value, delayMs])
  return debounced
}

function KycBadge({ status }: { status: KycStatus }) {
  if (!status) return <Badge tone="neutral">—</Badge>
  const upper = status.toUpperCase()
  if (upper === "APPROVED") return <Badge tone="success">Terverifikasi</Badge>
  if (upper === "PENDING") return <Badge tone="warning">Menunggu</Badge>
  if (upper === "REJECTED") return <Badge tone="danger">Ditolak</Badge>
  return <Badge tone="neutral">{status}</Badge>
}

function StatusCell({ user }: { user: AdminUserSummary }) {
  if (user.isBanned) {
    return <Badge tone="danger">Diblokir</Badge>
  }
  return (
    <span className="flex flex-wrap items-center gap-1.5">
      <Badge tone="success">Aktif</Badge>
      {user.flaggedForReview ? <Badge tone="warning">Perlu review</Badge> : null}
    </span>
  )
}

export default function UsersListPage() {
  const toast = useToast()

  const [query, setQuery] = useState("")
  const [filter, setFilter] = useState<StatusFilter>("all")
  const [page, setPage] = useState(1)
  const debouncedQuery = useDebouncedValue(query, DEBOUNCE_MS)

  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [rows, setRows] = useState<AdminUserSummary[]>([])
  const [total, setTotal] = useState(0)
  const [totalPages, setTotalPages] = useState(1)
  const [exportOpen, setExportOpen] = useState(false)

  const load = useCallback(
    async (
      mode: "initial" | "refresh" = "initial",
      targetPage: number,
      targetFilter: StatusFilter,
      targetQuery: string,
    ) => {
      if (mode === "initial") setLoading(true)
      else setRefreshing(true)
      setError(null)
      try {
        const res = await listAdminUsers({
          q: targetQuery || undefined,
          status: targetFilter === "all" ? undefined : targetFilter,
          page: targetPage,
          limit: PAGE_SIZE,
        })
        setRows(res.data ?? [])
        const t = res.total ?? 0
        setTotal(t)
        setTotalPages(Math.max(1, res.totalPages ?? Math.ceil(t / PAGE_SIZE)))
      } catch (e) {
        const msg = userMessage(e)
        setError(msg)
        toast.show({ title: "Gagal memuat pengguna", description: msg, tone: "danger" })
      } finally {
        setLoading(false)
        setRefreshing(false)
      }
    },
    [toast],
  )

  // Muat ulang saat pencarian (debounce) / filter berubah — kembali ke hal. 1.
  useEffect(() => {
    void load("initial", 1, filter, debouncedQuery)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedQuery, filter])

  const handleFilterChange = (value: StatusFilter) => {
    setFilter(value)
    setPage(1)
  }

  const handlePageChange = (p: number) => {
    setPage(p)
    void load("initial", p, filter, debouncedQuery)
  }

  return (
    <RoleGate href="/users">
      <PageHeader
        title="Pengguna"
        description="Kelola akun pengguna Kahade: cari, filter status, dan tinjau detail."
        actions={
          <Button
            variant="secondary"
            size="sm"
            fullWidth={false}
            onClick={() => setExportOpen(true)}
          >
            Ekspor CSV
          </Button>
        }
        onRefresh={() => {
          void load("refresh", page, filter, debouncedQuery)
        }}
        refreshing={refreshing}
      />

      <div className="mb-4 flex flex-wrap items-end gap-3">
        <div className="min-w-64 flex-1">
          <Input
            placeholder="Cari nama, email, username, ID, atau HP…"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value)
              setPage(1)
            }}
            aria-label="Cari pengguna"
          />
        </div>
        <div className="w-52">
          <Select
            label="Status"
            options={STATUS_OPTIONS}
            value={filter}
            onChange={(e) => handleFilterChange(e.target.value as StatusFilter)}
          />
        </div>
      </div>

      {loading ? (
        <LoadingBlock message="Memuat pengguna…" />
      ) : error && rows.length === 0 ? (
        <ErrorBlock
          title="Gagal memuat pengguna"
          message={error}
          onRetry={() => load("initial", page, filter, debouncedQuery)}
        />
      ) : (
        <>
          <DataTable<AdminUserSummary>
            columns={[
              {
                key: "user",
                header: "Pengguna",
                render: (r) => {
                  const name = r.fullName?.trim() || "Tanpa nama"
                  return (
                    <div className="min-w-0">
                      <Link
                        href={`/users/${r.id}`}
                        className="font-semibold text-info-text hover:underline"
                      >
                        {name}
                      </Link>
                      {r.username ? (
                        <p className="text-caption text-text-secondary">@{r.username}</p>
                      ) : null}
                      <p className="truncate text-caption text-text-secondary">{r.email}</p>
                    </div>
                  )
                },
              },
              {
                key: "status",
                header: "Status",
                render: (r) => <StatusCell user={r} />,
              },
              {
                key: "kyc",
                header: "KYC",
                render: (r) => <KycBadge status={r.kycStatus} />,
              },
              {
                key: "wallet",
                header: "Saldo tersedia",
                align: "right",
                render: (r) => `Rp ${formatNumber(r.wallet?.availableBalance)}`,
              },
              {
                key: "orders",
                header: "Order",
                render: (r) =>
                  `${r.totalOrdersAsBuyer} beli · ${r.totalOrdersAsSeller} jual`,
              },
              {
                key: "createdAt",
                header: "Terdaftar",
                render: (r) => formatDateTimeWIB(r.createdAt),
              },
              {
                key: "action",
                header: "",
                align: "right",
                render: (r) => (
                  <Link
                    href={`/users/${r.id}`}
                    className="font-semibold text-info-text hover:underline"
                  >
                    Lihat
                  </Link>
                ),
              },
            ]}
            rows={rows}
            rowKey={(r) => r.id}
            emptyText={
              debouncedQuery
                ? `Tidak ditemukan untuk "${debouncedQuery}".`
                : "Tidak ada pengguna pada filter ini."
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

      <ExportUsersDialog
        open={exportOpen}
        onClose={() => setExportOpen(false)}
        q={debouncedQuery}
        status={filter === "all" ? undefined : filter}
      />
    </RoleGate>
  )
}
