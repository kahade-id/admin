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
import { formatDateTimeWIB } from "@/lib/format"

import { DISPUTE_STATUS_LABEL, DISPUTE_STATUS_TONE } from "./maps"

const PAGE_SIZE = 20

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

export default function DisputesListPage() {
  const toast = useToast()

  const [filter, setFilter] = useState<Filter>("ALL")
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [rows, setRows] = useState<AdminDisputeItem[]>([])
  const [total, setTotal] = useState(0)
  const [totalPages, setTotalPages] = useState(1)

  const load = useCallback(
    async (mode: "initial" | "refresh" = "initial", targetPage = page, targetFilter = filter) => {
      if (mode === "initial") setLoading(true)
      else setRefreshing(true)
      setError(null)
      try {
        const res = await listDisputes({
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
        toast.show({ title: "Gagal memuat daftar sengketa", description: msg, tone: "danger" })
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
