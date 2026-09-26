"use client"

/**
 * Admin — Daftar laporan etalase (moderasi showcase).
 *
 * Filter status (5 enum ReportStatus), tabel dengan paginasi bernomor,
 * kolom pelapor, item, alasan, umur laporan, status, aksi "Tinjau" → detail.
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
import {
  listShowcaseReports,
  type ShowcaseReport,
  type ShowcaseReportStatus,
} from "@/lib/api/admin/showcase-reports"
import { userMessage } from "@/lib/api/response"
import { formatAge, formatDateTimeWIB } from "@/lib/format"

import {
  SHOWCASE_REPORT_STATUS_LABEL,
  SHOWCASE_REPORT_STATUS_TONE,
} from "./maps"

const PAGE_SIZE = 20

type Filter = "ALL" | ShowcaseReportStatus

const FILTER_OPTIONS = [
  { value: "ALL", label: "Semua" },
  { value: "PENDING", label: "Menunggu" },
  { value: "UNDER_REVIEW", label: "Ditinjau" },
  { value: "RESOLVED_ACTION_TAKEN", label: "Selesai (ditindak)" },
  { value: "RESOLVED_NO_ACTION", label: "Selesai (tanpa tindakan)" },
  { value: "DISMISSED", label: "Ditolak" },
]

function displayName(fullName?: string | null, username?: string | null): string {
  if (fullName && fullName.trim()) return fullName
  if (username && username.trim()) return `@${username}`
  return "—"
}

export default function ShowcaseReportsListPage() {
  const toast = useToast()

  const [filter, setFilter] = useState<Filter>("PENDING")
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [rows, setRows] = useState<ShowcaseReport[]>([])
  const [total, setTotal] = useState(0)
  const [totalPages, setTotalPages] = useState(1)

  const load = useCallback(
    async (mode: "initial" | "refresh" = "initial", targetPage = page, targetFilter = filter) => {
      if (mode === "initial") setLoading(true)
      else setRefreshing(true)
      setError(null)
      try {
        const res = await listShowcaseReports({
          page: targetPage,
          limit: PAGE_SIZE,
          status: targetFilter === "ALL" ? undefined : targetFilter,
        })
        setRows(res.data ?? [])
        const t = res.meta?.total ?? res.total ?? res.data?.length ?? 0
        setTotal(t)
        setTotalPages(res.meta?.totalPages ?? Math.max(1, Math.ceil(t / PAGE_SIZE)))
      } catch (e) {
        const msg = userMessage(e)
        setError(msg)
        toast.show({ title: "Gagal memuat laporan etalase", description: msg, tone: "danger" })
      } finally {
        setLoading(false)
        setRefreshing(false)
      }
    },
    [page, filter, toast],
  )

  useEffect(() => {
    void load("initial")
  }, [load])

  const handleFilterChange = (f: Filter) => {
    setFilter(f)
    setPage(1)
    void load("initial", 1, f)
  }

  const handlePageChange = (p: number) => {
    setPage(p)
    void load("initial", p, filter)
  }

  return (
    <RoleGate href="/reports/showcase">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-h2 font-bold text-text-primary">Laporan Etalase</h1>
          <p className="mt-1 text-body text-text-secondary">
            Moderasi laporan pengguna terhadap item etalase.
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
          className="w-64"
        />
      </div>

      {loading ? (
        <div className="flex min-h-[40vh] items-center justify-center gap-2">
          <Spinner size="md" />
          <p className="text-body text-text-secondary">Memuat laporan etalase…</p>
        </div>
      ) : error ? (
        <Card>
          <EmptyState
            title="Gagal memuat laporan etalase"
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
          <DataTable<ShowcaseReport>
            columns={[
              {
                key: "showcase",
                header: "Item",
                render: (r) => (
                  <div>
                    <p className="font-semibold">
                      {r.showcase?.title ?? "—"}
                    </p>
                    <p className="text-caption text-text-secondary">
                      {r.showcase?.user
                        ? `oleh ${displayName(r.showcase.user.fullName, r.showcase.user.username)}`
                        : ""}
                      {r.showcase?.isActive === false ? " · nonaktif" : ""}
                    </p>
                  </div>
                ),
              },
              {
                key: "reporter",
                header: "Pelapor",
                render: (r) => (
                  <div>
                    <p className="font-semibold">
                      {displayName(r.reporter?.fullName, r.reporter?.username)}
                    </p>
                    <p className="text-caption text-text-secondary">
                      {r.reporter?.username ? `@${r.reporter.username}` : "—"}
                    </p>
                  </div>
                ),
              },
              {
                key: "reason",
                header: "Alasan",
                render: (r) => (
                  <div>
                    <p className="font-semibold">{r.reason}</p>
                    {r.description ? (
                      <p className="max-w-64 truncate text-caption text-text-secondary">
                        {r.description}
                      </p>
                    ) : null}
                  </div>
                ),
              },
              {
                key: "age",
                header: "Umur laporan",
                render: (r) => (
                  <div className="flex flex-col gap-1">
                    <span className="tabular-nums text-[13px]">{formatAge(r.createdAt)}</span>
                    <span className="text-caption text-text-tertiary">
                      {formatDateTimeWIB(r.createdAt)}
                    </span>
                  </div>
                ),
              },
              {
                key: "status",
                header: "Status",
                render: (r) => (
                  <Badge tone={SHOWCASE_REPORT_STATUS_TONE[r.status] ?? "neutral"}>
                    {SHOWCASE_REPORT_STATUS_LABEL[r.status] ?? r.status}
                  </Badge>
                ),
              },
              {
                key: "action",
                header: "",
                align: "right",
                render: (r) => (
                  <Link
                    href={`/reports/showcase/${r.id}`}
                    className="font-semibold text-info-text hover:underline"
                  >
                    Tinjau
                  </Link>
                ),
              },
            ]}
            rows={rows}
            rowKey={(r) => r.id}
            emptyText="Tidak ada laporan pada filter ini."
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
