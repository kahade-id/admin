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
import {
  dismissReport,
  getReportDetail,
  resolveReport,
  type UserReport,
} from "@/lib/api/admin/reports"
import { userMessage } from "@/lib/api/response"
import { formatDateTimeWIB } from "@/lib/format"

import {
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
  }

  const closeAction = () => {
    if (submitting) return
    setAction(null)
    setNotes("")
  }

  const handleConfirm = async () => {
    if (!action || submitting) return
    setSubmitting(true)
    try {
      const noteText = notes.trim() || undefined
      if (action === "dismiss") {
        await dismissReport(reportId, noteText)
        toast.show({ title: "Laporan diabaikan", tone: "success" })
      } else {
        await resolveReport(reportId, noteText)
        toast.show({ title: "Laporan diselesaikan", tone: "success" })
      }
      setAction(null)
      setNotes("")
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
              <p className="text-h3 font-semibold text-text-primary">{report.reason}</p>
              {report.description ? (
                <p className="mt-2 text-body text-text-primary">{report.description}</p>
              ) : null}
              <dl className="mt-4">
                <KeyValue label="ID Laporan" value={report.id} mono />
                <KeyValue label="ID Pelapor" value={report.reporterId} mono />
                {report.reportedUserId ? (
                  <KeyValue label="ID Terlapor" value={report.reportedUserId} mono />
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

      {/* Dialog aksi: catatan opsional */}
      <Dialog
        open={action !== null}
        onClose={closeAction}
        title={isDismiss ? "Abaikan laporan?" : "Selesaikan laporan?"}
        description={
          isDismiss
            ? "Laporan akan ditandai diabaikan dan tidak ditindaklanjuti."
            : "Laporan akan ditandai selesai ditangani."
        }
        footer={
          <div className="flex flex-col gap-2">
            <Button
              variant={isDismiss ? "destructive" : "primary"}
              loading={submitting}
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
        <TextArea
          label="Catatan (opsional)"
          rows={3}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Tulis catatan penanganan bila perlu…"
          maxLength={2000}
        />
      </Dialog>
    </RoleGate>
  )
}
