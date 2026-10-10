"use client"

/**
 * Admin — Moderasi Story.
 *
 * Tab "Laporan": antrean laporan (default `open`) dengan kartu ringkas +
 * dialog tinjau. Tab "Semua Story": tabel semua Story dengan filter
 * status/jenis/penulis. Baris metrik 30 hari di atas (`/metrics`).
 * Kontrak: `src/lib/api/admin/stories.ts`. Filter tersimpan di URL.
 */

import Link from "next/link"
import { Suspense, useCallback, useState } from "react"

import { Pagination } from "@/components/admin/pagination"
import { RoleGate } from "@/components/admin/role-gate"
import { Select } from "@/components/admin/select"
import { useStepUp } from "@/components/admin/step-up-gate"
import { parsePage, useUrlFilters } from "@/components/admin/batch139/use-url-filters"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { EmptyState } from "@/components/ui/empty-state"
import { Field, Input } from "@/components/ui/input"
import { DataTable } from "@/components/ui/table"
import {
  getAdminStoryMetrics,
  listAdminStories,
  listStoryReports,
  type AdminStoryListItem,
  type AdminStoryMetrics,
  type AdminStoryReport,
  type StoryKind,
  type StoryListStatus,
  type StoryReportStatus,
} from "@/lib/api/admin/stories"
import { userMessage } from "@/lib/api/response"
import { cn } from "@/lib/cn"
import { formatAge, formatDateTimeWIB } from "@/lib/format"

import { ErrorBlock, FilterChips, LoadingBlock, PageHeader } from "../_components/admin-ui"
import { ReviewReportDialog } from "./_components/review-report-dialog"
import { CardListSkeleton, Skeleton, TableSkeleton } from "./_components/skeleton"
import { StoryThumb } from "./_components/story-media"
import { useAsync } from "./_components/use-async"
import {
  deriveStoryStatus,
  formatCompact,
  formatStoryDuration,
  REPORT_CATEGORY_LABEL,
  REPORT_FINAL_STATUSES,
  REPORT_STATUS_LABEL,
  REPORT_STATUS_TONE,
  STORY_KIND_LABEL,
  STORY_STATUS_LABEL,
  STORY_STATUS_TONE,
} from "./maps"

const PAGE_SIZE = 20

const REPORT_STATUS_OPTIONS: { value: StoryReportStatus; label: string }[] = [
  { value: "open", label: "Terbuka" },
  { value: "in_review", label: "Ditinjau" },
  { value: "resolved_action", label: "Ditindak" },
  { value: "resolved_dismissed", label: "Diabaikan" },
]

const STORY_STATUS_OPTIONS: { value: StoryListStatus; label: string }[] = [
  { value: "all", label: "Semua status" },
  { value: "active", label: "Aktif" },
  { value: "hidden", label: "Disembunyikan" },
  { value: "expired", label: "Kedaluwarsa" },
  { value: "deleted", label: "Dihapus" },
  { value: "banned", label: "Penulis di-ban" },
]

const KIND_OPTIONS: { value: StoryKind | ""; label: string }[] = [
  { value: "", label: "Semua jenis" },
  { value: "image", label: "Gambar" },
  { value: "video", label: "Video" },
  { value: "text", label: "Teks" },
]

const REPORT_STATUSES = new Set<string>(REPORT_STATUS_OPTIONS.map((o) => o.value))
const STORY_STATUSES = new Set<string>(STORY_STATUS_OPTIONS.map((o) => o.value))
const KINDS = new Set<string>(["image", "video", "text"])

export default function StoriesPage() {
  return (
    <Suspense fallback={<LoadingBlock />}>
      <StoriesPageInner />
    </Suspense>
  )
}

function StoriesPageInner() {
  const stepUp = useStepUp()
  const { values: f, set: setF } = useUrlFilters({
    tab: "laporan",
    rstatus: "open",
    status: "all",
    kind: "",
    author: "",
    page: "1",
  })
  const tab: "laporan" | "semua" = f.tab === "semua" ? "semua" : "laporan"
  const page = parsePage(f.page)
  const reportStatus = (REPORT_STATUSES.has(f.rstatus) ? f.rstatus : "open") as StoryReportStatus
  const storyStatus = (STORY_STATUSES.has(f.status) ? f.status : "all") as StoryListStatus
  const kind = (KINDS.has(f.kind) ? f.kind : "") as StoryKind | ""
  const [refreshKey, setRefreshKey] = useState(0)

  return (
    <RoleGate href="/stories">
      <PageHeader title="Story" onRefresh={() => setRefreshKey((k) => k + 1)} />

      <MetricsRow refreshKey={refreshKey} />

      <div
        role="tablist"
        aria-label="Bagian"
        className="mb-4 inline-flex rounded-sm border border-border bg-surface p-1"
      >
        {(
          [
            { value: "laporan", label: "Laporan" },
            { value: "semua", label: "Semua Story" },
          ] as const
        ).map((t) => (
          <button
            key={t.value}
            role="tab"
            type="button"
            aria-selected={tab === t.value}
            onClick={() => setF({ tab: t.value, page: "1" })}
            className={cn(
              "rounded-sm px-4 py-1.5 text-body transition-colors",
              tab === t.value
                ? "bg-primary font-semibold text-primary-foreground"
                : "text-text-secondary hover:text-text-primary",
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "laporan" ? (
        <ReportsTab
          status={reportStatus}
          page={page}
          refreshKey={refreshKey}
          onStatusChange={(s) => setF({ rstatus: s, page: "1" })}
          onPageChange={(p) => setF({ page: String(p) })}
          requestStepUp={stepUp.requestStepUp}
        />
      ) : (
        <StoriesTab
          status={storyStatus}
          kind={kind}
          author={f.author}
          page={page}
          refreshKey={refreshKey}
          onFilterChange={(patch) => setF({ ...patch, page: "1" })}
          onPageChange={(p) => setF({ page: String(p) })}
        />
      )}

      {stepUp.stepUpDialog}
    </RoleGate>
  )
}

// ---------------------------------------------------------------------------
// Metrik
// ---------------------------------------------------------------------------

function MetricsRow({ refreshKey }: { refreshKey: number }) {
  const fetcher = useCallback(() => getAdminStoryMetrics(), [])
  const { data: metrics, error, loading } = useAsync<AdminStoryMetrics>(fetcher, refreshKey)

  const tiles: { label: string; value: string }[] = metrics
    ? [
        { label: "Story hari ini", value: formatCompact(metrics.storiesToday) },
        { label: "Story 30 hari", value: formatCompact(metrics.storiesLast30Days) },
        { label: "Rata-rata viewer", value: formatCompact(metrics.averageViewersPerStory) },
        { label: "Reaksi per view", value: `${(metrics.reactionRate * 100).toFixed(1)}%` },
        { label: "Laporan per 1.000 Story", value: formatCompact(metrics.reportsPer1000Stories) },
        {
          label: "Rata-rata penyelesaian laporan",
          value: `${formatCompact(metrics.averageReportResolutionHours)} jam`,
        },
      ]
    : []

  if (error) {
    return (
      <p className="mb-6 text-caption text-text-secondary">
        Metrik tidak tersedia: {userMessage(error)}
      </p>
    )
  }

  return (
    <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
      {loading
        ? Array.from({ length: 6 }).map((_, i) => (
            <Card key={i} className="space-y-2">
              <Skeleton className="h-3 w-24" />
              <Skeleton className="h-6 w-16" />
            </Card>
          ))
        : tiles.map((t) => (
            <Card key={t.label}>
              <p className="text-caption text-text-secondary">{t.label}</p>
              <p className="mt-1 text-h3 font-semibold text-text-primary">{t.value}</p>
            </Card>
          ))}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Tab Laporan
// ---------------------------------------------------------------------------

function ReportsTab({
  status,
  page,
  refreshKey,
  onStatusChange,
  onPageChange,
  requestStepUp,
}: {
  status: StoryReportStatus
  page: number
  refreshKey: number
  onStatusChange: (s: StoryReportStatus) => void
  onPageChange: (p: number) => void
  requestStepUp: ReturnType<typeof useStepUp>["requestStepUp"]
}) {
  const [reviewing, setReviewing] = useState<AdminStoryReport | null>(null)
  const fetcher = useCallback(
    () => listStoryReports({ status, page, limit: PAGE_SIZE }),
    [status, page],
  )
  const { data, error, loading, reload, mutate } = useAsync(fetcher, refreshKey)
  const rows = data?.reports ?? []
  const total = data?.total ?? 0
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))

  return (
    <>
      <FilterChips options={REPORT_STATUS_OPTIONS} value={status} onChange={onStatusChange} />

      {loading ? (
        <CardListSkeleton />
      ) : error ? (
        <ErrorBlock title="Gagal memuat laporan" message={userMessage(error)} onRetry={reload} />
      ) : rows.length === 0 ? (
        <Card>
          <EmptyState
            compact
            title="Tidak ada laporan"
            description={`Tidak ada laporan berstatus "${REPORT_STATUS_LABEL[status]}".`}
          />
        </Card>
      ) : (
        <div className="space-y-3">
          {rows.map((r) => (
            <ReportCard key={r.id} report={r} onReview={() => setReviewing(r)} onReload={reload} />
          ))}
        </div>
      )}

      <Pagination
        page={page}
        totalPages={totalPages}
        total={total}
        pageSize={PAGE_SIZE}
        onPageChange={onPageChange}
        className="mt-4"
      />

      <ReviewReportDialog
        report={reviewing}
        onClose={() => setReviewing(null)}
        requestStepUp={requestStepUp}
        onReviewed={(report, result) => {
          setReviewing(null)
          // Optimistis: perbarui/lepas baris tanpa menunggu muat ulang.
          mutate((prev) =>
            result.status === status
              ? {
                  ...prev,
                  reports: prev.reports.map((r) =>
                    r.id === report.id
                      ? { ...r, status: result.status, reviewedAt: result.reviewedAt }
                      : r,
                  ),
                }
              : {
                  ...prev,
                  reports: prev.reports.filter((r) => r.id !== report.id),
                  total: Math.max(0, prev.total - 1),
                },
          )
        }}
      />
    </>
  )
}

function ReportCard({
  report,
  onReview,
  onReload,
}: {
  report: AdminStoryReport
  onReview: () => void
  /** URL snapshot bertanda tangan 900 dtk — muat ulang antrean bila media gagal. */
  onReload: () => void
}) {
  const snap = report.storySnapshot
  const isFinal = REPORT_FINAL_STATUSES.has(report.status)
  return (
    <Card className="flex gap-4">
      <StoryThumb
        key={snap.mediaUrl ?? snap.thumbnailUrl ?? ""}
        onReload={onReload}
        story={{
          kind: snap.kind,
          mediaUrl: snap.mediaUrl,
          thumbnailUrl: snap.thumbnailUrl,
          text: snap.text,
          backgroundColor: snap.backgroundColor,
          durationMs: snap.durationMs,
        }}
      />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone="accent">{REPORT_CATEGORY_LABEL[report.category] ?? report.category}</Badge>
          <Badge tone={REPORT_STATUS_TONE[report.status] ?? "neutral"}>
            {REPORT_STATUS_LABEL[report.status] ?? report.status}
          </Badge>
          <span className="text-caption text-text-tertiary">{formatAge(report.createdAt)}</span>
          {snap.kind ? (
            <span className="text-caption text-text-tertiary">
              · {STORY_KIND_LABEL[snap.kind]}
              {snap.kind === "video" ? ` ${formatStoryDuration(snap.durationMs)}` : ""}
            </span>
          ) : null}
        </div>
        <p className="mt-1 text-body text-text-primary">
          Pelapor{" "}
          <span className="font-medium">@{report.reporter?.username ?? "—"}</span>
          {snap.author?.username ? (
            <>
              {" "}
              · Penulis <span className="font-medium">@{snap.author.username}</span>
            </>
          ) : null}
        </p>
        {report.note ? (
          <p className="mt-1 line-clamp-2 text-body text-text-secondary">“{report.note}”</p>
        ) : null}
        {isFinal && report.internalNote ? (
          <p className="mt-1 line-clamp-2 text-caption italic text-text-tertiary">
            Catatan: {report.internalNote}
          </p>
        ) : null}
      </div>
      <div className="flex shrink-0 flex-col items-end gap-2">
        <Link
          href={`/stories/${encodeURIComponent(report.storyId)}`}
          className="text-body font-semibold text-info-text hover:underline"
        >
          Lihat Story
        </Link>
        {!isFinal ? (
          <Button size="sm" fullWidth={false} onClick={onReview}>
            Tinjau
          </Button>
        ) : null}
      </div>
    </Card>
  )
}

// ---------------------------------------------------------------------------
// Tab Semua Story
// ---------------------------------------------------------------------------

function StoriesTab({
  status,
  kind,
  author,
  page,
  refreshKey,
  onFilterChange,
  onPageChange,
}: {
  status: StoryListStatus
  kind: StoryKind | ""
  author: string
  page: number
  refreshKey: number
  onFilterChange: (patch: { status?: string; kind?: string; author?: string }) => void
  onPageChange: (p: number) => void
}) {
  const [authorInput, setAuthorInput] = useState(author)
  // Sinkronkan input saat URL berubah (mis. tombol kembali) — pola
  // "setState saat render" React, bukan effect.
  const [syncedAuthor, setSyncedAuthor] = useState(author)
  if (syncedAuthor !== author) {
    setSyncedAuthor(author)
    setAuthorInput(author)
  }

  const fetcher = useCallback(
    () =>
      listAdminStories({
        page,
        limit: PAGE_SIZE,
        status,
        kind: kind || undefined,
        authorUserId: author.trim() || undefined,
      }),
    [page, status, kind, author],
  )
  const { data, error, loading, reload } = useAsync(fetcher, refreshKey)
  const rows = data?.stories ?? []
  const total = data?.total ?? 0

  const applyAuthor = () => {
    if (authorInput.trim() !== author) onFilterChange({ author: authorInput.trim() })
  }

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))

  return (
    <>
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <Select
          label="Status"
          options={STORY_STATUS_OPTIONS}
          value={status}
          onChange={(e) => onFilterChange({ status: e.target.value })}
          className="w-48"
        />
        <Select
          label="Jenis"
          options={KIND_OPTIONS}
          value={kind}
          onChange={(e) => onFilterChange({ kind: e.target.value })}
          className="w-40"
        />
        <Field label="ID penulis">
          <Input
            value={authorInput}
            onChange={(e) => setAuthorInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") applyAuthor()
            }}
            onBlur={applyAuthor}
            placeholder="userId publik"
            className="w-56"
          />
        </Field>
      </div>

      {loading ? (
        <TableSkeleton />
      ) : error ? (
        <ErrorBlock title="Gagal memuat Story" message={userMessage(error)} onRetry={reload} />
      ) : (
        <DataTable<AdminStoryListItem>
          columns={[
            {
              key: "author",
              header: "Penulis",
              render: (r) => (
                <div className="min-w-0">
                  <p className="font-medium">@{r.author.username}</p>
                  {r.author.fullName ? (
                    <p className="truncate text-caption text-text-secondary">{r.author.fullName}</p>
                  ) : null}
                </div>
              ),
            },
            {
              key: "kind",
              header: "Jenis",
              render: (r) => (
                <span className="inline-flex items-center gap-1.5">
                  <Badge tone={r.kind === "video" ? "info" : "neutral"}>
                    {STORY_KIND_LABEL[r.kind]}
                  </Badge>
                  {r.kind === "video" ? (
                    <span className="font-mono text-caption text-text-secondary">
                      {formatStoryDuration(r.durationMs)}
                    </span>
                  ) : null}
                </span>
              ),
            },
            {
              key: "status",
              header: "Status",
              render: (r) => {
                const s = deriveStoryStatus(r)
                return (
                  <span className="inline-flex flex-wrap items-center gap-1">
                    <Badge tone={STORY_STATUS_TONE[s]}>{STORY_STATUS_LABEL[s]}</Badge>
                    {r.featureBanned ? <Badge tone="danger">Penulis di-ban</Badge> : null}
                  </span>
                )
              },
            },
            {
              key: "metrics",
              header: "View · Reaksi · Balasan · Laporan",
              render: (r) => (
                <span className="font-mono text-caption text-text-secondary">
                  {formatCompact(r.viewCount)} · {formatCompact(r.reactionCount)} ·{" "}
                  {formatCompact(r.replyCount)} ·{" "}
                  <span className={r.reportCount > 0 ? "font-semibold text-danger-text" : undefined}>
                    {formatCompact(r.reportCount)}
                  </span>
                </span>
              ),
            },
            {
              key: "time",
              header: "Dibuat · Kedaluwarsa",
              render: (r) => (
                <div className="text-caption text-text-secondary">
                  <p>{formatDateTimeWIB(r.createdAt)}</p>
                  <p className="text-text-tertiary">{formatDateTimeWIB(r.expiresAt)}</p>
                </div>
              ),
            },
            {
              key: "action",
              header: "",
              align: "right",
              render: (r) => (
                <Link
                  href={`/stories/${encodeURIComponent(r.id)}`}
                  className="font-semibold text-info-text hover:underline"
                >
                  Detail
                </Link>
              ),
            },
          ]}
          rows={rows}
          rowKey={(r) => r.id}
          emptyText="Tidak ada Story pada filter ini."
        />
      )}

      <Pagination
        page={page}
        totalPages={totalPages}
        total={total}
        pageSize={PAGE_SIZE}
        onPageChange={onPageChange}
        className="mt-4"
      />
    </>
  )
}
