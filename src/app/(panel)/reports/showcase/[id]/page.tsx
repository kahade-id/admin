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
import {
  getShowcaseReportDetail,
  reviewShowcaseReport,
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

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [report, setReport] = useState<ShowcaseReportDetail | null>(null)

  const [dialogAction, setDialogAction] = useState<ShowcaseReportAction | null>(null)
  const [resolution, setResolution] = useState("")
  const [acting, setActing] = useState(false)

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
    </RoleGate>
  )
}
