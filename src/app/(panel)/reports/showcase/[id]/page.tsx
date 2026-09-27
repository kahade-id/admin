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
import { TextArea } from "@/components/ui/input"
import { Spinner } from "@/components/ui/spinner"
import { useToast } from "@/components/ui/toast"
import { RoleGate } from "@/components/admin/role-gate"
import { useAuth } from "@/lib/auth-context"
import {
  addModerationNote,
  decideAppeal,
  getRelatedReports,
  getReviewerSummary,
  getShowcaseReportDetail,
  getSnapshotDiff,
  reopenShowcaseReport,
  reviewShowcaseReport,
  type ModerationEvent,
  type ReportAppeal,
  type ShowcaseReport,
  type ShowcaseReportAction,
  type ShowcaseReportDetail,
} from "@/lib/api/admin/showcase-reports"
import { userMessage } from "@/lib/api/response"
import { formatAge, formatDateTimeWIB, formatNumber } from "@/lib/format"

import {
  SHOWCASE_REPORT_STATUS_LABEL,
  SHOWCASE_REPORT_STATUS_TONE,
} from "../maps"

/** Status final: backend menolak aksi lanjutan dengan 400. */
const FINAL_STATUSES = new Set([
  "RESOLVED_ACTION_TAKEN",
  "RESOLVED_NO_ACTION",
  "DISMISSED",
])

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

export default function ShowcaseReportDetailPage() {
  const { id } = useParams<{ id: string }>()
  const toast = useToast()
  const { role } = useAuth()
  const isSuperAdmin = role === "SUPER_ADMIN"

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [report, setReport] = useState<
    (ShowcaseReportDetail & {
      moderationEvents?: ModerationEvent[]
      activeAssignment?: {
        assigneeAdminId: string
        assignedAt: string
        slaDueAt?: string | null
        riskScore?: number | null
        riskTier?: string | null
      } | null
      appeals?: ReportAppeal[]
    }) | null
  >(null)

  const [dialogAction, setDialogAction] = useState<ShowcaseReportAction | null>(null)
  const [resolution, setResolution] = useState("")
  const [acting, setActing] = useState(false)

  // GAP-F: lifecycle pasca-final
  const [showReopen, setShowReopen] = useState(false)
  const [reopenReason, setReopenReason] = useState("")
  const [showNote, setShowNote] = useState(false)
  const [noteText, setNoteText] = useState("")
  const [related, setRelated] = useState<ShowcaseReport[] | null>(null)
  const [diff, setDiff] = useState<
    { changed: { field: string; from: unknown; to: unknown }[] } | null
  >(null)
  const [decidingAppeal, setDecidingAppeal] = useState<string | null>(null)
  const [decisionNote, setDecisionNote] = useState("")

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
    setActing(true)
    try {
      const res = await reviewShowcaseReport(id, {
        action: dialogAction,
        resolution: resolution.trim() || undefined,
      })
      toast.show({
        title: "Berhasil",
        description: res.message ?? "Aksi moderasi berhasil.",
        tone: "success",
      })
      setDialogAction(null)
      setResolution("")
      await load()
    } catch (e) {
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
      await load()
    } catch (e) {
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
      await load()
    } catch (e) {
      toast.show({ title: "Gagal menambah catatan", description: userMessage(e), tone: "danger" })
    } finally {
      setActing(false)
    }
  }

  const handleDecideAppeal = async (appealId: string, decision: "APPROVED" | "REJECTED") => {
    if (decisionNote.trim().length < 10) {
      toast.show({
        title: "Catatan putusan wajib",
        description: "Tulis alasan putusan minimal 10 karakter.",
        tone: "danger",
      })
      return
    }
    setDecidingAppeal(appealId)
    try {
      await decideAppeal(appealId, { decision, decisionNote: decisionNote.trim() })
      toast.show({
        title: "Berhasil",
        description: decision === "APPROVED" ? "Banding disetujui — item dipulihkan." : "Banding ditolak.",
        tone: "success",
      })
      setDecisionNote("")
      await load()
    } catch (e) {
      toast.show({ title: "Gagal memutus banding", description: userMessage(e), tone: "danger" })
    } finally {
      setDecidingAppeal(null)
    }
  }

  const loadRelated = async () => {
    try {
      const res = await getRelatedReports(id)
      setRelated(res.related ?? [])
    } catch (e) {
      toast.show({ title: "Gagal memuat laporan terkait", description: userMessage(e), tone: "danger" })
    }
  }

  const loadDiff = async () => {
    try {
      const res = await getSnapshotDiff(id)
      setDiff(res)
    } catch (e) {
      toast.show({ title: "Gagal memuat diff", description: userMessage(e), tone: "danger" })
    }
  }

  const loadReviewerSummary = async () => {
    try {
      const res = await getReviewerSummary(id)
      toast.show({
        title: "Ringkasan reviewer",
        description: `Snapshot: ${res.snapshot ? "ada" : "tidak ada"}, event: ${Array.isArray(res.events) ? res.events.length : 0}, banding: ${Array.isArray(res.appeals) ? res.appeals.length : 0}.`,
        tone: "info",
      })
    } catch (e) {
      toast.show({ title: "Gagal memuat ringkasan", description: userMessage(e), tone: "danger" })
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
                  {report.showcase?.images?.[0]?.imageUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={report.showcase.images[0].imageUrl}
                      alt={report.showcase.title ?? "Thumbnail item etalase"}
                      className="h-32 w-32 shrink-0 rounded-sm border border-border object-cover"
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
                        <Badge tone="neutral">{ev.action}</Badge>
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
                            value={decisionNote}
                            onChange={(e) => setDecisionNote(e.target.value)}
                            rows={2}
                            placeholder="Alasan mempertahankan / membalikkan keputusan…"
                          />
                          <div className="flex gap-2">
                            <Button
                              variant="primary"
                              size="sm"
                              fullWidth={false}
                              loading={decidingAppeal === ap.id}
                              onClick={() => void handleDecideAppeal(ap.id, "APPROVED")}
                            >
                              Setujui (pulihkan item)
                            </Button>
                            <Button
                              variant="destructive"
                              size="sm"
                              fullWidth={false}
                              loading={decidingAppeal === ap.id}
                              onClick={() => void handleDecideAppeal(ap.id, "REJECTED")}
                            >
                              Tolak
                            </Button>
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
                  <Button variant="ghost" size="sm" fullWidth={false} onClick={() => void loadDiff()}>
                    Muat diff
                  </Button>
                }
              />
              <CardBody>
                {diff === null ? (
                  <p className="text-body text-text-secondary">
                    Bandingkan snapshot saat keputusan final dengan kondisi item saat ini.
                  </p>
                ) : diff.changed.length === 0 ? (
                  <p className="text-body text-text-secondary">Tidak ada perubahan terdeteksi.</p>
                ) : (
                  <dl>
                    {diff.changed.map((c) => (
                      <KeyValue
                        key={c.field}
                        label={c.field}
                        value={`${String(c.from ?? "—")} → ${String(c.to ?? "—")}`}
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
                  <Button variant="ghost" size="sm" fullWidth={false} onClick={() => void loadRelated()}>
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
            <Button variant="ghost" size="sm" fullWidth={false} onClick={() => void loadReviewerSummary()}>
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
            <TextArea
              label="Catatan resolusi (opsional)"
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
            <TextArea
              label="Catatan"
              value={noteText}
              onChange={(e) => setNoteText(e.target.value)}
              placeholder="Catatan internal moderator…"
              rows={3}
            />
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
    </RoleGate>
  )
}
