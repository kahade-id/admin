"use client"

/**
 * Admin — Laporan etalase (moderasi showcase).
 *
 * Tab:
 * - Daftar: filter status + tabel + paginasi bernomor, aksi "Tinjau" → detail.
 * - Antrean prioritas (SH-A-007): skor risiko + badge overdue dari
 *   `getModerationQueue` (G411/G419).
 * - Banding menunggu (SH-A-008): antrean PENDING dari `listPendingAppeals`
 *   + putus langsung (G405–G408).
 * Header: ekspor audit G421 (SH-A-010, SUPER_ADMIN saja).
 */

import Link from "next/link"
import { useCallback, useEffect, useState } from "react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Dialog } from "@/components/ui/dialog"
import { EmptyState } from "@/components/ui/empty-state"
import { Field, Input, TextArea } from "@/components/ui/input"
import { Spinner } from "@/components/ui/spinner"
import { DataTable } from "@/components/ui/table"
import { useToast } from "@/components/ui/toast"
import { Pagination } from "@/components/admin/pagination"
import { RoleGate } from "@/components/admin/role-gate"
import { Select } from "@/components/admin/select"
import { useAuth } from "@/lib/auth-context"
import {
  decideAppeal,
  downloadShowcaseReportsExport,
  getModerationQueue,
  listPendingAppeals,
  listShowcaseReports,
  type ExportShowcaseReportsParams,
  type ModerationQueueItem,
  type ReportAppeal,
  type ShowcaseReport,
  type ShowcaseReportStatus,
} from "@/lib/api/admin/showcase-reports"
import { userMessage } from "@/lib/api/response"
import { formatAge, formatDateTimeWIB } from "@/lib/format"

import {
  RISK_TIER_LABEL,
  RISK_TIER_TONE,
  SHOWCASE_REPORT_STATUS_LABEL,
  SHOWCASE_REPORT_STATUS_TONE,
} from "./maps"

const PAGE_SIZE = 20

type Tab = "list" | "queue" | "appeals"

const TABS: { value: Tab; label: string }[] = [
  { value: "list", label: "Daftar laporan" },
  { value: "queue", label: "Antrean prioritas" },
  { value: "appeals", label: "Banding menunggu" },
]

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
  const { role } = useAuth()
  const isSuperAdmin = role === "SUPER_ADMIN"
  const [tab, setTab] = useState<Tab>("list")

  return (
    <RoleGate href="/reports/showcase">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-h2 font-bold text-text-primary">Laporan Etalase</h1>
          <p className="mt-1 text-body text-text-secondary">
            Moderasi laporan pengguna terhadap item etalase.
          </p>
        </div>
        {isSuperAdmin ? <ExportButton /> : null}
      </div>

      <div className="mb-4 flex flex-wrap gap-2">
        {TABS.map((t) => (
          <Button
            key={t.value}
            variant={tab === t.value ? "primary" : "secondary"}
            size="sm"
            fullWidth={false}
            onClick={() => setTab(t.value)}
          >
            {t.label}
          </Button>
        ))}
      </div>

      {tab === "list" && <ReportsListSection />}
      {tab === "queue" && <PriorityQueueSection />}
      {tab === "appeals" && <PendingAppealsSection />}
    </RoleGate>
  )
}

/* ================================================================== */
/* Daftar laporan                                                       */
/* ================================================================== */

function ReportsListSection() {
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
        const t = res.total ?? res.data?.length ?? 0
        setTotal(t)
        setTotalPages(res.totalPages ?? Math.max(1, Math.ceil(t / PAGE_SIZE)))
        // SH-A-026 — sinkronkan pager dengan halaman aktual backend
        // (backend meng-clamp page ke MAX_ADMIN_PAGE secara diam-diam).
        if (res.page && res.page !== targetPage) setPage(res.page)
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

  // SH-A-029 — empty state kontekstual.
  const emptyText =
    filter === "ALL" && total === 0
      ? "Belum ada laporan etalase."
      : "Tidak ada laporan pada filter ini."

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <Select
          label="Status"
          options={FILTER_OPTIONS}
          value={filter}
          onChange={(e) => handleFilterChange(e.target.value as Filter)}
          className="w-64"
        />
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
            emptyText={emptyText}
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
    </div>
  )
}

/* ================================================================== */
/* Antrean prioritas (SH-A-007)                                         */
/* ================================================================== */

const RISK_TIER_FILTER_OPTIONS = [
  { value: "", label: "Semua tier" },
  { value: "HIGH", label: "Risiko tinggi" },
  { value: "MEDIUM", label: "Risiko sedang" },
  { value: "LOW", label: "Risiko rendah" },
]

function PriorityQueueSection() {
  const toast = useToast()

  const [riskTier, setRiskTier] = useState("")
  const [overdueOnly, setOverdueOnly] = useState(false)
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [rows, setRows] = useState<ModerationQueueItem[]>([])
  const [total, setTotal] = useState(0)
  const [totalPages, setTotalPages] = useState(1)

  const load = useCallback(
    async (targetPage = 1, tier = riskTier, overdue = overdueOnly) => {
      setLoading(true)
      setError(null)
      try {
        const res = await getModerationQueue({
          page: targetPage,
          limit: PAGE_SIZE,
          riskTier: tier || undefined,
          overdueOnly: overdue || undefined,
          sort: "risk",
        })
        setRows(res.data ?? [])
        const t = res.total ?? res.data?.length ?? 0
        setTotal(t)
        setTotalPages(res.totalPages ?? Math.max(1, Math.ceil(t / PAGE_SIZE)))
        setPage(targetPage)
      } catch (e) {
        const msg = userMessage(e)
        setError(msg)
        toast.show({ title: "Gagal memuat antrean prioritas", description: msg, tone: "danger" })
      } finally {
        setLoading(false)
      }
    },
    [riskTier, overdueOnly, toast],
  )

  useEffect(() => {
    void load(1)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const applyFilters = (tier = riskTier, overdue = overdueOnly) => {
    setRiskTier(tier)
    setOverdueOnly(overdue)
    setPage(1)
    void load(1, tier, overdue)
  }

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <Select
          label="Tier risiko"
          className="w-48"
          options={RISK_TIER_FILTER_OPTIONS}
          value={riskTier}
          onChange={(e) => applyFilters(e.target.value, overdueOnly)}
        />
        <label className="flex min-h-10 items-center gap-2 text-body text-text-secondary">
          <input
            type="checkbox"
            checked={overdueOnly}
            onChange={(e) => applyFilters(riskTier, e.target.checked)}
          />
          Hanya yang overdue SLA
        </label>
      </div>

      {loading ? (
        <div className="flex min-h-[40vh] items-center justify-center gap-2">
          <Spinner size="md" />
          <p className="text-body text-text-secondary">Memuat antrean prioritas…</p>
        </div>
      ) : error ? (
        <Card>
          <EmptyState
            title="Gagal memuat antrean prioritas"
            description={error}
            action={
              <Button variant="secondary" fullWidth={false} onClick={() => load(page)}>
                Coba lagi
              </Button>
            }
          />
        </Card>
      ) : (
        <>
          <DataTable<ModerationQueueItem>
            columns={[
              {
                key: "item",
                header: "Item",
                render: (r) => (
                  <div>
                    <p className="font-semibold">{r.showcase?.title ?? "—"}</p>
                    <p className="text-caption text-text-secondary">
                      {r.reason} · {formatAge(r.createdAt)}
                    </p>
                  </div>
                ),
              },
              {
                key: "risk",
                header: "Risiko",
                render: (r) => (
                  <div className="flex flex-col items-start gap-1">
                    <Badge tone={RISK_TIER_TONE[r.riskTier] ?? "neutral"}>
                      {RISK_TIER_LABEL[r.riskTier] ?? r.riskTier}
                    </Badge>
                    <span className="tabular-nums text-caption text-text-secondary">
                      skor {r.riskScore}
                    </span>
                  </div>
                ),
              },
              {
                key: "sla",
                header: "SLA",
                render: (r) => (
                  <div className="flex flex-col items-start gap-1">
                    {r.isOverdue ? (
                      <Badge tone="danger">Overdue</Badge>
                    ) : (
                      <Badge tone="success">Dalam SLA</Badge>
                    )}
                    <span className="text-caption text-text-secondary">
                      {r.slaDueAt ? formatDateTimeWIB(r.slaDueAt) : "—"}
                    </span>
                  </div>
                ),
              },
              {
                key: "assignee",
                header: "Penugasan",
                render: (r) => (
                  <span className="font-mono text-[13px] text-text-secondary">
                    {r.assigneeAdminId ?? "—"}
                  </span>
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
            emptyText="Antrean prioritas kosong pada filter ini."
          />
          <Pagination
            page={page}
            totalPages={totalPages}
            total={total}
            pageSize={PAGE_SIZE}
            onPageChange={(p) => load(p)}
            className="mt-4"
          />
        </>
      )}
    </div>
  )
}

/* ================================================================== */
/* Banding menunggu putusan (SH-A-008)                                   */
/* ================================================================== */

function PendingAppealsSection() {
  const toast = useToast()

  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [rows, setRows] = useState<ReportAppeal[]>([])
  const [total, setTotal] = useState(0)
  const [totalPages, setTotalPages] = useState(1)

  const [deciding, setDeciding] = useState<ReportAppeal | null>(null)
  const [decision, setDecision] = useState<"APPROVED" | "REJECTED">("APPROVED")
  const [note, setNote] = useState("")
  const [busy, setBusy] = useState(false)

  const load = useCallback(
    async (targetPage = 1) => {
      setLoading(true)
      setError(null)
      try {
        const res = await listPendingAppeals({ page: targetPage, limit: PAGE_SIZE })
        setRows(res.data ?? [])
        const t = res.total ?? res.data?.length ?? 0
        setTotal(t)
        setTotalPages(res.totalPages ?? Math.max(1, Math.ceil(t / PAGE_SIZE)))
        setPage(targetPage)
      } catch (e) {
        const msg = userMessage(e)
        setError(msg)
        toast.show({ title: "Gagal memuat antrean banding", description: msg, tone: "danger" })
      } finally {
        setLoading(false)
      }
    },
    [toast],
  )

  useEffect(() => {
    void load(1)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const submitDecision = async () => {
    if (!deciding) return
    if (note.trim().length < 10) {
      toast.show({
        title: "Catatan putusan wajib",
        description: "Tulis alasan putusan minimal 10 karakter.",
        tone: "danger",
      })
      return
    }
    setBusy(true)
    try {
      await decideAppeal(deciding.id, { decision, decisionNote: note.trim() })
      toast.show({
        title: "Berhasil",
        description:
          decision === "APPROVED" ? "Banding disetujui — item dipulihkan." : "Banding ditolak.",
        tone: "success",
      })
      setDeciding(null)
      setNote("")
      void load(page)
    } catch (e) {
      toast.show({ title: "Gagal memutus banding", description: userMessage(e), tone: "danger" })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      {loading ? (
        <div className="flex min-h-[40vh] items-center justify-center gap-2">
          <Spinner size="md" />
          <p className="text-body text-text-secondary">Memuat antrean banding…</p>
        </div>
      ) : error ? (
        <Card>
          <EmptyState
            title="Gagal memuat antrean banding"
            description={error}
            action={
              <Button variant="secondary" fullWidth={false} onClick={() => load(page)}>
                Coba lagi
              </Button>
            }
          />
        </Card>
      ) : (
        <>
          <DataTable<ReportAppeal>
            columns={[
              {
                key: "appeal",
                header: "Banding",
                render: (a) => (
                  <div>
                    <p className="line-clamp-2 max-w-md">{a.reason}</p>
                    <p className="mt-1 text-caption text-text-secondary">
                      {a.appellantType === "OWNER" ? "Pemilik item" : "Pelapor"} ·{" "}
                      {formatDateTimeWIB(a.createdAt)}
                    </p>
                  </div>
                ),
              },
              {
                key: "report",
                header: "Laporan",
                render: (a) => (
                  <Link
                    href={`/reports/showcase/${a.reportId}`}
                    className="font-mono text-[13px] text-info-text hover:underline"
                  >
                    {a.reportId.slice(0, 8)}…
                  </Link>
                ),
              },
              {
                key: "action",
                header: "",
                align: "right",
                render: (a) => (
                  <Button
                    variant="secondary"
                    size="sm"
                    fullWidth={false}
                    onClick={() => {
                      setDeciding(a)
                      setDecision("APPROVED")
                      setNote("")
                    }}
                  >
                    Putus
                  </Button>
                ),
              },
            ]}
            rows={rows}
            rowKey={(a) => a.id}
            emptyText="Tidak ada banding yang menunggu putusan."
          />
          <Pagination
            page={page}
            totalPages={totalPages}
            total={total}
            pageSize={PAGE_SIZE}
            onPageChange={(p) => load(p)}
            className="mt-4"
          />
        </>
      )}

      <Dialog
        open={!!deciding}
        onClose={() => setDeciding(null)}
        title="Putus banding"
        description="Reviewer tidak boleh sama dengan moderator keputusan awal (ditolak backend 422)."
      >
        {deciding && (
          <div className="flex flex-col gap-3">
            <p className="text-body">{deciding.reason}</p>
            <Select
              label="Keputusan"
              value={decision}
              onChange={(e) => setDecision(e.target.value as "APPROVED" | "REJECTED")}
              options={[
                { value: "APPROVED", label: "Setujui — pulihkan item" },
                { value: "REJECTED", label: "Tolak — keputusan moderasi tetap" },
              ]}
            />
            <TextArea
              label="Catatan putusan (wajib, min. 10 karakter)"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Alasan mempertahankan / membalikkan keputusan…"
              rows={3}
            />
            <div className="flex gap-2">
              <Button variant="primary" fullWidth={false} loading={busy} onClick={submitDecision}>
                Kirim keputusan
              </Button>
              <Button variant="secondary" fullWidth={false} onClick={() => setDeciding(null)}>
                Batal
              </Button>
            </div>
          </div>
        )}
      </Dialog>
    </div>
  )
}

/* ================================================================== */
/* Ekspor audit G421 (SH-A-010) — SUPER_ADMIN saja                       */
/* ================================================================== */

function ExportButton() {
  const toast = useToast()
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [params, setParams] = useState<ExportShowcaseReportsParams>({
    format: "csv",
    status: "ALL",
    limit: 5000,
  })

  const doExport = async () => {
    setBusy(true)
    try {
      await downloadShowcaseReportsExport(params)
      toast.show({
        title: "Ekspor diunduh",
        description: "File teredaksi (tanpa PII pelapor/pemilik); tercatat sebagai event EXPORTED.",
        tone: "success",
      })
      setOpen(false)
    } catch (e) {
      toast.show({ title: "Ekspor gagal", description: userMessage(e), tone: "danger" })
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <Button variant="secondary" size="sm" fullWidth={false} onClick={() => setOpen(true)}>
        Ekspor audit
      </Button>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title="Ekspor audit laporan etalase"
        description="CSV/JSON teredaksi (tanpa PII pelapor/pemilik). Setiap ekspor dicatat backend sebagai event EXPORTED."
      >
        <div className="flex flex-col gap-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <Select
              label="Format"
              value={params.format ?? "csv"}
              onChange={(e) =>
                setParams((p) => ({ ...p, format: e.target.value as "csv" | "json" }))
              }
              options={[
                { value: "csv", label: "CSV" },
                { value: "json", label: "JSON" },
              ]}
            />
            <Select
              label="Status"
              value={params.status ?? "ALL"}
              onChange={(e) =>
                setParams((p) => ({
                  ...p,
                  status: e.target.value as ExportShowcaseReportsParams["status"],
                }))
              }
              options={[{ value: "ALL", label: "Semua" }, ...FILTER_OPTIONS.slice(1)]}
            />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Dari tanggal">
              <Input
                type="date"
                value={params.from ?? ""}
                onChange={(e) => setParams((p) => ({ ...p, from: e.target.value || undefined }))}
              />
            </Field>
            <Field label="Sampai tanggal">
              <Input
                type="date"
                value={params.to ?? ""}
                onChange={(e) => setParams((p) => ({ ...p, to: e.target.value || undefined }))}
              />
            </Field>
          </div>
          <Field label="Maksimum baris (1–5000)">
            <Input
              type="number"
              min={1}
              max={5000}
              value={params.limit ?? 5000}
              onChange={(e) => setParams((p) => ({ ...p, limit: Number(e.target.value) || 5000 }))}
            />
          </Field>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" fullWidth={false} onClick={() => setOpen(false)}>
              Batal
            </Button>
            <Button variant="primary" fullWidth={false} loading={busy} onClick={doExport}>
              Unduh
            </Button>
          </div>
        </div>
      </Dialog>
    </>
  )
}
