"use client"

/**
 * Admin — dialog konfirmasi aksi retur (ADM-113).
 *
 * Menggantikan window.confirm / window.prompt yang inkonsisten:
 * - menampilkan nominal refund yang akan dieksekusi (ADM-113),
 * - catatan wajib tervalidasi via TextArea (bukan prompt yang bisa di-bypass),
 * - pilihan outcome eksplisit untuk tutup paksa.
 */

import { useEffect, useState } from "react"

import { Button } from "@/components/ui/button"
import { Dialog } from "@/components/ui/dialog"
import { Input, TextArea } from "@/components/ui/input"
import { Select } from "@/components/admin/select"
import { formatIdrSen } from "@/lib/format"

export type ReturnActionKind = "escalate" | "approve" | "reject" | "force-resolve" | "extend"

export type ReturnActionConfirmInput = {
  note: string
  resolution?: "REFUND" | "EXCHANGE" | "REPAIR"
  rejectReasonCode?: string
  refundAmountSen?: number
}

const KIND_META: Record<
  ReturnActionKind,
  { title: string; confirmLabel: string; destructive: boolean; noteRequired: boolean }
> = {
  escalate: {
    title: "Eskalasi ke sengketa",
    confirmLabel: "Eskalasi",
    destructive: false,
    noteRequired: false,
  },
  approve: {
    title: "Setujui refund",
    confirmLabel: "Setujui refund",
    destructive: false,
    noteRequired: false,
  },
  reject: {
    title: "Tolak pengajuan retur",
    confirmLabel: "Tolak retur",
    destructive: true,
    noteRequired: false,
  },
  "force-resolve": {
    title: "Tutup paksa",
    confirmLabel: "Tutup paksa",
    destructive: true,
    noteRequired: true,
  },
  extend: {
    title: "Perpanjang deadline +24 jam",
    confirmLabel: "Perpanjang",
    destructive: false,
    noteRequired: false,
  },
}

const REJECT_REASON_OPTIONS = [
  { value: "MELEWATI_BATAS_WAKTU", label: "Melewati batas waktu" },
  { value: "BARANG_TIDAK_RUSAK", label: "Barang tidak rusak" },
  { value: "KLAIM_TIDAK_VALID", label: "Klaim tidak valid" },
  { value: "BUKTI_TIDAK_CUKUP", label: "Bukti tidak cukup" },
  { value: "BARANG_SUDAH_DIGUNAKAN", label: "Barang sudah digunakan" },
  { value: "KERUSAKAN_AKIBAT_PEMBELI", label: "Kerusakan akibat pembeli" },
  { value: "DILUAR_CAKUPAN_KEBIJAKAN", label: "Di luar cakupan kebijakan" },
  { value: "LAINNYA", label: "Lainnya" },
]

const RESOLUTION_OPTIONS = [
  { value: "REFUND", label: "Refund (kembalikan dana)" },
  { value: "EXCHANGE", label: "Tukar barang" },
  { value: "REPAIR", label: "Perbaikan" },
]

type Props = {
  open: boolean
  kind: ReturnActionKind | null
  /** Label retur untuk konteks judul, mis. "RTN-20260927-0001". */
  returnLabel: string
  /** Deadline seller saat ini (untuk aksi extend). */
  currentDeadline?: string | null
  /** Nominal refund usulan/persetujuan saat ini dalam sen (untuk aksi approve). */
  currentRefundSen?: number | null
  /** Pembayaran pembeli dalam sen — default nominal bila input dikosongkan. */
  buyerPaySen?: number | null
  /** Jumlah perpanjangan yang sudah dipakai (info cap 3x). */
  extensionsUsed?: number | null
  confirming: boolean
  onClose: () => void
  onConfirm: (input: ReturnActionConfirmInput) => void
}

export function ReturnActionDialog({
  open,
  kind,
  returnLabel,
  currentDeadline,
  currentRefundSen,
  buyerPaySen,
  extensionsUsed,
  confirming,
  onClose,
  onConfirm,
}: Props) {
  const meta = kind ? KIND_META[kind] : null
  const [note, setNote] = useState("")
  const [noteError, setNoteError] = useState<string | null>(null)
  const [resolution, setResolution] = useState<"REFUND" | "EXCHANGE" | "REPAIR">("REFUND")
  const [rejectReason, setRejectReason] = useState("LAINNYA")
  const [refundInput, setRefundInput] = useState("")
  const [refundError, setRefundError] = useState<string | null>(null)

  // Reset state tiap dialog dibuka untuk aksi baru.
  useEffect(() => {
    if (open) {
      setNote("")
      setNoteError(null)
      setResolution("REFUND")
      setRejectReason("LAINNYA")
      setRefundInput(currentRefundSen != null ? String(currentRefundSen) : "")
      setRefundError(null)
    }
  }, [open, kind, currentRefundSen])

  if (!meta || !kind) return null

  const parsedRefund = refundInput.trim() === "" ? null : Number(refundInput.replace(/[^\d]/g, ""))
  const refundValid =
    kind !== "approve" ||
    parsedRefund === null ||
    (Number.isInteger(parsedRefund) && parsedRefund > 0)
  const noteValid = !meta.noteRequired || note.trim().length >= 10
  const canConfirm = noteValid && refundValid && !confirming

  const handleConfirm = () => {
    if (meta.noteRequired && note.trim().length < 10) {
      setNoteError("Catatan wajib minimal 10 karakter.")
      return
    }
    if (kind === "approve" && parsedRefund !== null && !(Number.isInteger(parsedRefund) && parsedRefund > 0)) {
      setRefundError("Nominal harus bilangan bulat positif (sen).")
      return
    }
    onConfirm({
      note: note.trim(),
      ...(kind === "force-resolve" ? { resolution } : {}),
      ...(kind === "reject" ? { rejectReasonCode: rejectReason } : {}),
      ...(kind === "approve" && parsedRefund !== null ? { refundAmountSen: parsedRefund } : {}),
    })
  }

  // ADM-113: nominal yang akan dieksekusi — eksplisit, bukan "buta angka".
  const effectiveRefundSen = parsedRefund ?? currentRefundSen ?? buyerPaySen ?? null

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={meta.title}
      description={`Retur ${returnLabel}`}
      footer={
        <div className="flex flex-col gap-2">
          <Button
            variant={meta.destructive ? "destructive" : "primary"}
            loading={confirming}
            disabled={!canConfirm}
            onClick={handleConfirm}
          >
            {meta.confirmLabel}
          </Button>
          <Button variant="ghost" disabled={confirming} onClick={onClose}>
            Batal
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        {kind === "approve" ? (
          <div className="rounded-sm border border-border bg-surface px-4 py-3">
            <p className="text-caption font-semibold text-text-secondary">
              Nominal refund yang akan dieksekusi
            </p>
            <p className="mt-1 text-h3 font-bold text-text-primary">
              {effectiveRefundSen != null ? formatIdrSen(effectiveRefundSen) : "—"}
            </p>
            <p className="mt-1 text-caption text-text-secondary">
              {parsedRefund === null && buyerPaySen != null
                ? "Dikosongkan = full sebesar pembayaran pembeli."
                : "Sekali eksekusi dan idempoten."}
            </p>
          </div>
        ) : null}

        {kind === "approve" ? (
          <Input
            label="Nominal refund kustom (sen, opsional)"
            type="number"
            inputMode="numeric"
            min={1}
            value={refundInput}
            onChange={(e) => {
              setRefundInput(e.target.value)
              if (refundError) setRefundError(null)
            }}
            error={refundError ?? undefined}
            hint={
              currentRefundSen != null
                ? `Usulan saat ini: ${formatIdrSen(currentRefundSen)}`
                : "Kosongkan untuk memakai nominal default backend."
            }
          />
        ) : null}

        {kind === "force-resolve" ? (
          <Select
            label="Hasil penyelesaian"
            options={RESOLUTION_OPTIONS}
            value={resolution}
            onChange={(e) => setResolution(e.target.value as "REFUND" | "EXCHANGE" | "REPAIR")}
            hint="Menutup paksa tanpa menunggu alur normal — tercatat di audit."
          />
        ) : null}

        {kind === "reject" ? (
          <Select
            label="Alasan penolakan"
            options={REJECT_REASON_OPTIONS}
            value={rejectReason}
            onChange={(e) => setRejectReason(e.target.value)}
          />
        ) : null}

        {kind === "extend" ? (
          <div className="rounded-sm border border-border bg-surface px-4 py-3">
            <p className="text-caption font-semibold text-text-secondary">Deadline baru</p>
            <p className="mt-1 text-body text-text-primary">
              +24 jam dari deadline saat ini
              {extensionsUsed != null ? ` · perpanjangan ke-${extensionsUsed + 1} dari maks 3x` : ""}
            </p>
            {currentDeadline ? (
              <p className="mt-1 text-caption text-text-secondary">
                Saat ini: {currentDeadline}
              </p>
            ) : null}
          </div>
        ) : null}

        {kind === "escalate" ? (
          <p className="text-body text-text-secondary">
            Retur akan diteruskan ke sengketa. Bila sudah ada sengketa aktif
            untuk order ini, sengketa tersebut dipakai ulang.
          </p>
        ) : null}

        <TextArea
          label={meta.noteRequired ? "Catatan (wajib)" : "Catatan (opsional)"}
          required={meta.noteRequired}
          rows={3}
          value={note}
          onChange={(e) => {
            setNote(e.target.value)
            if (noteError) setNoteError(null)
          }}
          error={noteError ?? undefined}
          maxLength={2000}
          hint={meta.noteRequired ? "Minimal 10 karakter — tercatat di audit." : undefined}
        />
      </div>
    </Dialog>
  )
}
