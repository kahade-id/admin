/**
 * H04 — Aksi berbahaya meminta alasan (Batch 139).
 *
 * Suspend / tolak / override / batal memakai pola seragam:
 * - alasan TERSTRUKTUR (wajib pilih dari daftar)
 * - catatan bebas (wajib, min 10 karakter — selaras pola ekspor)
 * - tampilkan DAMPAK sebelum eksekusi
 *
 * Pemakaian:
 *   <DangerActionDialog
 *     open={open} onClose={...}
 *     title="Blokir pengguna"
 *     reasonOptions={USER_BAN_REASONS}
 *     impactItems={["Akun tidak bisa login", "Sesi aktif dicabut"]}
 *     onConfirm={(reason, notes) => banUser(id, { reason, notes })}
 *   />
 */
"use client"

import { useEffect, useState, type ReactNode } from "react"

import { Button } from "@/components/ui/button"
import { Dialog } from "@/components/ui/dialog"
import { TextArea } from "@/components/ui/input"
import { Select } from "@/components/admin/select"

export type ReasonOption = { value: string; label: string }

export const MIN_NOTES_LENGTH = 10

export type DangerActionDialogProps = {
  open: boolean
  onClose: () => void
  title: string
  description?: string
  reasonOptions: ReasonOption[]
  /** Dampak aksi — ditampilkan sebagai daftar sebelum eksekusi. */
  impactItems: string[]
  confirmLabel?: string
  cancelLabel?: string
  loading?: boolean
  /** Slot tambahan (mis. pratinjau dry-run H06). */
  extra?: ReactNode
  /** Nonaktifkan tombol konfirmasi dari luar (mis. belum centang scope). */
  confirmDisabled?: boolean
  onConfirm: (reason: string, notes: string) => void | Promise<void>
}

export function DangerActionDialog({
  open,
  onClose,
  title,
  description,
  reasonOptions,
  impactItems,
  confirmLabel = "Ya, jalankan",
  cancelLabel = "Batal",
  loading,
  extra,
  confirmDisabled,
  onConfirm,
}: DangerActionDialogProps) {
  const [reason, setReason] = useState("")
  const [notes, setNotes] = useState("")

  // Reset setiap dialog dibuka/ditutup — bukan hanya lewat tombol close
  // internal (parent bisa menutup programatik setelah sukses).
  useEffect(() => {
    if (!open) {
      setReason("")
      setNotes("")
    }
  }, [open ])

  const reasonValid = reason.trim().length > 0
  const notesValid = notes.trim().length >= MIN_NOTES_LENGTH
  const canConfirm = reasonValid && notesValid && !loading && !confirmDisabled

  const handleClose = () => {
    if (loading) return
    setReason("")
    setNotes("")
    onClose()
  }

  return (
    <Dialog
      open={open}
      onClose={handleClose}
      title={title}
      description={description}
      dirty={reasonValid || notes.trim().length > 0}
    >
      <div className="flex flex-col gap-4">
        {impactItems.length > 0 ? (
          <div className="rounded-sm border border-danger/40 bg-danger/10 p-3">
            <p className="mb-1 text-label font-semibold text-danger-text">
              Dampak aksi ini:
            </p>
            <ul className="list-disc pl-5 text-body text-text-primary">
              {impactItems.map((item, i) => (
                <li key={i}>{item}</li>
              ))}
            </ul>
          </div>
        ) : null}

        <Select
          label="Alasan (wajib)"
          options={[{ value: "", label: "— Pilih alasan —" }, ...reasonOptions]}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />

        <div>
          <TextArea
            label={`Catatan (wajib, min. ${MIN_NOTES_LENGTH} karakter)`}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={3}
            placeholder="Jelaskan konteks keputusan untuk jejak audit…"
          />
          {notes && !notesValid ? (
            <p className="mt-1 text-caption text-danger-text">
              Catatan minimal {MIN_NOTES_LENGTH} karakter.
            </p>
          ) : null}
        </div>

        {extra}

        <div className="flex flex-col gap-2">
          <Button variant="destructive" loading={loading} disabled={!canConfirm} onClick={() => onConfirm(reason.trim(), notes.trim())}>
            {confirmLabel}
          </Button>
          <Button variant="ghost" disabled={loading} onClick={handleClose}>
            {cancelLabel}
          </Button>
        </div>
      </div>
    </Dialog>
  )
}

/** Opsi alasan umum — salin & sesuaikan per konteks bila perlu. */
export const COMMON_DANGER_REASONS: ReasonOption[] = [
  { value: "FRAUD_SUSPECTED", label: "Dugaan penipuan" },
  { value: "POLICY_VIOLATION", label: "Pelanggaran kebijakan" },
  { value: "USER_REQUEST", label: "Permintaan pengguna terverifikasi" },
  { value: "ADMIN_ERROR_CORRECTION", label: "Koreksi kesalahan admin" },
  { value: "RISK_PREVENTION", label: "Pencegahan risiko" },
  { value: "OTHER", label: "Lainnya (jelaskan di catatan)" },
]
