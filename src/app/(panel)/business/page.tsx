"use client"

/**
 * Admin — Antrean verifikasi badan usaha + operasi bulk (GAP-E G301–G325).
 *
 * - Checkbox seleksi per baris (hanya PENDING yang bisa dipilih) + toolbar
 *   "N terpilih" dengan aksi bulk setujui/tolak.
 * - Bulk memakai POST bulk/approve & bulk/reject (maks 50/batch, di-chunk
 *   otomatis); alasan WAJIB untuk tolak; dialog konfirmasi menampilkan
 *   jumlah, status, dan konsekuensi.
 * - Hasil per item: daftar berhasil/gagal per ID + pesan; salin ringkasan
 *   (tanpa PII); retry selektif hanya untuk kegagalan sementara.
 * - Selection aman: by ID lintas halaman; item yang statusnya berubah saat
 *   refresh otomatis dibatalkan; selection dibersihkan saat filter berubah.
 * - Filter: status, jenis badan hukum, kelengkapan dokumen,
 *   "menunggu dokumen tambahan".
 * - SLA: durasi antrean + badge SLA (baca sla-config scope
 *   BUSINESS_VERIFICATION, fallback 48 jam).
 * - Ringkasan volume disetujui/ditolak/dicabut per periode; ekspor CSV
 *   tanpa NPWP.
 */

import Link from "next/link"
import { useCallback, useEffect, useRef, useState } from "react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardBody } from "@/components/ui/card"
import { Dialog } from "@/components/ui/dialog"
import { EmptyState } from "@/components/ui/empty-state"
import { Spinner } from "@/components/ui/spinner"
import { DataTable } from "@/components/ui/table"
import { TextArea } from "@/components/ui/input"
import { useToast } from "@/components/ui/toast"
import { Pagination } from "@/components/admin/pagination"
import { RoleGate } from "@/components/admin/role-gate"
import { Select } from "@/components/admin/select"
import {
  bulkApproveBusiness,
  bulkRejectBusiness,
  exportBusinessCsv,
  getBusinessQueue,
  getBusinessSlaConfig,
  getBusinessSummary,
  type BusinessSlaConfig,
  type BusinessSummary,
  type BusinessVerificationItem,
  type BusinessVerificationStatus,
  type BulkBusinessResult,
} from "@/lib/api/admin/business"
import { userMessage } from "@/lib/api/response"
import { formatAge, formatDateTimeWIB, formatNumber } from "@/lib/format"
import {
  buildBulkSummaryText,
  chunkIds,
  deselectPageIds,
  isTransientFailure,
  pruneChangedStatuses,
  pruneSnapshot,
  selectPageIds,
  snapshotStatuses,
  toggleSelection,
  type SelectionSnapshot,
} from "@/lib/business/selection"
import { LEGAL_ENTITY_LABEL, LEGAL_ENTITY_OPTIONS } from "@/lib/business/masking"
import {
  BUSINESS_SLA_FALLBACK_HOURS,
  queueAgeHours,
  slaStatus,
} from "@/lib/business/sla"
import { LEGALITAS_STATUS_LABEL, legalitasStatus } from "@/lib/business/legalitas"

import { BUSINESS_STATUS_LABEL, BUSINESS_STATUS_TONE } from "./maps"

const PAGE_SIZE = 20
/** Batas bulk backend — UI men-chunk otomatis per batch sebesar ini. */
const BULK_BATCH_LIMIT = 50

type StatusFilter = "ALL" | BusinessVerificationStatus
type DocsFilter = "ALL" | "true" | "false"

const STATUS_OPTIONS = [
  { value: "ALL", label: "Semua" },
  { value: "PENDING", label: "Menunggu" },
  { value: "APPROVED", label: "Disetujui" },
  { value: "REJECTED", label: "Ditolak" },
  { value: "REVOKED", label: "Dicabut" },
]

const DOCS_OPTIONS = [
  { value: "ALL", label: "Semua" },
  { value: "true", label: "Lengkap" },
  { value: "false", label: "Belum lengkap" },
]

const SUMMARY_PERIODS = [
  { value: "7d", label: "7 hari" },
  { value: "30d", label: "30 hari" },
  { value: "90d", label: "90 hari" },
]

type BulkMode = "approve" | "reject"

type BulkOutcome = {
  mode: BulkMode
  batchIds: string[]
  succeeded: string[]
  failed: Array<{ id: string; reason: string }>
  skipped: string[]
}

function idOf(r: BusinessVerificationItem): string {
  return r.verificationId ?? r.id
}

export default function BusinessListPage() {
  const toast = useToast()

  const [statusFilter, setStatusFilter] = useState<StatusFilter>("PENDING")
  const [entityFilter, setEntityFilter] = useState("ALL")
  const [docsFilter, setDocsFilter] = useState<DocsFilter>("ALL")
  const [awaitingDocs, setAwaitingDocs] = useState(false)
  const [expiredOnly, setExpiredOnly] = useState(false)
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [rows, setRows] = useState<BusinessVerificationItem[]>([])
  const [total, setTotal] = useState(0)
  const [totalPages, setTotalPages] = useState(1)

  // --- Seleksi bulk: by ID, lintas halaman ---
  const [selected, setSelected] = useState<Set<string>>(() => new Set())
  const [snapshot, setSnapshot] = useState<SelectionSnapshot>(() => new Map())
  const selectedRef = useRef(selected)
  selectedRef.current = selected
  const snapshotRef = useRef(snapshot)
  snapshotRef.current = snapshot

  // --- Bulk dialogs & hasil ---
  const [bulkMode, setBulkMode] = useState<BulkMode | null>(null)
  const [bulkNotes, setBulkNotes] = useState("")
  const [bulkReason, setBulkReason] = useState("")
  const [bulkRunning, setBulkRunning] = useState(false)
  const [outcome, setOutcome] = useState<BulkOutcome | null>(null)
  const [copying, setCopying] = useState(false)

  // --- Ringkasan volume & SLA ---
  const [summaryPeriod, setSummaryPeriod] = useState<"7d" | "30d" | "90d">("30d")
  const [summary, setSummary] = useState<BusinessSummary | null>(null)
  const [slaConfig, setSlaConfig] = useState<BusinessSlaConfig>({
    slaHours: BUSINESS_SLA_FALLBACK_HOURS,
    useBusinessHours: false,
    source: "fallback",
  })

  const [exporting, setExporting] = useState(false)

  const buildQuery = useCallback(
    (sf: StatusFilter, ef: string, df: DocsFilter, ad: boolean, ex: boolean) => ({
      status: sf === "ALL" ? undefined : sf,
      legalEntityType: ef === "ALL" ? undefined : ef,
      docsComplete: ad ? undefined : df === "ALL" ? undefined : df,
      awaitingDocs: ad ? ("true" as const) : undefined,
      legalitasExpired: ex ? ("true" as const) : undefined,
    }),
    [],
  )

  const load = useCallback(
    async (
      mode: "initial" | "refresh" = "initial",
      targetPage = page,
      sf: StatusFilter = statusFilter,
      ef: string = entityFilter,
      df: DocsFilter = docsFilter,
      ad: boolean = awaitingDocs,
      ex: boolean = expiredOnly,
    ) => {
      if (mode === "initial") setLoading(true)
      else setRefreshing(true)
      setError(null)
      try {
        const res = await getBusinessQueue({
          page: targetPage,
          limit: PAGE_SIZE,
          ...buildQuery(sf, ef, df, ad, ex),
        })
        const nextRows = res.data ?? []
        setRows(nextRows)
        const t = res.total ?? nextRows.length
        setTotal(t)
        setTotalPages(res.totalPages ?? Math.max(1, Math.ceil(t / PAGE_SIZE)))

        // Selection aman: batalkan item yang statusnya berubah sejak dipilih.
        const currentById = new Map(nextRows.map((r) => [idOf(r), r.status] as [string, string]))
        const { kept, dropped } = pruneChangedStatuses(
          selectedRef.current,
          snapshotRef.current,
          currentById,
        )
        if (dropped.length > 0) {
          toast.show({
            title: "Pilihan dibatalkan otomatis",
            description: `${dropped.length} item statusnya berubah (${dropped.slice(0, 3).join(", ")}${dropped.length > 3 ? "…" : ""}) — dibatalkan dari pilihan.`,
            tone: "info",
          })
        }
        setSelected(kept)
        setSnapshot((prev) => pruneSnapshot(snapshotStatuses(prev, nextRows), kept))
      } catch (e) {
        const msg = userMessage(e)
        setError(msg)
        toast.show({ title: "Gagal memuat antrean bisnis", description: msg, tone: "danger" })
      } finally {
        setLoading(false)
        setRefreshing(false)
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [page, statusFilter, entityFilter, docsFilter, awaitingDocs, expiredOnly, toast, buildQuery],
  )

  useEffect(() => {
    void load("initial")
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    void getBusinessSlaConfig().then(setSlaConfig)
  }, [])

  const loadSummary = useCallback(async (period: "7d" | "30d" | "90d") => {
    try {
      setSummary(await getBusinessSummary(period))
    } catch {
      setSummary(null)
    }
  }, [])

  useEffect(() => {
    void loadSummary(summaryPeriod)
  }, [summaryPeriod, loadSummary])

  // --- Filter: SELALU bersihkan selection saat filter berubah ---
  const clearSelection = useCallback(() => {
    setSelected(new Set())
    setSnapshot(new Map())
  }, [])

  const handleFilterChange = (patch: {
    status?: StatusFilter
    entity?: string
    docs?: DocsFilter
    awaiting?: boolean
    expired?: boolean
  }) => {
    const sf = patch.status ?? statusFilter
    const ef = patch.entity ?? entityFilter
    const df = patch.docs ?? docsFilter
    const ad = patch.awaiting ?? awaitingDocs
    const ex = patch.expired ?? expiredOnly
    if (patch.status !== undefined) setStatusFilter(patch.status)
    if (patch.entity !== undefined) setEntityFilter(patch.entity)
    if (patch.docs !== undefined) setDocsFilter(patch.docs)
    if (patch.awaiting !== undefined) setAwaitingDocs(patch.awaiting)
    if (patch.expired !== undefined) setExpiredOnly(patch.expired)
    clearSelection()
    setPage(1)
    void load("initial", 1, sf, ef, df, ad, ex)
  }

  const handlePageChange = (p: number) => {
    setPage(p)
    void load("initial", p)
  }

  // --- Seleksi ---
  const toggleRow = (row: BusinessVerificationItem) => {
    const id = idOf(row)
    const nextSelected = toggleSelection(selected, id)
    setSelected(nextSelected)
    setSnapshot((prev) => {
      const next = new Map(prev)
      if (nextSelected.has(id)) {
        if (!next.has(id)) next.set(id, row.status)
      } else {
        next.delete(id)
      }
      return next
    })
  }

  const toggleSelectPage = () => {
    const pageIds = rows.filter((r) => r.status === "PENDING").map(idOf)
    const allSelected = pageIds.length > 0 && pageIds.every((id) => selected.has(id))
    if (allSelected) {
      setSelected((prev) => deselectPageIds(prev, pageIds))
      setSnapshot((prev) => pruneSnapshot(prev, deselectPageIds(selectedRef.current, pageIds)))
    } else {
      setSelected((prev) => selectPageIds(prev, pageIds))
      setSnapshot((prev) => snapshotStatuses(prev, rows.filter((r) => pageIds.includes(idOf(r)))))
    }
  }

  // --- Bulk ---
  const selectedIds = [...selected]
  const pagePendingIds = rows.filter((r) => r.status === "PENDING").map(idOf)
  const pageAllPendingSelected =
    pagePendingIds.length > 0 && pagePendingIds.every((id) => selected.has(id))

  /** Bagi selection menjadi eligible (PENDING/diketahui-belum-diproses) vs dilewati. */
  const partitionSelection = () => {
    const eligible: string[] = []
    const skipped: string[] = []
    for (const id of selectedIds) {
      const known = snapshot.get(id)
      if (known && known !== "PENDING") skipped.push(id)
      else eligible.push(id)
    }
    return { eligible, skipped }
  }

  const openBulk = (mode: BulkMode) => {
    setBulkNotes("")
    setBulkReason("")
    setBulkMode(mode)
  }

  const runBulk = async (mode: BulkMode, ids: string[], reason: string, notes: string) => {
    const chunks = chunkIds(ids, BULK_BATCH_LIMIT)
    const batchIds: string[] = []
    const succeeded: string[] = []
    const failed: Array<{ id: string; reason: string }> = []
    for (const chunk of chunks) {
      let res: BulkBusinessResult
      if (mode === "approve") {
        res = await bulkApproveBusiness(chunk, notes.trim() || undefined)
        succeeded.push(...(res.approved ?? []))
      } else {
        res = await bulkRejectBusiness(chunk, reason.trim(), notes.trim() || undefined)
        succeeded.push(...(res.rejected ?? []))
      }
      batchIds.push(res.batchId)
      failed.push(...(res.failed ?? []))
    }
    return { batchIds, succeeded, failed }
  }

  const handleBulkConfirm = async () => {
    if (!bulkMode) return
    if (bulkMode === "reject" && bulkReason.trim().length < 10) return
    const { eligible, skipped } = partitionSelection()
    if (eligible.length === 0) {
      toast.show({ title: "Tidak ada item PENDING terpilih", tone: "info" })
      return
    }
    setBulkRunning(true)
    try {
      const { batchIds, succeeded, failed } = await runBulk(
        bulkMode,
        eligible,
        bulkReason,
        bulkNotes,
      )
      setOutcome({ mode: bulkMode, batchIds, succeeded, failed, skipped })
      setBulkMode(null)
      // Item berhasil tidak lagi PENDING → keluarkan dari selection; yang gagal tetap terpilih.
      const failedIds = new Set(failed.map((f) => f.id))
      setSelected((prev) => {
        const next = new Set<string>()
        for (const id of prev) if (failedIds.has(id)) next.add(id)
        return next
      })
      setSnapshot((prev) => {
        const next = new Map<string, string>()
        for (const [id, st] of prev) if (failedIds.has(id)) next.set(id, st)
        return next
      })
      await load("refresh")
      toast.show({
        title:
          bulkMode === "approve"
            ? `${succeeded.length} pengajuan disetujui`
            : `${succeeded.length} pengajuan ditolak`,
        description:
          failed.length > 0
            ? `${failed.length} gagal — lihat rincian.`
            : "Semua item berhasil diproses.",
        tone: failed.length > 0 ? "info" : "success",
      })
    } catch (e) {
      toast.show({ title: "Operasi bulk gagal", description: userMessage(e), tone: "danger" })
    } finally {
      setBulkRunning(false)
    }
  }

  const handleRetryTransient = async () => {
    if (!outcome) return
    const transient = outcome.failed.filter((f) => isTransientFailure(f.reason))
    if (transient.length === 0) return
    setBulkRunning(true)
    try {
      const { batchIds, succeeded, failed } = await runBulk(
        outcome.mode,
        transient.map((f) => f.id),
        bulkReason,
        bulkNotes,
      )
      setOutcome({
        ...outcome,
        batchIds: [...outcome.batchIds, ...batchIds.filter((b) => !outcome.batchIds.includes(b))],
        succeeded: [...outcome.succeeded, ...succeeded],
        failed: [
          ...outcome.failed.filter((f) => !transient.some((t) => t.id === f.id)),
          ...failed,
        ],
      })
      setSelected((prev) => {
        const next = new Set(prev)
        for (const id of succeeded) next.delete(id)
        return next
      })
      setSnapshot((prev) => {
        const next = new Map(prev)
        for (const id of succeeded) next.delete(id)
        return next
      })
      await load("refresh")
      toast.show({
        title: `Retry selesai: ${succeeded.length} berhasil, ${failed.length} masih gagal`,
        tone: failed.length > 0 ? "info" : "success",
      })
    } catch (e) {
      toast.show({ title: "Retry gagal", description: userMessage(e), tone: "danger" })
    } finally {
      setBulkRunning(false)
    }
  }

  const handleCopySummary = async () => {
    if (!outcome) return
    setCopying(true)
    const text = buildBulkSummaryText({
      action: outcome.mode,
      batchIds: outcome.batchIds,
      succeeded: outcome.succeeded,
      failed: outcome.failed,
    })
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text)
      } else {
        const ta = document.createElement("textarea")
        ta.value = text
        document.body.appendChild(ta)
        ta.select()
        document.execCommand("copy")
        document.body.removeChild(ta)
      }
      toast.show({ title: "Ringkasan disalin", description: "Tanpa PII — hanya ID verifikasi.", tone: "success" })
    } catch {
      toast.show({ title: "Gagal menyalin ringkasan", tone: "danger" })
    } finally {
      setCopying(false)
    }
  }

  const handleExport = async () => {
    setExporting(true)
    try {
      const csv = await exportBusinessCsv({
        ...buildQuery(statusFilter, entityFilter, docsFilter, awaitingDocs, expiredOnly),
      })
      const blob = new Blob([csv], { type: "text/csv;charset=utf-8" })
      const url = URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url
      a.download = `verifikasi-bisnis-${new Date().toISOString().slice(0, 10)}.csv`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
      toast.show({ title: "Ekspor CSV diunduh", description: "Tanpa NPWP mentah.", tone: "success" })
    } catch (e) {
      toast.show({ title: "Ekspor gagal", description: userMessage(e), tone: "danger" })
    } finally {
      setExporting(false)
    }
  }

  const renderSlaCell = (r: BusinessVerificationItem) => {
    const age = queueAgeHours(r.slaStartedAt, r.createdAt)
    if (age == null) return <span className="text-text-secondary">—</span>
    const st = r.status === "PENDING" ? slaStatus(age, slaConfig.slaHours) : "ok"
    return (
      <div className="flex flex-col gap-1">
        <span>{formatAge(r.slaStartedAt ?? r.createdAt)}</span>
        {st === "breached" ? <Badge tone="danger">Lewat SLA</Badge> : null}
        {st === "warning" ? <Badge tone="warning">Mendekati SLA</Badge> : null}
      </div>
    )
  }

  const renderLegalitasBadge = (r: BusinessVerificationItem) => {
    if (r.status !== "APPROVED") return null
    // Flag server otoritatif; fallback hitung di klien bila backend lama.
    const expired = r.legalitasExpired ?? legalitasStatus(r.approvedAt) === "expired"
    const status = legalitasStatus(r.approvedAt)
    if (expired) return <Badge tone="danger">{LEGALITAS_STATUS_LABEL.expired}</Badge>
    if (status === "warning")
      return <Badge tone="warning">{LEGALITAS_STATUS_LABEL.warning}</Badge>
    return null
  }

  const dialogPartition = bulkMode ? partitionSelection() : { eligible: [], skipped: [] }

  return (
    <RoleGate href="/business">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-h2 font-bold text-text-primary">Verifikasi Bisnis</h1>
          <p className="mt-1 text-body text-text-secondary">
            Tinjau pengajuan verifikasi badan usaha — termasuk operasi bulk.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="secondary"
            size="sm"
            fullWidth={false}
            loading={exporting}
            onClick={handleExport}
          >
            Ekspor CSV
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

      {/* Ringkasan volume per periode */}
      <div className="mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <Card padded={false} className="xl:col-span-1">
          <CardBody>
            <p className="text-caption font-semibold uppercase text-text-secondary">Periode</p>
            <Select
              aria-label="Periode ringkasan"
              options={SUMMARY_PERIODS}
              value={summaryPeriod}
              onChange={(e) => setSummaryPeriod(e.target.value as "7d" | "30d" | "90d")}
              className="mt-2 w-full"
            />
          </CardBody>
        </Card>
        {[
          { label: "Menunggu", value: summary?.pending, tone: "warning" as const },
          { label: "Disetujui", value: summary?.approved, tone: "success" as const },
          { label: "Ditolak", value: summary?.rejected, tone: "danger" as const },
          { label: "Dicabut", value: summary?.revoked, tone: "neutral" as const },
        ].map((s) => (
          <Card key={s.label} padded={false}>
            <CardBody>
              <p className="text-caption font-semibold uppercase text-text-secondary">{s.label}</p>
              <p className="mt-1 text-h2 font-bold text-text-primary">
                {s.value == null ? "—" : formatNumber(s.value)}
              </p>
            </CardBody>
          </Card>
        ))}
      </div>

      {/* Filter */}
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <Select
          label="Status"
          options={STATUS_OPTIONS}
          value={awaitingDocs || expiredOnly ? (expiredOnly ? "APPROVED" : "PENDING") : statusFilter}
          disabled={awaitingDocs || expiredOnly}
          onChange={(e) => handleFilterChange({ status: e.target.value as StatusFilter })}
          className="w-44"
        />
        <Select
          label="Jenis badan hukum"
          options={LEGAL_ENTITY_OPTIONS}
          value={entityFilter}
          onChange={(e) => handleFilterChange({ entity: e.target.value })}
          className="w-44"
        />
        <Select
          label="Kelengkapan dokumen"
          options={DOCS_OPTIONS}
          value={docsFilter}
          disabled={awaitingDocs}
          onChange={(e) => handleFilterChange({ docs: e.target.value as DocsFilter })}
          className="w-44"
        />
        <label className="flex cursor-pointer items-center gap-2 pb-2 text-body text-text-primary">
          <input
            type="checkbox"
            className="h-4 w-4"
            checked={awaitingDocs}
            onChange={(e) => handleFilterChange({ awaiting: e.target.checked })}
          />
          Menunggu dokumen tambahan
        </label>
        <label className="flex cursor-pointer items-center gap-2 pb-2 text-body text-text-primary">
          <input
            type="checkbox"
            className="h-4 w-4"
            checked={expiredOnly}
            onChange={(e) => handleFilterChange({ expired: e.target.checked })}
            aria-label="Filter legalitas kedaluwarsa"
          />
          Legalitas kedaluwarsa
        </label>
        <p className="pb-2 text-caption text-text-secondary">
          SLA: {slaConfig.slaHours} jam{slaConfig.source === "fallback" ? " (fallback)" : ""}
        </p>
      </div>

      {/* Toolbar bulk */}
      {selected.size > 0 && (
        <Card padded={false} className="mb-4 border-info-text/40">
          <CardBody>
            <div className="flex flex-wrap items-center gap-3">
              <p className="font-semibold text-text-primary">
                {selected.size} terpilih
              </p>
              <Button variant="secondary" size="sm" fullWidth={false} onClick={toggleSelectPage}>
                {pageAllPendingSelected ? "Batalkan halaman ini" : "Pilih halaman ini"}
              </Button>
              <div className="ms-auto flex flex-wrap gap-2">
                <Button
                  variant="primary"
                  size="sm"
                  fullWidth={false}
                  onClick={() => openBulk("approve")}
                >
                  Setujui terpilih
                </Button>
                <Button
                  variant="destructive"
                  size="sm"
                  fullWidth={false}
                  onClick={() => openBulk("reject")}
                >
                  Tolak terpilih
                </Button>
                <Button variant="ghost" size="sm" fullWidth={false} onClick={clearSelection}>
                  Bersihkan
                </Button>
              </div>
            </div>
          </CardBody>
        </Card>
      )}

      {loading ? (
        <div className="flex min-h-[40vh] items-center justify-center gap-2">
          <Spinner size="md" />
          <p className="text-body text-text-secondary">Memuat antrean verifikasi bisnis…</p>
        </div>
      ) : error ? (
        <Card>
          <EmptyState
            title="Gagal memuat antrean bisnis"
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
          <DataTable<BusinessVerificationItem>
            columns={[
              {
                key: "select",
                header: "",
                render: (r) => (
                  <input
                    type="checkbox"
                    aria-label={`Pilih ${idOf(r)}`}
                    className="h-4 w-4"
                    checked={selected.has(idOf(r))}
                    disabled={r.status !== "PENDING"}
                    title={
                      r.status !== "PENDING"
                        ? "Hanya pengajuan PENDING yang bisa diproses bulk"
                        : undefined
                    }
                    onChange={() => toggleRow(r)}
                  />
                ),
              },
              {
                key: "business",
                header: "Badan usaha",
                render: (r) => (
                  <div>
                    <p className="font-semibold">{r.businessName ?? "—"}</p>
                    <p className="text-caption text-text-secondary">
                      {r.user?.fullName ?? r.user?.email ?? "—"}
                    </p>
                    <p className="mt-0.5">
                      <Badge tone="neutral">{LEGAL_ENTITY_LABEL[r.legalEntityType ?? ""] ?? r.legalEntityType ?? "—"}</Badge>
                    </p>
                  </div>
                ),
              },
              {
                key: "docs",
                header: "Dokumen",
                render: (r) => (
                  <div className="flex flex-col gap-1">
                    <span className="text-caption text-text-secondary">
                      {r.docCount ?? "—"} berkas
                    </span>
                    {r.documentsComplete ? (
                      <Badge tone="success">Lengkap</Badge>
                    ) : (
                      <Badge tone="warning">Belum lengkap</Badge>
                    )}
                    {renderLegalitasBadge(r)}
                  </div>
                ),
              },
              {
                key: "sla",
                header: "Durasi antrean",
                render: renderSlaCell,
              },
              {
                key: "status",
                header: "Status",
                render: (r) => (
                  <Badge tone={BUSINESS_STATUS_TONE[r.status] ?? "neutral"}>
                    {BUSINESS_STATUS_LABEL[r.status] ?? r.status}
                  </Badge>
                ),
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
                    href={`/business/${r.verificationId ?? r.id}`}
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

      {/* Dialog konfirmasi bulk */}
      <Dialog
        open={bulkMode !== null}
        onClose={() => (bulkRunning ? undefined : setBulkMode(null))}
        title={bulkMode === "approve" ? "Setujui pengajuan terpilih" : "Tolak pengajuan terpilih"}
        description={
          bulkMode === "approve"
            ? `${dialogPartition.eligible.length} pengajuan PENDING akan disetujui sekaligus (maks ${BULK_BATCH_LIMIT}/batch).`
            : `${dialogPartition.eligible.length} pengajuan PENDING akan ditolak dengan alasan yang sama.`
        }
        footer={
          <div className="flex flex-col gap-2">
            <Button
              variant={bulkMode === "approve" ? "primary" : "destructive"}
              loading={bulkRunning}
              disabled={
                bulkRunning ||
                dialogPartition.eligible.length === 0 ||
                (bulkMode === "reject" && bulkReason.trim().length < 10)
              }
              onClick={handleBulkConfirm}
            >
              {bulkMode === "approve"
                ? `Setujui ${dialogPartition.eligible.length} pengajuan`
                : `Tolak ${dialogPartition.eligible.length} pengajuan`}
            </Button>
            <Button variant="ghost" disabled={bulkRunning} onClick={() => setBulkMode(null)}>
              Batal
            </Button>
          </div>
        }
      >
        <div className="space-y-4">
          <div className="rounded-md border border-border bg-surface p-3 text-body text-text-secondary">
            {bulkMode === "approve" ? (
              <p>
                Badge “Business Verified” langsung aktif untuk tiap badan usaha yang
                disetujui. Tiap pemohon menerima notifikasi individual. Tindakan
                tercatat di audit log dengan ID batch.
              </p>
            ) : (
              <p>
                Tiap pemohon menerima notifikasi individual berisi alasan penolakan.
                Pemohon dapat mengajukan ulang setelah 24 jam. Tindakan tercatat di
                audit log dengan ID batch.
              </p>
            )}
            {dialogPartition.skipped.length > 0 && (
              <p className="mt-2">
                {dialogPartition.skipped.length} item dilewati (sudah tidak PENDING).
              </p>
            )}
          </div>
          {bulkMode === "reject" && (
            <TextArea
              label="Alasan penolakan (wajib, min 10 karakter)"
              required
              rows={4}
              value={bulkReason}
              onChange={(e) => setBulkReason(e.target.value)}
              placeholder="Alasan yang sama dikirim ke semua pemohon…"
              hint={`${bulkReason.trim().length} / 10 karakter minimum`}
            />
          )}
          <TextArea
            label="Catatan internal (opsional)"
            rows={2}
            value={bulkNotes}
            onChange={(e) => setBulkNotes(e.target.value)}
            placeholder="Hanya untuk tim internal…"
          />
        </div>
      </Dialog>

      {/* Dialog hasil bulk per item */}
      <Dialog
        open={outcome !== null}
        onClose={() => setOutcome(null)}
        title={`Hasil bulk ${outcome?.mode === "approve" ? "persetujuan" : "penolakan"}`}
        description={
          outcome
            ? `Batch: ${outcome.batchIds.join(", ") || "—"}`
            : undefined
        }
        footer={
          <div className="flex flex-col gap-2">
            {outcome && outcome.failed.some((f) => isTransientFailure(f.reason)) && (
              <Button
                variant="secondary"
                loading={bulkRunning}
                onClick={handleRetryTransient}
              >
                Retry yang gagal sementara (
                {outcome.failed.filter((f) => isTransientFailure(f.reason)).length})
              </Button>
            )}
            <Button variant="secondary" loading={copying} onClick={handleCopySummary}>
              Salin ringkasan (tanpa PII)
            </Button>
            <Button variant="ghost" onClick={() => setOutcome(null)}>
              Tutup
            </Button>
          </div>
        }
      >
        {outcome && (
          <div className="space-y-4">
            <div className="flex gap-4 text-body">
              <p>
                <span className="font-bold text-success-text">{outcome.succeeded.length}</span>{" "}
                berhasil
              </p>
              <p>
                <span className="font-bold text-danger-text">{outcome.failed.length}</span> gagal
              </p>
              {outcome.skipped.length > 0 && <p>{outcome.skipped.length} dilewati</p>}
            </div>
            {outcome.succeeded.length > 0 && (
              <div>
                <p className="mb-1 text-caption font-semibold uppercase text-text-secondary">
                  Berhasil ({outcome.succeeded.length})
                </p>
                <ul className="max-h-32 list-disc overflow-y-auto ps-5 font-mono text-[13px]">
                  {outcome.succeeded.map((id) => (
                    <li key={id}>{id}</li>
                  ))}
                </ul>
              </div>
            )}
            {outcome.failed.length > 0 && (
              <div>
                <p className="mb-1 text-caption font-semibold uppercase text-text-secondary">
                  Gagal ({outcome.failed.length})
                </p>
                <ul className="max-h-48 space-y-1 overflow-y-auto">
                  {outcome.failed.map((f) => (
                    <li key={f.id} className="text-[13px]">
                      <span className="font-mono">{f.id}</span>
                      <span className="text-text-secondary"> — {f.reason}</span>
                      {!isTransientFailure(f.reason) && (
                        <Badge tone="neutral" className="ms-2">
                          permanen
                        </Badge>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </Dialog>
    </RoleGate>
  )
}
