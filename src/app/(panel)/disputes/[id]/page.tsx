"use client"

/**
 * Admin — Detail sengketa: info, riwayat pesan, dan aksi putusan.
 *
 * Alur aksi (sesuai mobile):
 * - "Mulai review" → markDisputeUnderReview (hanya ASSIGNED — ADM-108).
 * - "Assign"/"Ambil sengketa ini" → OPEN (semua peran); SUPER_ADMIN boleh
 *   reassign di ASSIGNED/UNDER_REVIEW (BAI-092). DISPUTE_ADMIN self-assign,
 *   SUPER_ADMIN memilih lewat dropdown.
 * - "Resolve" → Dialog: keputusan FULL_BUYER/FULL_SELLER/SPLIT (Select) +
 *   catatan wajib min 100 karakter + persen SPLIT (1–99, jumlah 100, hanya
 *   saat SPLIT) + pratinjau nominal disbursement read-only sebelum eksekusi
 *   (ADM-109) — hanya bila status UNDER_REVIEW/ESCALATED (DP-007).
 *   Payload persis DisputeDecisionDto backend (DP-001).
 * - Riwayat pesan mediasi + paginasi "muat pesan lama" (ADM-127) + template
 *   pesan mediasi statis (ADM-126).
 * - Percakapan order buyer–seller termasuk pesan terhapus (ADM-111).
 * - Kartu hasil putusan untuk sengketa resolved (ADM-110); panggilan
 *   mediasi tercatat (ADM-120).
 * - Polling ringan 20 dtk saat tab aktif + indikator kesegaran (DP-021).
 *
 * Port dari frontend/app/admin/(panel)/disputes/[id].tsx → web desktop.
 */

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react"
import { useParams, useRouter } from "next/navigation"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardBody, CardHeader } from "@/components/ui/card"
import { Dialog } from "@/components/ui/dialog"
import { EmptyState } from "@/components/ui/empty-state"
import { Input, TextArea } from "@/components/ui/input"
import { Spinner } from "@/components/ui/spinner"
import { useToast } from "@/components/ui/toast"
import { RoleGate } from "@/components/admin/role-gate"
import { Select } from "@/components/admin/select"
import {
  assignDispute,
  escalateDispute,
  getDisputeDetail,
  getDisputeChat,
  getDisputeMessages,
  listDisputes,
  markDisputeUnderReview,
  previewResolveDispute,
  resolveDispute,
  sendDisputeMessage,
  listDisputeNotes,
  addDisputeNote,
  adminUploadDisputeEvidenceFile,
  adminSubmitDisputeEvidence,
  DISPUTE_EVIDENCE_ACCEPT,
  validateDisputeEvidenceFiles,
  retryDisputeSettlement,
  DISPUTE_SETTLEMENT_RETRY_STEP_UP_ACTION,
  type AdminDisputeItem,
  type DisputeMoneyTrail,
  type DisputeDecision,
  type DisputeInternalNote,
  type DisputeMessage,
  type DisputeOrderChatMessage,
  type ResolvePreviewResult,
} from "@/lib/api/admin/disputes"
import { useStepUp } from "@/components/admin/step-up-gate"
import { newIdempotencyKey } from "@/lib/api/admin/finance"
import { StepUpNotSupportedError } from "@/lib/api/admin/step-up"
import { listAdmins } from "@/lib/api/admin/management"
import { useAuth } from "@/lib/auth-context"
import { userMessage } from "@/lib/api/response"
import { formatDateTimeWIB, formatIDR as formatIDRCanonical, formatIdrSen } from "@/lib/format"
// ADM-405: PII penggugat di-mask secara default (mask-only, tanpa unmask).
import { maskEmail, maskName } from "@/lib/pii"
// Batch 139 — H: fondasi admin web.
import { DisputePresence } from "@/components/admin/batch139/dispute-presence"
import { SplitComposer } from "@/components/admin/batch139/composer-split"
import { DraftStatus, useDraftNote } from "@/components/admin/batch139/draft-notes"
import {
  EvidenceChecklist,
  useEvidenceChecklist,
} from "@/components/admin/batch139/evidence-checklist"
import { RevisionBanner, useRevisionGuard } from "@/components/admin/batch139/revision-guard"

import { DISPUTE_CATEGORY_LABEL, DISPUTE_STATUS_LABEL, DISPUTE_STATUS_TONE } from "../maps"

type Resolution = DisputeDecision

const RESOLUTION_OPTIONS = [
  { value: "FULL_BUYER", label: "Menangkan pembeli" },
  { value: "FULL_SELLER", label: "Menangkan penjual" },
  { value: "SPLIT", label: "Dana dibagi kedua pihak" },
]

/**
 * H04: alasan TERSTRUKTUR untuk keputusan sengketa (wajib dipilih).
 * Disimpan di catatan keputusan; backend mencatat aksi resolve di audit.
 */
const RESOLVE_REASON_OPTIONS = [
  { value: "BUYER_EVIDENCE_STRONGER", label: "Bukti pembeli lebih kuat" },
  { value: "SELLER_EVIDENCE_STRONGER", label: "Bukti penjual lebih kuat" },
  { value: "SELLER_NO_RESPONSE", label: "Penjual tidak merespons" },
  { value: "BUYER_NO_RESPONSE", label: "Pembeli tidak merespons" },
  { value: "MUTUAL_AGREEMENT", label: "Kesepakatan kedua pihak" },
  { value: "POLICY_VIOLATION", label: "Pelanggaran kebijakan" },
  { value: "OTHER", label: "Lainnya (jelaskan di catatan)" },
]

/**
 * ADM-126: template pesan mediasi — string statis yang aman, tanpa PII,
 * tanpa janji nominal/waktu. Admin bisa mengedit sebelum mengirim.
 */
const MESSAGE_TEMPLATES = [
  {
    label: "Konfirmasi peninjauan",
    text: "Terima kasih. Sengketa ini sedang kami tinjau berdasarkan bukti dari kedua pihak. Kami akan mengabari perkembangannya di sini.",
  },
  {
    label: "Minta klarifikasi",
    text: "Mohon kedua pihak menyampaikan klarifikasi atau bukti tambahan melalui halaman sengketa ini. Batas penyampaian akan kami informasikan menyusul.",
  },
  {
    label: "Jadwal putusan",
    text: "Peninjauan hampir selesai. Keputusan mediasi akan kami sampaikan melalui halaman ini. Terima kasih atas kesabarannya.",
  },
]

/**
 * Adapter: nilai order bisa string numerik (kolom desimal) — normalisasi ke
 * number lalu delegasi ke formatIDR kanonis (@/lib/format): "-RpX" untuk
 * negatif (SYS-C-104) + pecahan 2 desimal tanpa Math.round diam-diam
 * (SYS-C-101 / BAI-052).
 */
function formatIDR(n: unknown): string {
  const v = typeof n === "string" ? Number(n) : n
  return formatIDRCanonical(v)
}

type DisputeParty = { userId?: string; fullName?: string; email?: string }
type DisputeOrderInfo = {
  buyerId?: string
  sellerId?: string
  orderValue?: string | number
  buyerPayAmount?: string | number
  sellerReceiveAmount?: string | number
  status?: string
}
type DisputeEvidenceItem = {
  id: string
  submittedByRole?: string
  description?: string
  fileUrls?: string[]
  /** URL unduh bertanda tangan dari backend admin (pengganti fileUrls mentah). */
  fileDownloadUrls?: string[]
  fileTypes?: string[]
  createdAt?: string
}

/** Backend mengirim URL aman di `fileDownloadUrls`; `fileUrls` dikosongkan. */
function evidenceUrls(e: Record<string, unknown>): string[] {
  const pick = (v: unknown) => (Array.isArray(v) ? v.filter((u): u is string => typeof u === "string") : [])
  const dl = pick(e.fileDownloadUrls)
  return dl.length > 0 ? dl : pick(e.fileUrls)
}

/** Klasifikasi dari MIME (backend menyimpan `image/jpeg`, `video/mp4`, …). */
function evidenceKind(mime?: string): "image" | "video" | "pdf" | "other" {
  if (mime?.startsWith("image/")) return "image"
  if (mime?.startsWith("video/")) return "video"
  if (mime === "application/pdf") return "pdf"
  return "other"
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return v !== null && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null
}

const ROLE_LABEL: Record<string, string> = {
  BUYER: "Pembeli",
  SELLER: "Penjual",
  ADMIN: "Admin",
  SYSTEM: "Sistem",
}

/** Status usulan damai — label Indonesia, bukan raw enum. */
const PROPOSAL_STATUS_LABEL: Record<string, string> = {
  ACCEPTED: "Diterima",
  REJECTED: "Ditolak",
  EXPIRED: "Kedaluwarsa",
  PENDING: "Menunggu",
}

/** SLA mediasi sengketa — selaras DISPUTE_SLA_HOURS backend (72 jam). */
const DISPUTE_SLA_HOURS = 72

/** "2h 5j 30m 12d" / "Lewat 1j 20m" — hitung mundur live tiap detik. */
function formatCountdown(ms: number): string {
  const abs = Math.abs(ms)
  const d = Math.floor(abs / 86_400_000)
  const h = Math.floor((abs % 86_400_000) / 3_600_000)
  const m = Math.floor((abs % 3_600_000) / 60_000)
  const s = Math.floor((abs % 60_000) / 1_000)
  const core =
    d > 0 ? `${d}h ${h}j ${m}m` : h > 0 ? `${h}j ${m}m ${s}d` : `${m}m ${s}d`
  return ms < 0 ? `Lewat ${core}` : core
}

/**
 * BAI-097/100 — countdown sisa SLA sengketa, live tiap detik.
 * Prioritas deadline: escalationSlaDeadlineAt (bila sengketa dieskalasi) →
 * slaDeadlineAt → fallback createdAt + 72 jam (selaras DISPUTE_SLA_HOURS
 * backend). Sebelumnya selalu createdAt + 72 jam sehingga countdown salah
 * untuk sengketa ESCALATED.
 */
function SlaCountdown({
  createdAt,
  slaDeadlineAt,
  escalationSlaDeadlineAt,
  resolved,
}: {
  createdAt?: string
  slaDeadlineAt?: string | null
  escalationSlaDeadlineAt?: string | null
  resolved: boolean
}) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (resolved) return
    const t = setInterval(() => setNow(Date.now()), 1_000)
    return () => clearInterval(t)
  }, [resolved])
  const explicit = escalationSlaDeadlineAt ?? slaDeadlineAt
  const deadline = explicit
    ? new Date(explicit).getTime()
    : createdAt
      ? new Date(createdAt).getTime() + DISPUTE_SLA_HOURS * 3_600_000
      : NaN
  if (!Number.isFinite(deadline)) return <>—</>
  const diff = deadline - now
  const breached = diff < 0
  return (
    <span className="flex flex-wrap items-center justify-end gap-2">
      <span className={breached ? "font-semibold tabular-nums text-danger-text" : "font-semibold tabular-nums"}>
        {resolved ? "—" : formatCountdown(diff)}
      </span>
      {resolved ? null : breached ? <Badge tone="danger">Lewat SLA</Badge> : null}
    </span>
  )
}

function KeyValue({
  label,
  value,
  mono = false,
  copyText,
}: {
  label: string
  value: ReactNode
  mono?: boolean
  /** Bila diisi, tampilkan tombol "Salin" cepat di samping nilai. */
  copyText?: string
}) {
  const toast = useToast()
  const copy = async () => {
    if (!copyText) return
    try {
      await navigator.clipboard.writeText(copyText)
      toast.show({ title: "Disalin", description: copyText, tone: "success" })
    } catch {
      toast.show({ title: "Gagal menyalin", tone: "danger" })
    }
  }
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
        <span className="inline-flex max-w-full flex-wrap items-center justify-end gap-2">
          <span className="min-w-0 break-all">{value}</span>
          {copyText ? (
            <button
              type="button"
              onClick={() => void copy()}
              title={`Salin ${label}`}
              className="shrink-0 rounded-sm border border-border px-2 py-0.5 text-caption text-text-secondary hover:border-primary hover:text-primary"
            >
              Salin
            </button>
          ) : null}
        </span>
      </dd>
    </div>
  )
}

/**
 * Pihak yang bersengketa, nominal order, dan bukti dari kedua belah pihak.
 * Data sudah disediakan backend (`initiator`, `order`, `evidences`) — sebelumnya
 * tidak ditampilkan sama sekali sehingga putusan dana diambil tanpa konteks.
 */
function PartiesAndEvidence({
  dispute,
  hasNewEvidence,
  onOpenEvidence,
}: {
  dispute: AdminDisputeItem
  /** Penanda polling: ada bukti baru sejak halaman dibuka. */
  hasNewEvidence?: boolean
  /** H10: dipanggil saat admin membuka sebuah bukti (untuk checklist). */
  onOpenEvidence?: (evidenceId: string) => void
}) {
  const initiator = asRecord(dispute.initiator) as DisputeParty | null
  const order = asRecord(dispute.order) as DisputeOrderInfo | null
  const rawEvidences = Array.isArray(dispute.evidences) ? dispute.evidences : []
  const evidences = rawEvidences
    .map((e) => asRecord(e))
    .filter((e): e is Record<string, unknown> => e !== null)
    .map(
      (e): DisputeEvidenceItem => ({
        id: String(e.id ?? ""),
        submittedByRole: typeof e.submittedByRole === "string" ? e.submittedByRole : undefined,
        description: typeof e.description === "string" ? e.description : undefined,
        fileUrls: evidenceUrls(e),
        fileDownloadUrls: undefined,
        fileTypes: Array.isArray(e.fileTypes)
          ? e.fileTypes.filter((t): t is string => typeof t === "string")
          : undefined,
        createdAt: typeof e.createdAt === "string" ? e.createdAt : undefined,
      }),
    )

  // Lightbox: kumpulkan semua URL gambar bukti (lintas evidence) agar bisa
  // dinavigasi sebelum/sesudah tanpa keluar halaman.
  const imageIndexOf = new Map<string, number>()
  const imageUrls: string[] = []
  evidences.forEach((ev) => {
    const typesAligned =
      Array.isArray(ev.fileTypes) && ev.fileTypes.length === ev.fileUrls?.length
    ev.fileUrls?.forEach((url, i) => {
      const kind = typesAligned ? evidenceKind(ev.fileTypes?.[i]) : "other"
      if (kind === "image" && !imageIndexOf.has(url)) {
        imageIndexOf.set(url, imageUrls.length)
        imageUrls.push(url)
      }
    })
  })
  const [lightboxIdx, setLightboxIdx] = useState<number | null>(null)
  const closeLightbox = () => setLightboxIdx(null)
  const stepLightbox = (dir: 1 | -1) => {
    if (lightboxIdx === null || imageUrls.length === 0) return
    setLightboxIdx((lightboxIdx + dir + imageUrls.length) % imageUrls.length)
  }

  return (
    <div className="flex flex-col gap-6">
      <dl>
        <KeyValue
          label="Penggugat (initiator)"
          value={
            initiator
              ? `${maskName(initiator.fullName ?? null)}${initiator.email ? ` · ${maskEmail(initiator.email)}` : ""}`
              : "—"
          }
          mono
        />
        <KeyValue label="ID Pembeli" value={order?.buyerId ? String(order.buyerId) : "—"} mono />
        <KeyValue label="ID Penjual" value={order?.sellerId ? String(order.sellerId) : "—"} mono />
        <KeyValue label="Nilai order" value={formatIDR(order?.orderValue)} />
        {dispute.category ? (
          <KeyValue
            label="Kategori sengketa"
            value={DISPUTE_CATEGORY_LABEL[String(dispute.category)] ?? String(dispute.category)}
          />
        ) : null}
        <KeyValue label="Dibayar pembeli" value={formatIDR(order?.buyerPayAmount)} />
        <KeyValue label="Diterima penjual" value={formatIDR(order?.sellerReceiveAmount)} />
        {order?.status ? <KeyValue label="Status order" value={String(order.status)} /> : null}
      </dl>

      <div>
        <h3 className="mb-2 flex flex-wrap items-center gap-2 text-label font-semibold text-text-secondary">
          Bukti ({evidences.length})
          {hasNewEvidence ? <Badge tone="info">Ada bukti baru</Badge> : null}
        </h3>
        {evidences.length === 0 ? (
          <p className="text-body text-text-secondary">Belum ada bukti yang dilampirkan.</p>
        ) : (
          <ul className="space-y-3">
            {evidences.map((ev) => (
              <li key={ev.id} className="rounded-sm border border-border px-4 py-3">
                <p className="text-caption text-text-secondary">
                  {ROLE_LABEL[ev.submittedByRole ?? ""] ?? ev.submittedByRole ?? "—"}
                  {ev.createdAt ? ` · ${formatDateTimeWIB(ev.createdAt)}` : ""}
                </p>
                {ev.description ? (
                  <p className="mt-1 text-body text-text-primary">{ev.description}</p>
                ) : null}
                {ev.fileUrls && ev.fileUrls.length > 0 ? (
                  <ul className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
                    {ev.fileUrls.map((url, i) => {
                      // DP-009: backend membuang signed URL yang gagal generate
                      // (.filter(Boolean)) tanpa menyesuaikan fileTypes, sehingga
                      // pairing by-index bisa bergeser. Hanya percaya pairing
                      // bila panjangnya sama; bila tidak, tampilkan sebagai
                      // dokumen generik tanpa tebakan tipe.
                      const typesAligned =
                        Array.isArray(ev.fileTypes) &&
                        ev.fileTypes.length === ev.fileUrls?.length
                      const kind = typesAligned ? evidenceKind(ev.fileTypes?.[i]) : "other"
                      return (
                        <li
                          key={`${ev.id}-${i}`}
                          className="overflow-hidden rounded-sm border border-border"
                        >
                          {kind === "image" ? (
                            <button
                              type="button"
                              onClick={() => {
                                onOpenEvidence?.(ev.id)
                                const gi = imageIndexOf.get(url)
                                if (gi !== undefined) setLightboxIdx(gi)
                              }}
                              title="Buka lightbox — klik untuk memperbesar, navigasi antar gambar"
                              className="block w-full cursor-zoom-in"
                            >
                              <img
                                src={url}
                                alt={`Bukti ${i + 1}`}
                                loading="lazy"
                                className="h-32 w-full object-cover"
                              />
                            </button>
                          ) : kind === "video" ? (
                            <video
                              src={url}
                              controls
                              preload="metadata"
                              onPlay={() => onOpenEvidence?.(ev.id)}
                              className="h-32 w-full bg-black object-contain"
                            />
                          ) : (
                            <a
                              href={url}
                              target="_blank"
                              rel="noopener noreferrer"
                              onClick={() => onOpenEvidence?.(ev.id)}
                              className="block px-3 py-6 text-center text-body text-primary underline"
                            >
                              {kind === "pdf" ? "Buka PDF" : "Buka dokumen"} {i + 1}
                            </a>
                          )}
                        </li>
                      )
                    })}
                  </ul>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Lightbox bukti gambar dalam halaman + navigasi sebelum/sesudah. */}
      {lightboxIdx !== null && imageUrls.length > 0 ? (
        <Dialog
          open
          onClose={closeLightbox}
          title={`Bukti gambar ${lightboxIdx + 1} / ${imageUrls.length}`}
          description="Klik Sebelumnya/Berikutnya untuk berpindah antar bukti gambar tanpa keluar halaman."
          className="max-w-4xl"
          footer={
            <div className="flex items-center justify-between gap-2">
              <Button
                variant="secondary"
                fullWidth={false}
                disabled={imageUrls.length <= 1}
                onClick={() => stepLightbox(-1)}
              >
                ← Sebelumnya
              </Button>
              <span className="text-caption tabular-nums text-text-secondary">
                {lightboxIdx + 1} / {imageUrls.length}
              </span>
              <Button
                variant="secondary"
                fullWidth={false}
                disabled={imageUrls.length <= 1}
                onClick={() => stepLightbox(1)}
              >
                Berikutnya →
              </Button>
            </div>
          }
        >
          <img
            src={imageUrls[lightboxIdx]}
            alt={`Bukti gambar ${lightboxIdx + 1}`}
            className="max-h-[70vh] w-full rounded-sm bg-black object-contain"
          />
        </Dialog>
      ) : null}
    </div>
  )
}

/**
 * BAI-094 — uploader bukti "titipan" admin: pilih file → upload (admin-scoped)
 * → submit sebagai bukti ADMIN. Hanya dirender bila pemanggil mengizinkan
 * (mediator pemegang kasus / SUPER_ADMIN + status terbuka untuk bukti).
 */
function AdminEvidenceUploader({
  disputeId,
  onSubmitted,
}: {
  disputeId: string
  onSubmitted: () => void
}) {
  const toast = useToast()
  const [title, setTitle] = useState("")
  const [description, setDescription] = useState("")
  const [files, setFiles] = useState<File[]>([])
  const [busy, setBusy] = useState(false)
  const [phase, setPhase] = useState<string | null>(null)

  const handleSubmit = async () => {
    if (files.length === 0 || !title.trim() || !description.trim() || busy) return
    // SYS-C-303 — validasi pra-upload sesuai batas server SEBELUM upload,
    // agar gagal cepat dengan pesan jelas (bukan setelah upload lalu ditolak).
    const validation = validateDisputeEvidenceFiles(files)
    if (!validation.ok) {
      toast.show({ title: "File tidak valid", description: validation.message, tone: "danger" })
      return
    }
    setBusy(true)
    try {
      setPhase("Mengunggah file…")
      const uploaded = await Promise.all(files.map((f) => adminUploadDisputeEvidenceFile(disputeId, f)))
      setPhase("Menyimpan bukti…")
      const res = await adminSubmitDisputeEvidence(disputeId, {
        title: title.trim(),
        description: description.trim(),
        fileUrls: uploaded.map((u) => u.fileKey),
        fileTypes: files.map((f) => f.type || "application/octet-stream"),
      })
      setTitle("")
      setDescription("")
      setFiles([])
      onSubmitted()
      toast.show({
        title: `Bukti ditambahkan (${res.summary.filesAttached} file)`,
        description: res.notificationDelivered
          ? "Kedua pihak diberi tahu."
          : "Notifikasi ke pihak GAGAL — kegagalan tercatat di backend.",
        tone: res.notificationDelivered ? "success" : "info",
      })
    } catch (e) {
      toast.show({ title: "Gagal menambah bukti", description: userMessage(e), tone: "danger" })
    } finally {
      setBusy(false)
      setPhase(null)
    }
  }

  return (
    <div className="mt-4 rounded-sm border border-dashed border-border-control p-3">
      <p className="text-body font-semibold text-text-primary">Tambah bukti (titipan admin)</p>
      <p className="mt-1 text-caption text-text-secondary">
        File diunggah atas nama admin dan tercatat sebagai bukti ADMIN. Kedua pihak diberi tahu.
      </p>
      <div className="mt-3 flex flex-col gap-2">
        <Input
          label="Judul bukti"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="mis. Foto kondisi barang dari penjual"
          disabled={busy}
        />
        <TextArea
          label="Deskripsi"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={2}
          placeholder="Jelaskan isi bukti ini…"
          disabled={busy}
        />
        <input
          type="file"
          multiple
          accept={DISPUTE_EVIDENCE_ACCEPT}
          disabled={busy}
          onChange={(e) => {
            const picked = Array.from(e.target.files ?? [])
            // SYS-C-303 — umpan balik langsung saat pilih file (validasi penuh
            // tetap di handleSubmit sebelum upload).
            const v = validateDisputeEvidenceFiles(picked)
            if (picked.length > 0 && !v.ok) {
              toast.show({ title: "File tidak valid", description: v.message, tone: "danger" })
              e.target.value = ""
              return
            }
            setFiles(picked)
          }}
          className="text-body text-text-primary"
        />
        {files.length > 0 ? (
          <p className="text-caption text-text-secondary">
            {files.length} file dipilih — maks 10 file, 10MB/file, total 50MB (JPEG/PNG/WebP/HEIC/HEIF/PDF/MP4/MOV/WebM)
          </p>
        ) : null}
        <Button
          variant="secondary"
          fullWidth={false}
          loading={busy}
          disabled={files.length === 0 || !title.trim() || !description.trim()}
          onClick={() => void handleSubmit()}
        >
          {phase ?? "Unggah & simpan bukti"}
        </Button>
      </div>
    </div>
  )
}

type MutualProposalItem = {
  id: string
  proposerName?: string
  proposerRole?: string
  buyerPercent?: number
  sellerPercent?: number
  status?: string
  reason?: string
  createdAt?: string
}

/** Klaim terstruktur + usulan penyelesaian bersama — bahan putusan mediator. */
function ClaimsAndProposals({ dispute }: { dispute: AdminDisputeItem }) {
  const str = (v: unknown) => (typeof v === "string" ? v : undefined)
  const numOrUndef = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : undefined)
  const claims = [
    { label: "Klaim pembeli", text: str(dispute.buyerClaim), at: str(dispute.buyerClaimedAt) },
    { label: "Klaim penjual", text: str(dispute.sellerClaim), at: str(dispute.sellerClaimedAt) },
  ]
  const proposals: MutualProposalItem[] = (
    Array.isArray(dispute.mutualProposals) ? dispute.mutualProposals : []
  )
    .map(asRecord)
    .filter((p): p is Record<string, unknown> => p !== null)
    .map((p) => ({
      id: String(p.id ?? ""),
      proposerName: str(p.proposerName),
      proposerRole: str(p.proposerRole),
      buyerPercent: numOrUndef(p.buyerPercent),
      sellerPercent: numOrUndef(p.sellerPercent),
      status: str(p.status),
      reason: str(p.reason),
      createdAt: str(p.createdAt),
    }))

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h3 className="mb-2 text-label font-semibold text-text-secondary">Klaim para pihak</h3>
        <div className="grid gap-3 md:grid-cols-2">
          {claims.map((c) => (
            <div key={c.label} className="rounded-sm border border-border px-4 py-3">
              <p className="text-caption font-semibold text-text-secondary">
                {c.label}
                {c.at ? ` · ${formatDateTimeWIB(c.at)}` : ""}
              </p>
              <p className="mt-1 text-body text-text-primary">
                {c.text?.trim() ? c.text : "Belum ada klaim."}
              </p>
            </div>
          ))}
        </div>
      </div>

      <div>
        <h3 className="mb-2 text-label font-semibold text-text-secondary">
          Usulan penyelesaian bersama ({proposals.length})
        </h3>
        {proposals.length === 0 ? (
          <p className="text-body text-text-secondary">Belum ada usulan.</p>
        ) : (
          <ul className="space-y-3">
            {proposals.map((p) => (
              <li key={p.id} className="rounded-sm border border-border px-4 py-3">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-body font-semibold text-text-primary">
                    {p.proposerName ?? "—"}
                  </p>
                  {p.proposerRole ? (
                    <span className="text-caption text-text-secondary">
                      ({p.proposerRole === "BUYER" ? "Pembeli" : p.proposerRole === "SELLER" ? "Penjual" : p.proposerRole})
                    </span>
                  ) : null}
                  {p.status ? (
                    <Badge tone={p.status === "ACCEPTED" ? "success" : p.status === "REJECTED" || p.status === "EXPIRED" ? "neutral" : "info"}>
                      {PROPOSAL_STATUS_LABEL[p.status] ?? p.status}
                    </Badge>
                  ) : null}
                  <span className="ml-auto text-caption tabular-nums text-text-secondary">
                    {p.createdAt ? formatDateTimeWIB(p.createdAt) : ""}
                  </span>
                </div>
                {p.buyerPercent != null && p.sellerPercent != null ? (
                  <p className="mt-1 text-body text-text-primary">
                    Pembeli {p.buyerPercent}% · Penjual {p.sellerPercent}%
                  </p>
                ) : null}
                {p.reason ? (
                  <p className="mt-1 text-body text-text-secondary">{p.reason}</p>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}

export default function DisputeDetailPage() {
  const { id } = useParams<{ id: string }>()
  const disputeId = Array.isArray(id) ? id[0] : (id ?? "")
  const toast = useToast()

  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [dispute, setDispute] = useState<AdminDisputeItem | null>(null)

  const { profile, role } = useAuth()

  const [messages, setMessages] = useState<DisputeMessage[]>([])
  const [msgCursor, setMsgCursor] = useState<string | null>(null)
  const [msgHasMore, setMsgHasMore] = useState(false)
  const [msgLoading, setMsgLoading] = useState(true)
  const [msgOlderLoading, setMsgOlderLoading] = useState(false)
  const [msgError, setMsgError] = useState<string | null>(null)
  // H11: draf autosave per record — tidak hilang saat navigasi.
  const mediationDraft = useDraftNote(`dispute:${disputeId}:mediation`)
  const internalDraft = useDraftNote(`dispute:${disputeId}:internal`)
  const resolveDraft = useDraftNote(`dispute:${disputeId}:resolve-notes`)
  const [sending, setSending] = useState(false)

  // ADM-111: percakapan order (buyer–seller), termasuk pesan terhapus.
  const [orderChat, setOrderChat] = useState<DisputeOrderChatMessage[]>([])
  const [orderChatCursor, setOrderChatCursor] = useState<string | null>(null)
  const [orderChatHasMore, setOrderChatHasMore] = useState(false)
  const [orderChatLoading, setOrderChatLoading] = useState(true)
  const [orderChatOlderLoading, setOrderChatOlderLoading] = useState(false)
  const [orderChatError, setOrderChatError] = useState<string | null>(null)

  // ADM-109: pratinjau nominal disbursement sebelum eksekusi resolve.
  const [preview, setPreview] = useState<ResolvePreviewResult | null>(null)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [previewError, setPreviewError] = useState<string | null>(null)

  const [assignOpen, setAssignOpen] = useState(false)
  const [adminId, setAdminId] = useState("")
  const [adminOptions, setAdminOptions] = useState<{ value: string; label: string }[]>([])
  const [adminsLoading, setAdminsLoading] = useState(false)
  // Pencarian nama admin di dialog assign (filter client-side dari daftar yang dimuat).
  const [adminSearch, setAdminSearch] = useState("")
  const [resolveOpen, setResolveOpen] = useState(false)
  // SEC-501/SEC-504: gate verifikasi ulang server untuk resolve + satu kunci
  // idempotency per sesi dialog (dibuat saat dialog dibuka, dibuang saat
  // ditutup; retry memakai kunci yang sama).
  const { requestStepUp, stepUpDialog } = useStepUp()
  // K6 (audit 2026-10-10): retry settlement sengketa no-wallet (FAILED/ESCALATED).
  const [retryingSettlement, setRetryingSettlement] = useState(false)
  const resolveKey = useMemo(
    () => (resolveOpen ? newIdempotencyKey() : null),
    [resolveOpen],
  )
  const [resolution, setResolution] = useState<Resolution>("FULL_BUYER")
  // H04: alasan terstruktur keputusan (wajib) — catatan via resolveDraft (H11).
  const [resolveReason, setResolveReason] = useState("")
  // DP-008: persen SPLIT — hanya dipakai bila keputusan SPLIT.
  const [buyerPercent, setBuyerPercent] = useState("")
  const [sellerPercent, setSellerPercent] = useState("")
  const [acting, setActing] = useState<string | null>(null)
  // Batch 43 item #33: eskalasi 1 ketuk — dialog konfirmasi + alasan (audit).
  const [escalateOpen, setEscalateOpen] = useState(false)
  const [escalateReason, setEscalateReason] = useState("")
  // DP-021: kapan data terakhir disegarkan (polling otomatis).
  const [lastUpdated, setLastUpdated] = useState<string | null>(null)
  // Penanda polling: pesan mediasi / bukti baru sejak halaman dibuka.
  const [newMessages, setNewMessages] = useState(false)
  const [newEvidence, setNewEvidence] = useState(false)
  const messagesRef = useRef<Set<string>>(new Set())
  const evidenceCountRef = useRef<number | null>(null)
  // Navigasi sengketa sebelumnya/berikutnya (tetangga di daftar 100 terbaru).
  const router = useRouter()
  const [prevDispute, setPrevDispute] = useState<{ id: string; orderId: string } | null>(null)
  const [nextDispute, setNextDispute] = useState<{ id: string; orderId: string } | null>(null)

  const load = useCallback(
    async (mode: "initial" | "refresh" = "initial"): Promise<AdminDisputeItem | null> => {
      if (mode === "initial") setLoading(true)
      else setRefreshing(true)
      setError(null)
      try {
        const d = await getDisputeDetail(disputeId)
        setDispute(d)
        // Baseline jumlah bukti untuk deteksi bukti baru saat polling.
        evidenceCountRef.current = Array.isArray(d.evidences) ? d.evidences.length : 0
        // DP-021: penanda kesegaran data untuk indikator di header.
        setLastUpdated(new Date().toISOString())
        return d
      } catch (e) {
        setError(userMessage(e))
        return null
      } finally {
        setLoading(false)
        setRefreshing(false)
      }
    },
    [disputeId],
  )

  // ADM-127: pesan terbaru (halaman pertama) — di-refresh polling;
  // pesan lama dimuat on-demand via cursor tanpa menumpuk duplikat.
  const loadMessages = useCallback(async () => {
    setMsgLoading(true)
    setMsgError(null)
    try {
      const res = await getDisputeMessages(disputeId)
      setMessages(res.messages)
      messagesRef.current = new Set(res.messages.map((m) => m.id))
      setMsgCursor(res.nextCursor)
      setMsgHasMore(res.hasMore)
    } catch (e) {
      setMsgError(userMessage(e))
    } finally {
      setMsgLoading(false)
    }
  }, [disputeId])

  const loadOlderMessages = useCallback(async () => {
    if (!msgCursor || msgOlderLoading) return
    setMsgOlderLoading(true)
    try {
      const res = await getDisputeMessages(disputeId, { cursor: msgCursor })
      setMessages((prev) => [...prev, ...res.messages])
      setMsgCursor(res.nextCursor)
      setMsgHasMore(res.hasMore)
    } catch (e) {
      toast.show({ title: "Gagal memuat pesan lama", description: userMessage(e), tone: "danger" })
    } finally {
      setMsgOlderLoading(false)
    }
  }, [disputeId, msgCursor, msgOlderLoading, toast])

  // ADM-111: percakapan order buyer–seller (termasuk pesan terhapus).
  const loadOrderChat = useCallback(async () => {
    setOrderChatLoading(true)
    setOrderChatError(null)
    try {
      const res = await getDisputeChat(disputeId)
      setOrderChat(res.messages)
      setOrderChatCursor(res.nextCursor)
      setOrderChatHasMore(res.hasMore)
    } catch (e) {
      setOrderChatError(userMessage(e))
    } finally {
      setOrderChatLoading(false)
    }
  }, [disputeId])

  const loadOlderOrderChat = useCallback(async () => {
    if (!orderChatCursor || orderChatOlderLoading) return
    setOrderChatOlderLoading(true)
    try {
      const res = await getDisputeChat(disputeId, { cursor: orderChatCursor })
      setOrderChat((prev) => [...prev, ...res.messages])
      setOrderChatCursor(res.nextCursor)
      setOrderChatHasMore(res.hasMore)
    } catch (e) {
      toast.show({ title: "Gagal memuat chat lama", description: userMessage(e), tone: "danger" })
    } finally {
      setOrderChatOlderLoading(false)
    }
  }, [disputeId, orderChatCursor, orderChatOlderLoading, toast])

  useEffect(() => {
    if (disputeId) {
      void load("initial")
      void loadMessages()
      void loadOrderChat()
    }
  }, [disputeId, load, loadMessages, loadOrderChat])

  // DP-021: polling ringan tiap 20 detik, hanya saat tab aktif, agar admin
  // tahu bila ada bukti/klaim/pesan baru tanpa refresh manual. Penanda
  // eksplisit (badge + toast) bila polling menemukan pesan/bukti BARU.
  const pollTick = useCallback(async () => {
    // Tangkap baseline SEBELUM load menimpa ref — kalau tidak, perbandingan
    // bukti baru selalu false.
    const prevEvCount = evidenceCountRef.current
    const d = await load("refresh")
    if (d) {
      const evCount = Array.isArray(d.evidences) ? d.evidences.length : 0
      if (prevEvCount !== null && evCount > prevEvCount) {
        setNewEvidence(true)
        toast.show({
          title: "Bukti baru ditambahkan",
          description: "Ada bukti baru pada sengketa ini — lihat bagian Bukti.",
          tone: "info",
        })
      }
    }
    try {
      const res = await getDisputeMessages(disputeId)
      const prevIds = messagesRef.current
      const fresh = res.messages.filter((m) => !prevIds.has(m.id))
      if (fresh.length > 0 && prevIds.size > 0) {
        setNewMessages(true)
        toast.show({
          title: `${fresh.length} pesan mediasi baru`,
          description: "Lihat bagian Riwayat pesan mediasi.",
          tone: "info",
        })
      }
      messagesRef.current = new Set(res.messages.map((m) => m.id))
      setMessages(res.messages)
      setMsgCursor(res.nextCursor)
      setMsgHasMore(res.hasMore)
    } catch {
      // Polling pesan berjalan senyap — error ditampilkan di pemuatan manual.
    }
  }, [disputeId, load, toast])

  useEffect(() => {
    if (!disputeId) return
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") {
        void pollTick()
      }
    }, 20_000)
    return () => clearInterval(timer)
  }, [disputeId, pollTick])

  // Navigasi sengketa sebelumnya/berikutnya: tetangga di daftar 100 terbaru
  // (urutan createdAt desc, sama dengan halaman daftar).
  useEffect(() => {
    if (!disputeId) return
    listDisputes({ page: 1, limit: 100 })
      .then((res) => {
        const items = res.data ?? []
        const idx = items.findIndex((x) => x.id === disputeId)
        if (idx === -1) {
          setPrevDispute(null)
          setNextDispute(null)
          return
        }
        setPrevDispute(idx > 0 ? { id: items[idx - 1].id, orderId: items[idx - 1].orderId } : null)
        setNextDispute(
          idx < items.length - 1 ? { id: items[idx + 1].id, orderId: items[idx + 1].orderId } : null,
        )
      })
      .catch(() => {
        setPrevDispute(null)
        setNextDispute(null)
      })
  }, [disputeId])

  const reloadAll = () => {
    setNewMessages(false)
    setNewEvidence(false)
    void load("refresh")
    void loadMessages()
    void loadOrderChat()
  }

  const fail = (title: string, e: unknown) => {
    toast.show({ title, description: userMessage(e), tone: "danger" })
  }

  const handleSendMessage = async (text?: string) => {
    const body = (text ?? mediationDraft.value).trim()
    if (!body || sending) return
    setSending(true)
    try {
      // BAI-098: backend mengembalikan notificationDelivered — tampilkan statusnya.
      const res = (await sendDisputeMessage(disputeId, body)) as { notificationDelivered?: boolean }
      mediationDraft.clear()
      await loadMessages()
      toast.show({
        title: "Pesan terkirim",
        description: res?.notificationDelivered === false ? "Notifikasi ke pihak GAGAL — kegagalan tercatat di audit." : undefined,
        tone: res?.notificationDelivered === false ? "info" : "success",
      })
    } catch (e) {
      fail("Gagal mengirim pesan", e)
    } finally {
      setSending(false)
    }
  }

  // BAI-095: catatan internal — kolaboratif antar admin via API backend
  // (GET/POST /v1/admin/disputes/:id/notes). localStorage dihapus.
  const [internalNotes, setInternalNotes] = useState<DisputeInternalNote[]>([])
  const [notesLoading, setNotesLoading] = useState(false)
  const [savingNote, setSavingNote] = useState(false)

  const loadNotes = useCallback(async () => {
    setNotesLoading(true)
    try {
      const notes = await listDisputeNotes(disputeId)
      setInternalNotes(notes)
    } catch {
      // Bukan pemegang kasus / backend lama → biarkan kosong, jangan ganggu halaman.
      setInternalNotes([])
    } finally {
      setNotesLoading(false)
    }
  }, [disputeId])

  useEffect(() => {
    void loadNotes()
  }, [loadNotes])

  const handleSaveInternalNote = async (text: string) => {
    const trimmed = text.trim()
    if (!trimmed || savingNote) return
    setSavingNote(true)
    try {
      await addDisputeNote(disputeId, trimmed)
      internalDraft.clear()
      await loadNotes()
      toast.show({
        title: "Catatan internal disimpan",
        description: "Tersimpan di server — terlihat oleh semua admin.",
        tone: "success",
      })
    } catch (e) {
      fail("Gagal menyimpan catatan internal", e)
    } finally {
      setSavingNote(false)
    }
  }

  const handleUnderReview = async () => {
    setActing("under-review")
    try {
      await markDisputeUnderReview(disputeId)
      await load("refresh")
      toast.show({ title: "Sengketa ditandai under review", tone: "success" })
    } catch (e) {
      fail("Gagal menandai under review", e)
    } finally {
      setActing(null)
    }
  }

  // Batch 43 item #33: eskalasi 1 ketuk — hanya menandai status ESCALATED,
  // dana tetap di escrow sampai resolve. Non-finansial.
  const handleEscalate = async () => {
    if (acting) return
    const reason = escalateReason.trim()
    if (!reason) {
      toast.show({ title: "Alasan eskalasi wajib diisi (audit).", tone: "danger" })
      return
    }
    setActing("escalate")
    try {
      await escalateDispute(disputeId, reason)
      setEscalateOpen(false)
      setEscalateReason("")
      await load("refresh")
      toast.show({ title: "Sengketa dieskalasi.", tone: "success" })
    } catch (e) {
      fail("Gagal mengekskalasi sengketa", e)
    } finally {
      setActing(null)
    }
  }

  // ADM-123: DISPUTE_ADMIN melakukan self-assign langsung; SUPER_ADMIN
  // dapat memilih admin lewat dropdown (dialog dibuka hanya bila gating
  // status di bawah terpenuhi).
  const isDisputeAdmin = role === "DISPUTE_ADMIN"
  const selfAssign = async () => {
    if (!profile || acting) return
    setActing("assign")
    try {
      await assignDispute(disputeId, profile.id)
      await load("refresh")
      toast.show({ title: "Sengketa diambil alih", tone: "success" })
    } catch (e) {
      fail("Gagal mengambil sengketa", e)
    } finally {
      setActing(null)
    }
  }

  const openAssign = useCallback(() => {
    setAssignOpen(true)
    setAdminSearch("")
    setAdminsLoading(true)
    // Dropdown admin yang boleh menangani sengketa — menggantikan ketik ID
    // manual yang rawan salah ketik (sengketa bisa nyasar/tak bertuan).
    listAdmins({ limit: 100 })
      .then((page) => {
        const items = Array.isArray(page?.data) ? page.data : []
        setAdminOptions(
          items
            .filter((a) => a.isActive && (a.role === "DISPUTE_ADMIN" || a.role === "SUPER_ADMIN"))
            .map((a) => ({
              value: a.id,
              label: `${a.fullName} · ${a.role === "SUPER_ADMIN" ? "Super Admin" : "Admin Sengketa"}`,
            })),
        )
      })
      .catch((e) => fail("Gagal memuat daftar admin", e))
      .finally(() => setAdminsLoading(false))
  }, [])

  const handleAssign = async () => {
    const target = adminId.trim()
    if (!target || acting) return
    setActing("assign")
    try {
      await assignDispute(disputeId, target)
      setAssignOpen(false)
      setAdminId("")
      await load("refresh")
      toast.show({ title: "Sengketa ditugaskan", tone: "success" })
    } catch (e) {
      fail("Gagal menugaskan sengketa", e)
    } finally {
      setActing(null)
    }
  }

  // DP-001/DP-008: validasi client sebelum submit — backend menolak 400
  // bila catatan < 100 char atau persen SPLIT tak berjumlah 100.
  const isSplit = resolution === "SPLIT"
  const buyerPct = Number.parseInt(buyerPercent, 10)
  const sellerPct = Number.parseInt(sellerPercent, 10)
  const splitValid =
    !isSplit ||
    (Number.isInteger(buyerPct) &&
      Number.isInteger(sellerPct) &&
      buyerPct >= 1 &&
      buyerPct <= 99 &&
      sellerPct >= 1 &&
      sellerPct <= 99 &&
      buyerPct + sellerPct === 100)
  const notesValid = resolveDraft.value.trim().length >= 100
  const reasonValid = resolveReason.trim().length > 0

  const handleResolve = async () => {
    if (!notesValid || !reasonValid || !splitValid || acting) return
    // SEC-501: verifikasi ulang server SEBELUM eksekusi — fail-closed.
    let stepUpToken: string | null
    try {
      stepUpToken = await requestStepUp({
        action: "dispute.resolve",
        targetId: disputeId,
        title: "Verifikasi ulang",
        description: "Menyelesaikan sengketa mencairkan escrow dan bersifat final.",
      })
    } catch (e) {
      if (e instanceof StepUpNotSupportedError) {
        toast.show({
          title: "Backend belum mendukung verifikasi ulang server — aksi diblokir",
          tone: "danger",
        })
        return
      }
      toast.show({
        title: "Verifikasi ulang gagal",
        description: userMessage(e),
        tone: "danger",
      })
      return
    }
    if (stepUpToken === null) return // user membatalkan verifikasi
    setActing("resolve")
    try {
      // DP-001: payload persis DisputeDecisionDto {decision, decisionNotes, ...}.
      // winnerId dihapus — backend tidak mengenalnya.
      // H04: alasan terstruktur digabung ke decisionNotes agar tercatat di audit.
      const reasonLabel =
        RESOLVE_REASON_OPTIONS.find((o) => o.value === resolveReason)?.label ?? resolveReason
      const res = await resolveDispute(
        disputeId,
        {
          decision: resolution,
          decisionNotes: `[Alasan: ${reasonLabel}] ${resolveDraft.value.trim()}`,
          ...(isSplit ? { buyerPercent: buyerPct, sellerPercent: sellerPct } : {}),
        },
        // SEC-504: kunci idempotency SEKALI per sesi dialog (bukan per
        // panggilan) + token step-up via X-Step-Up-Token.
        { idempotencyKey: resolveKey ?? undefined, stepUpToken },
      )
      setResolveOpen(false)
      resolveDraft.clear()
      setResolveReason("")
      setBuyerPercent("")
      setSellerPercent("")
      await load("refresh")
      // SEC-501: nominal besar — backend bisa menahan eksekusi menunggu
      // persetujuan admin kedua. Jangan toast sukses buta.
      if (res?.pendingSecondApproval) {
        toast.show({
          title: "Menunggu persetujuan kedua",
          description:
            "Keputusan tercatat, tetapi eksekusi ditahan — nominal besar sehingga dibutuhkan persetujuan admin kedua.",
          tone: "info",
        })
        return
      }
      // BAI-046: baca hasil settlement DANA — JANGAN toast sukses buta.
      // P1-30 (audit integrasi 2026-10-06): backend bisa tidak menyertakan
      // `settlement` (mis. jalur wallet) — jangan false alarm "gagal" bila
      // field tidak ada; hanya warning bila settlement ada TAPI gagal.
      const settlement = (res as { settlement?: unknown })?.settlement ?? null
      const buyerExpectsRefund = resolution !== "FULL_SELLER"
      if (settlement === null || settlement === undefined) {
        // Settlement tidak dilaporkan backend — bukan bukti gagal.
        // Tampilkan sukses standar; verifikasi manual via halaman Disbursement.
        const notifNote = (res as { notificationDelivered?: boolean })?.notificationDelivered === false
          ? " (notifikasi putusan ke pihak GAGAL — tercatat di audit)"
          : ""
        toast.show({ title: `Sengketa diselesaikan${notifNote}`, tone: (res as { notificationDelivered?: boolean })?.notificationDelivered === false ? "info" : "success" })
      } else {
        const s = settlement as {
          buyerRefunded?: boolean
          buyerRefundAlready?: boolean
          sellerDisbursement?: { outcome?: string; status?: string | null } | null
        }
        const sellerProblem =
          s.sellerDisbursement !== null &&
          s.sellerDisbursement !== undefined &&
          !["SUCCESS", "RELEASED", "SETTLED", "PENDING", "PROCESSING"].includes(
            String(s.sellerDisbursement.status ?? s.sellerDisbursement.outcome ?? "").toUpperCase(),
          )
        if (buyerExpectsRefund && !s.buyerRefunded && !s.buyerRefundAlready) {
          toast.show({
            title: "Sengketa diputus — refund buyer BELUM berhasil",
            description:
              "Keputusan tercatat, tetapi refund DANA ke buyer belum terkonfirmasi. Verifikasi via halaman Disbursement DANA.",
            tone: "danger",
          })
        } else if (sellerProblem) {
          toast.show({
            title: "Sengketa diputus — disbursement seller bermasalah",
            description: `Keputusan tercatat, tetapi disbursement seller: ${s.sellerDisbursement?.status ?? s.sellerDisbursement?.outcome ?? "tidak diketahui"}. Verifikasi via halaman Disbursement DANA.`,
            tone: "danger",
          })
        } else {
          // BAI-098: status kirim notifikasi putusan dari backend.
          const notifNote = (res as { notificationDelivered?: boolean })?.notificationDelivered === false
            ? " (notifikasi putusan ke pihak GAGAL — tercatat di audit)"
            : ""
          toast.show({ title: `Sengketa diselesaikan${notifNote}`, tone: (res as { notificationDelivered?: boolean })?.notificationDelivered === false ? "info" : "success" })
        }
      }
    } catch (e) {
      fail("Gagal menyelesaikan sengketa", e)
    } finally {
      setActing(null)
    }
  }

  // ADM-109: pratinjau nominal disbursement SEBELUM eksekusi resolve.
  // Read-only di backend — guard status sama dengan resolve sehingga angka
  // yang tampil pasti bisa dieksekusi.
  const handlePreview = async () => {
    if (previewLoading) return
    if (isSplit && !splitValid) {
      setPreviewError("Persen SPLIT harus valid (1–99, jumlah 100) sebelum pratinjau.")
      return
    }
    setPreviewLoading(true)
    setPreviewError(null)
    try {
      const res = await previewResolveDispute(disputeId, {
        decision: resolution,
        ...(isSplit ? { buyerPercent: buyerPct, sellerPercent: sellerPct } : {}),
      })
      setPreview(res)
    } catch (e) {
      setPreviewError(userMessage(e))
      setPreview(null)
    } finally {
      setPreviewLoading(false)
    }
  }

  // Reset pratinjau setiap dialog dibuka / input keputusan berubah.
  const openResolve = () => {
    setPreview(null)
    setPreviewError(null)
    setResolveReason("")
    setResolveOpen(true)
  }

  const status = dispute ? String(dispute.status) : ""
  // BAI-091: komentar lama ("backend markUnderReview menerima OPEN dan
  // ASSIGNED") SALAH — backend hanya menerima ASSIGNED. Gating canReview =
  // ASSIGNED di bawah sudah benar.
  // BAI-089: WAITING_RESPONSE dihapus dari UI (unreachable di backend).
  // BAI-092: SUPER_ADMIN boleh reassign di ASSIGNED/UNDER_REVIEW (backend
  // mendukung reassign + OCC guard); DISPUTE_ADMIN hanya self-assign saat OPEN.
  const isSuperAdmin = role === "SUPER_ADMIN"
  const canAssign = status === "OPEN" || (isSuperAdmin && (status === "ASSIGNED" || status === "UNDER_REVIEW"))
  // BAI-084: review/resolve hanya untuk mediator pemegang kasus atau SUPER_ADMIN.
  const isCaseHolder = dispute ? dispute.assignedAdminId === profile?.id || isSuperAdmin : false
  const canReview = status === "ASSIGNED" && isCaseHolder
  // DP-007: backend hanya menerima resolve dari UNDER_REVIEW/ESCALATED.
  // ASSIGNED diarahkan lewat "Mulai review" (markDisputeUnderReview).
  const canResolve = (status === "UNDER_REVIEW" || status === "ESCALATED") && isCaseHolder
  // ADM-110: sengketa yang sudah punya keputusan → tampilkan kartu putusan,
  // tombol resolve disembunyikan.
  const decision = dispute ? asRecord(dispute.decision) : null
  // K6: jejak pergerakan dana (baris durable backend) — null bila backend lama.
  const moneyTrail = dispute && dispute.moneyTrail && typeof dispute.moneyTrail === "object"
    ? (dispute.moneyTrail as DisputeMoneyTrail)
    : null
  const settlementIntent = moneyTrail?.settlementIntent ?? null
  const canRetrySettlement =
    isSuperAdmin && settlementIntent !== null && ["FAILED", "ESCALATED", "PENDING"].includes(settlementIntent.status)

  const handleRetrySettlement = async () => {
    if (!dispute || retryingSettlement) return
    const token = await requestStepUp({
      action: DISPUTE_SETTLEMENT_RETRY_STEP_UP_ACTION,
      targetId: disputeId,
      title: "Ulangi settlement sengketa",
      description: "Menjalankan ulang refund DANA ke pembeli / pencairan ke penjual sesuai putusan (idempoten).",
    })
    if (!token) return
    setRetryingSettlement(true)
    try {
      const res = await retryDisputeSettlement(disputeId, { stepUpToken: token })
      if (res.intent?.status === "DONE") {
        toast.show({ title: "Settlement selesai", description: "Dana sudah dieksekusi sesuai putusan.", tone: "success" })
      } else {
        toast.show({
          title: `Settlement ${res.intent?.status ?? "belum selesai"}`,
          description: res.error ?? res.intent?.lastError ?? "Periksa jejak pergerakan dana.",
          tone: "info",
        })
      }
      void load()
    } catch (e) {
      fail("Gagal mengulang settlement", e)
    } finally {
      setRetryingSettlement(false)
    }
  }
  const isResolved = status === "RESOLVED" || decision !== null
  // Batch 43 item #33: eskalasi 1 ketuk tersedia selama sengketa belum
  // diputus dan belum berstatus ESCALATED.
  const canEscalate = !isResolved && status !== "ESCALATED"

  // Info order untuk label pengirim di riwayat pesan (pembeli/penjual/admin).
  const disputeOrder = dispute ? (asRecord(dispute.order) as DisputeOrderInfo | null) : null

  // H08: peringatan bila record berubah saat form terbuka.
  const revGuard = useRevisionGuard({
    recordKey: `dispute:${disputeId}`,
    getRevision: () =>
      getDisputeDetail(disputeId).then((d) => (d.updatedAt ?? d.createdAt ?? null) as string | null),
    dirty:
      resolveOpen ||
      mediationDraft.hasDraft ||
      internalDraft.hasDraft ||
      resolveDraft.hasDraft,
    enabled: !!dispute,
  })

  // H10: checklist bukti — tandai yang sudah dibuka sebelum keputusan.
  const evidenceIds = useMemo(() => {
    const raw = Array.isArray(dispute?.evidences) ? dispute.evidences : []
    return raw
      .map((e) => String(asRecord(e)?.id ?? ""))
      .filter((id) => id.length > 0)
  }, [dispute])
  const checklist = useEvidenceChecklist(disputeId, profile?.adminId ?? "anon", evidenceIds)

  // H04: dampak keputusan — ditampilkan sebelum eksekusi.
  const resolveImpact = useMemo(() => {
    const items: string[] = []
    if (resolution === "FULL_BUYER") items.push("Dana escrow dikembalikan ke pembeli (tidak termasuk biaya platform)")
    else if (resolution === "FULL_SELLER") items.push("Seluruh dana escrow dicairkan ke penjual")
    else items.push(`Dana escrow dibagi: ${buyerPercent || "?"}% pembeli / ${sellerPercent || "?"}% penjual`)
    if (preview) {
      items.push(
        `Pratinjau nominal: ${formatIDR(preview.buyerAmount)} ke pembeli · ${formatIDR(preview.sellerAmount)} ke penjual`,
      )
    }
    items.push("Keputusan final — tidak bisa dibatalkan")
    items.push("Tercatat di audit log beserta alasan dan catatan")
    return items
  }, [resolution, buyerPercent, sellerPercent, preview])

  /**
   * SEC-501: total disbursement pratinjau (dalam sen). Di atas Rp1.000.000
   * → tampilkan peringatan "dibutuhkan persetujuan admin kedua".
   */
  const previewTotalSen = useMemo(() => {
    if (!preview) return 0
    const b = Number(preview.buyerAmountSen)
    const s = Number(preview.sellerAmountSen)
    const total = (Number.isFinite(b) ? b : 0) + (Number.isFinite(s) ? s : 0)
    return total
  }, [preview])
  const isLargeNominal = previewTotalSen > 100_000_000 // > Rp1.000.000 (sen)

  return (
    <RoleGate href="/disputes">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-h2 font-bold text-text-primary">
            {dispute?.orderId ? `Sengketa ${dispute.orderId}` : "Detail Sengketa"}
          </h1>
          <p className="mt-1 text-body text-text-secondary">
            {dispute ? `ID: ${dispute.id}` : "Info sengketa, pesan, dan aksi putusan."}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {/* DP-021: indikator kesegaran data dari polling otomatis 20 dtk. */}
          {lastUpdated ? (
            <p className="text-caption text-text-secondary">
              Diperbarui {formatDateTimeWIB(lastUpdated)} · refresh otomatis tiap 20 dtk
            </p>
          ) : null}
          {/* Navigasi sengketa sebelumnya/berikutnya (daftar 100 terbaru). */}
          <div className="flex items-center gap-2">
            <Button
              variant="secondary"
              size="sm"
              fullWidth={false}
              disabled={!prevDispute}
              title={
                prevDispute
                  ? `Sengketa sebelumnya — order ${prevDispute.orderId}`
                  : "Tidak ada sengketa sebelumnya di daftar terbaru"
              }
              onClick={() => {
                if (prevDispute) router.push(`/disputes/${prevDispute.id}`)
              }}
            >
              ← Sebelumnya
            </Button>
            <Button
              variant="secondary"
              size="sm"
              fullWidth={false}
              disabled={!nextDispute}
              title={
                nextDispute
                  ? `Sengketa berikutnya — order ${nextDispute.orderId}`
                  : "Tidak ada sengketa berikutnya di daftar terbaru"
              }
              onClick={() => {
                if (nextDispute) router.push(`/disputes/${nextDispute.id}`)
              }}
            >
              Berikutnya →
            </Button>
          </div>
          <Button
            variant="secondary"
            size="sm"
            fullWidth={false}
            loading={refreshing}
            onClick={reloadAll}
          >
            Muat ulang
          </Button>
        </div>
      </div>

      {/* H09: siapa sedang menangani sengketa ini (tanpa lock permanen). */}
      <DisputePresence disputeId={disputeId} />

      {/* H08: peringatan bila record berubah saat form terbuka. */}
      {revGuard.stale ? (
        <RevisionBanner
          onReload={async () => {
            await load("refresh")
            revGuard.acknowledge()
          }}
        />
      ) : null}

      {loading ? (
        <div className="flex min-h-[40vh] items-center justify-center gap-2">
          <Spinner size="md" />
          <p className="text-body text-text-secondary">Memuat detail sengketa…</p>
        </div>
      ) : error || !dispute ? (
        <Card>
          <EmptyState
            title="Gagal memuat detail sengketa"
            description={error ?? "Data tidak ditemukan."}
            action={
              <Button
                variant="secondary"
                fullWidth={false}
                onClick={() => {
                  void load("initial")
                  void loadMessages()
                  void loadOrderChat()
                }}
              >
                Coba lagi
              </Button>
            }
          />
        </Card>
      ) : (
        <div className="grid gap-4 xl:grid-cols-2">
          <Card padded={false}>
            <CardHeader
              title="Info sengketa"
              action={
                <Badge tone={DISPUTE_STATUS_TONE[status] ?? "neutral"}>
                  {DISPUTE_STATUS_LABEL[status] ?? status}
                </Badge>
              }
            />
            <CardBody>
              <dl>
                <KeyValue label="ID Sengketa" value={dispute.id} mono copyText={dispute.id} />
                <KeyValue label="ID Order" value={dispute.orderId} mono copyText={dispute.orderId} />
                {/* Countdown sisa SLA 72 jam — live tiap detik. */}
                <KeyValue
                  label="Sisa SLA"
                  value={
                    <SlaCountdown
                      createdAt={dispute.createdAt}
                      slaDeadlineAt={(dispute as { slaDeadlineAt?: string | null }).slaDeadlineAt ?? null}
                      escalationSlaDeadlineAt={(dispute as { escalationSlaDeadlineAt?: string | null }).escalationSlaDeadlineAt ?? null}
                      resolved={isResolved}
                    />
                  }
                />
                {dispute.reason ? <KeyValue label="Alasan" value={dispute.reason} /> : null}
                {/* A9 (audit 2026-09-26): tampilkan nama admin pelaksana bila tersedia,
                    bukan ID mentah. Backend menyertakan relasi assignedAdmin. */}
                <KeyValue
                  label="Ditugaskan ke"
                  value={
                    (dispute.assignedAdmin as { fullName?: string } | undefined)?.fullName ||
                    (dispute.assignedAdminId ? String(dispute.assignedAdminId) : "—")
                  }
                />
                <KeyValue label="Dibuat" value={formatDateTimeWIB(dispute.createdAt)} />
                {dispute.updatedAt ? (
                  <KeyValue label="Diperbarui" value={formatDateTimeWIB(dispute.updatedAt)} />
                ) : null}
              </dl>
            </CardBody>
          </Card>

          {/* ADM-110: kartu hasil putusan untuk sengketa yang sudah resolved. */}
          {isResolved && decision ? (
            <Card padded={false}>
              <CardHeader title="Hasil putusan" />
              <CardBody>
                <dl>
                  <KeyValue
                    label="Keputusan"
                    value={
                      RESOLUTION_OPTIONS.find((o) => o.value === String(decision.decision))?.label ??
                      String(decision.decision ?? "—")
                    }
                  />
                  {decision.buyerPercent != null || decision.sellerPercent != null ? (
                    <KeyValue
                      label="Pembagian"
                      value={`Pembeli ${String(decision.buyerPercent ?? "—")}% · Penjual ${String(decision.sellerPercent ?? "—")}%`}
                    />
                  ) : null}
                  {decision.buyerAmount != null ? (
                    <KeyValue label="Nominal pembeli" value={formatIdrSen(decision.buyerAmount as string | number)} />
                  ) : null}
                  {decision.sellerAmount != null ? (
                    <KeyValue label="Nominal penjual" value={formatIdrSen(decision.sellerAmount as string | number)} />
                  ) : null}
                  {decision.decisionNotes ? (
                    <KeyValue label="Catatan putusan" value={String(decision.decisionNotes)} />
                  ) : null}
                  {decision.decidedAt ? (
                    <KeyValue label="Diputus" value={formatDateTimeWIB(String(decision.decidedAt))} />
                  ) : null}
                </dl>
              </CardBody>
            </Card>
          ) : null}

          {/* K6 (audit 2026-10-10): jejak pergerakan dana putusan (no-wallet)
              dari baris durable — admin melihat di mana uang berada, dan
              SUPER_ADMIN bisa mengulang settlement yang FAILED/ESCALATED. */}
          {moneyTrail ? (
            <Card padded={false}>
              <CardHeader title="Pergerakan dana" />
              <CardBody>
                <dl>
                  <KeyValue
                    label="Settlement"
                    value={
                      settlementIntent
                        ? `${settlementIntent.status} · pembeli ${formatIdrSen(settlementIntent.buyerAmountSen)} · penjual ${formatIdrSen(settlementIntent.sellerAmountSen)} · percobaan ${settlementIntent.attemptCount}`
                        : "— (belum ada putusan no-wallet)"
                    }
                  />
                  {settlementIntent?.lastError ? (
                    <KeyValue label="Error terakhir" value={settlementIntent.lastError} />
                  ) : null}
                  <KeyValue
                    label="Refund pembeli (DANA)"
                    value={
                      moneyTrail.buyerRefund
                        ? `${moneyTrail.buyerRefund.status} · ${formatIdrSen(moneyTrail.buyerRefund.amountSen)}${moneyTrail.buyerRefund.danaReferenceNo ? ` · ref ${moneyTrail.buyerRefund.danaReferenceNo}` : ""}`
                        : "—"
                    }
                  />
                  <KeyValue
                    label="Pencairan penjual"
                    value={
                      moneyTrail.sellerDisbursement
                        ? `${moneyTrail.sellerDisbursement.status} · ${formatIdrSen(moneyTrail.sellerDisbursement.amountSen)}${moneyTrail.sellerDisbursement.heldReason ? ` · ${moneyTrail.sellerDisbursement.heldReason}` : ""}${moneyTrail.sellerDisbursement.lastError ? ` · ${moneyTrail.sellerDisbursement.lastError}` : ""}`
                        : "—"
                    }
                  />
                  <KeyValue
                    label="Pencairan escrow order"
                    value={
                      moneyTrail.orderRelease
                        ? `${moneyTrail.orderRelease.status} · ${formatIdrSen(moneyTrail.orderRelease.amountSen)}${moneyTrail.orderRelease.releasedAt ? ` · ${formatDateTimeWIB(moneyTrail.orderRelease.releasedAt)}` : ""}`
                        : "— (dana masih di Kahade)"
                    }
                  />
                </dl>
                {canRetrySettlement ? (
                  <div className="mt-3">
                    <Button
                      variant="secondary"
                      fullWidth={false}
                      loading={retryingSettlement}
                      onClick={() => void handleRetrySettlement()}
                    >
                      Ulangi settlement
                    </Button>
                  </div>
                ) : null}
              </CardBody>
            </Card>
          ) : null}

          {/* ADM-120: panggilan mediasi yang tercatat pada sengketa. */}
          {Array.isArray(dispute.calls) && dispute.calls.length > 0 ? (
            <Card padded={false} className="xl:col-span-2">
              <CardHeader title="Panggilan mediasi" />
              <CardBody>
                <ul className="space-y-2">
                  {(dispute.calls as Array<Record<string, unknown>>).map((c, i) => {
                    const dur = typeof c.durationSeconds === "number" ? c.durationSeconds : null
                    return (
                      <li
                        key={String(c.id ?? i)}
                        className="flex flex-wrap items-center justify-between gap-2 rounded-sm bg-surface px-4 py-3"
                      >
                        <div>
                          <p className="text-body font-medium text-text-primary">
                            Status: {String(c.status ?? "—")}
                          </p>
                          <p className="text-caption text-text-secondary">
                            Diminta {c.requestedAt ? formatDateTimeWIB(String(c.requestedAt)) : "—"}
                            {c.startedAt ? ` · mulai ${formatDateTimeWIB(String(c.startedAt))}` : ""}
                            {c.endedAt ? ` · selesai ${formatDateTimeWIB(String(c.endedAt))}` : ""}
                          </p>
                        </div>
                        <p className="text-body text-text-secondary">
                          {dur != null ? `Durasi ${Math.floor(dur / 60)} mnt ${dur % 60} dtk` : "Belum ada durasi"}
                        </p>
                      </li>
                    )
                  })}
                </ul>
              </CardBody>
            </Card>
          ) : null}

          <Card padded={false} className="xl:col-span-2">
            <CardHeader title="Pihak, nominal & bukti" />
            <CardBody>
              <PartiesAndEvidence
                dispute={dispute}
                hasNewEvidence={newEvidence}
                onOpenEvidence={(id) => checklist.markOpened(id)}
              />
              {/* BAI-094: bukti titipan admin — hanya pemegang kasus di status terbuka. */}
              {isCaseHolder && ["OPEN", "ASSIGNED", "UNDER_REVIEW", "ESCALATED"].includes(status) ? (
                <AdminEvidenceUploader disputeId={disputeId} onSubmitted={() => void load("refresh")} />
              ) : null}
            </CardBody>
          </Card>

          <Card padded={false} className="xl:col-span-2">
            <CardHeader title="Klaim & usulan penyelesaian" />
            <CardBody>
              <ClaimsAndProposals dispute={dispute} />
            </CardBody>
          </Card>

          <Card padded={false}>
            <CardHeader title="Aksi putusan" />
            <CardBody>
              {isResolved ? (
                <p className="text-body text-text-secondary">
                  Sengketa ini sudah diputus — lihat kartu “Hasil putusan” di atas.
                </p>
              ) : (
                <>
                  {/* H10: checklist bukti sebelum keputusan. */}
                  <div className="mb-4">
                    <EvidenceChecklist
                      checklist={checklist}
                      items={evidenceIds.map((id, i) => ({
                        id,
                        label: `Bukti ${i + 1}`,
                      }))}
                    />
                  </div>
                  <div className="flex flex-wrap gap-2">
                  <Button
                    variant="secondary"
                    fullWidth={false}
                    disabled={!canReview}
                    title={canReview ? undefined : isCaseHolder ? "Hanya tersedia saat status ASSIGNED" : "Ambil alih (assign) dulu — hanya pemegang kasus yang bisa mereview"}
                    loading={acting === "under-review"}
                    onClick={handleUnderReview}
                  >
                    Mulai review
                  </Button>
                  {isDisputeAdmin ? (
                    <Button
                      variant="secondary"
                      fullWidth={false}
                      disabled={!canAssign}
                      title={canAssign ? undefined : "Assign hanya untuk status OPEN"}
                      loading={acting === "assign"}
                      onClick={selfAssign}
                    >
                      Ambil sengketa ini
                    </Button>
                  ) : (
                    <Button
                      variant="secondary"
                      fullWidth={false}
                      disabled={!canAssign}
                      title={canAssign ? undefined : isSuperAdmin ? "Reassign tersedia untuk status OPEN/ASSIGNED/UNDER_REVIEW" : "Assign hanya untuk status OPEN"}
                      onClick={openAssign}
                    >
                      Assign
                    </Button>
                  )}
                  <Button
                    variant="secondary"
                    fullWidth={false}
                    disabled={!canEscalate}
                    title={
                      canEscalate
                        ? "Tandai sengketa sebagai ESCALATED (dana tetap di escrow sampai resolve)"
                        : isResolved
                          ? "Sengketa sudah diputus"
                          : "Sengketa sudah dieskalasi"
                    }
                    loading={acting === "escalate"}
                    onClick={() => {
                      setEscalateReason("")
                      setEscalateOpen(true)
                    }}
                  >
                    Eskalasi 1 ketuk
                  </Button>
                  <Button
                    variant="primary"
                    fullWidth={false}
                    disabled={!canResolve}
                    onClick={openResolve}
                  >
                    Resolve
                  </Button>
                  </div>
                  {checklist.unopenedCount > 0 ? (
                    <p className="mt-3 text-caption text-warning-text">
                      {checklist.unopenedCount} bukti belum diperiksa — keputusan idealnya
                      menunggu seluruh bukti ditinjau.
                    </p>
                  ) : null}
                </>
              )}
              {!isResolved && !canResolve ? (
                <p className="mt-3 text-caption text-text-secondary">
                  {status === "ASSIGNED"
                    ? // DP-007: backend menolak resolve dari ASSIGNED — arahkan lewat "Mulai review".
                      "Tekan “Mulai review” terlebih dahulu — tombol Resolve aktif setelah sengketa under review."
                    : "Resolve tersedia setelah sengketa ditugaskan dan ditandai under review."}
                </p>
              ) : null}
              {/* BAI-084: hint bila bukan pemegang kasus. */}
              {!isResolved && !isCaseHolder && (status === "ASSIGNED" || status === "UNDER_REVIEW" || status === "ESCALATED") ? (
                <p className="mt-3 text-caption text-warning-text">
                  Sengketa ini dipegang mediator lain — ambil alih (assign) dulu untuk mereview atau menyelesaikannya.
                </p>
              ) : null}
            </CardBody>
          </Card>

          <Card padded={false} className="xl:col-span-2">
            <CardHeader
              title="Riwayat pesan mediasi"
              action={newMessages ? <Badge tone="info">Ada pesan baru</Badge> : undefined}
            />
            <CardBody>
              {msgLoading ? (
                <p className="text-body text-text-secondary">Memuat pesan…</p>
              ) : msgError ? (
                <div className="flex flex-wrap items-center gap-3">
                  <p className="text-body text-danger-text">{msgError}</p>
                  <Button
                    variant="secondary"
                    size="sm"
                    fullWidth={false}
                    onClick={() => void loadMessages()}
                  >
                    Coba lagi
                  </Button>
                </div>
              ) : messages.length === 0 ? (
                <p className="text-body text-text-secondary">Belum ada pesan.</p>
              ) : (
                <>
                  <ul className="space-y-3">
                    {messages.map((m) => {
                      const senderLabel =
                        disputeOrder?.buyerId && String(m.senderId) === String(disputeOrder.buyerId)
                          ? "Pembeli"
                          : disputeOrder?.sellerId && String(m.senderId) === String(disputeOrder.sellerId)
                            ? "Penjual"
                            : "Admin"
                      return (
                        <li key={m.id} className="rounded-sm bg-surface px-4 py-3">
                          <p className="text-caption text-text-secondary">
                            {senderLabel} · {formatDateTimeWIB(m.createdAt)}
                          </p>
                          <p className="mt-1 text-body text-text-primary">{m.message}</p>
                        </li>
                      )
                    })}
                  </ul>
                  {/* ADM-127: muat riwayat pesan lama via cursor. */}
                  {msgHasMore ? (
                    <div className="mt-3">
                      <Button
                        variant="secondary"
                        size="sm"
                        fullWidth={false}
                        loading={msgOlderLoading}
                        onClick={() => void loadOlderMessages()}
                      >
                        Muat pesan lama
                      </Button>
                    </div>
                  ) : null}
                </>
              )}

              <div className="mt-4 space-y-3">
                {/* ADM-126: template pesan mediasi statis (aman, tanpa janji nominal). */}
                <div className="flex flex-wrap gap-2">
                  {MESSAGE_TEMPLATES.map((t) => (
                    <Button
                      key={t.label}
                      variant="secondary"
                      size="sm"
                      fullWidth={false}
                      onClick={() => mediationDraft.setValue(t.text)}
                      title="Sisipkan template ke kolom pesan (bisa diedit sebelum dikirim)"
                    >
                      {t.label}
                    </Button>
                  ))}
                </div>
                {/* BAI-095: catatan internal kolaboratif (API backend). */}
                {notesLoading ? (
                  <p className="text-caption text-text-secondary">Memuat catatan internal…</p>
                ) : internalNotes.length > 0 ? (
                  <ul className="flex flex-col gap-2">
                    {internalNotes.map((n) => (
                      <li
                        key={n.id}
                        className="rounded-sm border border-warning/40 bg-warning/5 px-3 py-2"
                      >
                        <p className="text-caption text-text-secondary">
                          📝 {n.admin?.fullName?.trim() || "Admin"} · {formatDateTimeWIB(n.createdAt)} · internal
                        </p>
                        <p className="mt-1 whitespace-pre-wrap text-body text-text-primary">
                          {n.note}
                        </p>
                      </li>
                    ))}
                  </ul>
                ) : null}
                {/* BAI-095: composer terpisah — default catatan internal; pesan ke
                    pengguna wajib konfirmasi eksplisit. */}
                <SplitComposer
                  internalValue={internalDraft.value}
                  onInternalChange={internalDraft.setValue}
                  externalValue={mediationDraft.value}
                  onExternalChange={mediationDraft.setValue}
                  onSendInternal={(text) => void handleSaveInternalNote(text)}
                  onSendExternal={(text) => void handleSendMessage(text)}
                  sending={sending || savingNote}
                  internalFooter={
                    <div className="mt-1">
                      <DraftStatus status={internalDraft.status} savedAt={internalDraft.savedAt} />
                    </div>
                  }
                />
                {/* H11: status autosave draf pesan mediasi. */}
                <DraftStatus status={mediationDraft.status} savedAt={mediationDraft.savedAt} />
              </div>
            </CardBody>
          </Card>

          {/* ADM-111: percakapan order buyer–seller, termasuk pesan terhapus. */}
          <Card padded={false} className="xl:col-span-2">
            <CardHeader
              title="Percakapan order (buyer–seller)"
              action={
                <p className="text-caption text-text-secondary">
                  Termasuk pesan yang dihapus — bukti untuk mediasi
                </p>
              }
            />
            <CardBody>
              {orderChatLoading ? (
                <p className="text-body text-text-secondary">Memuat percakapan…</p>
              ) : orderChatError ? (
                <div className="flex flex-wrap items-center gap-3">
                  <p className="text-body text-danger-text">{orderChatError}</p>
                  <Button
                    variant="secondary"
                    size="sm"
                    fullWidth={false}
                    onClick={() => void loadOrderChat()}
                  >
                    Coba lagi
                  </Button>
                </div>
              ) : orderChat.length === 0 ? (
                <p className="text-body text-text-secondary">Belum ada percakapan di room order.</p>
              ) : (
                <>
                  <ul className="space-y-3">
                    {orderChat.map((m) => {
                      const senderLabel =
                        disputeOrder?.buyerId && String(m.senderId) === String(disputeOrder.buyerId)
                          ? "Pembeli"
                          : disputeOrder?.sellerId && String(m.senderId) === String(disputeOrder.sellerId)
                            ? "Penjual"
                            : "Admin"
                      const deleted = m.isDeleted === true
                      return (
                        <li
                          key={m.id}
                          className={
                            deleted
                              ? "rounded-sm border border-dashed border-border px-4 py-3 opacity-70"
                              : "rounded-sm bg-surface px-4 py-3"
                          }
                        >
                          <p className="text-caption text-text-secondary">
                            {senderLabel} · {formatDateTimeWIB(m.createdAt)}
                            {deleted ? " · dihapus" : ""}
                          </p>
                          <p className="mt-1 text-body text-text-primary">
                            {deleted
                              ? `Isi asli (dihapus): ${String(m.deletedContent ?? m.content ?? m.message ?? "—")}`
                              : String(m.content ?? m.message ?? "—")}
                          </p>
                        </li>
                      )
                    })}
                  </ul>
                  {orderChatHasMore ? (
                    <div className="mt-3">
                      <Button
                        variant="secondary"
                        size="sm"
                        fullWidth={false}
                        loading={orderChatOlderLoading}
                        onClick={() => void loadOlderOrderChat()}
                      >
                        Muat chat lama
                      </Button>
                    </div>
                  ) : null}
                </>
              )}
            </CardBody>
          </Card>
        </div>
      )}

      {/* Assign */}
      <Dialog
        open={assignOpen}
        onClose={() => setAssignOpen(false)}
        title="Assign sengketa"
        description="Pilih admin yang akan menangani sengketa ini."
        dirty={adminId.trim().length > 0}
        footer={
          <div className="flex flex-col gap-2">
            <Button
              variant="primary"
              loading={acting === "assign"}
              disabled={adminId.trim().length === 0}
              onClick={handleAssign}
            >
              Tugaskan
            </Button>
            <Button
              variant="ghost"
              disabled={acting === "assign"}
              onClick={() => setAssignOpen(false)}
            >
              Batal
            </Button>
          </div>
        }
      >
        <Input
          label="Cari nama admin"
          value={adminSearch}
          onChange={(e) => setAdminSearch(e.target.value)}
          placeholder="Ketik nama admin…"
          disabled={adminsLoading}
          hint="Saring daftar di bawah berdasarkan nama."
        />
        <Select
          label="Admin penangan"
          options={[
            { value: "", label: adminsLoading ? "Memuat…" : "— Pilih admin —" },
            ...adminOptions.filter((o) =>
              o.label.toLowerCase().includes(adminSearch.trim().toLowerCase()),
            ),
          ]}
          value={adminId}
          onChange={(e) => setAdminId(e.target.value)}
          disabled={adminsLoading}
          hint="Hanya admin sengketa & super admin yang aktif."
        />
      </Dialog>

      {/* Resolve */}
      <Dialog
        open={resolveOpen}
        onClose={() => setResolveOpen(false)}
        title="Resolve sengketa"
        description="Keputusan ini tercatat dan tidak bisa dibatalkan."
        dirty={reasonValid || resolveDraft.hasDraft}
        footer={
          <div className="flex flex-col gap-2">
            <Button
              variant="primary"
              loading={acting === "resolve"}
              disabled={!notesValid || !reasonValid || !splitValid}
              onClick={handleResolve}
            >
              Selesaikan sengketa
            </Button>
            <Button
              variant="ghost"
              disabled={acting === "resolve"}
              onClick={() => setResolveOpen(false)}
            >
              Batal
            </Button>
          </div>
        }
      >
        <div className="space-y-4">
          {/* H04: dampak keputusan — tampil SEBELUM eksekusi. */}
          <div className="rounded-sm border border-danger/40 bg-danger/10 p-3">
            <p className="mb-1 text-label font-semibold text-danger-text">
              Dampak keputusan ini:
            </p>
            <ul className="list-disc pl-5 text-body text-text-primary">
              {resolveImpact.map((item, i) => (
                <li key={i}>{item}</li>
              ))}
            </ul>
          </div>
          {/* SEC-501: nominal besar — dibutuhkan persetujuan admin kedua. */}
          {isLargeNominal ? (
            <div className="rounded-sm border border-warning/40 bg-warning/5 px-3 py-2">
              <p className="text-body font-semibold text-warning-text">
                Nominal di atas Rp1.000.000 — dibutuhkan persetujuan admin kedua
                sebelum keputusan dieksekusi.
              </p>
            </div>
          ) : null}
          {/* H04: alasan terstruktur (wajib). */}
          <Select
            label="Alasan keputusan (wajib)"
            options={[{ value: "", label: "— Pilih alasan —" }, ...RESOLVE_REASON_OPTIONS]}
            value={resolveReason}
            onChange={(e) => setResolveReason(e.target.value)}
          />
          <Select
            label="Keputusan penyelesaian"
            options={RESOLUTION_OPTIONS}
            value={resolution}
            onChange={(e) => {
              setResolution(e.target.value as Resolution)
              setPreview(null)
              setPreviewError(null)
            }}
          />
          <div>
            <TextArea
              label="Catatan keputusan"
              required
              rows={4}
              value={resolveDraft.value}
              onChange={(e) => resolveDraft.setValue(e.target.value)}
              placeholder="Minimal 100 karakter untuk dokumentasi audit…"
              maxLength={5000}
              hint={`${resolveDraft.value.trim().length} / 100 karakter minimum`}
            />
            {/* H11: status autosave draf catatan keputusan. */}
            <DraftStatus status={resolveDraft.status} savedAt={resolveDraft.savedAt} />
          </div>
          {/* DP-008: persen SPLIT wajib backend (1–99, jumlah 100). Hanya
              tampil bila keputusan SPLIT dipilih. */}
          {isSplit ? (
            <div className="grid grid-cols-2 gap-3">
              <Input
                label="Pembeli (%)"
                required
                type="number"
                inputMode="numeric"
                min={1}
                max={99}
                value={buyerPercent}
                onChange={(e) => {
                  setBuyerPercent(e.target.value)
                  setPreview(null)
                  setPreviewError(null)
                }}
                error={
                  buyerPercent !== "" && (!Number.isInteger(buyerPct) || buyerPct < 1 || buyerPct > 99)
                    ? "Isi 1–99"
                    : undefined
                }
              />
              <Input
                label="Penjual (%)"
                required
                type="number"
                inputMode="numeric"
                min={1}
                max={99}
                value={sellerPercent}
                onChange={(e) => {
                  setSellerPercent(e.target.value)
                  setPreview(null)
                  setPreviewError(null)
                }}
                error={
                  sellerPercent !== "" && (!Number.isInteger(sellerPct) || sellerPct < 1 || sellerPct > 99)
                    ? "Isi 1–99"
                    : undefined
                }
              />
            </div>
          ) : null}
          {isSplit ? (
            <p
              role={splitValid ? undefined : "alert"}
              className={
                splitValid
                  ? "text-caption text-text-secondary"
                  : "text-caption text-danger-text"
              }
            >
              {splitValid
                ? `Pembagian: pembeli ${buyerPct}% · penjual ${sellerPct}%`
                : "Jumlah persen pembeli + penjual harus tepat 100."}
            </p>
          ) : null}

          {/* ADM-109: pratinjau nominal disbursement SEBELUM eksekusi. */}
          <div className="rounded-sm border border-border bg-surface px-4 py-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-caption font-semibold text-text-secondary">
                Pratinjau nominal disbursement
              </p>
              <Button
                variant="secondary"
                size="sm"
                fullWidth={false}
                loading={previewLoading}
                disabled={isSplit && !splitValid}
                onClick={() => void handlePreview()}
              >
                Hitung pratinjau
              </Button>
            </div>
            {previewError ? (
              <p role="alert" className="mt-2 text-caption text-danger-text">
                {previewError}
              </p>
            ) : preview ? (
              <dl className="mt-2 space-y-1 text-body">
                <div className="flex justify-between gap-2">
                  <dt className="text-text-secondary">Pembeli menerima</dt>
                  <dd className="font-semibold">{formatIdrSen(preview.buyerAmountSen)}</dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="text-text-secondary">Penjual menerima</dt>
                  <dd className="font-semibold">{formatIdrSen(preview.sellerAmountSen)}</dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="text-text-secondary">Platform menahan</dt>
                  <dd>{formatIdrSen(preview.platformRetainAmountSen)}</dd>
                </div>
                {/* BAD-025: kebijakan platform fee untuk keputusan FULL_BUYER —
                    tampil hanya bila backend mengirim feePolicy. */}
                {resolution === "FULL_BUYER" && preview.feePolicy ? (
                  <div className="flex justify-between gap-2">
                    <dt className="text-text-secondary">Platform fee dikembalikan ke pembeli</dt>
                    <dd className="font-semibold">
                      {preview.feePolicy.fullBuyerRefundsPlatformFee ? "Ya" : "Tidak"}
                    </dd>
                  </div>
                ) : null}
                {preview.isPostCompletionDispute ? (
                  <p className="pt-1 text-caption text-text-secondary">
                    Sengketa pasca-penyelesaian — disbursement mengikuti kebijakan
                    platform fee yang berlaku.
                  </p>
                ) : null}
              </dl>
            ) : (
              <p className="mt-2 text-caption text-text-secondary">
                Klik “Hitung pratinjau” untuk melihat nominal sebelum keputusan
                dieksekusi. Tanpa pratinjau, tombol eksekusi tetap aktif.
              </p>
            )}
          </div>
        </div>
      </Dialog>
      {/* Batch 43 item #33: eskalasi 1 ketuk — konfirmasi + alasan wajib (audit). */}
      <Dialog
        open={escalateOpen}
        onClose={() => setEscalateOpen(false)}
        title="Eskalasi sengketa?"
        description="Sengketa ditandai ESCALATED dan diprioritaskan untuk putusan tingkat lanjut. Dana tetap di escrow sampai sengketa di-resolve."
        dirty={escalateReason.trim().length > 0}
        footer={
          <div className="flex flex-col gap-2">
            <Button
              variant="primary"
              loading={acting === "escalate"}
              disabled={!escalateReason.trim()}
              onClick={handleEscalate}
            >
              Eskalasi sekarang
            </Button>
            <Button
              variant="ghost"
              disabled={acting === "escalate"}
              onClick={() => setEscalateOpen(false)}
            >
              Batal
            </Button>
          </div>
        }
      >
        <TextArea
          label="Alasan eskalasi"
          required
          rows={3}
          value={escalateReason}
          onChange={(e) => setEscalateReason(e.target.value)}
          placeholder="cth. Bukti bertentangan, perlu tinjauan supervisor…"
          maxLength={500}
        />
      </Dialog>
      {/* SEC-501: dialog verifikasi ulang server (step-up) untuk resolve. */}
      {stepUpDialog}
    </RoleGate>
  )
}
