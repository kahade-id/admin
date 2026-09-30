"use client"

/**
 * Admin — Antrean KYC: daftar pengajuan + SLA + bulk + konfigurasi SLA.
 *
 * GAP-E (G276–G300):
 * - SLA dibaca dari backend (GET /v1/admin/kyc/sla-config), bukan konstanta
 *   hardcode; label menampilkan mode jam kalender/jam kerja.
 * - Kolom umur antrean + badge SLA (Aman / Mendekati SLA / Lewat SLA / Dijeda)
 *   + reviewer yang ditugaskan; filter kondisi SLA & rentang umur.
 * - Bulk approve/reject: checkbox maks 50, konfirmasi ekstra untuk approve,
 *   alasan wajib + pratinjau dampak untuk reject, hasil per ID + retry yang
 *   gagal saja, guard expectedStatus=PENDING per ID di backend.
 * - Ekspor CSV agregat (tanpa NIK/dokumen).
 * - Seleksi lintas halaman dengan snapshot status: item yang statusnya berubah
 *   sejak dipilih otomatis dibatalkan saat refresh (dipakai ulang dari
 *   @/lib/business/selection supaya konsisten dengan antrean bisnis).
 */

import Link from "next/link"
import { useCallback, useEffect, useRef, useState } from "react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardBody, CardHeader } from "@/components/ui/card"
import { Dialog } from "@/components/ui/dialog"
import { EmptyState } from "@/components/ui/empty-state"
import { Input, TextArea } from "@/components/ui/input"
import { Spinner } from "@/components/ui/spinner"
import { DataTable } from "@/components/ui/table"
import { useToast } from "@/components/ui/toast"
import { Pagination } from "@/components/admin/pagination"
import { RoleGate } from "@/components/admin/role-gate"
import { Select } from "@/components/admin/select"
import {
  bulkApproveKyc,
  bulkRejectKyc,
  getKycQueue,
  getSlaConfig,
  listKycReviewers,
  updateSlaConfig,
  type BulkKycResult,
  type KycQueueItem,
  type KycSlaView,
  type KycStatus,
  type SlaConfigResponse,
  type SlaScope,
} from "@/lib/api/admin/kyc"
import { userMessage } from "@/lib/api/response"
import { formatAge, formatDateTimeWIB } from "@/lib/format"
import {
  buildKycBulkSummaryText,
  chunkIds,
  deselectPageIds,
  isTransientFailure,
  KYC_BULK_MAX,
  pruneChangedStatuses,
  pruneSnapshot,
  selectPageIds,
  snapshotStatuses,
  toggleSelection,
  type SelectionSnapshot,
} from "@/lib/kyc/selection"

import { KYC_STATUS_LABEL, KYC_STATUS_TONE } from "./maps"

const PAGE_SIZE = 20

const STATUS_OPTIONS = [
  { value: "ALL", label: "Semua" },
  // BAI-065: UNVERIFIED = status awal pengajuan — bisa difilter eksplisit
  // (nilai enum backend KycStatus yang valid; jangan dibuang).
  { value: "UNVERIFIED", label: "Belum verifikasi" },
  { value: "PENDING", label: "Sedang ditinjau" },
  { value: "APPROVED", label: "Terverifikasi" },
  { value: "REJECTED", label: "Ditolak" },
  { value: "REVOKED", label: "Dicabut" },
]

type SlaFilter = "all" | "ok" | "warning" | "breached" | "paused"
const SLA_OPTIONS = [
  { value: "all", label: "Semua" },
  { value: "ok", label: "Aman" },
  { value: "warning", label: "Mendekati SLA" },
  { value: "breached", label: "Lewat SLA" },
  { value: "paused", label: "Dijeda" },
]

const SLA_STATUS_BY_FILTER: Record<Exclude<SlaFilter, "all">, "OK" | "MENDEKATI" | "BREACHED" | "PAUSED"> = {
  ok: "OK",
  warning: "MENDEKATI",
  breached: "BREACHED",
  paused: "PAUSED",
}

type AgePreset = "all" | "under24" | "between24and48" | "over48"
const AGE_OPTIONS: Array<{ value: AgePreset; label: string; min?: number; max?: number }> = [
  { value: "all", label: "Semua umur" },
  { value: "under24", label: "Di bawah 24 jam", max: 24 },
  { value: "between24and48", label: "24–48 jam", min: 24, max: 48 },
  { value: "over48", label: "Di atas 48 jam", min: 48 },
]

type BulkMode = "approve" | "reject"

type BulkOutcome = {
  mode: BulkMode
  succeeded: string[]
  failed: Array<{ id: string; reason: string }>
  skipped: string[]
}

function SlaBadge({ sla }: { sla?: KycSlaView | null }) {
  if (!sla) return <span className="text-text-tertiary">—</span>
  if (sla.paused) return <Badge tone="neutral">Dijeda</Badge>
  if (sla.status === "BREACHED") return <Badge tone="danger">Lewat SLA</Badge>
  if (sla.status === "MENDEKATI") return <Badge tone="warning">Mendekati SLA</Badge>
  return <Badge tone="success">Aman</Badge>
}

function slaConfigLabel(config: SlaConfigResponse | null): string {
  if (!config) return "memuat…"
  // QA-2026-09-26 (G510): respons tak terduga (configs hilang) tidak boleh
  // meledakkan render — tampilkan fallback, bukan crash.
  const c = config.configs?.KYC_PERSONAL
  if (!c) return "—"
  return `${c.slaHours} jam ${c.useBusinessHours ? "jam kerja" : "kalender"}`
}

export default function KycListPage() {
  const toast = useToast()

  const [statusFilter, setStatusFilter] = useState("PENDING")
  const [slaFilter, setSlaFilter] = useState<SlaFilter>("all")
  const [agePreset, setAgePreset] = useState<AgePreset>("all")
  // ADM-015: pencarian teks antrean. ADM-019: filter reviewer.
  const [searchInput, setSearchInput] = useState("")
  const [searchFilter, setSearchFilter] = useState("")
  const [reviewerFilter, setReviewerFilter] = useState("ALL")
  const [reviewers, setReviewers] = useState<Array<{ id: string; adminId: string; fullName: string | null; role: string }>>([])
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [rows, setRows] = useState<KycQueueItem[]>([])
  const [total, setTotal] = useState(0)
  const [totalPages, setTotalPages] = useState(1)
  const [slaConfig, setSlaConfig] = useState<SlaConfigResponse | null>(null)

  // --- Seleksi bulk: by ID, lintas halaman, maks 50 ---
  const [selected, setSelected] = useState<Set<string>>(() => new Set())
  const [snapshot, setSnapshot] = useState<SelectionSnapshot>(() => new Map())
  const selectedRef = useRef(selected)
  selectedRef.current = selected
  const snapshotRef = useRef(snapshot)
  snapshotRef.current = snapshot

  // --- Bulk dialogs & hasil ---
  const [bulkMode, setBulkMode] = useState<BulkMode | null>(null)
  const [bulkReason, setBulkReason] = useState("")
  const [approveAck, setApproveAck] = useState(false)
  const [bulkRunning, setBulkRunning] = useState(false)
  const [outcome, setOutcome] = useState<BulkOutcome | null>(null)
  const [copying, setCopying] = useState(false)

  // --- Ubah SLA ---
  const [slaOpen, setSlaOpen] = useState(false)
  const [slaScope, setSlaScope] = useState<SlaScope>("KYC_PERSONAL")
  const [slaHoursInput, setSlaHoursInput] = useState("48")
  const [slaBusinessInput, setSlaBusinessInput] = useState(false)
  const [slaChangeReason, setSlaChangeReason] = useState("")
  const [slaSaving, setSlaSaving] = useState(false)

  const buildQuery = useCallback(
    (sf: string, sla: SlaFilter, age: AgePreset, search: string, reviewer: string) => {
      const preset = AGE_OPTIONS.find((o) => o.value === age)
      return {
        status: sf === "ALL" ? undefined : (sf as KycStatus),
        // ADM-006: kondisi SLA difilter di sisi server (dulu client-side).
        slaStatus: sla === "all" ? undefined : SLA_STATUS_BY_FILTER[sla],
        minAgeHours: preset?.min,
        maxAgeHours: preset?.max,
        // ADM-015: pencarian teks. ADM-019: filter reviewer.
        search: search.trim() || undefined,
        assigned: reviewer === "ALL" ? undefined : reviewer === "UNASSIGNED" ? "unassigned" : reviewer,
      }
    },
    [],
  )

  const load = useCallback(
    async (mode: "initial" | "refresh" = "initial", targetPage = page) => {
      if (mode === "initial") setLoading(true)
      else setRefreshing(true)
      setError(null)
      try {
        const res = await getKycQueue({ page: targetPage, limit: PAGE_SIZE, ...buildQuery(statusFilter, slaFilter, agePreset, searchFilter, reviewerFilter) })
        const nextRows = res.data ?? []
        setRows(nextRows)
        const t = res.total ?? nextRows.length
        setTotal(t)
        setTotalPages(res.totalPages ?? Math.max(1, Math.ceil(t / PAGE_SIZE)))

        // Selection aman: batalkan item yang statusnya berubah sejak dipilih.
        const currentById = new Map(nextRows.map((r) => [r.kycId, r.status] as [string, string]))
        const { kept, dropped } = pruneChangedStatuses(selectedRef.current, snapshotRef.current, currentById)
        if (dropped.length > 0) {
          toast.show({
            title: "Pilihan dibatalkan otomatis",
            description: `${dropped.length} item statusnya berubah sejak dipilih — dibatalkan dari pilihan.`,
            tone: "info",
          })
        }
        setSelected(kept)
        setSnapshot((prev) => pruneSnapshot(snapshotStatuses(prev, nextRows.map((r) => ({ id: r.kycId, status: r.status }))), kept))
      } catch (e) {
        const msg = userMessage(e)
        setError(msg)
        toast.show({ title: "Gagal memuat antrean KYC", description: msg, tone: "danger" })
      } finally {
        setLoading(false)
        setRefreshing(false)
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [page, statusFilter, slaFilter, agePreset, searchFilter, reviewerFilter, toast, buildQuery],
  )

  useEffect(() => {
    void getSlaConfig().then(setSlaConfig).catch(() => setSlaConfig(null))
    // ADM-019: opsi filter reviewer (Gagal diam-diam → filter reviewer tetap
    // hanya menampilkan opsi "Belum ditugaskan").
    void listKycReviewers().then((r) => setReviewers(r.data ?? [])).catch(() => setReviewers([]))
  }, [])

  const clearSelection = useCallback(() => {
    setSelected(new Set())
    setSnapshot(new Map())
  }, [])

  const handleFilterChange = (patch: { status?: string; sla?: SlaFilter; age?: AgePreset; reviewer?: string }) => {
    if (patch.status !== undefined) setStatusFilter(patch.status)
    if (patch.sla !== undefined) setSlaFilter(patch.sla)
    if (patch.age !== undefined) setAgePreset(patch.age)
    if (patch.reviewer !== undefined) setReviewerFilter(patch.reviewer)
    clearSelection()
    setPage(1)
    // load ulang dipicu oleh effect di bawah (juga berjalan saat mount).
  }

  /** ADM-015: terapkan pencarian teks (tombol Enter/Terapkan — bukan per-keystroke). */
  const applySearch = () => {
    setSearchFilter(searchInput.trim())
    clearSelection()
    setPage(1)
  }

  // Muat ulang saat filter berubah; berjalan juga saat mount (load awal).
  useEffect(() => {
    void load("initial", 1)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFilter, slaFilter, agePreset, searchFilter, reviewerFilter])

  const handlePageChange = (p: number) => {
    setPage(p)
    void load("initial", p)
  }

  // --- Seleksi ---
  const toggleRow = (row: KycQueueItem) => {
    const id = row.kycId
    const nextSelected = toggleSelection(selected, id)
    if (nextSelected.size > KYC_BULK_MAX) {
      toast.show({ title: `Maksimal ${KYC_BULK_MAX} pengajuan per aksi bulk`, tone: "info" })
      return
    }
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

  const pagePendingIds = rows.filter((r) => r.status === "PENDING").map((r) => r.kycId)
  const pageAllPendingSelected =
    pagePendingIds.length > 0 && pagePendingIds.every((id) => selected.has(id))

  const toggleSelectPage = () => {
    if (pageAllPendingSelected) {
      setSelected((prev) => deselectPageIds(prev, pagePendingIds))
      setSnapshot((prev) => pruneSnapshot(prev, deselectPageIds(selectedRef.current, pagePendingIds)))
    } else {
      const room = KYC_BULK_MAX - selected.size
      const toAdd = pagePendingIds.filter((id) => !selected.has(id)).slice(0, Math.max(0, room))
      if (toAdd.length < pagePendingIds.filter((id) => !selected.has(id)).length) {
        toast.show({ title: `Maksimal ${KYC_BULK_MAX} pengajuan per aksi bulk`, tone: "info" })
      }
      setSelected((prev) => selectPageIds(prev, toAdd))
      setSnapshot((prev) =>
        snapshotStatuses(
          prev,
          rows.filter((r) => toAdd.includes(r.kycId)).map((r) => ({ id: r.kycId, status: r.status })),
        ),
      )
    }
  }

  // --- Bulk ---
  const selectedIds = [...selected]

  /** Bagi selection menjadi eligible (PENDING saat dipilih) vs dilewati. */
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
    setBulkReason("")
    setApproveAck(false)
    setBulkMode(mode)
  }

  const runBulk = async (mode: BulkMode, ids: string[], reason: string) => {
    const chunks = chunkIds(ids, KYC_BULK_MAX)
    const succeeded: string[] = []
    const failed: Array<{ id: string; reason: string }> = []
    for (const chunk of chunks) {
      let res: BulkKycResult
      if (mode === "approve") {
        res = await bulkApproveKyc(chunk, { expectedStatus: "PENDING" })
        succeeded.push(...(res.approved ?? []))
      } else {
        res = await bulkRejectKyc(chunk, reason.trim(), { expectedStatus: "PENDING" })
        succeeded.push(...(res.rejected ?? []))
      }
      failed.push(...(res.failed ?? []))
    }
    return { succeeded, failed }
  }

  const handleBulkConfirm = async () => {
    if (!bulkMode) return
    if (bulkMode === "reject" && bulkReason.trim().length < 10) return
    if (bulkMode === "approve" && !approveAck) return
    const { eligible, skipped } = partitionSelection()
    if (eligible.length === 0) {
      toast.show({ title: "Tidak ada item PENDING terpilih", tone: "info" })
      return
    }
    setBulkRunning(true)
    try {
      const { succeeded, failed } = await runBulk(bulkMode, eligible, bulkReason)
      setOutcome({ mode: bulkMode, succeeded, failed, skipped })
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
        title: bulkMode === "approve" ? `${succeeded.length} pengajuan disetujui` : `${succeeded.length} pengajuan ditolak`,
        description: failed.length > 0 ? `${failed.length} gagal — lihat rincian.` : "Semua item berhasil diproses.",
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
      const { succeeded, failed } = await runBulk(outcome.mode, transient.map((f) => f.id), bulkReason)
      setOutcome({
        ...outcome,
        succeeded: [...outcome.succeeded, ...succeeded],
        failed: [...outcome.failed.filter((f) => !transient.some((t) => t.id === f.id)), ...failed],
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
    } catch (e) {
      toast.show({ title: "Retry gagal", description: userMessage(e), tone: "danger" })
    } finally {
      setBulkRunning(false)
    }
  }

  const copySummary = async () => {
    if (!outcome) return
    setCopying(true)
    try {
      await navigator.clipboard.writeText(
        buildKycBulkSummaryText({
          action: outcome.mode,
          succeeded: outcome.succeeded,
          failed: outcome.failed,
          skipped: outcome.skipped,
        }),
      )
      toast.show({ title: "Ringkasan disalin", tone: "success" })
    } catch {
      toast.show({ title: "Gagal menyalin ringkasan", tone: "danger" })
    } finally {
      setCopying(false)
    }
  }

  // --- Ekspor CSV agregat (tanpa NIK/dokumen) ---
  const exportCsv = () => {
    const header = ["KYC ID", "ID Pengguna", "Status", "Upaya ke", "Umur antrean", "Status SLA", "Reviewer", "Diajukan", "Ditinjau"]
    const lines = rows.map((r) => {
      const slaLabel = !r.sla ? "" : r.sla.paused ? "Dijeda" : r.sla.status === "BREACHED" ? "Lewat SLA" : r.sla.status === "MENDEKATI" ? "Mendekati SLA" : "Aman"
      return [
        r.kycId,
        r.userId,
        KYC_STATUS_LABEL[r.status] ?? r.status,
        String(r.attemptNumber),
        formatAge(r.sla?.startedAt ?? r.createdAt),
        slaLabel,
        r.assignedReviewer?.fullName ?? r.reviewer?.fullName ?? "",
        formatDateTimeWIB(r.createdAt),
        formatDateTimeWIB(r.reviewedAt),
      ]
        .map((c) => `"${String(c).replace(/"/g, '""')}"`)
        .join(",")
    })
    const blob = new Blob([[header.join(","), ...lines].join("\n")], { type: "text/csv;charset=utf-8" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = `kyc-antrean-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
    toast.show({ title: "CSV agregat diunduh (tanpa NIK/dokumen)", tone: "success" })
  }

  // --- Ubah SLA ---
  const openSlaEdit = () => {
    const current = slaConfig?.configs[slaScope]
    setSlaHoursInput(String(current?.slaHours ?? 48))
    setSlaBusinessInput(current?.useBusinessHours ?? false)
    setSlaChangeReason("")
    setSlaOpen(true)
  }

  const saveSlaConfig = async () => {
    const hours = Number(slaHoursInput)
    if (!Number.isFinite(hours) || hours < 1 || hours > 720) {
      toast.show({ title: "SLA harus 1–720 jam", tone: "danger" })
      return
    }
    if (slaChangeReason.trim().length < 10) {
      toast.show({ title: "Alasan perubahan wajib diisi (minimal 10 karakter)", tone: "danger" })
      return
    }
    setSlaSaving(true)
    try {
      await updateSlaConfig({
        scope: slaScope,
        slaHours: Math.round(hours),
        useBusinessHours: slaBusinessInput,
        changeReason: slaChangeReason.trim(),
      })
      setSlaConfig(await getSlaConfig())
      toast.show({ title: "Konfigurasi SLA diperbarui (tercatat di audit)", tone: "success" })
      setSlaOpen(false)
      await load("refresh")
    } catch (e) {
      toast.show({ title: "Gagal menyimpan SLA", description: userMessage(e), tone: "danger" })
    } finally {
      setSlaSaving(false)
    }
  }

  const columns = [
    {
      key: "select",
      header: "",
      render: (row: KycQueueItem) => (
        <input
          type="checkbox"
          aria-label={`Pilih ${row.kycId}`}
          className="h-4 w-4"
          checked={selected.has(row.kycId)}
          disabled={row.status !== "PENDING"}
          title={row.status !== "PENDING" ? "Hanya pengajuan PENDING yang bisa diproses bulk" : undefined}
          onChange={() => toggleRow(row)}
        />
      ),
    },
    {
      key: "user",
      header: "Pengguna",
      render: (row: KycQueueItem) => (
        <div>
          <div className="font-medium">{row.user.fullName ?? row.user.userId}</div>
          <div className="text-caption text-text-secondary">{row.user.userId}</div>
        </div>
      ),
    },
    {
      key: "status",
      header: "Status",
      render: (row: KycQueueItem) => (
        <Badge tone={KYC_STATUS_TONE[row.status] ?? "neutral"}>{KYC_STATUS_LABEL[row.status] ?? row.status}</Badge>
      ),
    },
    {
      key: "age",
      header: "Umur antrean",
      render: (row: KycQueueItem) => formatAge(row.sla?.startedAt ?? row.createdAt),
    },
    {
      key: "sla",
      header: "SLA",
      render: (row: KycQueueItem) => <SlaBadge sla={row.sla} />,
    },
    {
      key: "reviewer",
      header: "Reviewer",
      render: (row: KycQueueItem) =>
        row.assignedReviewer?.fullName ?? <span className="text-text-tertiary">Belum ditugaskan</span>,
    },
    {
      key: "createdAt",
      header: "Diajukan",
      render: (row: KycQueueItem) => formatDateTimeWIB(row.createdAt),
    },
    {
      key: "action",
      header: "",
      align: "right" as const,
      render: (row: KycQueueItem) => (
        <Link
          href={`/kyc/${encodeURIComponent(row.kycId)}`}
          className="font-semibold text-info-text hover:underline"
        >
          Tinjau
        </Link>
      ),
    },
  ]

  const { eligible } = partitionSelection()

  return (
    <RoleGate href="/kyc">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-h2 font-bold text-text-primary">Antrean KYC</h1>
          <p className="mt-1 text-body text-text-secondary">
            Tinjau pengajuan verifikasi identitas. SLA tinjauan: <strong>{slaConfigLabel(slaConfig)}</strong>
            {slaConfig ? ` — ${slaConfig.businessHoursDefinition}` : ""}.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-4">
          <Link href="/kyc/attention" className="font-semibold text-info-text hover:underline">
            Perlu perhatian
          </Link>
          <Link href="/kyc/metrics" className="font-semibold text-info-text hover:underline">
            Metrik & runbook
          </Link>
          <Button variant="secondary" size="sm" fullWidth={false} loading={refreshing} onClick={() => load("refresh")}>
            Muat ulang
          </Button>
        </div>
      </div>

      <Card padded={false} className="mb-4">
        <CardBody>
          <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
            {/* ADM-015: pencarian teks antrean KYC */}
            <Input
              label="Cari pengajuan"
              placeholder="Nama / email / userId / KYC ID…"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") applySearch()
              }}
            />
            <Select
              label="Status"
              options={STATUS_OPTIONS}
              value={statusFilter}
              onChange={(e) => handleFilterChange({ status: e.target.value })}
            />
            <Select
              label="Kondisi SLA"
              options={SLA_OPTIONS}
              value={slaFilter}
              onChange={(e) => handleFilterChange({ sla: e.target.value as SlaFilter })}
            />
            <Select
              label="Umur antrean"
              options={AGE_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
              value={agePreset}
              onChange={(e) => handleFilterChange({ age: e.target.value as AgePreset })}
            />
            {/* ADM-019: filter reviewer */}
            <Select
              label="Reviewer"
              options={[
                { value: "ALL", label: "Semua" },
                { value: "UNASSIGNED", label: "Belum ditugaskan" },
                ...reviewers.map((r) => ({
                  value: r.id,
                  label: r.fullName ?? r.adminId,
                })),
              ]}
              value={reviewerFilter}
              onChange={(e) => handleFilterChange({ reviewer: e.target.value })}
            />
            <div className="flex items-end gap-2">
              <Button variant="primary" fullWidth={false} onClick={applySearch}>
                Cari
              </Button>
              <Button variant="secondary" fullWidth={false} onClick={exportCsv} disabled={rows.length === 0}>
                Ekspor CSV
              </Button>
              <Button variant="secondary" fullWidth={false} onClick={openSlaEdit}>
                Ubah SLA
              </Button>
            </div>
          </div>
        </CardBody>
      </Card>

      {selected.size > 0 && (
        <Card padded={false} className="mb-4 border-primary/40">
          <CardBody>
            <div className="flex flex-wrap items-center gap-3">
              <span className="text-body font-medium">
                {selected.size} dipilih{eligible.length !== selected.size ? ` (${eligible.length} berstatus PENDING saat dipilih)` : ""}
              </span>
              <Button variant="secondary" size="sm" fullWidth={false} onClick={toggleSelectPage}>
                {pageAllPendingSelected ? "Batalkan halaman ini" : "Pilih halaman ini"}
              </Button>
              <Button variant="primary" size="sm" fullWidth={false} disabled={eligible.length === 0} onClick={() => openBulk("approve")}>
                Setujui ({eligible.length})
              </Button>
              <Button variant="destructive" size="sm" fullWidth={false} disabled={eligible.length === 0} onClick={() => openBulk("reject")}>
                Tolak ({eligible.length})
              </Button>
              <Button variant="ghost" size="sm" fullWidth={false} onClick={clearSelection}>
                Bersihkan
              </Button>
              <span className="text-caption text-text-secondary">
                Maksimal {KYC_BULK_MAX} per aksi. Item yang statusnya berubah sejak dipilih dibatalkan otomatis.
              </span>
            </div>
          </CardBody>
        </Card>
      )}

      <Card padded={false}>
        <DataTable
          columns={columns}
          rows={rows}
          rowKey={(r) => r.kycId}
          loading={loading}
          emptyText={error ?? "Tidak ada pengajuan KYC yang cocok dengan filter."}
        />
      </Card>

      <div className="mt-4">
        <Pagination page={page} totalPages={totalPages} total={total} pageSize={PAGE_SIZE} onPageChange={handlePageChange} />
      </div>

      {/* Dialog bulk: konfirmasi ekstra untuk approve, alasan wajib + pratinjau dampak untuk reject */}
      <Dialog
        open={bulkMode !== null}
        onClose={() => setBulkMode(null)}
        title={bulkMode === "approve" ? `Setujui ${eligible.length} pengajuan?` : `Tolak ${eligible.length} pengajuan?`}
        description={
          bulkMode === "approve"
            ? "Pengguna yang disetujui langsung mendapat akses penuh fitur terverifikasi. Tindakan ini tercatat di audit log."
            : "Pengguna menerima pemberitahuan beserta alasan penolakan dan dapat mengajukan ulang. Tindakan ini tercatat di audit log."
        }
        footer={
          <div className="flex flex-col gap-2">
            {bulkMode === "approve" ? (
              <label className="flex items-start gap-2 text-body">
                <input
                  type="checkbox"
                  className="mt-1"
                  checked={approveAck}
                  onChange={(e) => setApproveAck(e.target.checked)}
                />
                <span>Saya sudah meninjau pilihan dan memahami dampak persetujuan massal ini.</span>
              </label>
            ) : (
              <TextArea
                label="Alasan penolakan"
                required
                rows={3}
                value={bulkReason}
                onChange={(e) => setBulkReason(e.target.value)}
                placeholder="Minimal 10 karakter…"
                hint={`${bulkReason.trim().length} / 10 karakter minimum`}
              />
            )}
            <Button
              variant={bulkMode === "reject" ? "destructive" : "primary"}
              loading={bulkRunning}
              disabled={
                bulkMode === "reject"
                  ? bulkReason.trim().length < 10
                  : !approveAck
              }
              onClick={handleBulkConfirm}
            >
              {bulkMode === "approve" ? `Ya, setujui ${eligible.length} pengajuan` : `Ya, tolak ${eligible.length} pengajuan`}
            </Button>
            <Button variant="ghost" disabled={bulkRunning} onClick={() => setBulkMode(null)}>
              Batal
            </Button>
          </div>
        }
      >
        {eligible.length === 0 ? (
          <p className="text-body text-text-secondary">Tidak ada item PENDING terpilih.</p>
        ) : (
          <p className="text-caption text-text-secondary">
            {eligible.length} item akan diproses. Status tiap item dicek ulang di backend
            (expectedStatus=PENDING) — yang berubah sejak daftar dimuat dibatalkan otomatis per ID.
          </p>
        )}
      </Dialog>

      {/* Hasil bulk per ID + retry yang gagal saja */}
      <Dialog
        open={outcome !== null}
        onClose={() => setOutcome(null)}
        title="Hasil aksi bulk"
        footer={
          <div className="flex flex-col gap-2">
            <Button variant="secondary" loading={copying} onClick={copySummary}>
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
            <p className="text-body">
              Berhasil: <strong className="text-success-text">{outcome.succeeded.length}</strong>
              {" · "}Gagal: <strong className="text-danger-text">{outcome.failed.length}</strong>
              {outcome.skipped.length > 0 ? ` · Dilewati: ${outcome.skipped.length}` : ""}
            </p>
            {outcome.failed.length > 0 && (
              <div>
                <p className="mb-2 text-body font-medium">Gagal diproses</p>
                <ul className="max-h-48 space-y-1 overflow-auto">
                  {outcome.failed.map((f) => (
                    <li key={f.id} className="text-caption">
                      <span className="font-mono font-medium">{f.id}</span>
                      <span className="text-text-secondary"> — {f.reason}</span>
                      {isTransientFailure(f.reason) && (
                        <Badge tone="info" dot={false} className="ml-2">bisa dicoba lagi</Badge>
                      )}
                    </li>
                  ))}
                </ul>
                {outcome.failed.some((f) => isTransientFailure(f.reason)) && (
                  <Button
                    variant="secondary"
                    fullWidth={false}
                    loading={bulkRunning}
                    onClick={handleRetryTransient}
                    className="mt-3"
                  >
                    Coba lagi yang gagal (sementara)
                  </Button>
                )}
              </div>
            )}
            {outcome.skipped.length > 0 && (
              <p className="text-caption text-text-secondary">
                Dilewati karena bukan PENDING saat dipilih: {outcome.skipped.slice(0, 5).join(", ")}
                {outcome.skipped.length > 5 ? ` (+${outcome.skipped.length - 5} lainnya)` : ""}.
              </p>
            )}
          </div>
        )}
      </Dialog>

      {/* Dialog ubah konfigurasi SLA */}
      <Dialog
        open={slaOpen}
        onClose={() => setSlaOpen(false)}
        title="Ubah konfigurasi SLA tinjauan"
        description="Perubahan tercatat di audit log beserta alasannya."
        footer={
          <div className="flex flex-col gap-2">
            <Button variant="primary" loading={slaSaving} onClick={saveSlaConfig}>
              Simpan
            </Button>
            <Button variant="ghost" disabled={slaSaving} onClick={() => setSlaOpen(false)}>
              Batal
            </Button>
          </div>
        }
      >
        <div className="space-y-4">
          <Select
            label="Cakupan"
            options={[
              { value: "KYC_PERSONAL", label: "KYC personal" },
              { value: "BUSINESS_VERIFICATION", label: "Verifikasi bisnis" },
            ]}
            value={slaScope}
            onChange={(e) => setSlaScope(e.target.value as SlaScope)}
          />
          <Input
            label="Batas SLA (jam, 1–720)"
            type="number"
            min={1}
            max={720}
            value={slaHoursInput}
            onChange={(e) => setSlaHoursInput(e.target.value)}
          />
          <label className="flex items-start gap-2 text-body">
            <input
              type="checkbox"
              className="mt-1"
              checked={slaBusinessInput}
              onChange={(e) => setSlaBusinessInput(e.target.checked)}
            />
            <span>
              Hitung dengan jam kerja (Senin–Jumat 09:00–17:00 WIB). Bila mati, SLA dihitung jam
              kalender.
            </span>
          </label>
          <TextArea
            label="Alasan perubahan"
            required
            rows={3}
            value={slaChangeReason}
            onChange={(e) => setSlaChangeReason(e.target.value)}
            placeholder="Contoh: Penyesuaian kapasitas tim KYC pada periode libur akhir tahun."
            hint={`${slaChangeReason.trim().length} / 10 karakter minimum`}
          />
        </div>
      </Dialog>
    </RoleGate>
  )
}
