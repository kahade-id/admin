/**
 * Admin — Jastip trip (batch 43, item #29).
 *
 * Daftar trip jastip: host, destinasi, tenggat order, slot, status.
 * Admin HANYA memantau — tidak ada aksi finansial di halaman ini.
 *
 * Kontrak endpoint adalah ASUMSI (lihat src/lib/api/admin/jastip.ts).
 */
"use client"

import Link from "next/link"
import { useCallback, useEffect, useState } from "react"

import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Card, CardBody } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { DataTable } from "@/components/ui/table"
import { useToast } from "@/components/ui/toast"
import { Pagination } from "@/components/admin/pagination"
import { RoleGate } from "@/components/admin/role-gate"
import { Select } from "@/components/admin/select"
import { userMessage } from "@/lib/api/response"
import { formatDateTimeWIB, formatNumber } from "@/lib/format"
import {
  listJastipTrips,
  type JastipTripItem,
  type JastipTripStatus,
} from "@/lib/api/admin/jastip"
import {
  JASTIP_TRIP_STATUSES,
  jastipTripStatusLabel,
  jastipTripStatusTone,
} from "./lib"

const PAGE_SIZE = 20

type JastipTripRow = JastipTripItem & Record<string, unknown>

function JastipPageContent() {
  const toast = useToast()
  const [page, setPage] = useState(1)
  const [statusFilter, setStatusFilter] = useState<"" | JastipTripStatus>("")
  const [search, setSearch] = useState("")
  const [rows, setRows] = useState<JastipTripItem[]>([])
  const [total, setTotal] = useState(0)
  const [totalPages, setTotalPages] = useState(1)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(
    async (targetPage: number, targetStatus: "" | JastipTripStatus, q: string) => {
      setLoading(true)
      setError(null)
      try {
        const res = await listJastipTrips({
          page: targetPage,
          limit: PAGE_SIZE,
          status: targetStatus === "" ? undefined : targetStatus,
          q: q.trim() || undefined,
        })
        setRows(res.data ?? [])
        const t = res.total ?? (res.data ?? []).length
        setTotal(t)
        setTotalPages(res.totalPages ?? Math.max(1, Math.ceil(t / PAGE_SIZE)))
        setPage(targetPage)
      } catch (e) {
        const msg = userMessage(e)
        setError(msg)
        toast.show({ title: "Gagal memuat trip jastip", description: msg, tone: "danger" })
      } finally {
        setLoading(false)
      }
    },
    [toast],
  )

  useEffect(() => {
    void load(1, statusFilter, search)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load, statusFilter])

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-h2 font-semibold text-text-primary">Jastip</h1>
        <p className="mt-1 text-body text-text-secondary">
          Pantau trip jasa titip: host, destinasi, tenggat pemesanan, slot, dan
          status. Harga dikunci host sebelum buyer membayar via escrow.
        </p>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <Select
          label="Filter status"
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as "" | JastipTripStatus)}
          options={[
            { value: "", label: "Semua status" },
            ...JASTIP_TRIP_STATUSES.map((s) => ({ value: s.value, label: s.label })),
          ]}
          className="w-52"
        />
        <Input
          label="Cari judul/destinasi/host"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void load(1, statusFilter, search)
          }}
          placeholder="cth. Jepang"
          className="w-56"
        />
        <Button variant="secondary" fullWidth={false} onClick={() => load(1, statusFilter, search)}>
          Cari
        </Button>
      </div>

      {error && !loading ? (
        <Card>
          <CardBody className="flex flex-col gap-3">
            <p role="alert" className="text-body text-danger-text">
              {error}
            </p>
            <p className="text-caption text-text-secondary">
              Endpoint jastip mungkin belum tersedia di backend — kontrak masih
              asumsi (batch 43).
            </p>
            <div className="max-w-xs">
              <Button variant="secondary" fullWidth={false} onClick={() => load(page, statusFilter, search)}>
                Coba lagi
              </Button>
            </div>
          </CardBody>
        </Card>
      ) : (
        <>
          <DataTable<JastipTripRow>
            columns={[
              {
                key: "title",
                header: "Trip",
                render: (r) => (
                  <div>
                    <Link
                      href={`/jastip/${encodeURIComponent(r.id)}`}
                      className="font-semibold text-primary hover:underline"
                    >
                      {r.title}
                    </Link>
                    <p className="text-caption text-text-secondary">
                      {r.destination ?? "—"} · Host: {r.hostName ?? "—"}
                    </p>
                  </div>
                ),
              },
              {
                key: "slots",
                header: "Slot / Pesanan",
                align: "right",
                render: (r) =>
                  r.slotCount != null
                    ? `${formatNumber(r.orderCount ?? 0)} / ${formatNumber(r.slotCount)}`
                    : formatNumber(r.orderCount ?? 0),
              },
              {
                key: "status",
                header: "Status",
                render: (r) => (
                  <Badge tone={jastipTripStatusTone(r.status)} dot>
                    {jastipTripStatusLabel(r.status)}
                  </Badge>
                ),
              },
              {
                key: "orderDeadline",
                header: "Tenggat order",
                render: (r) => formatDateTimeWIB(r.orderDeadline),
              },
              {
                key: "action",
                header: "",
                align: "right",
                render: (r) => (
                  <div className="flex justify-end gap-2">
                    <Link href={`/jastip/${encodeURIComponent(r.id)}`}>
                      <Button variant="secondary" size="sm" fullWidth={false}>
                        Detail
                      </Button>
                    </Link>
                  </div>
                ),
              },
            ]}
            rows={rows as JastipTripRow[]}
            rowKey={(r) => r.id}
            loading={loading}
            emptyText="Belum ada trip jastip."
          />
          <Pagination
            page={page}
            totalPages={totalPages}
            total={total}
            pageSize={PAGE_SIZE}
            onPageChange={(p) => load(p, statusFilter, search)}
            disabled={loading}
          />
        </>
      )}
    </div>
  )
}

export default function JastipPage() {
  return (
    <RoleGate href="/jastip">
      <JastipPageContent />
    </RoleGate>
  )
}
