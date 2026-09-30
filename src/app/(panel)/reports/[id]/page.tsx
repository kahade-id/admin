"use client"

/**
 * Admin — Detail laporan pengguna: info laporan + aksi Abaikan (dismiss) /
 * Selesaikan (resolve) via Dialog dengan catatan opsional. Tombol aksi
 * disembunyikan bila status sudah final.
 *
 * Port dari frontend/app/admin/(panel)/reports/[id].tsx → web desktop.
 */

import { useCallback, useEffect, useState, type ReactNode } from "react"
import { useParams } from "next/navigation"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardBody, CardHeader } from "@/components/ui/card"
import { Dialog } from "@/components/ui/dialog"
import { EmptyState } from "@/components/ui/empty-state"
import { TextArea } from "@/components/ui/input"
import { Spinner } from "@/components/ui/spinner"
import { useToast } from "@/components/ui/toast"
import { RoleGate } from "@/components/admin/role-gate"
import { Select } from "@/components/admin/select"
import {
  dismissReport,
  getReportDetail,
  resolveReport,
  type UserReport,
} from "@/lib/api/admin/reports"
import { userMessage } from "@/lib/api/response"
import { formatDateTimeWIB } from "@/lib/format"

import {
  REPORT_CATEGORY_LABEL,
  REPORT_FINAL_STATUSES,
  REPORT_STATUS_LABEL,
  REPORT_STATUS_TONE,
} from "../maps"

type Action = "dismiss" | "resolve"

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

export default function ReportDetailPage() {
  const { id } = useParams<{ id: string }>()
  const reportId = Array.isArray(id) ? id[0] : (id ?? "")
  const toast = useToast()

  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [report, setReport] = useState<UserReport | null>(null)

  const [action, setAction] = useState<Action | null>(null)
  const [notes, setNotes] = useState("")
  const [submitting, setSubmitting] = useState(false)
  // BAI-032 — pilihan status resolusi: backend mendukung RESOLVED_NO_ACTION
  // selain default RESOLVED_ACTION_TAKEN; sebelumnya UI selalu tercatat
  // "ditindak" sehingga metrik resolusi bias.
  const [resolveStatus, setResolveStatus] = useState<"RESOLVED_ACTION_TAKEN" | "RESOLVED_NO_ACTION">(
    "RESOLVED_ACTION_TAKEN",
  )

  const load = useCallback(
    async (mode: "initial" | "refresh" = "initial") => {
      if (mode === "initial") setLoading(true)
      else setRefreshing(true)
      setError(null)
      try {
        setReport(await getReportDetail(reportId))
      } catch (e) {
        setError(userMessage(e))
      } finally {
        setLoading(false)
        setRefreshing(false)
      }
    },
    [reportId],
  )

  useEffect(() => {
    if (reportId) void load("initial")
  }, [reportId, load])

  const openAction = (a: Action) => {
    setAction(a)
    setNotes("")
    setResolveStatus("RESOLVED_ACTION_TAKEN")
  }

  const closeAction = () => {
    if (submitting) return
    setAction(null)
    setNotes("")
    setResolveStatus("RESOLVED_ACTION_TAKEN")
  }

  const handleConfirm = async () => {
    if (!action || submitting) return
    const noteText = notes.trim()
    // BAI-003: backend /resolve mewajibkan `resolution` (min 5 char).
    if (action === "resolve" && noteText.length < 5) {
      toast.show({
        title: "Resolusi wajib diisi (minimal 5 karakter)",
        tone: "danger",
      })
      return
    }
    setSubmitting(true)
    try {
      if (action === "dismiss") {
        await dismissReport(reportId, noteText || undefined)
        toast.show({ title: "Laporan diabaikan", tone: "success" })
      } else {
        await resolveReport(reportId, noteText, resolveStatus)
        toast.show({
          title: "Laporan diselesaikan",
          description:
            resolveStatus === "RESOLVED_NO_ACTION"
              ? "Status: selesai tanpa tindakan."
              : "Status: selesai, ditindaklanjuti.",
          tone: "success",
        })
      }
      setAction(null)
      setNotes("")
      setResolveStatus("RESOLVED_ACTION_TAKEN")
      await load("refresh")
    } catch (e) {
      toast.show({
        title: action === "dismiss" ? "Gagal mengabaikan laporan" : "Gagal menyelesaikan laporan",
        description: userMessage(e),
        tone: "danger",
      })
    } finally {
      setSubmitting(false)
    }
  }

  const status = report ? String(report.status) : ""
  const isFinal = REPORT_FINAL_STATUSES.includes(status)
  const isDismiss = action === "dismiss"

  return (
    <RoleGate href="/reports">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-h2 font-bold text-text-primary">Detail Laporan</h1>
          <p className="mt-1 text-body text-text-secondary">
            {report ? `ID: ${report.id}` : "Tinjau dan tangani laporan pengguna."}
          </p>
        </div>
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
          <p className="text-body text-text-secondary">Memuat detail laporan…</p>
        </div>
      ) : error || !report ? (
        <Card>
          <EmptyState
            title="Gagal memuat detail laporan"
            description={error ?? "Data tidak ditemukan."}
            action={
              <Button variant="secondary" fullWidth={false} onClick={() => load("initial")}>
                Coba lagi
              </Button>
            }
          />
        </Card>
      ) : (
        <div className="space-y-4">
          <Card padded={false}>
            <CardHeader
              title="Laporan"
              action={
                <Badge tone={REPORT_STATUS_TONE[status] ?? "neutral"}>
                  {REPORT_STATUS_LABEL[status] ?? status}
                </Badge>
              }
            />
            <CardBody>
              {/* BAI-024 — "Alasan" = category (label) + description; backend
                  tidak punya field `reason`. */}
              <p className="text-h3 font-semibold text-text-primary">
                {REPORT_CATEGORY_LABEL[report.category] ?? report.category ?? "—"}
              </p>
              {report.description ? (
                <p className="mt-2 text-body text-text-primary">{report.description}</p>
              ) : null}
              <dl className="mt-4">
                <KeyValue label="ID Laporan" value={report.id} mono />
                {/* BAI-035 — tampilkan identitas pelapor dari objek `reporter`,
                    bukan ID mentah saja. */}
                <KeyValue
                  label="Pelapor"
                  value={
                    report.reporter?.fullName ||
                    report.reporter?.username ||
                    report.reporter?.userId ||
                    report.reporterId
                  }
                />
                <KeyValue label="ID Pelapor" value={report.reporterId} mono />
                {/* BAI-123/BAI-025: baca `target`/`targetId` dari backend
                    (bukan `reportedUserId` yang tidak pernah dikirim). */}
                {report.target ? (
                  <KeyValue
                    label="Terlapor"
                    value={
                      report.target.fullName ||
                      report.target.username ||
                      report.target.userId ||
                      report.target.id ||
                      "—"
                    }
                  />
                ) : null}
                {report.targetId ? (
                  <KeyValue label="ID Terlapor" value={report.targetId} mono />
                ) : null}
                {/* BAI-035 — konteks tambahan dari backend yang sebelumnya
                    tidak dirender: status banned terlapor, bukti, keterkaitan
                    order, hasil penanganan + siapa/waktu mereview. */}
                {report.target?.isBanned != null ? (
                  <KeyValue
                    label="Status akun terlapor"
                    value={report.target.isBanned ? "Diblokir" : "Aktif"}
                  />
                ) : null}
                {report.relatedOrderId ? (
                  <KeyValue label="Order terkait" value={report.relatedOrderId} mono />
                ) : null}
                {report.relatedMessageId ? (
                  <KeyValue label="Pesan terkait" value={report.relatedMessageId} mono />
                ) : null}
                {report.evidenceUrls && report.evidenceUrls.length > 0 ? (
                  <KeyValue
                    label="Bukti"
                    value={
                      <span className="flex flex-col items-end gap-1">
                        {report.evidenceUrls.map((u) => (
                          <a
                            key={u}
                            href={u}
                            target="_blank"
                            rel="noreferrer"
                            className="break-all text-accent underline"
                          >
                            {u}
                          </a>
                        ))}
                      </span>
                    }
                  />
                ) : null}
                {report.resolution ? (
                  <KeyValue label="Hasil penanganan" value={report.resolution} />
                ) : null}
                {report.reviewedBy ? (
                  <KeyValue label="Ditinjau oleh" value={report.reviewedBy} mono />
                ) : null}
                {report.reviewedAt ? (
                  <KeyValue
                    label="Waktu tinjau"
                    value={formatDateTimeWIB(report.reviewedAt)}
                  />
                ) : null}
                <KeyValue label="Dibuat" value={formatDateTimeWIB(report.createdAt)} />
              </dl>
            </CardBody>
          </Card>

          {!isFinal ? (
            <div className="flex flex-wrap gap-2">
              <Button
                variant="secondary"
                fullWidth={false}
                onClick={() => openAction("dismiss")}
              >
                Abaikan
              </Button>
              <Button variant="primary" fullWidth={false} onClick={() => openAction("resolve")}>
                Selesaikan
              </Button>
            </div>
          ) : (
            <p className="text-caption text-text-secondary">
              Laporan ini sudah selesai ditangani.
            </p>
          )}
        </div>
      )}

      {/* Dialog aksi: catatan opsional (dismiss) / resolusi wajib min 5 char (resolve) */}
      <Dialog
        open={action !== null}
        onClose={closeAction}
        title={isDismiss ? "Abaikan laporan?" : "Selesaikan laporan?"}
        description={
          isDismiss
            ? "Laporan akan ditandai diabaikan dan tidak ditindaklanjuti."
            : "Laporan akan ditandai selesai ditangani. Resolusi wajib diisi."
        }
        footer={
          <div className="flex flex-col gap-2">
            <Button
              variant={isDismiss ? "destructive" : "primary"}
              loading={submitting}
              disabled={!isDismiss && notes.trim().length < 5}
              onClick={handleConfirm}
            >
              {isDismiss ? "Ya, abaikan" : "Ya, selesaikan"}
            </Button>
            <Button variant="ghost" disabled={submitting} onClick={closeAction}>
              Batal
            </Button>
          </div>
        }
      >
        {!isDismiss ? (
          <Select
            label="Hasil penyelesaian"
            value={resolveStatus}
            onChange={(e) =>
              setResolveStatus(e.target.value as "RESOLVED_ACTION_TAKEN" | "RESOLVED_NO_ACTION")
            }
            options={[
              { value: "RESOLVED_ACTION_TAKEN", label: "Selesai — ditindaklanjuti" },
              { value: "RESOLVED_NO_ACTION", label: "Selesai — tanpa tindakan" },
            ]}
            hint="BAI-032: pilih “tanpa tindakan” bila laporan valid tapi tidak perlu tindakan."
          />
        ) : null}
        <TextArea
          label={isDismiss ? "Catatan (opsional)" : "Resolusi (wajib, min. 5 karakter)"}
          rows={3}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder={
            isDismiss ? "Tulis catatan penanganan bila perlu…" : "Tulis ringkasan penyelesaian laporan…"
          }
          maxLength={2000}
          error={
            !isDismiss && notes.length > 0 && notes.trim().length < 5
              ? "Minimal 5 karakter"
              : undefined
          }
        />
      </Dialog>
    </RoleGate>
  )
}
