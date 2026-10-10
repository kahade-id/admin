"use client"

/**
 * Admin — Detail laporan etalase (moderasi showcase).
 *
 * Menampilkan info item etalase + thumbnail, alasan & deskripsi pelapor,
 * status laporan, dan tombol aksi moderasi (Dismiss / Takedown / No action /
 * Tandai ditinjau) dengan dialog konfirmasi + catatan resolusi.
 */

import Link from "next/link"
import { useParams } from "next/navigation"
import { useCallback, useEffect, useState, type ReactNode } from "react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardBody, CardHeader } from "@/components/ui/card"
import { Dialog } from "@/components/ui/dialog"
import { EmptyState } from "@/components/ui/empty-state"
import { Field, Input, TextArea } from "@/components/ui/input"
import { Spinner } from "@/components/ui/spinner"
import { useToast } from "@/components/ui/toast"
import { RoleGate } from "@/components/admin/role-gate"
import { useAuth } from "@/lib/auth-context"
import {
  addModerationNote,
  assignShowcaseReport,
  decideAppeal,
  getRelatedReports,
  getReviewerSummary,
  getShowcaseReportDetail,
  getSnapshotDiff,
  reopenShowcaseReport,
  restrictShowcase,
  restoreTakedownShowcaseItem,
  reviewShowcaseReport,
  type ModerationEvent,
  type ReportAppeal,
  type ShowcaseReport,
  type ShowcaseReportAction,
  type ShowcaseReportDetailWithLifecycle,
  type SnapshotDiffResult,
} from "@/lib/api/admin/showcase-reports"
import { errorCode, userMessage } from "@/lib/api/response"
import { formatAge, formatDateTimeWIB, formatNumber } from "@/lib/format"

import {
  MODERATION_EVENT_ACTION_LABEL,
  RISK_TIER_LABEL,
  riskTierFromScore,
  RISK_TIER_TONE,
  SHOWCASE_REPORT_STATUS_LABEL,
  SHOWCASE_REPORT_STATUS_TONE,
} from "../maps"

/** Status final: backend menolak aksi lanjutan dengan 400. */
const FINAL_STATUSES = new Set([
  "RESOLVED_ACTION_TAKEN",
  "RESOLVED_NO_ACTION",
  "DISMISSED",
])

/** SH-A-017 — batas backend AddModerationNoteDto (MODERATION_NOTE_MAX_LENGTH). */
const MODERATION_NOTE_MAX_LENGTH = 2000

/** SH-A-005 — batas backend RESTRICT_MIN/MAX_DAYS. */
const RESTRICT_MIN_DAYS = 1
const RESTRICT_MAX_DAYS = 30

const ACTION_META: Record<
  ShowcaseReportAction,
  { title: string; description: string; confirmLabel: string; destructive?: boolean }
> = {
  dismiss: {
    title: "Tolak laporan",
    description: "Laporan ditolak. Status → DITOLAK.",
    confirmLabel: "Tolak laporan",
  },
  takedown: {
    title: "Takedown item",
    description:
      "Item etalase dinonaktifkan (isActive = false) dan tidak lagi tampil di publik. Status laporan → SELESAI (DITINDAK).",
    confirmLabel: "Takedown item",
    destructive: true,
  },
  no_action: {
    title: "Selesai tanpa tindakan",
    description: "Laporan ditutup tanpa tindakan terhadap item. Status → SELESAI (TANPA TINDAKAN).",
    confirmLabel: "Tutup tanpa tindakan",
  },
  under_review: {
    title: "Tandai ditinjau",
    description: "Laporan ditandai sedang ditinjau. Status → DITINJAU.",
    confirmLabel: "Tandai ditinjau",
  },
}

function KeyValue({ label, value, mono = false }: { label: string; value: ReactNode; mono?: boolean }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-2 border-b border-border py-2.5 last:border-b-0">
      <dt className="shrink-0 text-caption font-semibold text-text-secondary">{label}</dt>
      <dd
        className={
          mono
            ? "min-w-0 flex-1 break-all text-right font-mono text-[13px] text-text-primary"
            : "min-w-0 flex-1 text-right text-body text-text-primary"
        }
      >
        {value}
      </dd>
    </div>
  )
}

/** "Rp1.234.567" — price backend bisa number/string (BigInt diserialisasi). */
function formatPrice(v: unknown): string {
  const n = typeof v === "string" ? Number(v) : typeof v === "number" ? v : NaN
  if (!Number.isFinite(n)) return "—"
  return `Rp${formatNumber(Math.round(n))}`
}

/** SLA assignment lewat bila timestamp-nya sudah lampau. */
function isOverdue(iso: string | null | undefined): boolean {
  if (!iso) return false
  return new Date(iso).getTime() < Date.now()
}

export default function ShowcaseReportDetailPage() {
  const { id } = useParams<{ id: string }>()
  const toast = useToast()
  const { role, profile } = useAuth()
  const isSuperAdmin = role === "SUPER_ADMIN"

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  // SH-A-018 — pakai tipe dari lib, bukan duplikasi inline.
  const [report, setReport] = useState<ShowcaseReportDetailWithLifecycle | null>(
    null,
  )

  const [dialogAction, setDialogAction] = useState<ShowcaseReportAction | null>(null)
  const [resolution, setResolution] = useState("")
  const [acting, setActing] = useState(false)

  // GAP-F: lifecycle pasca-final
  const [showReopen, setShowReopen] = useState(false)
  const [reopenReason, setReopenReason] = useState("")
  const [showNote, setShowNote] = useState(false)
  const [noteText, setNoteText] = useState("")
  const [related, setRelated] = useState<ShowcaseReport[] | null>(null)
  const [diff, setDiff] = useState<SnapshotDiffResult | null>(null)
  const [decidingAppeal, setDecidingAppeal] = useState<string | null>(null)
  // SH-A-012 — catatan putusan per-appeal (bukan satu state bersama).
  const [decisionNotes, setDecisionNotes] = useState<Record<string, string>>({})

  // SH-A-015 — loading state per panel lazy-load.
  const [loadingRelated, setLoadingRelated] = useState(false)
  const [loadingDiff, setLoadingDiff] = useState(false)
  const [loadingSummary, setLoadingSummary] = useState(false)

  // SH-A-005 — batasi sementara (restrict G423).
  const [showRestrict, setShowRestrict] = useState(false)
  const [restrictDays, setRestrictDays] = useState(7)
  const [restrictReason, setRestrictReason] = useState("")

  // SH-A-003 — batalkan takedown (restore).
  const [showRestore, setShowRestore] = useState(false)
  const [restoreNote, setRestoreNote] = useState("")

  // SH-A-006 — assign / handoff.
  const [showAssign, setShowAssign] = useState(false)
  const [assignAdminId, setAssignAdminId] = useState("")

  // SH-A-021 — thumbnail rusak → placeholder.
  const [imgError, setImgError] = useState(false)

  /**
   * SH-A-016 — panel related/diff memuat snapshot pra-aksi; reset setelah
   * aksi moderasi berhasil agar tidak menampilkan data basi.
   */
  const resetPanelCaches = useCallback(() => {
    setRelated(null)
    setDiff(null)
    setImgError(false)
  }, [])

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const detail = await getShowcaseReportDetail(id)
      setReport(detail)
    } catch (e) {
      const msg = userMessage(e)
      setError(msg)
      toast.show({ title: "Gagal memuat laporan", description: msg, tone: "danger" })
    } finally {
      setLoading(false)
    }
  }, [id, toast])

  useEffect(() => {
    void load()
  }, [load])

  const handleAction = async () => {
    if (!dialogAction) return
    // ADM-320: takedown = permanen → catatan resolusi WAJIB min. 10 karakter
    // (backend juga memvalidasi — fail closed).
    if (dialogAction === "takedown" && resolution.trim().length < 10) {
      toast.show({
        title: "Catatan resolusi wajib",
        description: "Takedown bersifat permanen — tulis alasan minimal 10 karakter.",
        tone: "danger",
      })
      return
    }
    setActing(true)
    try {
      const res = await reviewShowcaseReport(id, {
        action: dialogAction,
        resolution: resolution.trim() || undefined,
      })
      // BAI-036 — beri tahu bila laporan lain se-item ikut diselesaikan otomatis.
      const extra =
        typeof res.relatedReportsResolved === "number" && res.relatedReportsResolved > 0
          ? ` ${res.relatedReportsResolved} laporan lain untuk item yang sama ikut diselesaikan otomatis.`
          : ""
      toast.show({
        title: "Berhasil",
        description: `${res.message ?? "Aksi moderasi berhasil."}${extra}`,
        tone: "success",
      })
      setDialogAction(null)
      setResolution("")
      resetPanelCaches()
      await load()
    } catch (e) {
      if (await recoverStaleReport(e)) return
      const msg = userMessage(e)
      toast.show({ title: "Aksi gagal", description: msg, tone: "danger" })
    } finally {
      setActing(false)
    }
  }

  const isFinal = report ? FINAL_STATUSES.has(report.status) : false
  const itemActive = report?.showcase?.isActive === true
  const dialogMeta = dialogAction ? ACTION_META[dialogAction] : null
  const events = report?.moderationEvents ?? []
  const appeals = report?.appeals ?? []
  const assignment = report?.activeAssignment ?? null
  // SH-A-003 — restore hanya relevan bila item pernah di-takedown & masih nonaktif.
  const wasTakedown = events.some((e) => e.action === "TAKEDOWN")
  // SH-A-011 — reviewer banding tidak boleh = moderator keputusan awal.
  // ADM-04 (audit etalase 2026-10-10): `reviewedBy` = admin_users.id (cuid,
  // JWT sub) — bandingkan dengan `profile.id`, BUKAN kode tampilan
  // `profile.adminId` ("ADM-001") yang tidak pernah cocok → peringatan
  // konflik reviewer tidak pernah muncul dan backend menolak 422 belakangan.
  const isOriginalReviewer = !!profile?.id && profile.id === report?.reviewedBy
  const assignmentOverdue = isOverdue(assignment?.slaDueAt)
  // ADM-05: backend hanya mengirim riskScore pada activeAssignment.
  const assignmentTier = assignment
    ? (assignment.riskTier ??
      (typeof assignment.riskScore === "number" ? riskTierFromScore(assignment.riskScore) : null))
    : null
  /**
   * ADM-17: OCC backend — status laporan berubah sejak dimuat (admin lain
   * sudah menindak) → 400 REPORT_ALREADY_RESOLVED. Muat ulang, jangan hanya
   * menampilkan pesan Inggris mentah "Report state changed".
   */
  const recoverStaleReport = async (e: unknown): Promise<boolean> => {
    if (errorCode(e) !== "REPORT_ALREADY_RESOLVED") return false
    toast.show({
      title: "Laporan sudah berubah",
      description: "Status laporan berubah di server (ditinjau admin lain). Data dimuat ulang.",
      tone: "danger",
    })
    setDialogAction(null)
    setShowReopen(false)
    resetPanelCaches()
    await load()
    return true
  }

  const handleReopen = async () => {
    if (reopenReason.trim().length < 10) {
      toast.show({
        title: "Alasan terlalu pendek",
        description: "Alasan pembukaan kembali minimal 10 karakter.",
        tone: "danger",
      })
      return
    }
    setActing(true)
    try {
      const res = await reopenShowcaseReport(id, { reason: reopenReason.trim() })
      toast.show({ title: "Berhasil", description: res.message ?? "Laporan dibuka kembali.", tone: "success" })
      setShowReopen(false)
      setReopenReason("")
      resetPanelCaches()
      await load()
    } catch (e) {
      if (await recoverStaleReport(e)) return
      toast.show({ title: "Gagal membuka kembali", description: userMessage(e), tone: "danger" })
    } finally {
      setActing(false)
    }
  }

  const handleAddNote = async () => {
    if (!noteText.trim()) {
      toast.show({ title: "Catatan kosong", description: "Tulis catatan terlebih dahulu.", tone: "danger" })
      return
    }
    setActing(true)
    try {
      await addModerationNote(id, { note: noteText.trim() })
      toast.show({ title: "Berhasil", description: "Catatan moderasi ditambahkan.", tone: "success" })
      setShowNote(false)
      setNoteText("")
      resetPanelCaches()
      await load()
    } catch (e) {
      toast.show({ title: "Gagal menambah catatan", description: userMessage(e), tone: "danger" })
    } finally {
      setActing(false)
    }
  }

  const handleDecideAppeal = async (appealId: string, decision: "APPROVED" | "REJECTED") => {
    const note = (decisionNotes[appealId] ?? "").trim()
    if (note.length < 10) {
      toast.show({
        title: "Catatan putusan wajib",
        description: "Tulis alasan putusan minimal 10 karakter.",
        tone: "danger",
      })
      return
    }
    setDecidingAppeal(appealId)
    try {
      await decideAppeal(appealId, { decision, decisionNote: note })
      toast.show({
        title: "Berhasil",
        description: decision === "APPROVED" ? "Banding disetujui — item dipulihkan." : "Banding ditolak.",
        tone: "success",
      })
      setDecisionNotes((prev) => {
        const next = { ...prev }
        delete next[appealId]
        return next
      })
      resetPanelCaches()
      await load()
    } catch (e) {
      if (await recoverStaleReport(e)) return
      toast.show({ title: "Gagal memutus banding", description: userMessage(e), tone: "danger" })
    } finally {
      setDecidingAppeal(null)
    }
  }

  const loadRelated = async () => {
    if (loadingRelated) return
    setLoadingRelated(true)
    try {
      const res = await getRelatedReports(id)
      // SH-A-001 — backend mengirim key `reports`, bukan `related`.
      setRelated(res.reports ?? [])
    } catch (e) {
      toast.show({ title: "Gagal memuat laporan terkait", description: userMessage(e), tone: "danger" })
    } finally {
      setLoadingRelated(false)
    }
  }

  const loadDiff = async () => {
    if (loadingDiff) return
    setLoadingDiff(true)
    try {
      const res = await getSnapshotDiff(id)
      setDiff(res)
    } catch (e) {
      toast.show({ title: "Gagal memuat diff", description: userMessage(e), tone: "danger" })
    } finally {
      setLoadingDiff(false)
    }
  }

  const loadReviewerSummary = async () => {
    if (loadingSummary) return
    setLoadingSummary(true)
    try {
      const res = await getReviewerSummary(id)
      // SH-A-004 — backend mengirim `itemSnapshot` / `moderationEvents`,
      // bukan `snapshot` / `events`.
      const eventCount = Array.isArray(res.moderationEvents) ? res.moderationEvents.length : 0
      const appealCount = Array.isArray(res.appeals) ? res.appeals.length : 0
      toast.show({
        title: "Ringkasan reviewer",
        description: `Snapshot: ${res.itemSnapshot ? "ada" : "tidak ada"} (${res.snapshotSource ?? "—"}), event: ${eventCount}, banding: ${appealCount}.`,
        tone: "info",
      })
    } catch (e) {
      toast.show({ title: "Gagal memuat ringkasan", description: userMessage(e), tone: "danger" })
    } finally {
      setLoadingSummary(false)
    }
  }

  // SH-A-005 — batasi sementara (G423): default aman pengganti takedown permanen.
  const handleRestrict = async () => {
    const days = Math.floor(Number(restrictDays))
    if (!Number.isFinite(days) || days < RESTRICT_MIN_DAYS || days > RESTRICT_MAX_DAYS) {
      toast.show({
        title: "Durasi tidak valid",
        description: `Durasi ${RESTRICT_MIN_DAYS}–${RESTRICT_MAX_DAYS} hari.`,
        tone: "danger",
      })
      return
    }
    if (restrictReason.trim().length < 10) {
      toast.show({
        title: "Alasan wajib",
        description: "Tulis alasan pembatasan minimal 10 karakter.",
        tone: "danger",
      })
      return
    }
    setActing(true)
    try {
      const res = await restrictShowcase(id, {
        days,
        reason: restrictReason.trim(),
      })
      toast.show({
        title: "Item dibatasi sementara",
        description: `${res.message ?? "Berhasil."} Auto-restore: ${res.restrictUntil ? formatDateTimeWIB(res.restrictUntil) : "—"}.`,
        tone: "success",
      })
      setShowRestrict(false)
      setRestrictReason("")
      resetPanelCaches()
      await load()
    } catch (e) {
      toast.show({ title: "Gagal membatasi item", description: userMessage(e), tone: "danger" })
    } finally {
      setActing(false)
    }
  }

  // SH-A-003 — batalkan takedown (restore item). Backend mencatat event
  // RESTORED; endpoint mungkin belum tersedia → 404 ditangani graceful.
  const handleRestoreTakedown = async () => {
    const itemId = report?.showcaseId
    if (!itemId) {
      toast.show({ title: "Tidak bisa restore", description: "ID item tidak tersedia.", tone: "danger" })
      return
    }
    setActing(true)
    try {
      const res = await restoreTakedownShowcaseItem(itemId)
      // Catatan audit client-side: tempelkan konteks restore ke riwayat
      // catatan moderasi bila admin menulisnya (best-effort).
      if (restoreNote.trim()) {
        try {
          await addModerationNote(id, {
            note: `[restore-takedown] ${restoreNote.trim().slice(0, MODERATION_NOTE_MAX_LENGTH - 20)}`,
          })
        } catch {
          /* catatan opsional — kegagalan tidak menggagalkan restore */
        }
      }
      toast.show({
        title: "Takedown dibatalkan",
        description: res.ok ? "Item dipulihkan dan tampil kembali." : "Restore selesai.",
        tone: "success",
      })
      setShowRestore(false)
      setRestoreNote("")
      resetPanelCaches()
      await load()
    } catch (e) {
      const status = (e as { status?: number }).status
      if (status === 404) {
        // ADM-323: endpoint restore SUDAH ada (SH-A-003); 404 kini berarti
        // item tidak ditemukan / bukan hasil takedown — pesan generik.
        toast.show({ title: "Item tidak ditemukan", description: userMessage(e), tone: "danger" })
      } else {
        toast.show({ title: "Gagal membatalkan takedown", description: userMessage(e), tone: "danger" })
      }
    } finally {
      setActing(false)
    }
  }

  // SH-A-006 — assign / handoff (kosong = auto-assign by beban backend).
  const handleAssign = async () => {
    setActing(true)
    try {
      const res = await assignShowcaseReport(id, {
        assigneeAdminId: assignAdminId.trim() || null,
      })
      toast.show({
        title: "Laporan ditugaskan",
        description: `${res.message ?? "Berhasil."} Risiko ${res.riskTier ?? "—"}, SLA ${res.slaDueAt ? formatDateTimeWIB(res.slaDueAt) : "—"}.`,
        tone: "success",
      })
      setShowAssign(false)
      setAssignAdminId("")
      await load()
    } catch (e) {
      toast.show({ title: "Gagal menugaskan", description: userMessage(e), tone: "danger" })
    } finally {
      setActing(false)
    }
  }

  return (
    <RoleGate href="/reports/showcase">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <Link
            href="/reports/showcase"
            className="text-caption text-info-text hover:underline"
          >
            ← Kembali ke daftar
          </Link>
          <h1 className="mt-1 text-h2 font-bold text-text-primary">
            Tinjau Laporan Etalase
          </h1>
          <p className="mt-1 text-body text-text-secondary">
            Moderasi laporan pengguna terhadap item etalase.
          </p>
        </div>
        {report && !isFinal ? (
          <div className="flex flex-wrap gap-2">
            {report.status === "PENDING" ? (
              <Button
                variant="secondary"
                size="sm"
                fullWidth={false}
                onClick={() => setDialogAction("under_review")}
              >
                Tandai ditinjau
              </Button>
            ) : null}
            <Button
              variant="secondary"
              size="sm"
              fullWidth={false}
              onClick={() => setDialogAction("no_action")}
            >
              No action
            </Button>
            <Button
              variant="secondary"
              size="sm"
              fullWidth={false}
              onClick={() => setDialogAction("dismiss")}
            >
              Dismiss
            </Button>
            {itemActive ? (
              <Button
                variant="secondary"
                size="sm"
                fullWidth={false}
                onClick={() => setShowRestrict(true)}
              >
                Batasi sementara
              </Button>
            ) : null}
            {itemActive && isSuperAdmin ? (
              <Button
                variant="primary"
                size="sm"
                fullWidth={false}
                onClick={() => setDialogAction("takedown")}
              >
                Takedown
              </Button>
            ) : null}
            <Button
              variant="ghost"
              size="sm"
              fullWidth={false}
              onClick={() => setShowAssign(true)}
            >
              Assign / Handoff
            </Button>
            <Button
              variant="ghost"
              size="sm"
              fullWidth={false}
              onClick={() => setShowNote(true)}
            >
              Tambah catatan
            </Button>
          </div>
        ) : report && isFinal ? (
          <div className="flex flex-wrap gap-2">
            <Button
              variant="ghost"
              size="sm"
              fullWidth={false}
              onClick={() => setShowNote(true)}
            >
              Tambah catatan
            </Button>
            {isSuperAdmin && wasTakedown && !itemActive ? (
              <Button
                variant="secondary"
                size="sm"
                fullWidth={false}
                onClick={() => setShowRestore(true)}
              >
                Batalkan takedown
              </Button>
            ) : null}
            {isSuperAdmin ? (
              <Button
                variant="secondary"
                size="sm"
                fullWidth={false}
                onClick={() => setShowReopen(true)}
              >
                Buka kembali (reopen)
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>
      {report && !isFinal && !isSuperAdmin ? (
        <p className="mb-4 text-caption text-text-secondary">
          Takedown permanen hanya untuk Super Admin — untuk kasus ringan gunakan
          “Batasi sementara”.
        </p>
      ) : null}

      {loading ? (
        <div className="flex min-h-[40vh] items-center justify-center gap-2">
          <Spinner size="md" />
          <p className="text-body text-text-secondary">Memuat laporan…</p>
        </div>
      ) : error ? (
        <Card>
          <EmptyState
            title="Gagal memuat laporan"
            description={error}
            action={
              <Button variant="secondary" fullWidth={false} onClick={() => load()}>
                Coba lagi
              </Button>
            }
          />
        </Card>
      ) : report ? (
        <div className="flex flex-col gap-6">
          {isFinal ? (
            <Card>
              <p className="text-body text-text-secondary">
                Laporan ini sudah{" "}
                <Badge tone={SHOWCASE_REPORT_STATUS_TONE[report.status] ?? "neutral"}>
                  {SHOWCASE_REPORT_STATUS_LABEL[report.status] ?? report.status}
                </Badge>{" "}
                {report.reviewedAt ? `pada ${formatDateTimeWIB(report.reviewedAt)}` : ""}
                {report.reviewedByAdmin?.fullName
                  ? ` oleh ${report.reviewedByAdmin.fullName}`
                  : ""}
                . Aksi moderasi lanjutan tidak tersedia.
              </p>
              {report.resolution ? (
                <p className="mt-2 text-body text-text-primary">
                  <span className="font-semibold">Catatan resolusi: </span>
                  {report.resolution}
                </p>
              ) : null}
            </Card>
          ) : null}

          <div className="grid gap-6 lg:grid-cols-2">
            <Card padded={false}>
              <CardHeader title="Item etalase" />
              <CardBody>
                <div className="flex gap-4">
                  {report.showcase?.images?.[0]?.imageUrl && !imgError ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={report.showcase.images[0].imageUrl}
                      alt={report.showcase.title ?? "Thumbnail item etalase"}
                      className="h-32 w-32 shrink-0 rounded-sm border border-border object-cover"
                      onError={() => setImgError(true)}
                    />
                  ) : (
                    <div className="flex h-32 w-32 shrink-0 items-center justify-center rounded-sm border border-border bg-surface-elevated text-caption text-text-tertiary">
                      Tanpa gambar
                    </div>
                  )}
                  <div className="min-w-0">
                    <p className="text-h3 font-semibold text-text-primary">
                      {report.showcase?.title ?? "—"}
                    </p>
                    <p className="mt-1 text-caption text-text-secondary">
                      {report.showcase?.user
                        ? `oleh ${report.showcase.user.fullName ?? report.showcase.user.username ?? "—"}`
                        : "—"}
                    </p>
                    <div className="mt-2">
                      {itemActive ? (
                        <Badge tone="success">Aktif</Badge>
                      ) : (
                        <Badge tone="danger">Nonaktif</Badge>
                      )}
                    </div>
                  </div>
                </div>
                <dl className="mt-4">
                  <KeyValue
                    label="Kategori"
                    value={report.showcase?.category ?? "—"}
                  />
                  <KeyValue
                    label="Harga"
                    value={
                      report.showcase?.priceMin != null || report.showcase?.priceMax != null
                        ? `${formatPrice(report.showcase?.priceMin)} – ${formatPrice(report.showcase?.priceMax)}`
                        : "—"
                    }
                  />
                  <KeyValue
                    label="Suka / Komentar"
                    value={`${formatNumber(report.showcase?.likeCount ?? 0)} / ${formatNumber(report.showcase?.commentCount ?? 0)}`}
                  />
                  <KeyValue
                    label="Visibilitas"
                    value={report.showcase?.visibility ?? "—"}
                  />
                  <KeyValue
                    label="ID item"
                    value={report.showcaseId}
                    mono
                  />
                </dl>
                {report.showcase?.description ? (
                  <p className="mt-3 text-body text-text-secondary">
                    {report.showcase.description}
                  </p>
                ) : null}
              </CardBody>
            </Card>

            <Card padded={false}>
              <CardHeader title="Laporan" />
              <CardBody>
                <dl>
                  <KeyValue
                    label="Pelapor"
                    value={
                      report.reporter
                        ? `${report.reporter.fullName ?? "—"}${report.reporter.username ? ` (@${report.reporter.username})` : ""}`
                        : "—"
                    }
                  />
                  <KeyValue label="Alasan" value={report.reason} />
                  <KeyValue
                    label="Status"
                    value={
                      <Badge tone={SHOWCASE_REPORT_STATUS_TONE[report.status] ?? "neutral"}>
                        {SHOWCASE_REPORT_STATUS_LABEL[report.status] ?? report.status}
                      </Badge>
                    }
                  />
                  <KeyValue
                    label="Dilaporkan"
                    value={`${formatAge(report.createdAt)} (${formatDateTimeWIB(report.createdAt)})`}
                  />
                  <KeyValue
                    label="ID laporan"
                    value={report.id}
                    mono
                  />
                </dl>
                <div className="mt-4">
                  <p className="text-caption font-semibold text-text-secondary">
                    Deskripsi pelapor
                  </p>
                  <p className="mt-1 whitespace-pre-wrap rounded-sm border border-border bg-surface-elevated p-3 text-body text-text-primary">
                    {report.description?.trim() || "—"}
                  </p>
                </div>
              </CardBody>
            </Card>
          </div>

          {/* SH-A-006 — kartu penugasan aktif (assignee, SLA, risk tier) */}
          <Card padded={false}>
            <CardHeader
              title="Penugasan"
              action={
                <Button
                  variant="ghost"
                  size="sm"
                  fullWidth={false}
                  onClick={() => setShowAssign(true)}
                >
                  Assign / Handoff
                </Button>
              }
            />
            <CardBody>
              {assignment ? (
                <dl>
                  <KeyValue
                    label="Ditugaskan ke"
                    value={assignment.assigneeAdminId}
                    mono
                  />
                  <KeyValue
                    label="Sejak"
                    value={formatDateTimeWIB(assignment.assignedAt)}
                  />
                  <KeyValue
                    label="Batas SLA"
                    value={
                      assignment.slaDueAt ? (
                        <span className="flex items-center justify-end gap-2">
                          {assignmentOverdue ? (
                            <Badge tone="danger">Overdue</Badge>
                          ) : null}
                          {formatDateTimeWIB(assignment.slaDueAt)}
                        </span>
                      ) : (
                        "—"
                      )
                    }
                  />
                  <KeyValue
                    label="Tingkat risiko"
                    value={
                      assignmentTier ? (
                        <span className="flex items-center justify-end gap-2">
                          <Badge tone={RISK_TIER_TONE[assignmentTier] ?? "neutral"}>
                            {RISK_TIER_LABEL[assignmentTier] ?? assignmentTier}
                          </Badge>
                          {assignment.riskScore != null ? (
                            <span className="tabular-nums">skor {assignment.riskScore}</span>
                          ) : null}
                        </span>
                      ) : (
                        "—"
                      )
                    }
                  />
                </dl>
              ) : (
                <p className="text-body text-text-secondary">
                  Belum ditugaskan. Gunakan “Assign / Handoff” untuk menugaskan
                  ke admin tertentu, atau kosongkan ID admin untuk auto-assign
                  berdasarkan beban antrean.
                </p>
              )}
            </CardBody>
          </Card>

          {/* GAP-F G420 — histori semua aksi moderasi (append-only) */}
          <Card padded={false}>
            <CardHeader title={`Histori moderasi (${events.length})`} />
            <CardBody>
              {events.length === 0 ? (
                <p className="text-body text-text-secondary">Belum ada aksi moderasi tercatat.</p>
              ) : (
                <ol className="flex flex-col gap-2">
                  {events.map((ev: ModerationEvent) => (
                    <li
                      key={ev.id}
                      className="flex flex-wrap items-baseline justify-between gap-2 border-b border-border py-2 last:border-b-0"
                    >
                      <div className="min-w-0">
                        <Badge tone="neutral">{MODERATION_EVENT_ACTION_LABEL[ev.action] ?? ev.action}</Badge>
                        {ev.stateFrom || ev.stateTo ? (
                          <span className="ml-2 text-caption text-text-secondary">
                            {ev.stateFrom ?? "—"} → {ev.stateTo ?? "—"}
                          </span>
                        ) : null}
                        {ev.reasonCode ? (
                          <span className="ml-2 text-caption text-text-secondary">
                            [{ev.reasonCode}]
                          </span>
                        ) : null}
                        {ev.note ? (
                          <p className="mt-1 text-body text-text-primary">{ev.note}</p>
                        ) : null}
                      </div>
                      <div className="text-right text-caption text-text-secondary">
                        <p>{ev.actorAdminName ?? ev.actorAdminId ?? "Sistem"}</p>
                        <p>{formatDateTimeWIB(ev.createdAt)}</p>
                      </div>
                    </li>
                  ))}
                </ol>
              )}
            </CardBody>
          </Card>

          {/* GAP-F G404–G408 — panel banding */}
          {appeals.length > 0 ? (
            <Card padded={false}>
              <CardHeader title={`Banding (${appeals.length})`} />
              <CardBody>
                {/* SH-A-011 — keputusan awal agar reviewer tahu siapa moderator sebelumnya. */}
                {report.reviewedByAdmin?.fullName || report.reviewedBy ? (
                  <p className="mb-4 text-caption text-text-secondary">
                    Keputusan awal oleh{" "}
                    <span className="font-semibold text-text-primary">
                      {report.reviewedByAdmin?.fullName ?? report.reviewedBy}
                    </span>
                    {report.reviewedAt ? ` pada ${formatDateTimeWIB(report.reviewedAt)}` : ""}.
                    {isOriginalReviewer
                      ? " Anda adalah moderator awal — minta reviewer lain memutus banding."
                      : ""}
                  </p>
                ) : null}
                <div className="flex flex-col gap-4">
                  {appeals.map((ap: ReportAppeal) => (
                    <div key={ap.id} className="rounded-sm border border-border p-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div>
                          <Badge tone={ap.status === "PENDING" ? "warning" : ap.status === "APPROVED" ? "success" : "danger"}>
                            {ap.status}
                          </Badge>
                          <span className="ml-2 text-caption text-text-secondary">
                            {ap.appellantType === "OWNER" ? "Pemilik item" : "Pelapor"} • {formatDateTimeWIB(ap.createdAt)}
                          </span>
                        </div>
                      </div>
                      <p className="mt-2 text-body text-text-primary">
                        <span className="font-semibold">Alasan: </span>
                        {ap.reason}
                      </p>
                      {/* SH-A-020 — bukti baru banding. */}
                      {ap.newEvidence != null && String(ap.newEvidence).trim() !== "" ? (
                        <p className="mt-2 rounded-sm border border-border bg-surface-elevated p-2 text-body text-text-primary">
                          <span className="font-semibold">Bukti baru: </span>
                          {typeof ap.newEvidence === "string"
                            ? ap.newEvidence
                            : JSON.stringify(ap.newEvidence).slice(0, 500)}
                        </p>
                      ) : null}
                      {ap.decisionNote ? (
                        <p className="mt-1 text-body text-text-secondary">
                          <span className="font-semibold">Putusan: </span>
                          {ap.decisionNote}
                        </p>
                      ) : null}
                      {ap.status === "PENDING" ? (
                        <div className="mt-3 flex flex-col gap-2">
                          <TextArea
                            label="Catatan putusan (wajib, min. 10 karakter)"
                            value={decisionNotes[ap.id] ?? ""}
                            onChange={(e) =>
                              setDecisionNotes((prev) => ({ ...prev, [ap.id]: e.target.value }))
                            }
                            rows={2}
                            placeholder="Alasan mempertahankan / membalikkan keputusan…"
                          />
                          <div className="flex flex-wrap items-center gap-2">
                            <Button
                              variant="primary"
                              size="sm"
                              fullWidth={false}
                              loading={decidingAppeal === ap.id}
                              disabled={isOriginalReviewer}
                              onClick={() => void handleDecideAppeal(ap.id, "APPROVED")}
                            >
                              Setujui (pulihkan item)
                            </Button>
                            <Button
                              variant="destructive"
                              size="sm"
                              fullWidth={false}
                              loading={decidingAppeal === ap.id}
                              disabled={isOriginalReviewer}
                              onClick={() => void handleDecideAppeal(ap.id, "REJECTED")}
                            >
                              Tolak
                            </Button>
                            {isOriginalReviewer ? (
                              <span className="text-caption text-warning-text">
                                Anda moderator awal — putusan harus oleh reviewer lain.
                              </span>
                            ) : null}
                          </div>
                        </div>
                      ) : null}
                    </div>
                  ))}
                </div>
              </CardBody>
            </Card>
          ) : null}

          {/* GAP-F G409/G410/G414 — diff snapshot & laporan terkait */}
          <div className="grid gap-6 lg:grid-cols-2">
            <Card padded={false}>
              <CardHeader
                title="Perubahan item sejak keputusan"
                action={
                  <Button
                    variant="ghost"
                    size="sm"
                    fullWidth={false}
                    loading={loadingDiff}
                    disabled={loadingDiff}
                    onClick={() => void loadDiff()}
                  >
                    Muat diff
                  </Button>
                }
              />
              <CardBody>
                {diff === null ? (
                  <p className="text-body text-text-secondary">
                    Bandingkan snapshot saat keputusan final dengan kondisi item saat ini.
                  </p>
                ) : diff.itemDeleted ? (
                  <p className="text-body text-text-secondary">
                    Item sudah dihapus setelah snapshot keputusan diambil.
                  </p>
                ) : diff.changedFields.length === 0 ? (
                  <p className="text-body text-text-secondary">Tidak ada perubahan terdeteksi.</p>
                ) : (
                  <dl>
                    {diff.changedFields.map((c) => (
                      <KeyValue
                        key={c.field}
                        label={c.field}
                        value={`${String(c.snapshot ?? "—")} → ${String(c.current ?? "—")}`}
                        mono
                      />
                    ))}
                  </dl>
                )}
              </CardBody>
            </Card>
            <Card padded={false}>
              <CardHeader
                title="Laporan terkait"
                action={
                  <Button
                    variant="ghost"
                    size="sm"
                    fullWidth={false}
                    loading={loadingRelated}
                    disabled={loadingRelated}
                    onClick={() => void loadRelated()}
                  >
                    Muat
                  </Button>
                }
              />
              <CardBody>
                {related === null ? (
                  <p className="text-body text-text-secondary">
                    Laporan lain untuk item atau pemilik yang sama.
                  </p>
                ) : related.length === 0 ? (
                  <p className="text-body text-text-secondary">Tidak ada laporan terkait.</p>
                ) : (
                  <ul className="flex flex-col gap-2">
                    {related.map((r) => (
                      <li key={r.id} className="border-b border-border py-2 last:border-b-0">
                        <Link
                          href={`/reports/showcase/${r.id}`}
                          className="text-body text-info-text hover:underline"
                        >
                          {r.reason}
                        </Link>
                        <span className="ml-2">
                          <Badge tone={SHOWCASE_REPORT_STATUS_TONE[r.status] ?? "neutral"}>
                            {SHOWCASE_REPORT_STATUS_LABEL[r.status] ?? r.status}
                          </Badge>
                        </span>
                        <p className="text-caption text-text-secondary">
                          {formatDateTimeWIB(r.createdAt)}
                        </p>
                      </li>
                    ))}
                  </ul>
                )}
              </CardBody>
            </Card>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button
              variant="ghost"
              size="sm"
              fullWidth={false}
              loading={loadingSummary}
              disabled={loadingSummary}
              onClick={() => void loadReviewerSummary()}
            >
              Ringkasan untuk reviewer kedua
            </Button>
          </div>
        </div>
      ) : null}

      <Dialog
        open={dialogAction !== null}
        onClose={() => {
          if (!acting) {
            setDialogAction(null)
            setResolution("")
          }
        }}
        title={dialogMeta?.title ?? "Konfirmasi aksi"}
        description={dialogMeta?.description}
        footer={
          <div className="flex flex-col gap-3">
            {dialogAction === "takedown" ? (
              <p className="rounded-sm border border-warning/40 bg-warning/10 p-2.5 text-caption text-text-primary">
                {/* BAI-036 — peringatan: laporan PENDING lain untuk item yang
                    sama ikut diselesaikan otomatis oleh takedown ini. */}
                Perhatian: laporan lain yang masih terbuka untuk item yang sama
                akan otomatis ikut diselesaikan (ditindak) oleh takedown ini.
              </p>
            ) : null}
            <TextArea
              // ADM-320: wajib min. 10 char khusus untuk takedown.
              label={dialogAction === "takedown" ? "Catatan resolusi (WAJIB — min. 10 karakter)" : "Catatan resolusi (opsional)"}
              value={resolution}
              onChange={(e) => setResolution(e.target.value)}
              placeholder="Catatan internal untuk keputusan moderasi…"
              rows={3}
            />
            <div className="flex justify-end gap-2">
              <Button
                variant="ghost"
                fullWidth={false}
                disabled={acting}
                onClick={() => {
                  setDialogAction(null)
                  setResolution("")
                }}
              >
                Batal
              </Button>
              <Button
                variant={dialogMeta?.destructive ? "destructive" : "primary"}
                fullWidth={false}
                loading={acting}
                onClick={() => void handleAction()}
              >
                {dialogMeta?.confirmLabel ?? "Konfirmasi"}
              </Button>
            </div>
          </div>
        }
      />

      {/* GAP-F G401 — dialog reopen (SUPER_ADMIN saja; backend juga guard 403) */}
      <Dialog
        open={showReopen}
        onClose={() => {
          if (!acting) {
            setShowReopen(false)
            setReopenReason("")
          }
        }}
        title="Buka kembali laporan"
        description="Laporan final akan kembali ke UNDER_REVIEW. Alasan manual wajib (min. 10 karakter)."
        footer={
          <div className="flex flex-col gap-3">
            <TextArea
              label="Alasan pembukaan kembali (wajib)"
              value={reopenReason}
              onChange={(e) => setReopenReason(e.target.value)}
              placeholder="Contoh: bukti baru dari pemilik item memerlukan tinjauan ulang…"
              rows={3}
            />
            <div className="flex justify-end gap-2">
              <Button
                variant="ghost"
                fullWidth={false}
                disabled={acting}
                onClick={() => {
                  setShowReopen(false)
                  setReopenReason("")
                }}
              >
                Batal
              </Button>
              <Button
                variant="primary"
                fullWidth={false}
                loading={acting}
                onClick={() => void handleReopen()}
              >
                Buka kembali
              </Button>
            </div>
          </div>
        }
      />

      {/* GAP-F G402 — dialog tambah catatan (append-only) */}
      <Dialog
        open={showNote}
        onClose={() => {
          if (!acting) {
            setShowNote(false)
            setNoteText("")
          }
        }}
        title="Tambah catatan moderasi"
        description="Catatan ditambahkan ke riwayat tanpa menimpa resolusi awal."
        footer={
          <div className="flex flex-col gap-3">
            <div>
              <TextArea
                label="Catatan"
                value={noteText}
                onChange={(e) => setNoteText(e.target.value)}
                placeholder="Catatan internal moderator…"
                rows={3}
                maxLength={MODERATION_NOTE_MAX_LENGTH}
              />
              <p className="mt-1 text-right text-caption text-text-tertiary tabular-nums">
                {noteText.length}/{MODERATION_NOTE_MAX_LENGTH}
              </p>
            </div>
            <div className="flex justify-end gap-2">
              <Button
                variant="ghost"
                fullWidth={false}
                disabled={acting}
                onClick={() => {
                  setShowNote(false)
                  setNoteText("")
                }}
              >
                Batal
              </Button>
              <Button
                variant="primary"
                fullWidth={false}
                loading={acting}
                onClick={() => void handleAddNote()}
              >
                Simpan catatan
              </Button>
            </div>
          </div>
        }
      />
      {/* SH-A-005 — dialog batasi sementara (G423, auto-restore) */}
      <Dialog
        open={showRestrict}
        onClose={() => {
          if (!acting) {
            setShowRestrict(false)
            setRestrictReason("")
          }
        }}
        title="Batasi sementara item"
        description={`Item disembunyikan ${RESTRICT_MIN_DAYS}–${RESTRICT_MAX_DAYS} hari lalu otomatis tampil kembali (auto-restore). Untuk kasus ringan — alternatif takedown permanen.`}
        footer={
          <div className="flex flex-col gap-3">
            <Field label={`Durasi (hari, ${RESTRICT_MIN_DAYS}–${RESTRICT_MAX_DAYS})`} required>
              <Input
                type="number"
                min={RESTRICT_MIN_DAYS}
                max={RESTRICT_MAX_DAYS}
                value={restrictDays}
                onChange={(e) => setRestrictDays(Number(e.target.value))}
              />
            </Field>
            <TextArea
              label="Alasan pembatasan (wajib, min. 10 karakter)"
              value={restrictReason}
              onChange={(e) => setRestrictReason(e.target.value)}
              placeholder="Contoh: dugaan barang palsu, menunggu verifikasi penjual…"
              rows={3}
            />
            <div className="flex justify-end gap-2">
              <Button
                variant="ghost"
                fullWidth={false}
                disabled={acting}
                onClick={() => {
                  setShowRestrict(false)
                  setRestrictReason("")
                }}
              >
                Batal
              </Button>
              <Button
                variant="primary"
                fullWidth={false}
                loading={acting}
                onClick={() => void handleRestrict()}
              >
                Batasi item
              </Button>
            </div>
          </div>
        }
      />

      {/* SH-A-003 — dialog batalkan takedown (SUPER_ADMIN, tercatat event RESTORED) */}
      <Dialog
        open={showRestore}
        onClose={() => {
          if (!acting) {
            setShowRestore(false)
            setRestoreNote("")
          }
        }}
        title="Batalkan takedown"
        description="Item yang salah takedown akan dipulihkan dan tampil kembali di publik. Aksi tercatat sebagai event RESTORED di histori moderasi."
        footer={
          <div className="flex flex-col gap-3">
            <TextArea
              label="Catatan audit (opsional)"
              value={restoreNote}
              onChange={(e) => setRestoreNote(e.target.value)}
              placeholder="Contoh: takedown keliru — bukti baru menunjukkan item asli…"
              rows={3}
              maxLength={MODERATION_NOTE_MAX_LENGTH}
            />
            <div className="flex justify-end gap-2">
              <Button
                variant="ghost"
                fullWidth={false}
                disabled={acting}
                onClick={() => {
                  setShowRestore(false)
                  setRestoreNote("")
                }}
              >
                Batal
              </Button>
              <Button
                variant="primary"
                fullWidth={false}
                loading={acting}
                onClick={() => void handleRestoreTakedown()}
              >
                Pulihkan item
              </Button>
            </div>
          </div>
        }
      />

      {/* SH-A-006 — dialog assign / handoff */}
      <Dialog
        open={showAssign}
        onClose={() => {
          if (!acting) {
            setShowAssign(false)
            setAssignAdminId("")
          }
        }}
        title="Assign / handoff laporan"
        description="Tugaskan ke admin tertentu, atau kosongkan untuk auto-assign ke admin dengan antrean terbuka tersedikit. SLA: 24 jam (risiko tinggi) / 72 jam (normal)."
        footer={
          <div className="flex flex-col gap-3">
            <Field label="ID admin tujuan (kosong = auto-assign)">
              <Input
                value={assignAdminId}
                onChange={(e) => setAssignAdminId(e.target.value)}
                placeholder="cth: adm_01H…"
              />
            </Field>
            <div className="flex justify-end gap-2">
              <Button
                variant="ghost"
                fullWidth={false}
                disabled={acting}
                onClick={() => {
                  setShowAssign(false)
                  setAssignAdminId("")
                }}
              >
                Batal
              </Button>
              <Button
                variant="primary"
                fullWidth={false}
                loading={acting}
                onClick={() => void handleAssign()}
              >
                Tugaskan
              </Button>
            </div>
          </div>
        }
      />
    </RoleGate>
  )
}
