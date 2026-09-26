"use client"

/**
 * Admin — Daftar sengketa escrow.
 *
 * Filter 6 status, tabel dengan paginasi bernomor, klik "Tinjau" → detail.
 *
 * Port dari frontend/app/admin/(panel)/disputes/index.tsx → web desktop.
 */

import Link from "next/link"
import { useCallback, useEffect, useState } from "react"

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
import { ageHours, formatAge, formatDateTimeWIB } from "@/lib/format"
import { Input } from "@/components/ui/input"

import { DISPUTE_CATEGORY_LABEL, DISPUTE_STATUS_LABEL, DISPUTE_STATUS_TONE } from "./maps"

const PAGE_SIZE = 20

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

const FILTER_OPTIONS = [
  { value: "ALL", label: "Semua" },
  { value: "OPEN", label: "Terbuka" },
  { value: "ASSIGNED", label: "Ditugaskan" },
  { value: "UNDER_REVIEW", label: "Ditinjau" },
  { value: "WAITING_RESPONSE", label: "Menunggu respons" },
  { value: "ESCALATED", label: "Dieskalasi" },
  { value: "RESOLVED", label: "Selesai" },
]

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
      } catch (e) {
        const msg = userMessage(e)
        setError(msg)
        toast.show({ title: "Gagal memuat daftar sengketa", description: msg, tone: "danger" })
      } finally {
        setLoading(false)
        setRefreshing(false)
      }
    },
    [page, filter, categoryFilter, search, toast],
  )

  useEffect(() => {
    void load("initial")
  }, [load])

  const handleFilterChange = (f: Filter) => {
    setFilter(f)
    setPage(1)
    void load("initial", 1, f, search, categoryFilter)
  }

  const handleCategoryChange = (c: CategoryFilter) => {
    setCategoryFilter(c)
    setPage(1)
    void load("initial", 1, filter, search, c)
  }

  const handleSearch = () => {
    const q = searchInput.trim()
    setSearch(q)
    setPage(1)
    void load("initial", 1, filter, q, categoryFilter)
  }

  const handlePageChange = (p: number) => {
    setPage(p)
    void load("initial", p, filter, search, categoryFilter)
  }

  return (
    <RoleGate href="/disputes">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-h2 font-bold text-text-primary">Sengketa</h1>
          <p className="mt-1 text-body text-text-secondary">
            Sengketa escrow yang perlu putusan admin.
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
                render: (r) => (
                  <span className="break-all font-mono text-[13px]">
                    {r.assignedAdminId ?? "—"}
                  </span>
                ),
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
