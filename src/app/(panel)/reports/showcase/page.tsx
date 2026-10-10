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
  assignShowcaseReport,
  bulkReviewShowcaseReports,
  decideAppeal,
  downloadShowcaseReportsExport,
  getAssignCandidates,
  getModerationQueue,
  getShowcaseModerationMetrics,
  listPendingAppeals,
  listShowcaseReports,
  type AssignCandidate,
  type BulkReviewResult,
  type ExportShowcaseReportsParams,
  type ModerationQueueItem,
  type ReportAppeal,
  type ShowcaseModerationMetrics,
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
      {/* ADM-327: kartu statistik moderasi selalu terlihat di atas tab konten. */}
      <ModerationMetricsBar />
    </RoleGate>
  )
}

/* ================================================================== */
/* ADM-327 — kartu statistik moderasi (mirip metrik QA)                 */
/* ================================================================== */

function ModerationMetricsBar() {
  const toast = useToast()
  const [metrics, setMetrics] = useState<ShowcaseModerationMetrics | null>(null)

  useEffect(() => {
    void (async () => {
      try {
        setMetrics(await getShowcaseModerationMetrics())
      } catch (e) {
        toast.show({ title: "Gagal memuat metrik moderasi", description: userMessage(e), tone: "danger" })
      }
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  if (!metrics) return null

  const cards = [
    { label: "Laporan open", value: String(metrics.openReports) },
    { label: "Dalam peninjauan", value: String(metrics.underReview) },
    { label: "Banding menunggu", value: String(metrics.pendingAppeals) },
    { label: "Takedown (30 hari)", value: String(metrics.takedownsLast30d) },
    { label: "Restrict (30 hari)", value: String(metrics.restrictsLast30d) },
    { label: "Reopen (30 hari)", value: String(metrics.reopensLast30d) },
    {
      label: "Rata-rata penyelesaian",
      value: metrics.avgResolutionHours != null ? `${metrics.avgResolutionHours} jam` : "—",
    },
  ]

  return (
    <div className="mt-6">
      <div className="mb-3 grid grid-cols-2 gap-3 md:grid-cols-4">
        {cards.map((c) => (
          <Card key={c.label} className="p-4">
            <p className="text-caption text-text-secondary">{c.label}</p>
            <p className="text-h2 font-bold text-text-primary">{c.value}</p>
          </Card>
        ))}
      </div>
      {metrics.reasonDistribution.length > 0 ? (
        <Card className="p-4">
          <h3 className="mb-2 font-semibold">Distribusi alasan (laporan open)</h3>
          <div className="flex flex-wrap gap-2">
            {metrics.reasonDistribution.map((d) => (
              <Badge key={d.reason} tone="neutral">
                {d.reason} · {d.count}
              </Badge>
            ))}
          </div>
        </Card>
      ) : null}
    </div>
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
  // ADM-328 — seleksi bulk.
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [bulkAction, setBulkAction] = useState<"dismiss" | "under_review" | null>(null)
  const [bulkResolution, setBulkResolution] = useState("")
  const [bulkRunning, setBulkRunning] = useState(false)

  const clearSelection = () => setSelected(new Set())

  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

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
        // ADM-328 — seleksi hanya valid per halaman; reset saat daftar berubah.
        setSelected(new Set())
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

  // ADM-10 (audit etalase 2026-10-10): `load` bergantung pada page/filter dan
  // efek di atas memuat ulang setiap identitasnya berubah — memanggil `load`
  // eksplisit di sini membuat DUA request per ganti filter/halaman (yang kedua
  // bisa menimpa hasil pertama). Cukup ubah state; efek yang memuat.
  const handleFilterChange = (f: Filter) => {
    setFilter(f)
    setPage(1)
  }

  const handlePageChange = (p: number) => {
    setPage(p)
  }

  // SH-A-029 — empty state kontekstual.
  const emptyText =
    filter === "ALL" && total === 0
      ? "Belum ada laporan etalase."
      : "Tidak ada laporan pada filter ini."

  // ADM-328 — jalankan bulk setelah konfirmasi dialog.
  const handleBulkConfirm = async () => {
    if (!bulkAction || selected.size === 0) return
    setBulkRunning(true)
    try {
      const res: BulkReviewResult = await bulkReviewShowcaseReports({
        ids: [...selected],
        action: bulkAction,
        resolution: bulkResolution.trim() || undefined,
        confirm: true,
      })
      const failedMsgs = res.results
        .filter((r) => !r.ok)
        .slice(0, 5)
        .map((r) => r.error ?? r.id)
        .join("; ")
      toast.show({
        title:
          res.failed === 0
            ? `Bulk selesai: ${res.succeeded}/${res.total} berhasil`
            : `Bulk sebagian berhasil: ${res.succeeded}/${res.total} (gagal ${res.failed})`,
        description: failedMsgs || undefined,
        tone: res.failed === 0 ? "success" : "info",
      })
      setBulkAction(null)
      setBulkResolution("")
      clearSelection()
      void load("refresh")
    } catch (e) {
      toast.show({ title: "Bulk gagal", description: userMessage(e), tone: "danger" })
    } finally {
      setBulkRunning(false)
    }
  }

  const selectedCount = selected.size

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

      {/* ADM-328 — toolbar bulk (maks 50; konfirmasi via dialog). */}
      {selectedCount > 0 ? (
        <Card className="mb-4 flex flex-wrap items-center gap-3 p-4">
          <p className="font-semibold">{selectedCount} laporan dipilih</p>
          <Button
            variant="secondary"
            size="sm"
            fullWidth={false}
            onClick={() => setBulkAction("under_review")}
          >
            Tandai ditinjau
          </Button>
          <Button
            variant="destructive"
            size="sm"
            fullWidth={false}
            onClick={() => setBulkAction("dismiss")}
          >
            Tolak (dismiss)
          </Button>
          <Button variant="ghost" size="sm" fullWidth={false} onClick={clearSelection}>
            Batalkan pilihan
          </Button>
        </Card>
      ) : null}

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
                key: "select",
                header: "",
                render: (r) => (
                  <input
                    type="checkbox"
                    aria-label={`Pilih laporan ${r.id}`}
                    checked={selected.has(r.id)}
                    onChange={() => toggleSelect(r.id)}
                    className="h-4 w-4 accent-info"
                  />
                ),
              },
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

      {/* ADM-328 — dialog konfirmasi bulk (wajib confirm eksplisit backend). */}
      {bulkAction ? (
        <Dialog
          open={bulkAction !== null}
          onClose={() => {
            if (!bulkRunning) {
              setBulkAction(null)
              setBulkResolution("")
            }
          }}
          title={
            bulkAction === "dismiss"
              ? `Tolak ${selectedCount} laporan?`
              : `Tandai ${selectedCount} laporan sebagai ditinjau?`
          }
        >
          <div className="flex flex-col gap-3">
            <p className="text-body text-text-secondary">
              {bulkAction === "dismiss"
                ? "Laporan terpilih akan ditolak (DISMISSED). Item non-destruktif yang membutuhkan konfirmasi eksplisit ini dicatat di audit trail."
                : "Laporan terpilih akan ditandai UNDER_REVIEW dan muncul di antrean prioritas."}
            </p>
            <TextArea
              label="Catatan resolusi (opsional)"
              value={bulkResolution}
              onChange={(e) => setBulkResolution(e.target.value)}
              rows={3}
              maxLength={2000}
            />
            <div className="flex justify-end gap-2">
              <Button
                variant="secondary"
                fullWidth={false}
                disabled={bulkRunning}
                onClick={() => {
                  setBulkAction(null)
                  setBulkResolution("")
                }}
              >
                Batal
              </Button>
              <Button
                variant={bulkAction === "dismiss" ? "destructive" : "primary"}
                fullWidth={false}
                loading={bulkRunning}
                onClick={handleBulkConfirm}
              >
                {bulkAction === "dismiss" ? "Ya, tolak semua" : "Ya, tandai semua"}
              </Button>
            </div>
          </div>
        </Dialog>
      ) : null}
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
  // ADM-324 — picker assign: kandidat admin aktif + jumlah antrean.
  const [candidates, setCandidates] = useState<AssignCandidate[]>([])
  const [assignTarget, setAssignTarget] = useState<ModerationQueueItem | null>(null)
  const [assigneeId, setAssigneeId] = useState("")
  const [assigning, setAssigning] = useState(false)

  const openAssignDialog = async (r: ModerationQueueItem) => {
    setAssignTarget(r)
    setAssigneeId("")
    try {
      const res = await getAssignCandidates()
      setCandidates(res.candidates ?? [])
    } catch (e) {
      toast.show({ title: "Gagal memuat kandidat assignee", description: userMessage(e), tone: "danger" })
      setAssignTarget(null)
    }
  }

  const handleAssign = async () => {
    if (!assignTarget) return
    setAssigning(true)
    try {
      await assignShowcaseReport(assignTarget.id, { assigneeAdminId: assigneeId || null })
      toast.show({
        title: assigneeId ? "Laporan di-assign" : "Laporan di-assign otomatis (beban tersedikit)",
        tone: "success",
      })
      setAssignTarget(null)
      void load(page)
    } catch (e) {
      toast.show({ title: "Penugasan gagal", description: userMessage(e), tone: "danger" })
    } finally {
      setAssigning(false)
    }
  }

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
                  <div className="flex justify-end gap-2">
                    <Button
                      variant="secondary"
                      size="sm"
                      fullWidth={false}
                      onClick={() => void openAssignDialog(r)}
                    >
                      Assign
                    </Button>
                    <Link
                      href={`/reports/showcase/${r.id}`}
                      className="font-semibold text-info-text hover:underline self-center"
                    >
                      Tinjau
                    </Link>
                  </div>
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

      {/* ADM-324 — dialog picker assign: kandidat admin aktif + jumlah antrean. */}
      {assignTarget ? (
        <Dialog
          open={assignTarget !== null}
          onClose={() => {
            if (!assigning) setAssignTarget(null)
          }}
          title="Assign laporan"
          description={`Pilih admin untuk menangani laporan "${assignTarget.showcase?.title ?? assignTarget.id}".`}
        >
          <div className="flex flex-col gap-3">
            <Select
              label="Assignee"
              value={assigneeId}
              onChange={(e) => setAssigneeId(e.target.value)}
              options={[
                { value: "", label: "Otomatis — beban antrean tersedikit" },
                ...candidates.map((c) => ({
                  value: c.id,
                  label: `${c.fullName} (${c.role}) — ${c.openAssignments} antrean terbuka`,
                })),
              ]}
              className="w-full"
            />
            <div className="flex justify-end gap-2">
              <Button
                variant="secondary"
                fullWidth={false}
                disabled={assigning}
                onClick={() => setAssignTarget(null)}
              >
                Batal
              </Button>
              <Button variant="primary" fullWidth={false} loading={assigning} onClick={handleAssign}>
                Assign
              </Button>
            </div>
          </div>
        </Dialog>
      ) : null}
    </div>
  )
}

/* ================================================================== */
/* Banding menunggu putusan (SH-A-008)                                   */
/* ================================================================== */

function PendingAppealsSection() {
  const toast = useToast()
  // ADM-319: ID admin saat ini untuk deteksi konflik reviewer.
  // ADM-04 (audit etalase 2026-10-10): `report.reviewedBy` = admin_users.id
  // (JWT sub) — bandingkan dengan `profile.id`, bukan kode tampilan ADM-xxx.
  const { profile } = useAuth()
  const myAdminId = profile?.id ?? null

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
                  <div>
                    <Link
                      href={`/reports/showcase/${a.reportId}`}
                      className="font-mono text-[13px] text-info-text hover:underline"
                    >
                      {a.reportId.slice(0, 8)}…
                    </Link>
                    {/* ADM-319: info moderator awal agar konflik reviewer terlihat sejak tabel. */}
                    {(a.report as { reviewedBy?: string | null } | null)?.reviewedBy ? (
                      <p className="mt-1 text-caption text-text-secondary">
                        Mod. awal: <span className="font-mono">{((a.report as { reviewedBy?: string | null }).reviewedBy ?? "").slice(0, 12)}…</span>
                      </p>
                    ) : null}
                  </div>
                ),
              },
              {
                key: "action",
                header: "",
                align: "right",
                render: (a) => {
                  // ADM-319: sembunyikan tombol Putus bila moderator awal = admin saat ini
                  // (backend menolak 422); arahkan ke halaman detail sebagai gantinya.
                  const reviewedBy = (a.report as { reviewedBy?: string | null } | null)?.reviewedBy
                  const isOriginalReviewer = !!myAdminId && !!reviewedBy && reviewedBy === myAdminId
                  return (
                    <div className="flex flex-col items-end gap-1">
                      {isOriginalReviewer ? (
                        <>
                          <Badge tone="warning">Anda moderator awal</Badge>
                          <Link
                            href={`/reports/showcase/${a.reportId}`}
                            className="text-[13px] text-info-text hover:underline"
                          >
                            Lihat detail
                          </Link>
                        </>
                      ) : (
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
                      )}
                    </div>
                  )
                },
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
            {/* ADM-319: peringatan konflik reviewer di dalam dialog putus. */}
            {(deciding.report as { reviewedBy?: string | null } | null)?.reviewedBy ? (
              <p className="rounded-sm border border-warning/40 bg-warning/10 p-2 text-caption text-text-primary">
                Moderator keputusan awal:{" "}
                <span className="font-mono">
                  {((deciding.report as { reviewedBy?: string | null }).reviewedBy ?? "").slice(0, 16)}…
                </span>
                {myAdminId && (deciding.report as { reviewedBy?: string | null }).reviewedBy === myAdminId
                  ? " — ini Anda; putusan harus oleh reviewer lain."
                  : ""}
              </p>
            ) : null}
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
              // BAI-037 — backend DecideAppealDto @MaxLength(2000); batasi di
              // client agar putusan panjang tidak gagal 400 setelah ditulis.
              maxLength={2000}
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
