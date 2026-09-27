/**
 * Admin — Log Aktivitas Admin (E5a, grup E).
 *
 * Filter: admin, aksi, rentang waktu. Tabel hasil + tombol "Ekspor CSV"
 * (text/csv langsung) + info kebijakan retensi dari backend.
 */
"use client"

import { useCallback, useEffect, useState } from "react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardBody, CardHeader } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { DataTable } from "@/components/ui/table"
import { useToast } from "@/components/ui/toast"
import { Select } from "@/components/admin/select"
import { Pagination } from "@/components/admin/pagination"
import { RoleGate } from "@/components/admin/role-gate"
import {
  exportAdminActivityCsv,
  getActivityRetention,
  listAdminActivity,
  listAdmins,
  type ActivityRetentionInfo,
  type AdminActivityEntry,
  type AdminUserItem,
} from "@/lib/api/admin/management"
import { userMessage } from "@/lib/api/response"
import { formatDateTimeWIB } from "@/lib/format"

import { ErrorBlock, LoadingBlock, PageHeader } from "../../_components/admin-ui"

const PAGE_SIZE = 20

function saveCsv(filename: string, csv: string) {
  const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" })
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

function AdminActivityContent() {
  const toast = useToast()
  const [admins, setAdmins] = useState<AdminUserItem[]>([])
  const [rows, setRows] = useState<AdminActivityEntry[]>([])
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [exporting, setExporting] = useState(false)
  const [retention, setRetention] = useState<ActivityRetentionInfo | null>(null)

  const [adminId, setAdminId] = useState("")
  const [action, setAction] = useState("")
  const [from, setFrom] = useState("")
  const [to, setTo] = useState("")

  const filters = useCallback(
    () => ({
      adminId: adminId || undefined,
      action: action.trim() || undefined,
      from: from || undefined,
      to: to || undefined,
    }),
    [adminId, action, from, to],
  )

  const load = useCallback(
    async (
      targetPage: number,
      f: {
        adminId?: string
        action?: string
        from?: string
        to?: string
      } = filters(),
    ) => {
      setLoading(true)
      setError(null)
      try {
        const res = await listAdminActivity({ ...f, page: targetPage, limit: PAGE_SIZE })
        setRows(res.data ?? [])
        const t = res.total ?? 0
        setTotal(t)
        setTotalPages(res.totalPages ?? Math.max(1, Math.ceil(t / PAGE_SIZE)))
        setPage(targetPage)
      } catch (e) {
        setError(userMessage(e))
      } finally {
        setLoading(false)
      }
    },
    [filters],
  )

  useEffect(() => {
    void load(1)
    void listAdmins({ limit: 200 })
      .then((a) => setAdmins(a.data ?? []))
      .catch(() => setAdmins([]))
    void getActivityRetention()
      .then(setRetention)
      .catch(() => setRetention(null))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function applyFilters() {
    void load(1, filters())
  }

  function resetFilters() {
    setAdminId("")
    setAction("")
    setFrom("")
    setTo("")
    void load(1, {})
  }

  async function handleExport() {
    setExporting(true)
    try {
      const csv = await exportAdminActivityCsv(filters())
      const stamp = new Date().toISOString().slice(0, 10)
      saveCsv(`log-aktivitas-admin-${stamp}.csv`, csv)
      toast.show({ title: "Ekspor selesai.", description: "File CSV diunduh.", tone: "success" })
    } catch (e) {
      toast.show({ title: "Ekspor gagal", description: userMessage(e), tone: "danger" })
    } finally {
      setExporting(false)
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Log Aktivitas Admin"
        description="Jejak semua aksi admin di panel ini: siapa, apa, kapan."
        actions={
          <Button
            variant="secondary"
            size="sm"
            fullWidth={false}
            loading={exporting}
            onClick={handleExport}
          >
            Ekspor CSV
          </Button>
        }
        onRefresh={() => load(page)}
        refreshing={loading}
      />

      {retention ? (
        <div className="rounded-md border border-border bg-surface px-4 py-3">
          <p className="text-body text-text-primary">
            <span className="font-semibold">Kebijakan retensi:</span> log aktivitas disimpan{" "}
            {retention.retentionDays} hari.
            {retention.note ? ` ${retention.note}` : ""}
          </p>
        </div>
      ) : null}

      <Card padded={false}>
        <CardHeader title="Filter" />
        <CardBody>
          <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-5">
            <Select
              label="Admin"
              options={[
                { value: "", label: "Semua admin" },
                ...admins.map((a) => ({ value: a.id, label: `${a.fullName} (${a.email})` })),
              ]}
              value={adminId}
              onChange={(e) => setAdminId(e.target.value)}
            />
            <Input
              label="Aksi"
              placeholder="cth. USER_BAN, WALLET_ADJUST"
              value={action}
              onChange={(e) => setAction(e.target.value)}
            />
            <Input
              label="Dari"
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
            />
            <Input
              label="Sampai"
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
            />
            <div className="flex items-end gap-2">
              <Button variant="secondary" size="md" fullWidth={false} onClick={applyFilters}>
                Terapkan
              </Button>
              <Button variant="ghost" size="md" fullWidth={false} onClick={resetFilters}>
                Reset
              </Button>
            </div>
          </div>
        </CardBody>
      </Card>

      <Card padded={false}>
        <CardBody>
          {loading ? (
            <LoadingBlock message="Memuat log aktivitas…" />
          ) : error ? (
            <ErrorBlock title="Gagal memuat log aktivitas" message={error} onRetry={() => load(page)} />
          ) : (
            <>
              <DataTable<AdminActivityEntry & Record<string, unknown>>
                columns={[
                  {
                    key: "createdAt",
                    header: "Waktu",
                    render: (r) => formatDateTimeWIB(r.createdAt),
                  },
                  {
                    key: "adminName",
                    header: "Admin",
                    render: (r) => r.adminName ?? r.adminId ?? "—",
                  },
                  {
                    key: "action",
                    header: "Aksi",
                    render: (r) => <Badge tone="neutral">{r.action}</Badge>,
                  },
                  {
                    key: "description",
                    header: "Keterangan",
                    render: (r) => (
                      <div>
                        <p>{r.description?.trim() || "—"}</p>
                        {r.entityType ? (
                          <p className="font-mono text-caption text-text-secondary">
                            {r.entityType}
                            {r.entityId ? ` · ${r.entityId}` : ""}
                          </p>
                        ) : null}
                      </div>
                    ),
                  },
                  {
                    key: "ipAddress",
                    header: "IP",
                    render: (r) => (
                      <span className="font-mono text-[13px]">{r.ipAddress ?? "—"}</span>
                    ),
                  },
                ]}
                rows={rows.map((r) => ({ ...r }))}
                rowKey={(r) => r.id}
                emptyText="Tidak ada aktivitas pada filter ini."
              />
              <div className="mt-4">
                <Pagination
                  page={page}
                  totalPages={totalPages}
                  total={total}
                  pageSize={PAGE_SIZE}
                  onPageChange={(p) => load(p)}
                />
              </div>
            </>
          )}
        </CardBody>
      </Card>
    </div>
  )
}

export default function AdminActivityLogPage() {
  return (
    <RoleGate href="/team">
      <AdminActivityContent />
    </RoleGate>
  )
}
