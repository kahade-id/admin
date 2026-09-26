"use client"

/**
 * Admin — Detail sengketa: info, riwayat pesan, dan aksi putusan.
 *
 * Alur aksi (sesuai mobile):
 * - "Mulai review" → markDisputeUnderReview (tersedia bila belum
 *   UNDER_REVIEW/RESOLVED).
 * - "Assign" → Dialog dropdown admin (DISPUTE_ADMIN/SUPER_ADMIN aktif) → assignDispute.
 * - "Resolve" → Dialog: keputusan FULL_BUYER/FULL_SELLER/SPLIT (Select) +
 *   catatan wajib min 100 karakter + persen SPLIT (1–99, jumlah 100, hanya
 *   saat SPLIT) — hanya bila status UNDER_REVIEW/ESCALATED (DP-007).
 *   Payload persis DisputeDecisionDto backend (DP-001).
 * - Riwayat pesan + kirim pesan sebagai admin (DP-002: field `content`).
 * - Polling ringan 20 dtk saat tab aktif + indikator kesegaran (DP-021).
 *
 * Port dari frontend/app/admin/(panel)/disputes/[id].tsx → web desktop.
 */

import { useCallback, useEffect, useState, type ReactNode } from "react"
import { useParams } from "next/navigation"

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
  getDisputeDetail,
  getDisputeMessages,
  markDisputeUnderReview,
  resolveDispute,
  sendDisputeMessage,
  type AdminDisputeItem,
  type DisputeDecision,
  type DisputeMessage,
} from "@/lib/api/admin/disputes"
import { listAdmins } from "@/lib/api/admin/management"
import { userMessage } from "@/lib/api/response"
import { formatDateTimeWIB, formatNumber } from "@/lib/format"

import { DISPUTE_CATEGORY_LABEL, DISPUTE_STATUS_LABEL, DISPUTE_STATUS_TONE } from "../maps"

type Resolution = DisputeDecision

const RESOLUTION_OPTIONS = [
  { value: "FULL_BUYER", label: "Menangkan pembeli" },
  { value: "FULL_SELLER", label: "Menangkan penjual" },
  { value: "SPLIT", label: "Bagi dua (split)" },
]

/** "Rp1.234.567" — konsisten dengan halaman keuangan. */
function formatIDR(n: unknown): string {
  const v = typeof n === "string" ? Number(n) : typeof n === "number" ? n : NaN
  if (!Number.isFinite(v)) return "—"
  return `Rp${formatNumber(Math.round(v))}`
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

/**
 * Pihak yang bersengketa, nominal order, dan bukti dari kedua belah pihak.
 * Data sudah disediakan backend (`initiator`, `order`, `evidences`) — sebelumnya
 * tidak ditampilkan sama sekali sehingga putusan dana diambil tanpa konteks.
 */
function PartiesAndEvidence({ dispute }: { dispute: AdminDisputeItem }) {
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

  return (
    <div className="flex flex-col gap-6">
      <dl>
        <KeyValue
          label="Penggugat (initiator)"
          value={
            initiator
              ? `${initiator.fullName ?? "—"}${initiator.email ? ` · ${initiator.email}` : ""}`
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
        <h3 className="mb-2 text-label font-semibold text-text-secondary">
          Bukti ({evidences.length})
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
                            <a
                              href={url}
                              target="_blank"
                              rel="noopener noreferrer"
                              title="Buka ukuran penuh"
                            >
                              <img
                                src={url}
                                alt={`Bukti ${i + 1}`}
                                loading="lazy"
                                className="h-32 w-full object-cover"
                              />
                            </a>
                          ) : kind === "video" ? (
                            <video
                              src={url}
                              controls
                              preload="metadata"
                              className="h-32 w-full bg-black object-contain"
                            />
                          ) : (
                            <a
                              href={url}
                              target="_blank"
                              rel="noopener noreferrer"
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
                      {p.status}
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

  const [messages, setMessages] = useState<DisputeMessage[]>([])
  const [msgLoading, setMsgLoading] = useState(true)
  const [msgError, setMsgError] = useState<string | null>(null)
  const [draft, setDraft] = useState("")
  const [sending, setSending] = useState(false)

  const [assignOpen, setAssignOpen] = useState(false)
  const [adminId, setAdminId] = useState("")
  const [adminOptions, setAdminOptions] = useState<{ value: string; label: string }[]>([])
  const [adminsLoading, setAdminsLoading] = useState(false)
  const [resolveOpen, setResolveOpen] = useState(false)
  const [resolution, setResolution] = useState<Resolution>("FULL_BUYER")
  const [notes, setNotes] = useState("")
  // DP-008: persen SPLIT — hanya dipakai bila keputusan SPLIT.
  const [buyerPercent, setBuyerPercent] = useState("")
  const [sellerPercent, setSellerPercent] = useState("")
  const [acting, setActing] = useState<string | null>(null)
  // DP-021: kapan data terakhir disegarkan (polling otomatis).
  const [lastUpdated, setLastUpdated] = useState<string | null>(null)

  const load = useCallback(
    async (mode: "initial" | "refresh" = "initial") => {
      if (mode === "initial") setLoading(true)
      else setRefreshing(true)
      setError(null)
      try {
        setDispute(await getDisputeDetail(disputeId))
        // DP-021: penanda kesegaran data untuk indikator di header.
        setLastUpdated(new Date().toISOString())
      } catch (e) {
        setError(userMessage(e))
      } finally {
        setLoading(false)
        setRefreshing(false)
      }
    },
    [disputeId],
  )

  const loadMessages = useCallback(async () => {
    setMsgLoading(true)
    setMsgError(null)
    try {
      const list = await getDisputeMessages(disputeId)
      // AW-021: adaptor sudah menjamin array.
      setMessages(list)
    } catch (e) {
      setMsgError(userMessage(e))
    } finally {
      setMsgLoading(false)
    }
  }, [disputeId])

  useEffect(() => {
    if (disputeId) {
      void load("initial")
      void loadMessages()
    }
  }, [disputeId, load, loadMessages])

  // DP-021: polling ringan tiap 20 detik, hanya saat tab aktif, agar admin
  // tahu bila ada bukti/klaim/pesan baru tanpa refresh manual. Interval
  // disengaja tidak agresif; tombol "Muat ulang" tetap tersedia.
  useEffect(() => {
    if (!disputeId) return
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") {
        void load("refresh")
        void loadMessages()
      }
    }, 20_000)
    return () => clearInterval(timer)
  }, [disputeId, load, loadMessages])

  const reloadAll = () => {
    void load("refresh")
    void loadMessages()
  }

  const fail = (title: string, e: unknown) => {
    toast.show({ title, description: userMessage(e), tone: "danger" })
  }

  const handleSendMessage = async () => {
    const text = draft.trim()
    if (!text || sending) return
    setSending(true)
    try {
      await sendDisputeMessage(disputeId, text)
      setDraft("")
      await loadMessages()
      toast.show({ title: "Pesan terkirim", tone: "success" })
    } catch (e) {
      fail("Gagal mengirim pesan", e)
    } finally {
      setSending(false)
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

  const openAssign = useCallback(() => {
    setAssignOpen(true)
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
  const notesValid = notes.trim().length >= 100

  const handleResolve = async () => {
    if (!notesValid || !splitValid || acting) return
    setActing("resolve")
    try {
      // DP-001: payload persis DisputeDecisionDto {decision, decisionNotes, ...}.
      // winnerId dihapus — backend tidak mengenalnya.
      await resolveDispute(disputeId, {
        decision: resolution,
        decisionNotes: notes.trim(),
        ...(isSplit ? { buyerPercent: buyerPct, sellerPercent: sellerPct } : {}),
      })
      setResolveOpen(false)
      setNotes("")
      setBuyerPercent("")
      setSellerPercent("")
      await load("refresh")
      toast.show({ title: "Sengketa diselesaikan", tone: "success" })
    } catch (e) {
      fail("Gagal menyelesaikan sengketa", e)
    } finally {
      setActing(null)
    }
  }

  const status = dispute ? String(dispute.status) : ""
  const canReview = status !== "" && status !== "UNDER_REVIEW" && status !== "RESOLVED"
  // DP-007: backend hanya menerima resolve dari UNDER_REVIEW/ESCALATED.
  // ASSIGNED diarahkan lewat "Mulai review" (markDisputeUnderReview).
  const canResolve = status === "UNDER_REVIEW" || status === "ESCALATED"

  // Info order untuk label pengirim di riwayat pesan (pembeli/penjual/admin).
  const disputeOrder = dispute ? (asRecord(dispute.order) as DisputeOrderInfo | null) : null

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
                <KeyValue label="ID Sengketa" value={dispute.id} mono />
                <KeyValue label="ID Order" value={dispute.orderId} mono />
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

          <Card padded={false} className="xl:col-span-2">
            <CardHeader title="Pihak, nominal & bukti" />
            <CardBody>
              <PartiesAndEvidence dispute={dispute} />
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
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="secondary"
                  fullWidth={false}
                  disabled={!canReview}
                  loading={acting === "under-review"}
                  onClick={handleUnderReview}
                >
                  Mulai review
                </Button>
                <Button variant="secondary" fullWidth={false} onClick={openAssign}>
                  Assign
                </Button>
                <Button
                  variant="primary"
                  fullWidth={false}
                  disabled={!canResolve}
                  onClick={() => setResolveOpen(true)}
                >
                  Resolve
                </Button>
              </div>
              {!canResolve ? (
                <p className="mt-3 text-caption text-text-secondary">
                  {status === "ASSIGNED"
                    ? // DP-007: backend menolak resolve dari ASSIGNED — arahkan lewat "Mulai review".
                      "Tekan “Mulai review” terlebih dahulu — tombol Resolve aktif setelah sengketa under review."
                    : "Resolve tersedia setelah sengketa ditugaskan dan ditandai under review."}
                </p>
              ) : null}
            </CardBody>
          </Card>

          <Card padded={false} className="xl:col-span-2">
            <CardHeader title="Riwayat pesan" />
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
              )}

              <div className="mt-4 space-y-3">
                <TextArea
                  label="Kirim pesan sebagai admin"
                  rows={3}
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  placeholder="Tulis pesan untuk para pihak…"
                  maxLength={2000}
                />
                <Button
                  variant="primary"
                  fullWidth={false}
                  loading={sending}
                  disabled={draft.trim().length === 0}
                  onClick={handleSendMessage}
                >
                  Kirim pesan
                </Button>
              </div>
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
        <Select
          label="Admin penangan"
          options={[{ value: "", label: adminsLoading ? "Memuat…" : "— Pilih admin —" }, ...adminOptions]}
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
        footer={
          <div className="flex flex-col gap-2">
            <Button
              variant="primary"
              loading={acting === "resolve"}
              disabled={!notesValid || !splitValid}
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
          <Select
            label="Keputusan penyelesaian"
            options={RESOLUTION_OPTIONS}
            value={resolution}
            onChange={(e) => setResolution(e.target.value as Resolution)}
          />
          <TextArea
            label="Catatan keputusan"
            required
            rows={4}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Minimal 100 karakter untuk dokumentasi audit…"
            maxLength={5000}
            hint={`${notes.trim().length} / 100 karakter minimum`}
          />
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
                onChange={(e) => setBuyerPercent(e.target.value)}
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
                onChange={(e) => setSellerPercent(e.target.value)}
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
        </div>
      </Dialog>
    </RoleGate>
  )
}
