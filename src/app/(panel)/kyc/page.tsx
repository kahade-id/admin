"use client"

/**
 * Admin — Antrean KYC: daftar pengajuan verifikasi identitas.
 *
 * Filter status (Semua/Menunggu/Disetujui/Ditolak/Dicabut), tabel dengan
 * paginasi bernomor, klik "Tinjau" → detail.
 *
 * Port dari frontend/app/admin/(panel)/kyc/index.tsx → web desktop.
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
  getKycQueue,
  type KycQueueItem,
  type KycStatus,
} from "@/lib/api/admin/kyc"
import { userMessage } from "@/lib/api/response"
import { formatDateTimeWIB } from "@/lib/format"

import { KYC_STATUS_LABEL, KYC_STATUS_TONE } from "./maps"

const PAGE_SIZE = 20

type Filter = "ALL" | KycStatus

const FILTER_OPTIONS = [
  { value: "ALL", label: "Semua" },
  { value: "PENDING", label: "Menunggu" },
  { value: "APPROVED", label: "Disetujui" },
  { value: "REJECTED", label: "Ditolak" },
  { value: "REVOKED", label: "Dicabut" },
]

export default function KycListPage() {
  const toast = useToast()

  const [filter, setFilter] = useState<Filter>("PENDING")
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [rows, setRows] = useState<KycQueueItem[]>([])
  const [total, setTotal] = useState(0)
  const [totalPages, setTotalPages] = useState(1)

  const load = useCallback(
    async (mode: "initial" | "refresh" = "initial", targetPage = page, targetFilter = filter) => {
      if (mode === "initial") setLoading(true)
      else setRefreshing(true)
      setError(null)
      try {
        const res = await getKycQueue({
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
        toast.show({ title: "Gagal memuat antrean KYC", description: msg, tone: "danger" })
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
    <RoleGate href="/kyc">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-h2 font-bold text-text-primary">Antrean KYC</h1>
          <p className="mt-1 text-body text-text-secondary">
            Tinjau pengajuan verifikasi identitas pengguna.
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
          <p className="text-body text-text-secondary">Memuat antrean KYC…</p>
        </div>
      ) : error ? (
        <Card>
          <EmptyState
            title="Gagal memuat antrean KYC"
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
          <DataTable<KycQueueItem>
            columns={[
              {
                key: "user",
                header: "Pengguna",
                render: (r) => (
                  <div>
                    <p className="font-semibold">{r.user?.fullName ?? "—"}</p>
                    <p className="text-caption text-text-secondary">{r.user?.email}</p>
                  </div>
                ),
              },
              {
                key: "userId",
                header: "ID Pengguna",
                render: (r) => (
                  <span className="break-all font-mono text-[13px]">{r.userId}</span>
                ),
              },
              {
                key: "status",
                header: "Status",
                render: (r) => (
                  <Badge tone={KYC_STATUS_TONE[r.status] ?? "neutral"}>
                    {KYC_STATUS_LABEL[r.status] ?? r.status}
                  </Badge>
                ),
              },
              {
                key: "attemptNumber",
                header: "Percobaan",
                render: (r) => String(r.attemptNumber ?? "—"),
              },
              {
                key: "createdAt",
                header: "Diajukan",
                render: (r) => formatDateTimeWIB(r.createdAt),
              },
              {
                key: "action",
                header: "",
                align: "right",
                render: (r) => (
                  <Link
                    href={`/kyc/${r.kycId}`}
                    className="font-semibold text-info-text hover:underline"
                  >
                    Tinjau
                  </Link>
                ),
              },
            ]}
            rows={rows}
            rowKey={(r) => r.id}
            emptyText="Tidak ada pengajuan pada filter ini."
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
