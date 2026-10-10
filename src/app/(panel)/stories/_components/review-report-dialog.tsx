"use client"

/**
 * Dialog tinjau laporan Story — satu tindakan, catatan internal wajib,
 * durasi hari bila relevan (hide 1–30, ban kosong = permanen).
 * `delete`/`ban` meminta step-up lebih dulu; 409 dari backend berarti
 * laporan sudah diselesaikan admin lain (pesan jujur, bukan generik).
 * Form di-key per laporan agar state selalu segar tanpa effect reset.
 */

import { useState } from "react"

import type { StepUpRequestOptions } from "@/components/admin/step-up-gate"
import { Select } from "@/components/admin/select"
import { Button } from "@/components/ui/button"
import { Dialog } from "@/components/ui/dialog"
import { Input, TextArea } from "@/components/ui/input"
import { useToast } from "@/components/ui/toast"
import {
  reviewStoryReport,
  STORY_STEP_UP_ACTION,
  type AdminStoryReport,
  type ReviewStoryReportResult,
  type StoryReportAction,
} from "@/lib/api/admin/stories"
import { userMessage } from "@/lib/api/response"

import { REPORT_ACTION_LABEL } from "../maps"

const ACTIONS: StoryReportAction[] = ["in_review", "dismiss", "hide", "delete", "ban"]

type RequestStepUp = (opts: StepUpRequestOptions) => Promise<string | null>

export function ReviewReportDialog({
  report,
  onClose,
  onReviewed,
  requestStepUp,
}: {
  report: AdminStoryReport | null
  onClose: () => void
  onReviewed: (report: AdminStoryReport, result: ReviewStoryReportResult) => void
  requestStepUp: RequestStepUp
}) {
  const [busy, setBusy] = useState(false)
  return (
    <Dialog
      open={report !== null}
      onClose={() => {
        if (!busy) onClose()
      }}
      title="Tinjau laporan"
    >
      {report ? (
        <ReviewForm
          key={report.id}
          report={report}
          busy={busy}
          setBusy={setBusy}
          onClose={onClose}
          onReviewed={onReviewed}
          requestStepUp={requestStepUp}
        />
      ) : null}
    </Dialog>
  )
}

function ReviewForm({
  report,
  busy,
  setBusy,
  onClose,
  onReviewed,
  requestStepUp,
}: {
  report: AdminStoryReport
  busy: boolean
  setBusy: (b: boolean) => void
  onClose: () => void
  onReviewed: (report: AdminStoryReport, result: ReviewStoryReportResult) => void
  requestStepUp: RequestStepUp
}) {
  const toast = useToast()
  const [action, setAction] = useState<StoryReportAction | "">("")
  const [note, setNote] = useState("")
  const [days, setDays] = useState("")

  const needsDays = action === "hide" || action === "ban"
  const daysNum = days.trim() === "" ? undefined : Number(days)
  const daysMax = action === "hide" ? 30 : 3650
  const daysValid =
    daysNum === undefined || (Number.isInteger(daysNum) && daysNum >= 1 && daysNum <= daysMax)
  const canSubmit = !!action && note.trim().length > 0 && note.length <= 1000 && daysValid
  const destructive = action === "delete" || action === "ban"

  const submit = async () => {
    if (!action || !canSubmit || busy) return
    let stepUpToken: string | undefined
    if (destructive) {
      const token = await requestStepUp({
        action: STORY_STEP_UP_ACTION.review,
        targetId: report.id,
        title: REPORT_ACTION_LABEL[action],
        description:
          action === "delete"
            ? "Story dan medianya dihapus permanen. Aksi tercatat di audit."
            : "Semua Story aktif penulis ikut disembunyikan selama ban. Aksi tercatat di audit.",
      })
      if (!token) return
      stepUpToken = token
    }
    setBusy(true)
    try {
      const result = await reviewStoryReport(
        report.id,
        {
          action,
          internalNote: note.trim(),
          ...(needsDays && daysNum !== undefined ? { durationDays: daysNum } : {}),
        },
        { stepUpToken },
      )
      toast.show({ title: `${REPORT_ACTION_LABEL[action]} — tersimpan`, tone: "success" })
      onReviewed(report, result)
    } catch (e) {
      const status = (e as { status?: number } | null)?.status
      toast.show({
        title: "Tinjauan gagal",
        description:
          status === 409
            ? "Laporan ini sudah diselesaikan oleh admin lain. Muat ulang antrean."
            : status === 404
              ? "Laporan tidak ditemukan lagi."
              : userMessage(e),
        tone: "danger",
      })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-4">
      <Select
        label="Tindakan"
        value={action}
        onChange={(e) => {
          setAction(e.target.value as StoryReportAction | "")
          setDays("")
        }}
        options={[
          { value: "", label: "— Pilih —" },
          ...ACTIONS.map((a) => ({ value: a, label: REPORT_ACTION_LABEL[a] })),
        ]}
      />
      {needsDays ? (
        <Input
          type="number"
          inputMode="numeric"
          min={1}
          max={daysMax}
          label={action === "hide" ? "Durasi (hari, 1–30)" : "Durasi ban (hari)"}
          hint={action === "hide" ? "Kosong = 7 hari." : "Kosong = permanen. Maks 3650."}
          error={daysValid ? undefined : `Isi angka bulat 1–${daysMax}.`}
          value={days}
          onChange={(e) => setDays(e.target.value)}
        />
      ) : null}
      <TextArea
        label="Catatan internal"
        required
        rows={3}
        maxLength={1000}
        value={note}
        onChange={(e) => setNote(e.target.value)}
        hint={`${note.length}/1000 · tercatat di audit${needsDays ? ", dipakai sebagai alasan" : ""}`}
      />
      <div className="flex justify-end gap-2">
        <Button variant="secondary" fullWidth={false} onClick={onClose} disabled={busy}>
          Batal
        </Button>
        <Button
          variant={destructive ? "destructive" : "primary"}
          fullWidth={false}
          onClick={() => void submit()}
          disabled={!canSubmit}
          loading={busy}
        >
          {action ? REPORT_ACTION_LABEL[action] : "Pilih tindakan"}
        </Button>
      </div>
    </div>
  )
}
