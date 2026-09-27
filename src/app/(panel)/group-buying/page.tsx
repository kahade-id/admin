/**
 * Admin — Patungan grup / group buying (batch 43, item #30).
 *
 * Daftar patungan: progres dana, peserta, status. Admin HANYA memantau —
 * tidak ada aksi finansial di halaman ini (pencairan/refund dijalankan
 * otomatis backend atau lewat jalur dispute normal).
 *
 * Kontrak endpoint adalah ASUMSI (lihat src/lib/api/admin/group-buying.ts).
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
  listGroupBuys,
  type GroupBuyItem,
  type GroupBuyStatus,
} from "@/lib/api/admin/group-buying"
import {
  GROUP_BUY_STATUSES,
  GroupBuyProgressBar,
  groupBuyStatusLabel,
  groupBuyStatusTone,
} from "./lib"

const PAGE_SIZE = 20

type GroupBuyRow = GroupBuyItem & Record<string, unknown>

function GroupBuyingPageContent() {
  const toast = useToast()
  const [page, setPage] = useState(1)
  const [statusFilter, setStatusFilter] = useState<"" | GroupBuyStatus>("")
  const [search, setSearch] = useState("")
  const [rows, setRows] = useState<GroupBuyItem[]>([])
  const [total, setTotal] = useState(0)
  const [totalPages, setTotalPages] = useState(1)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(
    async (targetPage: number, targetStatus: "" | GroupBuyStatus, q: string) => {
      setLoading(true)
      setError(null)
      try {
        const res = await listGroupBuys({
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
        toast.show({ title: "Gagal memuat patungan", description: msg, tone: "danger" })
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
        <h1 className="text-h2 font-semibold text-text-primary">Patungan Grup</h1>
        <p className="mt-1 text-body text-text-secondary">
          Pantau progres pengumpulan dana patungan (escrow per peserta), daftar
          peserta, dan status. Tanpa aksi finansial — pencairan/refund otomatis
          oleh backend.
        </p>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <Select
          label="Filter status"
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as "" | GroupBuyStatus)}
          options={[
            { value: "", label: "Semua status" },
            ...GROUP_BUY_STATUSES.map((s) => ({ value: s.value, label: s.label })),
          ]}
          className="w-52"
        />
        <Input
          label="Cari judul/host"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void load(1, statusFilter, search)
          }}
          placeholder="cth. Kado bareng"
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
              Endpoint patungan mungkin belum tersedia di backend — kontrak
              masih asumsi (batch 43).
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
          <DataTable<GroupBuyRow>
            columns={[
              {
                key: "title",
                header: "Patungan",
                render: (r) => (
                  <div className="min-w-52">
                    <Link
                      href={`/group-buying/${encodeURIComponent(r.id)}`}
                      className="font-semibold text-primary hover:underline"
                    >
                      {r.title}
                    </Link>
                    <p className="text-caption text-text-secondary">
                      Host: {r.hostName ?? "—"}
                    </p>
                    <div className="mt-2">
                      <GroupBuyProgressBar item={r} />
                    </div>
                  </div>
                ),
              },
              {
                key: "participants",
                header: "Peserta",
                align: "right",
                render: (r) =>
                  r.maxParticipants != null
                    ? `${formatNumber(r.participantCount)} / ${formatNumber(r.maxParticipants)}`
                    : formatNumber(r.participantCount),
              },
              {
                key: "status",
                header: "Status",
                render: (r) => (
                  <Badge tone={groupBuyStatusTone(r.status)} dot>
                    {groupBuyStatusLabel(r.status)}
                  </Badge>
                ),
              },
              {
                key: "deadline",
                header: "Tenggat bayar",
                render: (r) => formatDateTimeWIB(r.deadline),
              },
              {
                key: "action",
                header: "",
                align: "right",
                render: (r) => (
                  <div className="flex justify-end gap-2">
                    <Link href={`/group-buying/${encodeURIComponent(r.id)}`}>
                      <Button variant="secondary" size="sm" fullWidth={false}>
                        Detail
                      </Button>
                    </Link>
                  </div>
                ),
              },
            ]}
            rows={rows as GroupBuyRow[]}
            rowKey={(r) => r.id}
            loading={loading}
            emptyText="Belum ada patungan grup."
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

export default function GroupBuyingPage() {
  return (
    <RoleGate href="/group-buying">
      <GroupBuyingPageContent />
    </RoleGate>
  )
}
