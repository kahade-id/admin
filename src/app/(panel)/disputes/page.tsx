"use client"

/**
 * Admin — Daftar sengketa escrow.
 *
 * Filter 7 status, tabel dengan paginasi bernomor, klik "Tinjau" → detail.
 *
 * Port dari frontend/app/admin/(panel)/disputes/index.tsx → web desktop.
 */

import Link from "next/link"
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useRouter } from "next/navigation"

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
import { listDisputes, markDisputeUnderReview, type AdminDisputeItem } from "@/lib/api/admin/disputes"
import { userMessage } from "@/lib/api/response"
import { downloadCsv } from "@/lib/csv"
import { ageHours, formatAge, formatDateTimeWIB } from "@/lib/format"
import { useListShortcuts } from "@/lib/list-shortcuts"
import { Input } from "@/components/ui/input"
// H01: filter tersimpan di URL.
import { parsePage, useUrlFilters } from "@/components/admin/batch139/use-url-filters"
// H02: preferensi kolom per admin.
import {
  ColumnCustomizer,
  useColumnPrefs,
  type PrefsColumnDef,
} from "@/components/admin/batch139/column-prefs"
// H03+H06: bulk action dengan scope eksplisit + dry-run.
import {
  BulkConfirmDialog,
  BulkScopeBar,
  useBulkSelection,
  type DryRunResult,
} from "@/components/admin/batch139/bulk-actions"
// H14: ekspor sebagai job (dengan fallback unduhan langsung).
import { ExportJobPanel, useExportJob } from "@/components/admin/batch139/export-job"

import { DISPUTE_CATEGORY_LABEL, DISPUTE_STATUS_LABEL, DISPUTE_STATUS_TONE } from "./maps"

const PAGE_SIZE = 20
/** Maksimum halaman yang diambil untuk export CSV / filter unassigned (100 baris per halaman). */
const FETCH_ALL_MAX_PAGES = 50

/** SLA mediasi sengketa — selaras DISPUTE_SLA_HOURS backend (72 jam). */
const DISPUTE_SLA_HOURS = 72

// WAITING_RESPONSE dipertahankan di filter: nilai enum backend DisputeStatus
// yang valid dan diterima API filter (`dispute-list-query.dto.ts`); endpoint
// assign backend juga menerimanya. Alur backend saat ini memang tidak
// mentransisikan sengketa KE status ini (catatan BAI-089), tetapi data
// historis bisa berstatus ini — filter kosong lebih jujur daripada opsi
// yang hilang.
type Filter =
  | "ALL"
  | "OPEN"
  | "ASSIGNED"
  | "UNDER_REVIEW"
  | "WAITING_RESPONSE"
  | "ESCALATED"
  | "RESOLVED"
  /** Pseudo-filter: sengketa tanpa assignedAdminId (disaring client-side). */
  | "UNASSIGNED"

const FILTER_OPTIONS = [
  { value: "ALL", label: "Semua" },
  { value: "OPEN", label: "Terbuka" },
  { value: "ASSIGNED", label: "Ditugaskan ke mediator" },
  { value: "UNASSIGNED", label: "Belum ditugaskan" },
  { value: "UNDER_REVIEW", label: "Ditinjau mediator" },
  { value: "WAITING_RESPONSE", label: "Menunggu tanggapan" },
  { value: "ESCALATED", label: "Dieskalasi" },
  { value: "RESOLVED", label: "Selesai" },
]

/**
 * Nama admin penangan dari relasi `assignedAdmin` yang ikut di respons
 * list backend (`assignedAdmin: { adminId, fullName }`) — bukan ID mentah.
 */
function assignedAdminName(r: AdminDisputeItem): string | null {
  const rel = r.assignedAdmin as { fullName?: string } | undefined
  const name = typeof rel?.fullName === "string" ? rel.fullName.trim() : ""
  return name || null
}

type CategoryFilter = "ALL" | keyof typeof DISPUTE_CATEGORY_LABEL

const CATEGORY_FILTER_OPTIONS = [
  { value: "ALL", label: "Semua kategori" },
  ...Object.entries(DISPUTE_CATEGORY_LABEL).map(([value, label]) => ({ value, label })),
]

export default function DisputesListPage() {
  // H01: useSearchParams wajib di dalam Suspense (aturan Next.js).
  return (
    <Suspense fallback={null}>
      <DisputesListInner />
    </Suspense>
  )
}

/** Alasan terstruktur untuk bulk "masuk review" (H04). */
const BULK_REVIEW_REASONS = [
  { value: "TRIAGE", label: "Triage — mulai peninjauan" },
  { value: "SLA_RISK", label: "Mendekati / melewati SLA" },
  { value: "QUEUE_REBALANCE", label: "Penyeimbangan antrean" },
  { value: "OTHER", label: "Lainnya (jelaskan di catatan)" },
]

function DisputesListInner() {
  const toast = useToast()

  // H01: status/kategori/pencarian/halaman disinkronkan ke URL.
  const { values: f, set: setF } = useUrlFilters({
    status: "ALL",
    category: "ALL",
    search: "",
    page: "1",
  })
  const filter = f.status as Filter
  const categoryFilter = f.category as CategoryFilter
  const search = f.search
  const page = parsePage(f.page)
  const [searchInput, setSearchInput] = useState(f.search)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [rows, setRows] = useState<AdminDisputeItem[]>([])
  const [total, setTotal] = useState(0)
  const [totalPages, setTotalPages] = useState(1)

  // H03: multi-select per halaman.
  const bulk = useBulkSelection(rows.map((r) => r.id))
  const [bulkOpen, setBulkOpen] = useState(false)
  const [dryRun, setDryRun] = useState<DryRunResult | null>(null)
  const [bulkLoading, setBulkLoading] = useState(false)

  // Scope selection = halaman ini saja: bersihkan saat halaman/filter berubah.
  useEffect(() => {
    bulk.clear()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [f.page, f.status, f.category, f.search])

  /**
   * Ambil SEMUA baris yang cocok dengan filter aktif (untuk export CSV).
   * AW-001 (perf-fix): filter "belum ditugaskan" sekarang server-side via
   * param `unassigned` — tidak lagi fetch-all lalu saring client-side.
   */
  const fetchAllMatching = useCallback(
    async (
      targetFilter: Filter,
      targetSearch: string,
      targetCategory: CategoryFilter,
    ): Promise<{ items: AdminDisputeItem[]; truncated: boolean }> => {
      const unassignedOnly = targetFilter === "UNASSIGNED"
      const out: AdminDisputeItem[] = []
      let truncated = false
      for (let p = 1; p <= FETCH_ALL_MAX_PAGES; p++) {
        const res = await listDisputes({
          page: p,
          limit: 100,
          status: !unassignedOnly && targetFilter !== "ALL" ? targetFilter : undefined,
          category: targetCategory === "ALL" ? undefined : targetCategory,
          search: targetSearch.trim() || undefined,
          unassigned: unassignedOnly || undefined,
        })
        const batch = res.data ?? []
        out.push(...batch)
        if (p >= (res.totalPages ?? 1) || batch.length === 0) break
        // BAD-032: cap tercapai tetapi backend masih punya halaman berikut.
        if (p === FETCH_ALL_MAX_PAGES) truncated = true
      }
      return { items: out, truncated }
    },
    [],
  )

  const load = useCallback(
    async (
      mode: "initial" | "refresh" = "initial",
      targetPage = page,
      targetFilter = filter,
      targetSearch = search,
      targetCategory = categoryFilter,
    ) => {
      if (mode === "initial") setLoading(true)
      else setRefreshing(true)
      setError(null)
      try {
        // AW-001 (perf-fix): UNASSIGNED difilter server-side (?unassigned=true)
        // dengan paginasi normal — tidak lagi fetch-all 50 halaman.
        const unassignedOnly = targetFilter === "UNASSIGNED"
        const res = await listDisputes({
          page: targetPage,
          limit: PAGE_SIZE,
          status: !unassignedOnly && targetFilter !== "ALL" ? targetFilter : undefined,
          category: targetCategory === "ALL" ? undefined : targetCategory,
          search: targetSearch.trim() || undefined,
          unassigned: unassignedOnly || undefined,
        })
        setRows(res.data ?? [])
        const t = res.total ?? res.data?.length ?? 0
        setTotal(t)
        setTotalPages(res.totalPages ?? Math.max(1, Math.ceil(t / PAGE_SIZE)))
      } catch (e) {
        const msg = userMessage(e)
        setError(msg)
        toast.show({ title: "Gagal memuat daftar sengketa", description: msg, tone: "danger" })
      } finally {
        setLoading(false)
        setRefreshing(false)
      }
    },
    [page, filter, categoryFilter, search, toast],
  )

  useEffect(() => {
    void load("initial")
  }, [load])

  const handleFilterChange = (value: Filter) => {
    setF({ status: value, page: "1" })
    setActiveIndex(0)
  }

  const handleCategoryChange = (value: CategoryFilter) => {
    setF({ category: value, page: "1" })
    setActiveIndex(0)
  }

  const handleSearch = () => {
    setF({ search: searchInput.trim(), page: "1" })
    setActiveIndex(0)
  }

  const handlePageChange = (p: number) => {
    setF({ page: String(p) })
    setActiveIndex(0)
  }

  // H14: ekspor sebagai job — backend sengketa belum punya endpoint job,
  // jadi dipakai fallback unduhan langsung dengan UI status yang sama.
  // BAD-032: tandai bila ekspor terpotong di batas halaman.
  const exportTruncatedRef = useRef(false)
  const exportJob = useExportJob({
    request: async () => {
      const all = await fetchAllMatching(filter, search, categoryFilter)
      exportTruncatedRef.current = all.truncated
      const stamp = new Date().toISOString().slice(0, 10)
      return {
        type: "file" as const,
        save: () => {
          downloadCsv(
            `sengketa-${stamp}.csv`,
            ["ID Sengketa", "ID Order", "Status", "Kategori", "Umur", "Ditugaskan ke", "Dibuat"],
            all.items.map((r) => [
              r.id,
              r.orderId,
              DISPUTE_STATUS_LABEL[r.status] ?? r.status,
              r.category ? (DISPUTE_CATEGORY_LABEL[r.category] ?? r.category) : "",
              formatAge(r.createdAt),
              assignedAdminName(r) ?? r.assignedAdminId ?? "",
              formatDateTimeWIB(r.createdAt),
            ]),
          )
        },
      }
    },
    getStatus: async () => {
      throw new Error("Job backend belum tersedia untuk ekspor sengketa.")
    },
    download: async () => {},
    onDone: () => {
      toast.show({
        title: "CSV diunduh",
        description: exportTruncatedRef.current
          ? "Ekspor sengketa sesuai filter aktif selesai — PERHATIAN: hanya 5.000 baris pertama diekspor (data melebihi batas)."
          : "Ekspor sengketa sesuai filter aktif selesai.",
        tone: exportTruncatedRef.current ? "info" : "success",
      })
    },
  })

  // H06: dry-run client-side — tanpa endpoint dry-run backend, estimasi dari
  // baris halaman ini (ditandai "Estimasi client-side" di dialog).
  const computeDryRun = useCallback((): DryRunResult => {
    const byId = new Map(rows.map((r) => [r.id, r]))
    const excluded: Array<{ id: string; reason: string }> = []
    let affected = 0
    for (const id of bulk.selectedIds) {
      const r = byId.get(id)
      if (!r) {
        excluded.push({ id, reason: "Tidak ada di halaman ini" })
        continue
      }
      if (r.status !== "ASSIGNED") {
        excluded.push({
          id,
          reason: `Status "${DISPUTE_STATUS_LABEL[r.status] ?? r.status}" — hanya ASSIGNED yang bisa masuk review`,
        })
        continue
      }
      affected += 1
    }
    return { affected, excluded, conflicts: [], estimated: true }
  }, [rows, bulk])

  const openBulkReview = () => {
    setDryRun(computeDryRun())
    setBulkOpen(true)
  }

  const handleBulkReview = async (reason: string, notes: string) => {
    const targets = bulk.selectedIds.filter((id) => {
      const r = rows.find((x) => x.id === id)
      return r?.status === "ASSIGNED"
    })
    if (targets.length === 0) return
    setBulkLoading(true)
    try {
      const results = await Promise.allSettled(targets.map((id) => markDisputeUnderReview(id)))
      const ok = results.filter((r) => r.status === "fulfilled").length
      const failed = results.length - ok
      // CATATAN: endpoint under-review backend belum menerima alasan/catatan —
      // alasan terstruktur tetap diminta di dialog (H04) sebagai disiplin proses
      // dan siap diteruskan saat backend mendukungnya (additive).
      void reason
      void notes
      toast.show({
        title: "Tinjau massal selesai",
        description: `${ok} sengketa masuk review${failed > 0 ? `, ${failed} gagal` : ""}.`,
        tone: failed > 0 ? "danger" : "success",
      })
      setBulkOpen(false)
      bulk.clear()
      void load("refresh")
    } catch (e) {
      toast.show({ title: "Gagal menjalankan bulk review", description: userMessage(e), tone: "danger" })
    } finally {
      setBulkLoading(false)
    }
  }

  // Keyboard shortcuts: "/" fokus cari, j/k pindah baris, Enter buka detail.
  const router = useRouter()
  const searchInputRef = useRef<HTMLInputElement | null>(null)
  const { activeIndex, setActiveIndex } = useListShortcuts<AdminDisputeItem>({
    rows,
    searchInputRef,
    onOpen: (r) => router.push(`/disputes/${r.id}`),
  })

  // H02: kolom tabel sengketa bisa dipilih/diurutkan — preferensi per admin.
  // Kolom checkbox "select" selalu tampil (bagian dari bulk selection H03).
  const disputeColumnDefs = useMemo<PrefsColumnDef<AdminDisputeItem>[]>(
    () => [
      {
        key: "reason",
        header: "Sengketa",
        defaultVisible: true,
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
        defaultVisible: true,
        render: (r) => (
          <Badge tone={DISPUTE_STATUS_TONE[r.status] ?? "neutral"}>
            {DISPUTE_STATUS_LABEL[r.status] ?? r.status}
          </Badge>
        ),
      },
      {
        key: "category",
        header: "Kategori",
        defaultVisible: true,
        render: (r) =>
          r.category ? (
            <Badge tone="info">{DISPUTE_CATEGORY_LABEL[r.category] ?? r.category}</Badge>
          ) : (
            <span className="text-caption text-text-secondary">—</span>
          ),
      },
      {
        key: "age",
        header: "Umur",
        defaultVisible: true,
        render: (r) => {
          const h = ageHours(r.createdAt)
          const breached =
            h != null &&
            h >= DISPUTE_SLA_HOURS &&
            r.status !== "RESOLVED" &&
            !String(r.status).startsWith("RESOLVED")
          return (
            <div className="flex flex-col gap-1">
              <span className="tabular-nums text-[13px]">{formatAge(r.createdAt)}</span>
              {breached ? <Badge tone="danger">Lewat SLA</Badge> : null}
            </div>
          )
        },
      },
      {
        key: "assignedAdminId",
        header: "Ditugaskan ke",
        defaultVisible: true,
        // Tampilkan nama admin (dari relasi assignedAdmin), bukan ID mentah.
        render: (r) => {
          const name = assignedAdminName(r)
          if (name) return <span className="font-medium">{name}</span>
          return (
            <span className="break-all font-mono text-[13px]">
              {r.assignedAdminId ?? "—"}
            </span>
          )
        },
      },
      {
        key: "action",
        header: "",
        defaultVisible: true,
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
    ],
    [],
  )
  const cols = useColumnPrefs<AdminDisputeItem>("disputes", disputeColumnDefs)

  // Kolom checkbox selalu dirender dari state bulk terkini (tidak di-memo agar
  // selalu sinkron dengan selection).
  const selectColumn = {
    key: "select",
    header: "",
    render: (r: AdminDisputeItem) => (
      <input
        type="checkbox"
        checked={bulk.isSelected(r.id)}
        onChange={() => bulk.toggle(r.id)}
        aria-label={`Pilih sengketa order ${r.orderId}`}
        className="h-4 w-4 accent-[var(--color-primary)]"
      />
    ),
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
        <div className="flex flex-wrap items-center gap-3">
          <Button
            variant="secondary"
            size="sm"
            fullWidth={false}
            loading={exportJob.phase.phase === "requesting" || exportJob.phase.phase === "polling"}
            onClick={() => void exportJob.start()}
            title="Unduh CSV sesuai filter aktif"
          >
            Unduh CSV
          </Button>
          {/* H02: kustomisasi kolom tabel sengketa. */}
          <Button
            variant="secondary"
            size="sm"
            fullWidth={false}
            onClick={() => cols.setCustomizerOpen(true)}
          >
            Kolom
          </Button>
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
      </div>

      {/* H14: status job ekspor */}
      {exportJob.phase.phase !== "idle" ? (
        <div className="mb-4">
          <ExportJobPanel
            phase={exportJob.phase}
            onDownload={() => {}}
            onReset={exportJob.reset}
          />
        </div>
      ) : null}

      <div className="mb-4 flex flex-wrap items-end gap-3">
        <Select
          label="Status"
          options={FILTER_OPTIONS}
          value={filter}
          onChange={(e) => handleFilterChange(e.target.value as Filter)}
          className="w-52"
        />
        <Select
          label="Kategori"
          options={CATEGORY_FILTER_OPTIONS}
          value={categoryFilter}
          onChange={(e) => handleCategoryChange(e.target.value as CategoryFilter)}
          className="w-52"
        />
        <form
          className="flex flex-1 flex-wrap items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            handleSearch()
          }}
        >
          <Input
            ref={searchInputRef}
            label="Cari sengketa / order"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="ID sengketa atau ID order…"
            className="min-w-52 flex-1"
          />
          <Button type="submit" variant="secondary" size="md" fullWidth={false}>
            Cari
          </Button>
        </form>
      </div>
      <p className="mb-4 text-caption text-text-secondary">
        Shortcut: <kbd className="rounded-sm border border-border bg-surface px-1">/</kbd> cari ·{" "}
        <kbd className="rounded-sm border border-border bg-surface px-1">j</kbd>/
        <kbd className="rounded-sm border border-border bg-surface px-1">k</kbd> navigasi ·{" "}
        <kbd className="rounded-sm border border-border bg-surface px-1">Enter</kbd> buka detail
      </p>

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
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              fullWidth={false}
              onClick={() => (bulk.allPageSelected ? bulk.deselectPage() : bulk.selectPage())}
            >
              {bulk.allPageSelected ? "Batalkan pilih halaman ini" : "Pilih halaman ini"}
            </Button>
            {bulk.selectedCount > 0 ? (
              <span className="text-caption text-text-secondary">
                {bulk.selectedCount} dipilih
              </span>
            ) : null}
          </div>
          {/* H03: bar scope bulk — jumlah ID eksplisit + penjelasan scope */}
          <BulkScopeBar
            selection={bulk}
            pageSize={rows.length}
            totalResults={total}
            scope="selected-page"
            actions={
              <Button variant="secondary" size="sm" fullWidth={false} onClick={openBulkReview}>
                Masukkan ke review
              </Button>
            }
          />
          <DataTable<AdminDisputeItem>
            columns={[selectColumn, ...cols.visible]}
            rows={rows}
            rowKey={(r) => r.id}
            loading={loading}
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

      {/* H03+H04+H06: konfirmasi bulk — scope + dry-run + alasan terstruktur */}
      <BulkConfirmDialog
        open={bulkOpen}
        onClose={() => setBulkOpen(false)}
        title="Bulk: masukkan ke review"
        summary={`Tandai ${bulk.selectedCount} sengketa terpilih sebagai "Dalam Review".`}
        selectedIds={bulk.selectedIds}
        scope="selected-page"
        totalResults={total}
        dryRun={dryRun}
        reasonOptions={BULK_REVIEW_REASONS}
        impactItems={[
          "Sengketa berstatus ASSIGNED → UNDER_REVIEW (siap diberi keputusan)",
          "Sengketa dengan status lain dilewati otomatis (lihat uji coba)",
          "Tercatat di audit log per sengketa oleh backend",
        ]}
        confirmLabel="Ya, masukkan ke review"
        loading={bulkLoading}
        onConfirm={(reason, notes) => void handleBulkReview(reason, notes)}
      />
      {/* H02: dialog kustomisasi kolom */}
      <ColumnCustomizer prefs={cols} />
    </RoleGate>
  )
}
