"use client"

/**
 * Admin — Detail sengketa: info, riwayat pesan, dan aksi putusan.
 *
 * Alur aksi (sesuai mobile):
 * - "Mulai review" → markDisputeUnderReview (hanya ASSIGNED — ADM-108).
 * - "Assign"/"Ambil sengketa ini" → hanya OPEN/WAITING_RESPONSE (ADM-123);
 *   DISPUTE_ADMIN self-assign, SUPER_ADMIN memilih lewat dropdown.
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
  escalateDispute,
  getDisputeDetail,
  getDisputeChat,
  getDisputeMessages,
  markDisputeUnderReview,
  previewResolveDispute,
  resolveDispute,
  sendDisputeMessage,
  type AdminDisputeItem,
  type DisputeDecision,
  type DisputeMessage,
  type DisputeOrderChatMessage,
  type ResolvePreviewResult,
} from "@/lib/api/admin/disputes"
import { listAdmins } from "@/lib/api/admin/management"
import { useAuth } from "@/lib/auth-context"
import { userMessage } from "@/lib/api/response"
import { formatDateTimeWIB, formatIdrSen, formatNumber } from "@/lib/format"
// ADM-405: PII penggugat di-mask secara default (mask-only, tanpa unmask).
import { maskEmail, maskName } from "@/lib/pii"

import { DISPUTE_CATEGORY_LABEL, DISPUTE_STATUS_LABEL, DISPUTE_STATUS_TONE } from "../maps"

type Resolution = DisputeDecision

const RESOLUTION_OPTIONS = [
  { value: "FULL_BUYER", label: "Menangkan pembeli" },
  { value: "FULL_SELLER", label: "Menangkan penjual" },
  { value: "SPLIT", label: "Bagi dua (split)" },
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

  const { profile, role } = useAuth()

  const [messages, setMessages] = useState<DisputeMessage[]>([])
  const [msgCursor, setMsgCursor] = useState<string | null>(null)
  const [msgHasMore, setMsgHasMore] = useState(false)
  const [msgLoading, setMsgLoading] = useState(true)
  const [msgOlderLoading, setMsgOlderLoading] = useState(false)
  const [msgError, setMsgError] = useState<string | null>(null)
  const [draft, setDraft] = useState("")
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
  const [resolveOpen, setResolveOpen] = useState(false)
  const [resolution, setResolution] = useState<Resolution>("FULL_BUYER")
  const [notes, setNotes] = useState("")
  // DP-008: persen SPLIT — hanya dipakai bila keputusan SPLIT.
  const [buyerPercent, setBuyerPercent] = useState("")
  const [sellerPercent, setSellerPercent] = useState("")
  const [acting, setActing] = useState<string | null>(null)
  // Batch 43 item #33: eskalasi 1 ketuk — dialog konfirmasi + alasan (audit).
  const [escalateOpen, setEscalateOpen] = useState(false)
  const [escalateReason, setEscalateReason] = useState("")
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

  // ADM-127: pesan terbaru (halaman pertama) — di-refresh polling;
  // pesan lama dimuat on-demand via cursor tanpa menumpuk duplikat.
  const loadMessages = useCallback(async () => {
    setMsgLoading(true)
    setMsgError(null)
    try {
      const res = await getDisputeMessages(disputeId)
      setMessages(res.messages)
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
    void loadOrderChat()
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
    setResolveOpen(true)
  }

  const status = dispute ? String(dispute.status) : ""
  // ADM-108: backend `markUnderReview` menerima OPEN dan ASSIGNED, tapi OPEN
  // tidak pernah muncul di alur nyata (sengketa baru lahir ASSIGNED;
  // WAITING_RESPONSE unreachable) — gating tunggal: ASSIGNED.
  // ADM-123: assign hanya relevan saat sengketa masih "muda" (OPEN) atau
  // menunggu respons (WAITING_RESPONSE).
  const canAssign = status === "OPEN" || status === "WAITING_RESPONSE"
  const canReview = status === "ASSIGNED"
  // DP-007: backend hanya menerima resolve dari UNDER_REVIEW/ESCALATED.
  // ASSIGNED diarahkan lewat "Mulai review" (markDisputeUnderReview).
  const canResolve = status === "UNDER_REVIEW" || status === "ESCALATED"
  // ADM-110: sengketa yang sudah punya keputusan → tampilkan kartu putusan,
  // tombol resolve disembunyikan.
  const decision = dispute ? asRecord(dispute.decision) : null
  const isResolved = status === "RESOLVED" || decision !== null
  // Batch 43 item #33: eskalasi 1 ketuk tersedia selama sengketa belum
  // diputus dan belum berstatus ESCALATED.
  const canEscalate = !isResolved && status !== "ESCALATED"

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
              {isResolved ? (
                <p className="text-body text-text-secondary">
                  Sengketa ini sudah diputus — lihat kartu “Hasil putusan” di atas.
                </p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="secondary"
                    fullWidth={false}
                    disabled={!canReview}
                    title={canReview ? undefined : "Hanya tersedia saat status ASSIGNED"}
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
                      title={canAssign ? undefined : "Assign hanya untuk status OPEN / WAITING_RESPONSE"}
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
                      title={canAssign ? undefined : "Assign hanya untuk status OPEN / WAITING_RESPONSE"}
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
              )}
              {!isResolved && !canResolve ? (
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
            <CardHeader title="Riwayat pesan mediasi" />
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
                      onClick={() => setDraft(t.text)}
                      title="Sisipkan template ke kolom pesan (bisa diedit sebelum dikirim)"
                    >
                      {t.label}
                    </Button>
                  ))}
                </div>
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
            onChange={(e) => {
              setResolution(e.target.value as Resolution)
              setPreview(null)
              setPreviewError(null)
            }}
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
          maxLength={1000}
        />
      </Dialog>
    </RoleGate>
  )
}
