/**
 * Admin — Antrean umpan balik: daftar masukan pengguna dengan filter,
 * pencarian, paginasi cursor ("Muat lebih banyak"), dan badge SLA.
 */

"use client"

import Link from "next/link"
import { useCallback, useEffect, useMemo, useState } from "react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { EmptyState } from "@/components/ui/empty-state"
import { Input } from "@/components/ui/input"
import { Spinner } from "@/components/ui/spinner"
import { DataTable } from "@/components/ui/table"
import { useToast } from "@/components/ui/toast"
import { RoleGate } from "@/components/admin/role-gate"
import { Select } from "@/components/admin/select"
import {
  exportFeedback,
  getFeedbackSummary,
  listFeedback,
  type FeedbackItem,
  type FeedbackSummary,
} from "@/lib/api/admin/feedback"
import { userMessage } from "@/lib/api/response"
import { formatDateTimeWIB } from "@/lib/format"

import {
  FEEDBACK_RISK_LABEL,
  FEEDBACK_RISK_TONE,
  FEEDBACK_STATUS_LABEL,
  FEEDBACK_STATUS_TONE,
} from "./maps"

const PAGE_SIZE = 20

const STATUS_OPTIONS = [
  { value: "ALL", label: "Semua status" },
  { value: "NEW", label: "Baru" },
  { value: "IN_REVIEW", label: "Ditinjau" },
  { value: "ACTIONED", label: "Ditindaklanjuti" },
  { value: "CLOSED", label: "Ditutup" },
]

const CATEGORY_OPTIONS = [
  { value: "", label: "Semua kategori" },
  { value: "Saran fitur", label: "Saran fitur" },
  { value: "Laporan masalah", label: "Laporan masalah" },
  { value: "Pengalaman pengguna", label: "Pengalaman pengguna" },
  { value: "Pujian", label: "Pujian" },
  { value: "Lainnya", label: "Lainnya" },
]

const PLATFORM_OPTIONS = [
  { value: "", label: "Semua platform" },
  { value: "app", label: "Aplikasi" },
  { value: "web", label: "Web" },
]

const RATING_OPTIONS = [
  { value: "", label: "Semua rating" },
  { value: "1", label: "1 bintang" },
  { value: "2", label: "2 bintang" },
  { value: "3", label: "3 bintang" },
  { value: "4", label: "4 bintang" },
  { value: "5", label: "5 bintang" },
]

const ACCOUNT_OPTIONS = [
  { value: "", label: "Semua akun" },
  { value: "user", label: "Pengguna" },
  { value: "guest", label: "Tamu" },
]

function SlaBadge({ slaDueAt, status }: { slaDueAt?: string | null; status: string }) {
  if (!slaDueAt || status === "CLOSED" || status === "ACTIONED") return null
  const diff = new Date(slaDueAt).getTime() - Date.now()
  if (Number.isNaN(diff)) return null
  if (diff <= 0) {
    return (
      <span title="Tenggat SLA sudah lewat">
        <Badge tone="danger" variant="outline">
          Lewat tenggat
        </Badge>
      </span>
    )
  }
  if (diff <= 6 * 60 * 60 * 1000) {
    return (
      <span title={`Tenggat ${formatDateTimeWIB(slaDueAt)}`}>
        <Badge tone="warning" variant="outline">
          Mendekati tenggat
        </Badge>
      </span>
    )
  }
  return null
}

/** G174: strip ringkasan volume, rating rata-rata, dan distribusi status. */
function FeedbackSummaryStrip() {
  const [summary, setSummary] = useState<FeedbackSummary | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let cancelled = false
    getFeedbackSummary()
      .then((s) => {
        if (!cancelled) setSummary(s)
      })
      .catch(() => {
        if (!cancelled) setFailed(true)
      })
    return () => {
      cancelled = true
    }
  }, [])

  if (failed || !summary) return null

  const cards: { label: string; value: string }[] = [
    { label: "Total masukan", value: String(summary.total) },
    {
      label: "Rating rata-rata",
      value: summary.avgRating != null ? summary.avgRating.toFixed(2) : "—",
    },
    { label: "Baru", value: String(summary.byStatus["NEW"] ?? 0) },
    { label: "Ditinjau", value: String(summary.byStatus["IN_REVIEW"] ?? 0) },
    { label: "Ditindaklanjuti", value: String(summary.byStatus["ACTIONED"] ?? 0) },
    { label: "Ditutup", value: String(summary.byStatus["CLOSED"] ?? 0) },
  ]

  return (
    <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
      {cards.map((c) => (
        <Card key={c.label} className="p-4">
          <p className="text-caption text-text-secondary">{c.label}</p>
          <p className="text-h3 font-bold text-text-primary">{c.value}</p>
        </Card>
      ))}
    </div>
  )
}

export default function FeedbackListPage() {
  const toast = useToast()

  const [filters, setFilters] = useState({
    status: "ALL",
    category: "",
    platform: "",
    rating: "",
    dateFrom: "",
    dateTo: "",
    account: "",
    search: "",
  })
  const [searchDraft, setSearchDraft] = useState("")
  const [rows, setRows] = useState<FeedbackItem[]>([])
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [hasMore, setHasMore] = useState(false)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const fetchPage = useCallback(
    async (cursor: string | undefined, append: boolean) => {
      try {
        const res = await listFeedback({
          cursor,
          limit: PAGE_SIZE,
          status: filters.status === "ALL" ? undefined : filters.status,
          category: filters.category || undefined,
          platform: filters.platform || undefined,
          rating: filters.rating ? Number(filters.rating) : undefined,
          dateFrom: filters.dateFrom || undefined,
          dateTo: filters.dateTo || undefined,
          account: filters.account === "user" || filters.account === "guest" ? filters.account : undefined,
          search: filters.search || undefined,
        })
        setRows((prev) => (append ? [...prev, ...(res.data ?? [])] : (res.data ?? [])))
        setNextCursor(res.nextCursor ?? null)
        setHasMore(Boolean(res.hasMore))
      } catch (e) {
        const msg = userMessage(e)
        setError(msg)
        toast.show({ title: "Gagal memuat umpan balik", description: msg, tone: "danger" })
      }
    },
    [filters, toast],
  )

  useEffect(() => {
    setLoading(true)
    setError(null)
    setNextCursor(null)
    void fetchPage(undefined, false).finally(() => setLoading(false))
  }, [fetchPage])

  const handleLoadMore = async () => {
    if (!hasMore || loadingMore) return
    setLoadingMore(true)
    await fetchPage(nextCursor ?? undefined, true)
    setLoadingMore(false)
  }

  const setFilter = (key: keyof typeof filters, value: string) => {
    setFilters((prev) => ({ ...prev, [key]: value }))
  }

  const resetFilters = () => {
    setFilters({ status: "ALL", category: "", platform: "", rating: "", dateFrom: "", dateTo: "", account: "", search: "" })
    setSearchDraft("")
  }

  const columns = useMemo(
    () => [
      {
        key: "time",
        header: "Waktu",
        render: (r: FeedbackItem) => (
          <div>
            <p className="font-medium">{formatDateTimeWIB(r.createdAt)}</p>
            <div className="mt-1 flex flex-wrap gap-1">
              <SlaBadge slaDueAt={r.slaDueAt} status={r.status} />
            </div>
          </div>
        ),
      },
      {
        key: "category",
        header: "Kategori",
        render: (r: FeedbackItem) => (
          <div>
            <p className="font-semibold">{r.category}</p>
            <p className="text-caption text-text-secondary">
              {r.isGuest ? "Tamu" : "Pengguna"} · {r.platform}
            </p>
          </div>
        ),
      },
      {
        key: "rating",
        header: "Rating",
        render: (r: FeedbackItem) => (r.rating ? `${r.rating} / 5` : "—"),
      },
      {
        key: "status",
        header: "Status",
        render: (r: FeedbackItem) => (
          <Badge tone={FEEDBACK_STATUS_TONE[r.status] ?? "neutral"}>
            {FEEDBACK_STATUS_LABEL[r.status] ?? r.status}
          </Badge>
        ),
      },
      {
        key: "assignee",
        header: "Penanggung jawab",
        render: (r: FeedbackItem) => r.assignee?.fullName ?? "—",
      },
      {
        key: "risk",
        header: "Risiko",
        render: (r: FeedbackItem) => (
          <Badge tone={FEEDBACK_RISK_TONE[r.riskFlag] ?? "neutral"} variant="outline">
            {FEEDBACK_RISK_LABEL[r.riskFlag] ?? r.riskFlag}
          </Badge>
        ),
      },
      {
        key: "action",
        header: "",
        align: "right" as const,
        render: (r: FeedbackItem) => (
          <Link
            href={`/feedback/${r.id}`}
            className="font-semibold text-info-text hover:underline"
          >
            Tinjau
          </Link>
        ),
      },
    ],
    [],
  )

  return (
    <RoleGate href="/feedback">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-h2 font-bold text-text-primary">Masukan Pengguna</h1>
          <p className="mt-1 text-body text-text-secondary">
            Antrean umpan balik dari aplikasi — tinjau, tugaskan, balas, dan tindak lanjuti.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" size="sm" fullWidth={false} onClick={resetFilters}>
            Atur ulang filter
          </Button>          <Button
            variant="secondary"
            size="sm"
            fullWidth={false}
            onClick={async () => {
              try {
                const { url } = await exportFeedback({ format: "csv" })
                window.open(url, "_blank", "noopener,noreferrer")
              } catch (e) {
                toast.show({ title: "Gagal mengekspor", description: userMessage(e), tone: "danger" })
              }
            }}
          >
            Ekspor CSV
          </Button>
          <Button
            variant="secondary"
            size="sm"
            fullWidth={false}
            onClick={() => {
              setLoading(true)
              void fetchPage(undefined, false).finally(() => setLoading(false))
            }}
          >
            Muat ulang
          </Button>
        </div>
      </div>

      <FeedbackSummaryStrip />

      <Card padded>
        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
          <Select label="Status" options={STATUS_OPTIONS} value={filters.status} onChange={(e) => setFilter("status", e.target.value)} />
          <Select label="Kategori" options={CATEGORY_OPTIONS} value={filters.category} onChange={(e) => setFilter("category", e.target.value)} />
          <Select label="Platform" options={PLATFORM_OPTIONS} value={filters.platform} onChange={(e) => setFilter("platform", e.target.value)} />
          <Select label="Rating" options={RATING_OPTIONS} value={filters.rating} onChange={(e) => setFilter("rating", e.target.value)} />
          <Select label="Akun" options={ACCOUNT_OPTIONS} value={filters.account} onChange={(e) => setFilter("account", e.target.value)} />
          <Input label="Dari tanggal" type="date" value={filters.dateFrom} onChange={(e) => setFilter("dateFrom", e.target.value)} />
          <Input label="Sampai tanggal" type="date" value={filters.dateTo} onChange={(e) => setFilter("dateTo", e.target.value)} />
          <form
            className="flex items-end gap-2"
            onSubmit={(e) => {
              e.preventDefault()
              setFilter("search", searchDraft.trim())
            }}
          >
            <Input
              label="Pencarian"
              placeholder="Cari isi/kategori…"
              value={searchDraft}
              onChange={(e) => setSearchDraft(e.target.value)}
            />
            <Button type="submit" variant="secondary" fullWidth={false}>
              Cari
            </Button>
          </form>
        </div>
      </Card>

      <div className="mt-4">
        {loading ? (
          <div className="flex min-h-[40vh] items-center justify-center gap-2">
            <Spinner size="md" />
            <p className="text-body text-text-secondary">Memuat umpan balik…</p>
          </div>
        ) : error && rows.length === 0 ? (
          <Card>
            <EmptyState
              title="Gagal memuat umpan balik"
              description={error}
              action={
                <Button variant="secondary" fullWidth={false} onClick={() => {
                  setLoading(true)
                  void fetchPage(undefined, false).finally(() => setLoading(false))
                }}>
                  Coba lagi
                </Button>
              }
            />
          </Card>
        ) : (
          <>
            <DataTable<FeedbackItem> columns={columns} rows={rows} rowKey={(r) => r.id} emptyText="Tidak ada masukan pada filter ini." />
            {hasMore ? (
              <div className="mt-4 flex justify-center">
                <Button variant="secondary" fullWidth={false} loading={loadingMore} onClick={handleLoadMore}>
                  Muat lebih banyak
                </Button>
              </div>
            ) : rows.length > 0 ? (
              <p className="mt-4 text-center text-caption text-text-secondary">
                {rows.length} masukan ditampilkan.
              </p>
            ) : null}
          </>
        )}
      </div>
    </RoleGate>
  )
}
