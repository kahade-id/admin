/**
 * Admin — dialog Ekspor CSV pengguna (E5a, grup E).
 *
 * Alasan WAJIB (textarea, min 10 karakter; dicatat backend di audit),
 * pilihan kolom (checkbox dari EXPORTABLE_USER_COLUMNS yang didukung
 * backend), pratinjau masking contoh baris termasking, dan progress
 * polling saat backend me-return 202 { jobId } untuk ekspor besar.
 *
 * FOLLOW-UP re-auth: tidak ada endpoint re-auth kata sandi admin di
 * backend (hanya `/v1/admin/auth/login`); pola re-auth belum ada di
 * codebase (cek 2026-09-26). Sampai endpoint tersedia, ekspor dikunci
 * lewat alasan tertulis yang diaudit + role gate halaman. Tambahkan
 * `password` ke requestUsersExport saat backend menyediakannya.
 */
"use client"

import { useEffect, useRef, useState } from "react"

import { Button } from "@/components/ui/button"
import { Dialog } from "@/components/ui/dialog"
import { TextArea } from "@/components/ui/input"
import { useToast } from "@/components/ui/toast"
import {
  EXPORTABLE_USER_COLUMNS,
  downloadExportFile,
  getUsersExportJob,
  requestUsersExport,
  type AdminUserStatusFilter,
} from "@/lib/api/admin/users"
import { userMessage } from "@/lib/api/response"

const MIN_REASON_LENGTH = 10
const POLL_MS = 1500

/** Contoh nilai mentah untuk pratinjau masking (bukan data asli). */
const SAMPLE_VALUES: Record<string, string> = {
  fullName: "Budi Santoso",
  username: "budi_s",
  email: "budi.santoso@example.com",
  phoneNumber: "+6281234567890",
  kycStatus: "APPROVED",
  isBanned: "false",
  totalOrdersAsBuyer: "12",
  totalOrdersAsSeller: "3",
  createdAt: "2026-03-01 10:00",
  lastLoginAt: "2026-09-26 08:30",
}

/** Masking contoh yang dipakai pratinjau — backend melakukan masking nyata. */
export function maskSample(key: string, value: string): string {
  if (key === "email") {
    const [local, domain] = value.split("@")
    if (!domain) return "••••"
    const head = local.slice(0, 1) || "•"
    return `${head}•••@${domain}`
  }
  if (key === "phoneNumber") {
    const digits = value.replace(/\D/g, "")
    const tail = digits.slice(-4) || "••••"
    return `+62•••-••••-${tail}`
  }
  return value
}

function saveCsv(filename: string, csv: string) {
  const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" })
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

export function ExportUsersDialog({
  open,
  onClose,
  q,
  status,
}: {
  open: boolean
  onClose: () => void
  q: string
  status?: AdminUserStatusFilter
}) {
  const toast = useToast()
  const [reason, setReason] = useState("")
  const [reasonError, setReasonError] = useState<string | null>(null)
  const [columns, setColumns] = useState<string[]>(() =>
    EXPORTABLE_USER_COLUMNS.map((c) => c.key),
  )
  const [exporting, setExporting] = useState(false)
  const [jobId, setJobId] = useState<string | null>(null)
  const [progress, setProgress] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // Reset state tiap dialog dibuka; bersihkan polling saat ditutup.
  useEffect(() => {
    if (open) {
      setReason("")
      setReasonError(null)
      setColumns(EXPORTABLE_USER_COLUMNS.map((c) => c.key))
      setExporting(false)
      setJobId(null)
      setProgress(null)
      setError(null)
    }
    return () => {
      if (pollRef.current) {
        clearInterval(pollRef.current)
        pollRef.current = null
      }
    }
  }, [open ])

  function toggleColumn(key: string) {
    setColumns((prev) =>
      prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key],
    )
  }

  function downloadDone(csv: string) {
    const stamp = new Date().toISOString().slice(0, 10)
    saveCsv(`pengguna-kahade-${stamp}.csv`, csv)
    setExporting(false)
    setJobId(null)
    toast.show({ title: "Ekspor selesai.", description: "File CSV diunduh.", tone: "success" })
    onClose()
  }

  // Polling jobId untuk ekspor besar (202).
  useEffect(() => {
    if (!jobId) return
    const tick = async () => {
      try {
        const st = await getUsersExportJob(jobId)
        setProgress(typeof st.progress === "number" ? st.progress : null)
        if (st.status === "done" || st.status === "ready") {
          if (pollRef.current) clearInterval(pollRef.current)
          pollRef.current = null
          if (!st.downloadUrl) {
            setError("Ekspor selesai tanpa URL unduhan.")
            setExporting(false)
            return
          }
          const csv = await downloadExportFile(st.downloadUrl)
          downloadDone(csv)
        } else if (st.status === "failed") {
          if (pollRef.current) clearInterval(pollRef.current)
          pollRef.current = null
          setError(st.error || "Job ekspor gagal.")
          setExporting(false)
        }
      } catch (e) {
        if (pollRef.current) clearInterval(pollRef.current)
        pollRef.current = null
        setError(userMessage(e))
        setExporting(false)
      }
    }
    void tick()
    pollRef.current = setInterval(() => void tick(), POLL_MS)
    return () => {
      if (pollRef.current) {
        clearInterval(pollRef.current)
        pollRef.current = null
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobId])

  async function handleExport() {
    const r = reason.trim()
    if (r.length < MIN_REASON_LENGTH) {
      setReasonError(`Alasan ekspor minimal ${MIN_REASON_LENGTH} karakter.`)
      return
    }
    if (columns.length === 0) {
      setReasonError("Pilih minimal satu kolom untuk diekspor.")
      return
    }
    setReasonError(null)
    setError(null)
    setExporting(true)
    setProgress(null)
    try {
      const res = await requestUsersExport({ reason: r, columns, q, status })
      if (res.type === "job") {
        setJobId(res.jobId)
        toast.show({
          title: "Ekspor besar diproses.",
          description: "Memantau progress hingga selesai…",
          tone: "info",
        })
      } else {
        downloadDone(res.csv)
      }
    } catch (e) {
      setError(userMessage(e))
      setExporting(false)
    }
  }

  const previewColumns = EXPORTABLE_USER_COLUMNS.filter((c) => columns.includes(c.key))

  return (
    <Dialog
      open={open}
      onClose={() => {
        if (!exporting) onClose()
      }}
      title="Ekspor CSV pengguna"
      description="Ekspor dibatasi filter yang sedang aktif. Alasan dicatat di audit dan tidak bisa dikosongkan."
    >
      <div className="flex flex-col gap-4">
        {error ? (
          <p role="alert" className="text-body text-danger-text">
            {error}
          </p>
        ) : null}

        <TextArea
          label="Alasan ekspor"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="cth. Rekonsiliasi data pengguna untuk laporan bulanan keuangan…"
          rows={3}
          disabled={exporting}
          required
        />
        {reasonError ? (
          <p role="alert" className="-mt-2 text-caption text-danger-text">
            {reasonError}
          </p>
        ) : null}

        <fieldset>
          <legend className="mb-2 text-label font-semibold text-text-secondary">
            Kolom yang diekspor
          </legend>
          <div className="grid grid-cols-2 gap-2">
            {EXPORTABLE_USER_COLUMNS.map((c) => (
              <label
                key={c.key}
                className="flex cursor-pointer items-center gap-2 rounded-sm border border-border px-2.5 py-2 text-body text-text-primary"
              >
                <input
                  type="checkbox"
                  checked={columns.includes(c.key)}
                  onChange={() => toggleColumn(c.key)}
                  disabled={exporting}
                  className="accent-primary"
                />
                <span>
                  {c.label}
                  {c.masked ? (
                    <span className="ml-1.5 text-caption text-text-tertiary">(termasking)</span>
                  ) : null}
                </span>
              </label>
            ))}
          </div>
        </fieldset>

        <div>
          <p className="mb-2 text-label font-semibold text-text-secondary">
            Pratinjau masking (contoh baris)
          </p>
          <div className="overflow-x-auto rounded-sm border border-border">
            <table className="w-full border-collapse text-caption">
              <thead>
                <tr className="bg-surface-elevated">
                  {previewColumns.map((c) => (
                    <th
                      key={c.key}
                      className="whitespace-nowrap px-2.5 py-1.5 text-left font-semibold text-text-secondary"
                    >
                      {c.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                <tr>
                  {previewColumns.map((c) => {
                    const raw = SAMPLE_VALUES[c.key] ?? "—"
                    const shown = c.masked ? maskSample(c.key, raw) : raw
                    return (
                      <td
                        key={c.key}
                        className="whitespace-nowrap px-2.5 py-1.5 font-mono text-text-primary"
                      >
                        {shown}
                      </td>
                    )
                  })}
                </tr>
              </tbody>
            </table>
          </div>
          <p className="mt-1 text-caption text-text-tertiary">
            Nilai di atas contoh tampilan; masking nyata dilakukan server untuk kolom bertanda
            (termasking).
          </p>
        </div>

        <p className="text-caption text-text-tertiary">
          Catatan: re-auth kata sandi belum tersedia — backend belum menyediakan endpoint
          re-auth admin. Sampai tersedia, ekspor dilindungi alasan tertulis yang diaudit
          dan pembatasan role halaman ini.
        </p>

        {exporting && jobId ? (
          <div aria-live="polite">
            <div className="mb-1 flex justify-between text-caption text-text-secondary">
              <span>Memproses ekspor besar…</span>
              <span>{progress != null ? `${progress}%` : "…"}</span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-surface-elevated">
              <div
                className="h-full rounded-full bg-primary transition-all"
                style={{ width: `${progress ?? 5}%` }}
              />
            </div>
          </div>
        ) : null}

        <div className="flex justify-end gap-2">
          <Button
            variant="ghost"
            fullWidth={false}
            onClick={onClose}
            disabled={exporting}
          >
            Batal
          </Button>
          <Button loading={exporting} fullWidth={false} onClick={handleExport}>
            Ekspor
          </Button>
        </div>
      </div>
    </Dialog>
  )
}
