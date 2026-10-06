/**
 * Admin — Keuangan: panel rekonsiliasi E3 (G326–G350).
 *
 * - Temuan rekonsiliasi: daftar + filter + acknowledge (transisi status).
 * - Rekonsiliasi user: recorded/computed/difference + invariant yang dilanggar.
 * - Koreksi ledger manual: alur dual approval (request → approve admin
 *   berbeda), preview sebelum submit, prompt kata sandi, self-approve
 *   dinonaktifkan di UI.
 * - Batch terjadwal: metrik checked/clean/problematic + drill-down.
 * - Uji akses: simulasi read-only per role untuk tiap aksi.
 *
 * Semua copy berbahasa Indonesia.
 */
"use client"

import { useCallback, useEffect, useState } from "react"

import { Badge, type BadgeTone } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardBody, CardHeader } from "@/components/ui/card"
import { Dialog } from "@/components/ui/dialog"
import { Input, TextArea } from "@/components/ui/input"
import { Spinner } from "@/components/ui/spinner"
import { DataTable } from "@/components/ui/table"
import { useToast } from "@/components/ui/toast"

import { Pagination } from "@/components/admin/pagination"
import { Select } from "@/components/admin/select"
import { useStepUp } from "@/components/admin/step-up-gate"
import { useAuth } from "@/lib/auth-context"

import {
  acknowledgeFinding,
  decideCorrection,
  downloadFindingsCsv,
  getBatchDiscrepancies,
  getReconcileJobStatus,
  listCorrections,
  listFindings,
  listReconciliationBatches,
  newIdempotencyKey,
  reconcileAll,
  reconcileUser,
  requestCorrection,
  type CorrectionStatus,
  type FindingStatus,
  type FindingsQuery,
  type LedgerCorrection,
  type ReconciliationBatch,
  type ReconciliationFinding,
  type ReconcileJobStatus,
  type ReconcileResult,
} from "@/lib/api/admin/finance"
import { userMessage } from "@/lib/api/response"
import { formatDateTimeWIB, formatNumber } from "@/lib/format"

const PAGE_SIZE = 20

function formatRupiah(n: unknown): string {
  if (typeof n !== "number" || !Number.isFinite(n)) return "—"
  return `Rp${formatNumber(n)}`
}

const FINDING_STATUS_META: Record<FindingStatus, { label: string; tone: BadgeTone }> = {
  NEW: { label: "Baru", tone: "danger" },
  INVESTIGATING: { label: "Ditelusuri", tone: "info" },
  RESOLVED: { label: "Selesai", tone: "success" },
  ACCEPTED: { label: "Diterima", tone: "info" },
}

const CORRECTION_STATUS_META: Record<CorrectionStatus, { label: string; tone: BadgeTone }> = {
  PENDING_APPROVAL: { label: "Menunggu persetujuan", tone: "info" },
  APPROVED: { label: "Disetujui", tone: "success" },
  REJECTED: { label: "Ditolak", tone: "danger" },
}

// ============================================================
// Bagian 1: Temuan rekonsiliasi
// ============================================================

const STATUS_FILTERS: Array<{ value: FindingStatus | ""; label: string }> = [
  { value: "", label: "Semua status" },
  { value: "NEW", label: "Baru" },
  { value: "INVESTIGATING", label: "Ditelusuri" },
  { value: "RESOLVED", label: "Selesai" },
  { value: "ACCEPTED", label: "Diterima" },
]

// ADM-228: RESOLVED/ACCEPTED boleh dibuka kembali ke INVESTIGATING
// (catatan wajib — divalidasi backend), agar salah tandai selesai tidak permanen.
const ALLOWED_TRANSITIONS: Record<FindingStatus, Array<"INVESTIGATING" | "RESOLVED" | "ACCEPTED">> = {
  NEW: ["INVESTIGATING", "RESOLVED", "ACCEPTED"],
  INVESTIGATING: ["RESOLVED", "ACCEPTED"],
  RESOLVED: ["INVESTIGATING"],
  ACCEPTED: ["INVESTIGATING"],
}

const isReopenTarget = (f: ReconciliationFinding): boolean =>
  (f.status === "RESOLVED" || f.status === "ACCEPTED") &&
  ALLOWED_TRANSITIONS[f.status].includes("INVESTIGATING")

function FindingsSection() {
  const { show } = useToast()
  const [rows, setRows] = useState<ReconciliationFinding[]>([])
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(false)
  const [status, setStatus] = useState<FindingStatus | "">("")
  const [urgentOnly, setUrgentOnly] = useState(false)
  const [minDiff, setMinDiff] = useState("")
  const [ackTarget, setAckTarget] = useState<ReconciliationFinding | null>(null)
  const [ackStatus, setAckStatus] = useState<"INVESTIGATING" | "RESOLVED" | "ACCEPTED">("INVESTIGATING")
  const [ackNotes, setAckNotes] = useState("")
  const [ackBusy, setAckBusy] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const q: FindingsQuery = { page, limit: PAGE_SIZE }
      if (status) q.status = status
      if (urgentOnly) q.urgentOnly = true
      const md = Number(minDiff)
      if (minDiff.trim() !== "" && Number.isFinite(md) && md > 0) q.minDifferenceIdr = md
      const res = await listFindings(q)
      setRows(res.data ?? [])
      setTotal(res.total ?? 0)
      setTotalPages(res.totalPages ?? 1)
    } catch (err: unknown) {
      show({ tone: "danger", title: "Gagal memuat temuan rekonsiliasi.", description: userMessage(err) })
    } finally {
      setLoading(false)
    }
  }, [page, status, urgentOnly, minDiff, show])

  useEffect(() => {
    void load()
  }, [load])

  const openAck = (f: ReconciliationFinding) => {
    const allowed = ALLOWED_TRANSITIONS[f.status]
    setAckStatus(allowed[0] ?? "INVESTIGATING")
    setAckNotes("")
    setAckTarget(f)
  }

  /** Unduh CSV temuan via jalur authenticated; disimpan sebagai file lokal. */
  const downloadCsv = async () => {
    try {
      const q: FindingsQuery = {}
      if (status) q.status = status
      if (urgentOnly) q.urgentOnly = true
      const md = Number(minDiff)
      if (minDiff.trim() !== "" && Number.isFinite(md) && md > 0) q.minDifferenceIdr = md
      const csv = await downloadFindingsCsv(q)
      const blob = new Blob([csv], { type: "text/csv;charset=utf-8" })
      const a = document.createElement("a")
      a.href = URL.createObjectURL(blob)
      a.download = `temuan-rekonsiliasi-${new Date().toISOString().slice(0, 10)}.csv`
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(a.href)
    } catch (err: unknown) {
      show({ tone: "danger", title: "Gagal mengunduh CSV.", description: userMessage(err) })
    }
  }

  const submitAck = async () => {
    if (!ackTarget) return
    setAckBusy(true)
    try {
      await acknowledgeFinding(ackTarget.id, {
        status: ackStatus,
        notes: ackNotes.trim() || undefined,
      })
      show({ tone: "success", title: "Status temuan diperbarui." })
      setAckTarget(null)
      void load()
    } catch (err: unknown) {
      show({ tone: "danger", title: "Gagal memperbarui temuan.", description: userMessage(err) })
    } finally {
      setAckBusy(false)
    }
  }

  return (
    <section aria-label="Temuan rekonsiliasi">
      <Card>
        <CardHeader
          title="Temuan rekonsiliasi"
          subtitle="Selisih saldo yang tercatat — tanpa PII. Ekspor CSV memakai inisial, bukan nama."
        />
        <CardBody>
          <div className="mb-4 grid grid-cols-1 gap-3 md:grid-cols-4">
            <Select
              label="Status"
              value={status}
              onChange={(e) => {
                setStatus(e.target.value as FindingStatus | "")
                setPage(1)
              }}
              options={STATUS_FILTERS}
            />
            <Input
              label="Selisih minimum (Rp)"
              type="number"
              min={0}
              placeholder="cth. 100000"
              value={minDiff}
              onChange={(e) => {
                setMinDiff(e.target.value)
                setPage(1)
              }}
            />
            <label className="flex items-end gap-2 pb-2 text-body text-text-primary">
              <input
                type="checkbox"
                checked={urgentOnly}
                onChange={(e) => {
                  setUrgentOnly(e.target.checked)
                  setPage(1)
                }}
              />
              Hanya yang mendesak
            </label>
            <div className="flex items-end gap-2">
              <Button variant="secondary" size="sm" fullWidth={false} onClick={() => void load()}>
                Muat ulang
              </Button>
              <Button
                variant="secondary"
                size="sm"
                fullWidth={false}
                onClick={() => void downloadCsv()}
                title="CSV tanpa PII — nama menjadi inisial"
              >
                Unduh CSV
              </Button>
            </div>
          </div>

          <DataTable<ReconciliationFinding>
            columns={[
              {
                key: "differenceIdr",
                header: "Selisih",
                align: "right",
                render: (r) => (
                  <span className={r.differenceIdr !== 0 ? "font-semibold text-danger-text" : ""}>
                    {r.differenceIdr < 0 ? "−" : ""}
                    {formatRupiah(Math.abs(r.differenceIdr))}
                    {r.urgent ? <Badge tone="danger">Mendesak</Badge> : null}
                  </span>
                ),
              },
              {
                key: "status",
                header: "Status",
                render: (r) => {
                  const m = FINDING_STATUS_META[r.status]
                  return <Badge tone={m.tone}>{m.label}</Badge>
                },
              },
              {
                key: "violatedInvariants",
                header: "Invariant",
                render: (r) => (
                  <span className="block max-w-xs truncate text-caption">
                    {r.violatedInvariants.join(", ") || "—"}
                  </span>
                ),
              },
              {
                key: "ageDays",
                header: "Umur",
                render: (r) => `${r.ageDays} hari`,
              },
              {
                key: "createdAt",
                header: "Dibuat",
                render: (r) => formatDateTimeWIB(r.createdAt),
              },
              {
                key: "aksi",
                header: "Aksi",
                render: (r) =>
                  ALLOWED_TRANSITIONS[r.status].length > 0 ? (
                    <Button variant="secondary" size="sm" fullWidth={false} onClick={() => openAck(r)}>
                      {isReopenTarget(r) ? "Buka kembali" : "Tindak lanjuti"}
                    </Button>
                  ) : (
                    <span className="text-caption text-text-secondary">—</span>
                  ),
              },
            ]}
            rows={rows}
            rowKey={(r) => r.id}
            loading={loading}
            emptyText="Tidak ada temuan pada filter ini."
          />
          <div className="mt-4">
            <Pagination page={page} totalPages={totalPages} total={total} pageSize={PAGE_SIZE} onPageChange={setPage} disabled={loading} />
          </div>
        </CardBody>
      </Card>

      <Dialog
        open={ackTarget !== null}
        onClose={() => setAckTarget(null)}
        title={ackTarget && isReopenTarget(ackTarget) ? "Buka kembali temuan" : "Tindak lanjuti temuan"}
        description={
          ackTarget
            ? `Selisih ${formatRupiah(Math.abs(ackTarget.differenceIdr))} • invariant: ${ackTarget.violatedInvariants.join(", ") || "—"}${
                isReopenTarget(ackTarget)
                  ? " • Temuan yang dibuka kembali wajib diberi catatan alasan."
                  : ""
              }`
            : undefined
        }
        footer={
          <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
            <Button variant="ghost" fullWidth={false} disabled={ackBusy} onClick={() => setAckTarget(null)}>
              Batal
            </Button>
            <Button variant="primary" fullWidth={false} loading={ackBusy} onClick={() => void submitAck()}>
              Simpan
            </Button>
          </div>
        }
      >
        <Select
          label="Status baru"
          value={ackStatus}
          onChange={(e) => setAckStatus(e.target.value as "INVESTIGATING" | "RESOLVED" | "ACCEPTED")}
          options={(ackTarget ? ALLOWED_TRANSITIONS[ackTarget.status] : []).map((s) => ({
            value: s,
            label: FINDING_STATUS_META[s].label,
          }))}
        />
        <div className="mt-3">
          <TextArea
            label="Catatan tindak lanjut"
            rows={3}
            value={ackNotes}
            onChange={(e) => setAckNotes(e.target.value)}
            placeholder="Contoh: selisih berasal dari fee yang belum tercatat…"
          />
        </div>
      </Dialog>
    </section>
  )
}

// ============================================================
// Bagian 2: Rekonsiliasi satu user
// ============================================================

function ReconcileUserSection() {
  const { show } = useToast()
  const { role } = useAuth()
  const [userId, setUserId] = useState("")
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<ReconcileResult | null>(null)

  const canReconcile = role === "SUPER_ADMIN"

  const run = async () => {
    const id = userId.trim()
    if (!id) {
      show({ tone: "info", title: "Isi ID pengguna dulu." })
      return
    }
    setBusy(true)
    setResult(null)
    try {
      const res = await reconcileUser(id)
      setResult(res)
      if (res.clean) {
        show({ tone: "success", title: "Saldo bersih — tidak ada selisih." })
      } else {
        show({ tone: "info", title: "Ditemukan selisih — temuan dicatat otomatis." })
      }
    } catch (err: unknown) {
      show({ tone: "danger", title: "Gagal menjalankan rekonsiliasi.", description: userMessage(err) })
    } finally {
      setBusy(false)
    }
  }

  const d = result?.discrepancy

  return (
    <section aria-label="Rekonsiliasi pengguna">
      <Card>
        <CardHeader
          title="Rekonsiliasi pengguna"
          subtitle="Hitung ulang saldo dari transaksi dan bandingkan dengan saldo aktual. Hanya SUPER_ADMIN."
        />
        <CardBody>
          {!canReconcile ? (
            <p className="text-body text-text-secondary">
              Role Anda ({role ?? "—"}) tidak diizinkan menjalankan rekonsiliasi manual.
            </p>
          ) : (
            <>
              <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
                <div className="flex-1">
                  <Input
                    label="ID pengguna"
                    placeholder="cth. USR-XXXXXXXX"
                    value={userId}
                    onChange={(e) => setUserId(e.target.value)}
                  />
                </div>
                <Button variant="primary" fullWidth={false} loading={busy} onClick={() => void run()}>
                  Jalankan rekonsiliasi
                </Button>
              </div>

              {result ? (
                <div className="mt-4 rounded-md border border-border p-4">
                  <div className="mb-3 flex items-center gap-2">
                    <Badge tone={result.clean ? "success" : "danger"}>
                      {result.clean ? "Bersih" : "Ada selisih"}
                    </Badge>
                    <span className="text-caption text-text-secondary">
                      {formatDateTimeWIB(result.reconciledAt)}
                    </span>
                  </div>
                  {d ? (
                    <dl className="grid grid-cols-2 gap-3 md:grid-cols-4">
                      <div>
                        <dt className="text-caption text-text-secondary">Saldo tercatat</dt>
                        <dd className="text-body font-semibold">{formatRupiah(d.actualTotal)}</dd>
                      </div>
                      <div>
                        <dt className="text-caption text-text-secondary">Saldo hasil hitung</dt>
                        <dd className="text-body font-semibold">{formatRupiah(d.expectedTotal)}</dd>
                      </div>
                      <div>
                        <dt className="text-caption text-text-secondary">Selisih</dt>
                        <dd className="text-body font-semibold text-danger-text">
                          {d.discrepancy < 0 ? "−" : ""}
                          {formatRupiah(Math.abs(d.discrepancy))}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-caption text-text-secondary">Invariant dilanggar</dt>
                        <dd className="text-body font-semibold">
                          {d.invariantViolation ? "Ya" : "Tidak"}
                        </dd>
                      </div>
                    </dl>
                  ) : (
                    <p className="text-body text-text-secondary">
                      Saldo tercatat sama dengan hasil perhitungan ulang.
                    </p>
                  )}
                </div>
              ) : null}
            </>
          )}
        </CardBody>
      </Card>
    </section>
  )
}

// ============================================================
// Bagian 2b: Rekonsiliasi massal (async) — BAI-051
// ============================================================

function ReconcileAllSection() {
  const { show } = useToast()
  const { role } = useAuth()
  const [busy, setBusy] = useState(false)
  const [job, setJob] = useState<ReconcileJobStatus | null>(null)
  const [polling, setPolling] = useState(false)

  const canReconcile = role === "SUPER_ADMIN"

  const poll = useCallback(async (jobId: string | number) => {
    setPolling(true)
    try {
      const st = await getReconcileJobStatus(jobId)
      setJob(st)
      // Poll tiap 5 detik sampai terminal (completed/failed).
      if (st.status === "completed" || st.status === "failed") {
        setPolling(false)
        show({
          tone: st.status === "completed" ? "success" : "danger",
          title: st.status === "completed" ? "Rekonsiliasi massal selesai." : "Rekonsiliasi massal gagal.",
          description: st.status === "failed" && st.error ? st.error : undefined,
        })
      } else {
        setTimeout(() => void poll(jobId), 5000)
      }
    } catch (err: unknown) {
      setPolling(false)
      show({ tone: "danger", title: "Gagal memantau job rekonsiliasi.", description: userMessage(err) })
    }
  }, [show])

  const run = async () => {
    if (busy || polling) return
    setBusy(true)
    setJob(null)
    try {
      const res = await reconcileAll()
      show({ tone: "info", title: "Job rekonsiliasi massal diantrekan.", description: `Job ID: ${res.jobId}` })
      void poll(res.jobId)
    } catch (err: unknown) {
      show({ tone: "danger", title: "Gagal memulai rekonsiliasi massal.", description: userMessage(err) })
    } finally {
      setBusy(false)
    }
  }

  return (
    <section aria-label="Rekonsiliasi massal">
      <Card>
        <CardHeader
          title="Rekonsiliasi massal"
          subtitle="Antrekan job async untuk semua wallet (hasil snapshot batch). Hanya SUPER_ADMIN."
        />
        <CardBody>
          {!canReconcile ? (
            <p className="text-body text-text-secondary">
              Role Anda ({role ?? "—"}) tidak diizinkan menjalankan rekonsiliasi massal.
            </p>
          ) : (
            <>
              <Button variant="primary" fullWidth={false} loading={busy || polling} onClick={() => void run()}>
                {polling ? "Memantau job…" : "Jalankan reconcile-all"}
              </Button>
              {job ? (
                <div className="mt-4 rounded-md border border-border p-4">
                  <div className="mb-2 flex items-center gap-2">
                    <Badge tone={job.status === "completed" ? "success" : job.status === "failed" ? "danger" : "info"}>
                      {job.status}
                    </Badge>
                    <span className="font-mono text-caption text-text-secondary">
                      job {String(job.jobId)}
                    </span>
                  </div>
                  {job.requestedAt ? (
                    <p className="text-caption text-text-secondary">
                      Diminta {formatDateTimeWIB(job.requestedAt)}{job.requestedBy ? ` oleh ${job.requestedBy}` : ""}
                    </p>
                  ) : null}
                  {job.status === "completed" && job.result != null ? (
                    <pre className="mt-2 max-h-48 overflow-auto rounded bg-surface-sunken p-2 font-mono text-caption">
                      {JSON.stringify(job.result, null, 2)}
                    </pre>
                  ) : null}
                </div>
              ) : null}
            </>
          )}
        </CardBody>
      </Card>
    </section>
  )
}

// ============================================================
// Bagian 3: Koreksi ledger — dual approval
// ============================================================

const MAX_CORRECTION_IDR = 10_000_000

function CorrectionRequestDialog({
  open,
  onClose,
  onCreated,
}: {
  open: boolean
  onClose: () => void
  onCreated: () => void
}) {
  const { show } = useToast()
  const { requestStepUp, stepUpDialog } = useStepUp()
  const [userId, setUserId] = useState("")
  const [amount, setAmount] = useState("")
  const [type, setType] = useState<"CREDIT" | "DEBIT">("CREDIT")
  const [reason, setReason] = useState("")
  const [ticketRef, setTicketRef] = useState("")
  const [password, setPassword] = useState("")
  const [preview, setPreview] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const amountIdr = Number(amount)
  const valid =
    userId.trim() !== "" &&
    Number.isInteger(amountIdr) &&
    amountIdr > 0 &&
    amountIdr <= MAX_CORRECTION_IDR &&
    reason.trim().length >= 10 &&
    ticketRef.trim() !== "" &&
    password !== ""

  const reset = () => {
    setUserId("")
    setAmount("")
    setType("CREDIT")
    setReason("")
    setTicketRef("")
    setPassword("")
    setPreview(false)
    setError(null)
  }

  const submit = async () => {
    setError(null)
    setBusy(true)
    try {
      const token = await requestStepUp({
        action: "ledgerCorrection.request",
        title: "Ajukan koreksi ledger",
        description: `Koreksi ${type} ${formatNumber(amountIdr)} untuk user ${userId.trim()}.`,
      })
      if (!token) return
      await requestCorrection(
        {
          userId: userId.trim(),
          amountIdr,
          type,
          reason: reason.trim(),
          ticketRef: ticketRef.trim(),
          idempotencyKey: newIdempotencyKey(),
          // ADM-206: kata sandi asli — diverifikasi server-side (bcrypt + rate limit).
          reauthPassword: password,
        },
        { stepUpToken: token },
      )
      show({ tone: "success", title: "Pengajuan koreksi dibuat — menunggu persetujuan admin lain." })
      reset()
      onClose()
      onCreated()
    } catch (err: unknown) {
      setError(userMessage(err) || "Gagal membuat pengajuan koreksi.")
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <Dialog
        open={open}
        onClose={() => {
          reset()
          onClose()
        }}
      title={preview ? "Pratinjau pengajuan koreksi" : "Pengajuan koreksi ledger"}
      description={
        preview
          ? "Periksa kembali sebelum dikirim. Pengajuan ini TIDAK mengubah saldo."
          : "Langkah 1 dari 2 — pengajuan butuh persetujuan admin BERBEDA sebelum dieksekusi."
      }
      footer={
        <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
          <Button
            variant="ghost"
            fullWidth={false}
            disabled={busy}
            onClick={() => (preview ? setPreview(false) : (reset(), onClose()))}
          >
            {preview ? "Kembali" : "Batal"}
          </Button>
          {preview ? (
            <Button variant="primary" fullWidth={false} loading={busy} onClick={() => void submit()}>
              Kirim pengajuan
            </Button>
          ) : (
            <Button variant="primary" fullWidth={false} disabled={!valid} onClick={() => setPreview(true)}>
              Pratinjau
            </Button>
          )}
        </div>
      }
    >
      {preview ? (
        <dl className="space-y-3">
          <div className="flex justify-between gap-4">
            <dt className="text-caption text-text-secondary">Pengguna</dt>
            <dd className="text-body font-medium">{userId.trim()}</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-caption text-text-secondary">Jenis</dt>
            <dd>
              <Badge tone={type === "CREDIT" ? "success" : "danger"}>
                {type === "CREDIT" ? "Kredit (tambah saldo)" : "Debit (kurangi saldo)"}
              </Badge>
            </dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-caption text-text-secondary">Nominal</dt>
            <dd className="text-body font-semibold">{formatRupiah(amountIdr)}</dd>
          </div>
          <div>
            <dt className="text-caption text-text-secondary">Alasan</dt>
            <dd className="text-body">{reason.trim()}</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-caption text-text-secondary">Referensi tiket</dt>
            <dd className="text-body font-medium">{ticketRef.trim()}</dd>
          </div>
          <p className="rounded-md bg-warning-soft p-3 text-caption text-warning-text">
            Setelah dikirim, pengajuan berstatus Menunggu persetujuan. Hanya admin
            selain pengaju yang dapat menyetujui/menolak.
          </p>
        </dl>
      ) : (
        <div className="space-y-3">
          <Input label="ID pengguna" value={userId} onChange={(e) => setUserId(e.target.value)} placeholder="cth. USR-XXXXXXXX" />
          <div className="grid grid-cols-2 gap-3">
            <Input
              label={`Nominal (Rp, maks ${formatNumber(MAX_CORRECTION_IDR)})`}
              type="number"
              min={1}
              max={MAX_CORRECTION_IDR}
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
            <Select
              label="Jenis koreksi"
              value={type}
              onChange={(e) => setType(e.target.value as "CREDIT" | "DEBIT")}
              options={[
                { value: "CREDIT", label: "Kredit — tambah saldo" },
                { value: "DEBIT", label: "Debit — kurangi saldo" },
              ]}
            />
          </div>
          <TextArea
            label="Alasan (min 10 karakter)"
            rows={3}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Contoh: selisih Rp50.000 dari rekonsiliasi batch 2026-09-26…"
          />
          <Input label="Referensi tiket/insiden" value={ticketRef} onChange={(e) => setTicketRef(e.target.value)} placeholder="cth. TICKET-123" />
          <Input
            label="Kata sandi Anda (konfirmasi)"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Wajib diisi sebelum submit"
            autoComplete="current-password"
          />
          <p className="rounded-md bg-info-soft p-3 text-caption text-info-text">
            Kata sandi diverifikasi server-side terhadap hash akun admin Anda
            (rate limit 5x salah / 15 menit). Tidak pernah disimpan di log.
          </p>
          {error ? <p className="text-body text-danger-text">{error}</p> : null}
        </div>
      )}
      </Dialog>
      {stepUpDialog}
    </>
  )
}

function CorrectionsSection() {
  const { show } = useToast()
  const { profile } = useAuth()
  const { requestStepUp, stepUpDialog } = useStepUp()
  const [rows, setRows] = useState<LedgerCorrection[]>([])
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(false)
  const [statusFilter, setStatusFilter] = useState<CorrectionStatus | "">("")
  const [showRequest, setShowRequest] = useState(false)
  const [decideTarget, setDecideTarget] = useState<LedgerCorrection | null>(null)
  const [decision, setDecision] = useState<"APPROVE" | "REJECT">("APPROVE")
  const [decisionNotes, setDecisionNotes] = useState("")
  const [decidePassword, setDecidePassword] = useState("")
  const [decideBusy, setDecideBusy] = useState(false)

  const myAdminIds = [profile?.adminId, profile?.id].filter(Boolean) as string[]

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await listCorrections({
        page,
        limit: PAGE_SIZE,
        ...(statusFilter ? { status: statusFilter } : {}),
      })
      setRows(res.data ?? [])
      setTotal(res.total ?? 0)
      setTotalPages(res.totalPages ?? 1)
    } catch (err: unknown) {
      show({ tone: "danger", title: "Gagal memuat pengajuan koreksi.", description: userMessage(err) })
    } finally {
      setLoading(false)
    }
  }, [page, statusFilter, show])

  useEffect(() => {
    void load()
  }, [load])

  const isSelf = (c: LedgerCorrection) => myAdminIds.includes(c.requestedBy)

  const openDecide = (c: LedgerCorrection, d: "APPROVE" | "REJECT") => {
    setDecision(d)
    setDecisionNotes("")
    setDecidePassword("")
    setDecideTarget(c)
  }

  const submitDecision = async () => {
    if (!decideTarget) return
    if (!decidePassword) {
      show({ tone: "info", title: "Isi kata sandi Anda sebagai konfirmasi." })
      return
    }
    setDecideBusy(true)
    try {
      const token = await requestStepUp({
        action: "ledgerCorrection.approve",
        targetId: decideTarget.id,
        title: decision === "APPROVE" ? "Setujui koreksi ledger" : "Tolak koreksi ledger",
        description: `Keputusan ${decision} untuk koreksi ${formatNumber(decideTarget.amountIdr)}.`,
      })
      if (!token) return
      await decideCorrection(
        decideTarget.id,
        {
          decision,
          notes: decisionNotes.trim() || undefined,
          // ADM-206: kata sandi asli — diverifikasi server-side (bcrypt + rate limit).
          reauthPassword: decidePassword,
        },
        newIdempotencyKey(),
        { stepUpToken: token },
      )
      show({
        tone: "success",
        title: decision === "APPROVE" ? "Koreksi disetujui dan dieksekusi." : "Koreksi ditolak.",
      })
      setDecideTarget(null)
      setDecidePassword("")
      void load()
    } catch (err: unknown) {
      show({ tone: "danger", title: "Gagal memproses keputusan.", description: userMessage(err) })
    } finally {
      setDecideBusy(false)
    }
  }

  return (
    <section aria-label="Koreksi ledger">
      <Card>
        <CardHeader
          title="Koreksi ledger (dual approval)"
          subtitle="Pengajuan tidak mengubah saldo sampai disetujui admin BERBEDA. Batas Rp10.000.000/pengajuan."
        />
        <CardBody>
          <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-end">
            <div className="sm:w-64">
              <Select
                label="Status"
                value={statusFilter}
                onChange={(e) => {
                  setStatusFilter(e.target.value as CorrectionStatus | "")
                  setPage(1)
                }}
                options={[
                  { value: "", label: "Semua status" },
                  { value: "PENDING_APPROVAL", label: "Menunggu persetujuan" },
                  { value: "APPROVED", label: "Disetujui" },
                  { value: "REJECTED", label: "Ditolak" },
                ]}
              />
            </div>
            <Button variant="primary" size="sm" fullWidth={false} onClick={() => setShowRequest(true)}>
              + Pengajuan baru
            </Button>
          </div>

          <DataTable<LedgerCorrection>
            columns={[
              {
                key: "amountIdr",
                header: "Nominal",
                align: "right",
                render: (r) => (
                  <span>
                    {/* ADM-230: label Indonesia, bukan raw enum */}
                    <Badge tone={r.type === "CREDIT" ? "success" : "danger"}>{r.type === "CREDIT" ? "Kredit" : r.type === "DEBIT" ? "Debit" : String(r.type)}</Badge>{" "}
                    <span className="font-semibold">{formatRupiah(r.amountIdr)}</span>
                  </span>
                ),
              },
              {
                key: "status",
                header: "Status",
                render: (r) => {
                  const m = CORRECTION_STATUS_META[r.status]
                  return <Badge tone={m.tone}>{m.label}</Badge>
                },
              },
              {
                key: "reason",
                header: "Alasan / Tiket",
                render: (r) => (
                  <div>
                    <p className="block max-w-xs truncate">{r.reason}</p>
                    <p className="text-caption text-text-secondary">{r.ticketRef}</p>
                  </div>
                ),
              },
              {
                key: "requestedBy",
                header: "Pengaju",
                render: (r) => (
                  <span>
                    {r.requestedBy}
                    {isSelf(r) ? <Badge tone="info">Anda</Badge> : null}
                  </span>
                ),
              },
              {
                key: "decidedBy",
                header: "Diputuskan oleh",
                render: (r) => r.decidedBy ?? "—",
              },
              {
                key: "aksi",
                header: "Aksi",
                render: (r) =>
                  r.status === "PENDING_APPROVAL" ? (
                    isSelf(r) ? (
                      <span className="text-caption text-text-secondary" title="Self-approval dilarang — minta admin lain.">
                        Menunggu admin lain
                      </span>
                    ) : (
                      <div className="flex gap-2">
                        <Button variant="primary" size="sm" fullWidth={false} onClick={() => openDecide(r, "APPROVE")}>
                          Setujui
                        </Button>
                        <Button variant="secondary" size="sm" fullWidth={false} onClick={() => openDecide(r, "REJECT")}>
                          Tolak
                        </Button>
                      </div>
                    )
                  ) : (
                    <span className="text-caption text-text-secondary">
                      {r.executedTxId ? `Tx ${r.executedTxId}` : "—"}
                    </span>
                  ),
              },
            ]}
            rows={rows}
            rowKey={(r) => r.id}
            loading={loading}
            emptyText="Belum ada pengajuan koreksi."
          />
          <div className="mt-4">
            <Pagination page={page} totalPages={totalPages} total={total} pageSize={PAGE_SIZE} onPageChange={setPage} disabled={loading} />
          </div>
        </CardBody>
      </Card>

      <CorrectionRequestDialog open={showRequest} onClose={() => setShowRequest(false)} onCreated={() => void load()} />

      <Dialog
        open={decideTarget !== null}
        onClose={() => setDecideTarget(null)}
        title={decision === "APPROVE" ? "Setujui koreksi" : "Tolak koreksi"}
        description={
          decideTarget
            ? `${decideTarget.type === "CREDIT" ? "Kredit" : decideTarget.type === "DEBIT" ? "Debit" : decideTarget.type} ${formatRupiah(decideTarget.amountIdr)} untuk ${decideTarget.userId}`
            : undefined
        }
        footer={
          <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
            <Button variant="ghost" fullWidth={false} disabled={decideBusy} onClick={() => setDecideTarget(null)}>
              Batal
            </Button>
            <Button
              variant={decision === "APPROVE" ? "primary" : "destructive"}
              fullWidth={false}
              loading={decideBusy}
              onClick={() => void submitDecision()}
            >
              {decision === "APPROVE" ? "Setujui & eksekusi" : "Tolak pengajuan"}
            </Button>
          </div>
        }
      >
        {decision === "APPROVE" ? (
          <p className="text-body text-text-secondary">
            Menyetujui akan <strong>langsung memutasi saldo wallet</strong> pengguna secara
            atomik dan tercatat di audit. Tindakan ini tidak bisa dibatalkan.
          </p>
        ) : (
          <p className="text-body text-text-secondary">
            Penolakan membatalkan pengajuan tanpa mengubah saldo.
          </p>
        )}
        <div className="mt-3 space-y-3">
          <TextArea
            label="Catatan keputusan"
            rows={2}
            value={decisionNotes}
            onChange={(e) => setDecisionNotes(e.target.value)}
            placeholder="Contoh: sudah diverifikasi dengan tiket…"
          />
          <Input
            label="Kata sandi Anda (konfirmasi)"
            type="password"
            value={decidePassword}
            onChange={(e) => setDecidePassword(e.target.value)}
            autoComplete="current-password"
          />
          <p className="rounded-md bg-info-soft p-3 text-caption text-info-text">
            Kata sandi diverifikasi server-side terhadap hash akun admin Anda
            (rate limit 5x salah / 15 menit). Tidak pernah disimpan di log.
          </p>
        </div>
      </Dialog>
      {stepUpDialog}
    </section>
  )
}

// ============================================================
// Bagian 4: Batch rekonsiliasi terjadwal
// ============================================================

function BatchesSection() {
  const { show } = useToast()
  const [batches, setBatches] = useState<ReconciliationBatch[]>([])
  const [loading, setLoading] = useState(false)
  const [drillBatch, setDrillBatch] = useState<ReconciliationBatch | null>(null)
  const [drillRows, setDrillRows] = useState<ReconciliationFinding[]>([])
  const [drillPage, setDrillPage] = useState(1)
  const [drillTotalPages, setDrillTotalPages] = useState(1)
  const [drillTotal, setDrillTotal] = useState(0)
  const [drillLoading, setDrillLoading] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await listReconciliationBatches()
      setBatches(res.batches ?? [])
    } catch (err: unknown) {
      show({ tone: "danger", title: "Gagal memuat batch rekonsiliasi.", description: userMessage(err) })
    } finally {
      setLoading(false)
    }
  }, [show])

  useEffect(() => {
    void load()
  }, [load])

  const loadDrill = useCallback(
    async (batch: ReconciliationBatch, page: number) => {
      setDrillLoading(true)
      try {
        const res = await getBatchDiscrepancies(batch.id, { page, limit: PAGE_SIZE })
        setDrillRows(res.data ?? [])
        setDrillTotal(res.total ?? 0)
        setDrillTotalPages(res.totalPages ?? 1)
      } catch (err: unknown) {
        show({ tone: "danger", title: "Gagal memuat rincian batch.", description: userMessage(err) })
      } finally {
        setDrillLoading(false)
      }
    },
    [show],
  )

  const openDrill = (b: ReconciliationBatch) => {
    setDrillBatch(b)
    setDrillPage(1)
    void loadDrill(b, 1)
  }

  const latest = batches[0]

  return (
    <section aria-label="Batch rekonsiliasi">
      <Card>
        <CardHeader
          title="Batch rekonsiliasi terjadwal"
          subtitle="Ringkasan immutable dari proses reconcile-all. Maks 20 batch terakhir."
        />
        <CardBody>
          {latest ? (
            <div className="mb-4 grid grid-cols-3 gap-3">
              <div className="rounded-md border border-border p-3">
                <p className="text-caption text-text-secondary">Diperiksa</p>
                <p className="text-h3 font-semibold">{formatNumber(latest.checked)}</p>
              </div>
              <div className="rounded-md border border-border p-3">
                <p className="text-caption text-text-secondary">Bersih</p>
                <p className="text-h3 font-semibold text-success-text">{formatNumber(latest.clean)}</p>
              </div>
              <div className="rounded-md border border-border p-3">
                <p className="text-caption text-text-secondary">Bermasalah</p>
                <p className="text-h3 font-semibold text-danger-text">{formatNumber(latest.problematic)}</p>
              </div>
            </div>
          ) : null}

          <DataTable<ReconciliationBatch>
            columns={[
              {
                key: "finishedAt",
                header: "Selesai",
                render: (r) => formatDateTimeWIB(r.finishedAt),
              },
              {
                key: "checked",
                header: "Diperiksa",
                align: "right",
                render: (r) => formatNumber(r.checked),
              },
              {
                key: "clean",
                header: "Bersih",
                align: "right",
                render: (r) => formatNumber(r.clean),
              },
              {
                key: "problematic",
                header: "Bermasalah",
                align: "right",
                render: (r) => (
                  <span className={r.problematic > 0 ? "font-semibold text-danger-text" : ""}>
                    {formatNumber(r.problematic)}
                  </span>
                ),
              },
              {
                key: "durationMs",
                header: "Durasi",
                align: "right",
                render: (r) => `${(r.durationMs / 1000).toFixed(1)} dtk`,
              },
              {
                key: "aksi",
                header: "Aksi",
                render: (r) =>
                  r.problematic > 0 ? (
                    <Button variant="secondary" size="sm" fullWidth={false} onClick={() => openDrill(r)}>
                      Lihat selisih
                    </Button>
                  ) : (
                    <span className="text-caption text-text-secondary">—</span>
                  ),
              },
            ]}
            rows={batches}
            rowKey={(r) => r.id}
            loading={loading}
            emptyText="Belum ada batch rekonsiliasi."
          />
        </CardBody>
      </Card>

      <Dialog
        open={drillBatch !== null}
        onClose={() => setDrillBatch(null)}
        title={drillBatch ? `Selisih batch ${formatDateTimeWIB(drillBatch.finishedAt)}` : "Selisih batch"}
        description="Temuan yang tercatat dari batch ini (tanpa PII)."
        className="max-w-3xl"
      >
        <DataTable<ReconciliationFinding>
          columns={[
            {
              key: "differenceIdr",
              header: "Selisih",
              align: "right",
              render: (r) => (
                <span className="font-semibold text-danger-text">
                  {r.differenceIdr < 0 ? "−" : ""}
                  {formatRupiah(Math.abs(r.differenceIdr))}
                </span>
              ),
            },
            {
              key: "status",
              header: "Status",
              render: (r) => {
                const m = FINDING_STATUS_META[r.status]
                return <Badge tone={m.tone}>{m.label}</Badge>
              },
            },
            {
              key: "violatedInvariants",
              header: "Invariant",
              render: (r) => r.violatedInvariants.join(", ") || "—",
            },
            {
              key: "createdAt",
              header: "Dibuat",
              render: (r) => formatDateTimeWIB(r.createdAt),
            },
          ]}
          rows={drillRows}
          rowKey={(r) => r.id}
          loading={drillLoading}
          emptyText="Tidak ada selisih pada batch ini."
        />
        <div className="mt-4">
          <Pagination
            page={drillPage}
            totalPages={drillTotalPages}
            total={drillTotal}
            pageSize={PAGE_SIZE}
            onPageChange={(p) => {
              setDrillPage(p)
              if (drillBatch) void loadDrill(drillBatch, p)
            }}
            disabled={drillLoading}
          />
        </div>
      </Dialog>
    </section>
  )
}

// ============================================================
// Bagian 5: Uji akses per role (read-only)
// ============================================================

type SimulatedRole = "SUPER_ADMIN" | "FINANCE_ADMIN" | "DISPUTE_ADMIN" | "KYC_ADMIN" | "CUSTOMER_SUPPORT"

// ADM-229: matriks ini adalah PERKIRAAN yang ditulis manual (hard-coded) dari
// guard backend (@AdminRoles) per 2026-09-27 — BUKAN turunan otomatis dari
// kode backend. Bila guard backend berubah, matriks ini bisa drift; perbarui
// tanggal verifikasi di bawah setiap kali dicocokkan ulang dengan backend.
const ACTION_MATRIX_VERIFIED_AT = "2026-09-27"

const ACTION_MATRIX: Array<{
  action: string
  allowed: SimulatedRole[]
  note: string
}> = [
  {
    action: "Lihat ringkasan & transaksi",
    allowed: ["SUPER_ADMIN", "FINANCE_ADMIN"],
    note: "Menu Keuangan",
  },
  {
    action: "Lihat temuan rekonsiliasi",
    allowed: ["SUPER_ADMIN", "FINANCE_ADMIN"],
    note: "Read-only untuk role finance",
  },
  {
    action: "Tindak lanjuti temuan",
    allowed: ["SUPER_ADMIN", "FINANCE_ADMIN"],
    note: "Ubah status temuan",
  },
  {
    action: "Jalankan rekonsiliasi user",
    allowed: ["SUPER_ADMIN"],
    note: "Khusus SUPER_ADMIN di backend",
  },
  {
    action: "Ajukan koreksi ledger",
    allowed: ["SUPER_ADMIN", "FINANCE_ADMIN"],
    note: "Langkah 1 — tanpa mutasi",
  },
  {
    action: "Setujui/tolak koreksi",
    allowed: ["SUPER_ADMIN", "FINANCE_ADMIN"],
    note: "Langkah 2 — approver ≠ pengaju",
  },
  {
    action: "Setujui/tolak penarikan",
    allowed: ["SUPER_ADMIN", "FINANCE_ADMIN"],
    note: "Antrean withdrawal",
  },
  {
    action: "Lihat batch rekonsiliasi",
    allowed: ["SUPER_ADMIN", "FINANCE_ADMIN"],
    note: "Read-only",
  },
]

function RoleTestPanel() {
  const { role: myRole } = useAuth()
  const [simRole, setSimRole] = useState<SimulatedRole>((myRole as SimulatedRole) ?? "FINANCE_ADMIN")

  return (
    <section aria-label="Uji akses peran">
      <Card>
        <CardHeader
          title="Uji akses sebagai peran (perkiraan)"
          subtitle={`Simulasi read-only berdasarkan perkiraan manual guard backend — diverifikasi ${ACTION_MATRIX_VERIFIED_AT}. Bukan sumber kebenaran akses; guard backend yang menentukan. Tidak mengubah akses sungguhan.`}
        />
        <CardBody>
          <div className="mb-4 sm:w-72">
            <Select
              label="Simulasikan peran"
              value={simRole}
              onChange={(e) => setSimRole(e.target.value as SimulatedRole)}
              options={[
                { value: "SUPER_ADMIN", label: "SUPER_ADMIN" },
                { value: "FINANCE_ADMIN", label: "FINANCE_ADMIN" },
                { value: "DISPUTE_ADMIN", label: "DISPUTE_ADMIN" },
                { value: "KYC_ADMIN", label: "KYC_ADMIN" },
                { value: "CUSTOMER_SUPPORT", label: "CUSTOMER_SUPPORT" },
              ]}
            />
          </div>
          <DataTable<{ action: string; note: string; ok: boolean }>
            columns={[
              { key: "action", header: "Aksi", render: (r) => r.action },
              { key: "note", header: "Catatan", render: (r) => <span className="text-caption text-text-secondary">{r.note}</span> },
              {
                key: "ok",
                header: "Akses",
                render: (r) => <Badge tone={r.ok ? "success" : "danger"}>{r.ok ? "Diizinkan" : "Ditolak"}</Badge>,
              },
            ]}
            rows={ACTION_MATRIX.map((a) => ({
              action: a.action,
              note: a.note,
              ok: a.allowed.includes(simRole),
            }))}
            rowKey={(r) => r.action}
            emptyText="—"
          />
          <p className="mt-3 text-caption text-text-secondary">
            Peran Anda saat ini: {myRole ?? "—"}. Matriks ini mencerminkan guard
            backend (@AdminRoles); penolakan sungguhan ditegakkan server-side.
          </p>
        </CardBody>
      </Card>
    </section>
  )
}

// ============================================================
// Komposisi panel
// ============================================================

export function ReconciliationPanel() {
  return (
    <div className="space-y-8">
      <ReconcileUserSection />
      {/* BAI-051: trigger + polling reconcile-all async (SUPER_ADMIN). */}
      <ReconcileAllSection />
      <FindingsSection />
      <CorrectionsSection />
      <BatchesSection />
      <RoleTestPanel />
    </div>
  )
}
