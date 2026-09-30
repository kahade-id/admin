/**
 * Admin — Daftar Pengguna (GET /v1/admin/users).
 *
 * Pencarian (debounce 400ms: nama/email/username/userId/HP), filter status
 * via Select, DataTable + Pagination bernomor, klik nama/"Lihat" → detail.
 */
"use client"

import Link from "next/link"
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { DataTable } from "@/components/ui/table"
import { useToast } from "@/components/ui/toast"
import { Pagination } from "@/components/admin/pagination"
import { Select } from "@/components/admin/select"
import { RoleGate } from "@/components/admin/role-gate"
// H01: filter tersimpan di URL — refresh/berbagi tautan tidak menghilangkan filter.
import { parsePage, useUrlFilters } from "@/components/admin/batch139/use-url-filters"
// H02: kolom tabel dapat dikustomisasi per admin.
import {
  ColumnCustomizer,
  useColumnPrefs,
  type PrefsColumnDef,
} from "@/components/admin/batch139/column-prefs"
import {
  listAdminUsers,
  type AdminUserStatusFilter,
  type AdminUserSummary,
  type KycStatus,
} from "@/lib/api/admin/users"
import { userMessage } from "@/lib/api/response"
import { formatDateTimeWIB, formatIDR } from "@/lib/format"
// ADM-405: PII (nama, email) di-mask secara default — tanpa tombol unmask (mask-only).
import { maskEmail, maskName } from "@/lib/pii"

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
  // BAI-070: segmen KYC lain yang sebelumnya tak terjangkau filter.
  { value: "kyc_rejected", label: "KYC ditolak" },
  { value: "kyc_revoked", label: "KYC dicabut" },
  { value: "kyc_unverified", label: "KYC belum diajukan" },
  { value: "flagged", label: "Perlu review" },
]

/** ADM-014: sortir daftar pengguna (diteruskan ke sortBy/sortOrder backend). */
type SortOption = "createdAt-desc" | "createdAt-asc" | "lastLoginAt-desc" | "fullName-asc" | "email-asc"
const SORT_OPTIONS: Array<{ value: SortOption; label: string }> = [
  { value: "createdAt-desc", label: "Terdaftar terbaru" },
  { value: "createdAt-asc", label: "Terdaftar terlama" },
  { value: "lastLoginAt-desc", label: "Login terakhir" },
  { value: "fullName-asc", label: "Nama A–Z" },
  { value: "email-asc", label: "Email A–Z" },
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
  // H01: useSearchParams wajib di dalam Suspense (aturan Next.js).
  return (
    <Suspense fallback={null}>
      <UsersListInner />
    </Suspense>
  )
}

function UsersListInner() {
  const toast = useToast()

  // H01: query/page/sort/filter disinkronkan ke URL.
  const { values: f, set: setF } = useUrlFilters({
    q: "",
    status: "all",
    sort: "createdAt-desc",
    page: "1",
  })
  const [query, setQuery] = useState(f.q)
  const debouncedQuery = useDebouncedValue(query, DEBOUNCE_MS)
  const filter = (STATUS_OPTIONS.some((o) => o.value === f.status) ? f.status : "all") as StatusFilter
  const sort = (SORT_OPTIONS.some((o) => o.value === f.sort) ? f.sort : "createdAt-desc") as SortOption
  const page = parsePage(f.page)

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
      targetSort: SortOption,
    ) => {
      if (mode === "initial") setLoading(true)
      else setRefreshing(true)
      setError(null)
      try {
        const [sortBy, sortOrder] = targetSort.split("-") as [
          "createdAt" | "lastLoginAt" | "email" | "fullName",
          "asc" | "desc",
        ]
        const res = await listAdminUsers({
          q: targetQuery || undefined,
          status: targetFilter === "all" ? undefined : targetFilter,
          page: targetPage,
          limit: PAGE_SIZE,
          sortBy,
          sortOrder,
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

  // Muat ulang saat pencarian (debounce) / filter / sortir / page berubah.
  // Perubahan via URL (tombol back/forward, tautan berbagi) ikut ter-refresh.
  useEffect(() => {
    void load("initial", page, filter, debouncedQuery, sort)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, debouncedQuery, filter, sort])

  // H01: sinkronkan pencarian (sudah debounce) ke URL; reset ke hal. 1
  // hanya bila query benar-benar berubah (jaga tautan ?page=3).
  const prevQ = useRef(debouncedQuery)
  useEffect(() => {
    if (prevQ.current !== debouncedQuery) {
      prevQ.current = debouncedQuery
      setF({ q: debouncedQuery, page: "1" })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedQuery])

  const handleFilterChange = (value: StatusFilter) => {
    setF({ status: value, page: "1" })
  }

  const handleSortChange = (value: SortOption) => {
    setF({ sort: value, page: "1" })
  }

  const handlePageChange = (p: number) => {
    setF({ page: String(p) })
  }

  // H02: definisi kolom + preferensi per admin (pilih tampil/sembunyi + urutan).
  const columnDefs = useMemo<PrefsColumnDef<AdminUserSummary>[]>(
    () => [
      {
        key: "user",
        header: "Pengguna",
        render: (r) => {
          // ADM-405: mask nama + email pengguna di daftar.
          const name = maskName(r.fullName?.trim() || null)
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
              <p className="truncate text-caption text-text-secondary">{maskEmail(r.email)}</p>
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
        render: (r) => formatIDR(r.wallet?.availableBalance),
      },
      {
        key: "orders",
        header: "Order",
        render: (r) => `${r.totalOrdersAsBuyer} beli · ${r.totalOrdersAsSeller} jual`,
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
    ],
    [],
  )
  const cols = useColumnPrefs<AdminUserSummary>("users", columnDefs)

  return (
    <RoleGate href="/users">
      <PageHeader
        title="Pengguna"
        description="Kelola akun pengguna Kahade: cari, filter status, dan tinjau detail."
        actions={
          <>
            <Button
              variant="secondary"
              size="sm"
              fullWidth={false}
              onClick={() => cols.setCustomizerOpen(true)}
            >
              Kolom
            </Button>
            <Button
              variant="secondary"
              size="sm"
              fullWidth={false}
              onClick={() => setExportOpen(true)}
            >
              Ekspor CSV
            </Button>
          </>
        }
        onRefresh={() => {
          void load("refresh", page, filter, debouncedQuery, sort)
        }}
        refreshing={refreshing}
      />

      <div className="mb-4 flex flex-wrap items-end gap-3">
        <div className="min-w-64 flex-1">
          <Input
            placeholder="Cari nama, email, username, ID, atau HP…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
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
        <div className="w-52">
          <Select
            label="Urutan"
            options={SORT_OPTIONS}
            value={sort}
            onChange={(e) => handleSortChange(e.target.value as SortOption)}
          />
        </div>
      </div>

      {loading ? (
        <LoadingBlock message="Memuat pengguna…" />
      ) : error && rows.length === 0 ? (
        <ErrorBlock
          title="Gagal memuat pengguna"
          message={error}
          onRetry={() => load("initial", page, filter, debouncedQuery, sort)}
        />
      ) : (
        <>
          <DataTable<AdminUserSummary>
            columns={cols.visible}
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
      {/* H02: dialog kustomisasi kolom */}
      <ColumnCustomizer prefs={cols} />
    </RoleGate>
  )
}
