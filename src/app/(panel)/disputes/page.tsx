"use client"

/**
 * Admin — Daftar sengketa escrow.
 *
 * Filter 6 status, tabel dengan paginasi bernomor, klik "Tinjau" → detail.
 *
 * Port dari frontend/app/admin/(panel)/disputes/index.tsx → web desktop.
 */

import Link from "next/link"
import { useCallback, useEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"

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
import { listDisputes, type AdminDisputeItem } from "@/lib/api/admin/disputes"
import { userMessage } from "@/lib/api/response"
import { downloadCsv } from "@/lib/csv"
import { ageHours, formatAge, formatDateTimeWIB } from "@/lib/format"
import { useListShortcuts } from "@/lib/list-shortcuts"
import { Input } from "@/components/ui/input"

import { DISPUTE_CATEGORY_LABEL, DISPUTE_STATUS_LABEL, DISPUTE_STATUS_TONE } from "./maps"

const PAGE_SIZE = 20
/** Maksimum halaman yang diambil untuk export CSV / filter unassigned (100 baris per halaman). */
const FETCH_ALL_MAX_PAGES = 50

/** SLA mediasi sengketa — selaras DISPUTE_SLA_HOURS backend (72 jam). */
const DISPUTE_SLA_HOURS = 72

type Filter =
  | "ALL"
  | "OPEN"
  | "ASSIGNED"
  | "UNDER_REVIEW"
  | "WAITING_RESPONSE"
  | "ESCALATED"
  | "RESOLVED"
  /** Pseudo-filter: sengketa tanpa assignedAdminId (disaring client-side). */
  | "UNASSIGNED"

const FILTER_OPTIONS = [
  { value: "ALL", label: "Semua" },
  { value: "OPEN", label: "Terbuka" },
  { value: "ASSIGNED", label: "Ditugaskan" },
  { value: "UNASSIGNED", label: "Belum ditugaskan" },
  { value: "UNDER_REVIEW", label: "Ditinjau" },
  { value: "WAITING_RESPONSE", label: "Menunggu respons" },
  { value: "ESCALATED", label: "Dieskalasi" },
  { value: "RESOLVED", label: "Selesai" },
]

/**
 * Nama admin penangan dari relasi `assignedAdmin` yang ikut di respons
 * list backend (`assignedAdmin: { adminId, fullName }`) — bukan ID mentah.
 */
function assignedAdminName(r: AdminDisputeItem): string | null {
  const rel = r.assignedAdmin as { fullName?: string } | undefined
  const name = typeof rel?.fullName === "string" ? rel.fullName.trim() : ""
  return name || null
}

type CategoryFilter = "ALL" | keyof typeof DISPUTE_CATEGORY_LABEL

const CATEGORY_FILTER_OPTIONS = [
  { value: "ALL", label: "Semua kategori" },
  ...Object.entries(DISPUTE_CATEGORY_LABEL).map(([value, label]) => ({ value, label })),
]

export default function DisputesListPage() {
  const toast = useToast()

  const [filter, setFilter] = useState<Filter>("ALL")
  const [categoryFilter, setCategoryFilter] = useState<CategoryFilter>("ALL")
  const [searchInput, setSearchInput] = useState("")
  const [search, setSearch] = useState("")
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [rows, setRows] = useState<AdminDisputeItem[]>([])
  const [total, setTotal] = useState(0)
  const [totalPages, setTotalPages] = useState(1)
  const [csvLoading, setCsvLoading] = useState(false)

  /**
   * Ambil SEMUA baris yang cocok dengan filter aktif (untuk export CSV dan
   * pseudo-filter "Belum ditugaskan"). Backend tidak punya filter unassigned,
   * jadi UNASSIGNED diambil tanpa filter status lalu disaring client-side.
   */
  const fetchAllMatching = useCallback(
    async (
      targetFilter: Filter,
      targetSearch: string,
      targetCategory: CategoryFilter,
    ): Promise<AdminDisputeItem[]> => {
      const unassignedOnly = targetFilter === "UNASSIGNED"
      const out: AdminDisputeItem[] = []
      for (let p = 1; p <= FETCH_ALL_MAX_PAGES; p++) {
        const res = await listDisputes({
          page: p,
          limit: 100,
          status: !unassignedOnly && targetFilter !== "ALL" ? targetFilter : undefined,
          category: targetCategory === "ALL" ? undefined : targetCategory,
          search: targetSearch.trim() || undefined,
        })
        const items = res.data ?? []
        out.push(...items)
        if (p >= (res.totalPages ?? 1) || items.length === 0) break
      }
      return unassignedOnly ? out.filter((r) => !r.assignedAdminId) : out
    },
    [],
  )

  const load = useCallback(
    async (
      mode: "initial" | "refresh" = "initial",
      targetPage = page,
      targetFilter = filter,
      targetSearch = search,
      targetCategory = categoryFilter,
    ) => {
      if (mode === "initial") setLoading(true)
      else setRefreshing(true)
      setError(null)
      try {
        if (targetFilter === "UNASSIGNED") {
          const all = await fetchAllMatching(targetFilter, targetSearch, targetCategory)
          setRows(all.slice((targetPage - 1) * PAGE_SIZE, targetPage * PAGE_SIZE))
          setTotal(all.length)
          setTotalPages(Math.max(1, Math.ceil(all.length / PAGE_SIZE)))
        } else {
          const res = await listDisputes({
            page: targetPage,
            limit: PAGE_SIZE,
            status: targetFilter === "ALL" ? undefined : targetFilter,
            category: targetCategory === "ALL" ? undefined : targetCategory,
            search: targetSearch.trim() || undefined,
          })
          setRows(res.data ?? [])
          const t = res.total ?? res.data?.length ?? 0
          setTotal(t)
          setTotalPages(res.totalPages ?? Math.max(1, Math.ceil(t / PAGE_SIZE)))
        }
      } catch (e) {
        const msg = userMessage(e)
        setError(msg)
        toast.show({ title: "Gagal memuat daftar sengketa", description: msg, tone: "danger" })
      } finally {
        setLoading(false)
        setRefreshing(false)
      }
    },
    [page, filter, categoryFilter, search, toast, fetchAllMatching],
  )

  useEffect(() => {
    void load("initial")
  }, [load])

  const handleFilterChange = (f: Filter) => {
    setFilter(f)
    setPage(1)
    setActiveIndex(0)
    void load("initial", 1, f, search, categoryFilter)
  }

  const handleCategoryChange = (c: CategoryFilter) => {
    setCategoryFilter(c)
    setPage(1)
    setActiveIndex(0)
    void load("initial", 1, filter, search, c)
  }

  const handleSearch = () => {
    const q = searchInput.trim()
    setSearch(q)
    setPage(1)
    setActiveIndex(0)
    void load("initial", 1, filter, q, categoryFilter)
  }

  const handlePageChange = (p: number) => {
    setPage(p)
    setActiveIndex(0)
    void load("initial", p, filter, search, categoryFilter)
  }

  /** Export CSV sesuai filter aktif (status/kategori/pencarian/belum ditugaskan). */
  const handleExportCsv = async () => {
    setCsvLoading(true)
    try {
      const all = await fetchAllMatching(filter, search, categoryFilter)
      const stamp = new Date().toISOString().slice(0, 10)
      downloadCsv(
        `sengketa-${stamp}.csv`,
        ["ID Sengketa", "ID Order", "Status", "Kategori", "Umur", "Ditugaskan ke", "Dibuat"],
        all.map((r) => [
          r.id,
          r.orderId,
          DISPUTE_STATUS_LABEL[r.status] ?? r.status,
          r.category ? (DISPUTE_CATEGORY_LABEL[r.category] ?? r.category) : "",
          formatAge(r.createdAt),
          assignedAdminName(r) ?? r.assignedAdminId ?? "",
          formatDateTimeWIB(r.createdAt),
        ]),
      )
      toast.show({
        title: "CSV diunduh",
        description: `${all.length} sengketa sesuai filter aktif.`,
        tone: "success",
      })
    } catch (e) {
      toast.show({
        title: "Gagal mengekspor CSV",
        description: userMessage(e),
        tone: "danger",
      })
    } finally {
      setCsvLoading(false)
    }
  }

  // Keyboard shortcuts: "/" fokus cari, j/k pindah baris, Enter buka detail.
  const router = useRouter()
  const searchInputRef = useRef<HTMLInputElement | null>(null)
  const { activeIndex, setActiveIndex } = useListShortcuts<AdminDisputeItem>({
    rows,
    searchInputRef,
    onOpen: (r) => router.push(`/disputes/${r.id}`),
  })

  return (
    <RoleGate href="/disputes">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-h2 font-bold text-text-primary">Sengketa</h1>
          <p className="mt-1 text-body text-text-secondary">
            Sengketa escrow yang perlu putusan admin.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Button
            variant="secondary"
            size="sm"
            fullWidth={false}
            loading={csvLoading}
            onClick={() => void handleExportCsv()}
            title="Unduh CSV sesuai filter aktif"
          >
            Unduh CSV
          </Button>
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
      </div>

      <div className="mb-4 flex flex-wrap items-end gap-3">
        <Select
          label="Status"
          options={FILTER_OPTIONS}
          value={filter}
          onChange={(e) => handleFilterChange(e.target.value as Filter)}
          className="w-52"
        />
        <Select
          label="Kategori"
          options={CATEGORY_FILTER_OPTIONS}
          value={categoryFilter}
          onChange={(e) => handleCategoryChange(e.target.value as CategoryFilter)}
          className="w-52"
        />
        <form
          className="flex flex-1 flex-wrap items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            handleSearch()
          }}
        >
          <Input
            ref={searchInputRef}
            label="Cari sengketa / order"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="ID sengketa atau ID order…"
            className="min-w-52 flex-1"
          />
          <Button type="submit" variant="secondary" size="md" fullWidth={false}>
            Cari
          </Button>
        </form>
      </div>
      <p className="mb-4 text-caption text-text-secondary">
        Shortcut: <kbd className="rounded-sm border border-border bg-surface px-1">/</kbd> cari ·{" "}
        <kbd className="rounded-sm border border-border bg-surface px-1">j</kbd>/
        <kbd className="rounded-sm border border-border bg-surface px-1">k</kbd> navigasi ·{" "}
        <kbd className="rounded-sm border border-border bg-surface px-1">Enter</kbd> buka detail
      </p>

      {loading ? (
        <div className="flex min-h-[40vh] items-center justify-center gap-2">
          <Spinner size="md" />
          <p className="text-body text-text-secondary">Memuat sengketa…</p>
        </div>
      ) : error ? (
        <Card>
          <EmptyState
            title="Gagal memuat sengketa"
            description={error}
            action={
              <Button variant="secondary" fullWidth={false} onClick={() => load("initial")}>
                Coba lagi
              </Button>
            }
          />
        </Card>
      ) : (
        <>
          <DataTable<AdminDisputeItem>
            columns={[
              {
                key: "reason",
                header: "Sengketa",
                render: (r) => (
                  <div>
                    <p className="font-semibold">{r.reason?.trim() || r.orderId}</p>
                    <p className="text-caption text-text-secondary">
                      Order {r.orderId} · {formatDateTimeWIB(r.createdAt)}
                    </p>
                  </div>
                ),
              },
              {
                key: "status",
                header: "Status",
                render: (r) => (
                  <Badge tone={DISPUTE_STATUS_TONE[r.status] ?? "neutral"}>
                    {DISPUTE_STATUS_LABEL[r.status] ?? r.status}
                  </Badge>
                ),
              },
              {
                key: "category",
                header: "Kategori",
                render: (r) =>
                  r.category ? (
                    <Badge tone="info">{DISPUTE_CATEGORY_LABEL[r.category] ?? r.category}</Badge>
                  ) : (
                    <span className="text-caption text-text-secondary">—</span>
                  ),
              },
              {
                key: "age",
                header: "Umur",
                render: (r) => {
                  const h = ageHours(r.createdAt)
                  const breached =
                    h != null &&
                    h >= DISPUTE_SLA_HOURS &&
                    r.status !== "RESOLVED" &&
                    !String(r.status).startsWith("RESOLVED")
                  return (
                    <div className="flex flex-col gap-1">
                      <span className="tabular-nums text-[13px]">{formatAge(r.createdAt)}</span>
                      {breached ? <Badge tone="danger">Lewat SLA</Badge> : null}
                    </div>
                  )
                },
              },
              {
                key: "assignedAdminId",
                header: "Ditugaskan ke",
                // Tampilkan nama admin (dari relasi assignedAdmin), bukan ID mentah.
                render: (r) => {
                  const name = assignedAdminName(r)
                  if (name) return <span className="font-medium">{name}</span>
                  return (
                    <span className="break-all font-mono text-[13px]">
                      {r.assignedAdminId ?? "—"}
                    </span>
                  )
                },
              },
              {
                key: "action",
                header: "",
                align: "right",
                render: (r) => (
                  <Link
                    href={`/disputes/${r.id}`}
                    className="font-semibold text-info-text hover:underline"
                  >
                    Tinjau
                  </Link>
                ),
              },
            ]}
            rows={rows}
            rowKey={(r) => r.id}
            rowClassName={(_, i) => (i === activeIndex ? "bg-info-soft" : undefined)}
            emptyText="Tidak ada sengketa pada filter ini."
          />
          <Pagination
            page={page}
            totalPages={totalPages}
            total={total}
            pageSize={PAGE_SIZE}
            onPageChange={handlePageChange}
            className="mt-4"
          />
        </>
      )}
    </RoleGate>
  )
}
