/**
 * Admin — Detail umpan balik: isi pesan, kontak termasking, timeline audit,
 * catatan internal, tags, assignment, balasan, hubungi (perlu consent),
 * eskalasi risiko, dan penutupan dengan reason code.
 */

"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
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
  addFeedbackNote,
  assignFeedback,
  closeFeedback,
  escalateFeedback,
  findDuplicateFeedback,
  getFeedbackContact,
  getFeedbackDetail,
  replyToFeedback,
  unassignFeedback,
  updateFeedbackStatus,
  updateFeedbackTags,
  type FeedbackContact,
  type FeedbackDetail,
  type FeedbackDuplicate,
  type FeedbackStatus,
} from "@/lib/api/admin/feedback"
import { listAdmins, type AdminUserItem } from "@/lib/api/admin/management"
import { userMessage } from "@/lib/api/response"
import { formatDateTimeWIB } from "@/lib/format"

import {
  FEEDBACK_CLOSE_REASON_LABEL,
  FEEDBACK_CLOSE_REASON_OPTIONS,
  FEEDBACK_IMPACT_LABELS,
  FEEDBACK_RISK_LABEL,
  FEEDBACK_RISK_TONE,
  FEEDBACK_STATUS_LABEL,
  FEEDBACK_STATUS_TONE,
} from "../maps"

const STATUS_OPTIONS = Object.entries(FEEDBACK_STATUS_LABEL).map(([value, label]) => ({
  value,
  label,
}))

function StarRating({ value }: { value?: number | null }) {
  if (!value) return <span className="text-text-secondary">—</span>
  return (
    <span className="font-semibold text-text-primary" title={`${value} dari 5`}>
      {"★".repeat(value)}
      <span className="text-text-tertiary">{"★".repeat(5 - value)}</span>{" "}
      <span className="font-normal text-text-secondary">({value}/5)</span>
    </span>
  )
}

export default function FeedbackDetailPage() {
  const { id } = useParams<{ id: string }>()
  const feedbackId = Array.isArray(id) ? id[0] : (id ?? "")
  const toast = useToast()

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [detail, setDetail] = useState<FeedbackDetail | null>(null)

  const [contact, setContact] = useState<FeedbackContact | null>(null)
  const [contactLoading, setContactLoading] = useState(false)

  const [admins, setAdmins] = useState<AdminUserItem[]>([])
  const [duplicates, setDuplicates] = useState<FeedbackDuplicate[]>([])

  const [nextStatus, setNextStatus] = useState<FeedbackStatus>("IN_REVIEW")
  const [updating, setUpdating] = useState(false)
  const [noteDraft, setNoteDraft] = useState("")
  const [savingNote, setSavingNote] = useState(false)
  const [tagsDraft, setTagsDraft] = useState("")
  const [impactDraft, setImpactDraft] = useState("")
  const [savingTags, setSavingTags] = useState(false)
  const [assigneeDraft, setAssigneeDraft] = useState("")
  const [savingAssign, setSavingAssign] = useState(false)
  const [replyDraft, setReplyDraft] = useState("")
  const [sendingReply, setSendingReply] = useState(false)

  const [escalateOpen, setEscalateOpen] = useState(false)
  const [escalateType, setEscalateType] = useState<"SECURITY_RISK" | "FRAUD_RISK">("FRAUD_RISK")
  const [escalateReason, setEscalateReason] = useState("")
  const [escalating, setEscalating] = useState(false)

  const [closeOpen, setCloseOpen] = useState(false)
  const [closeReason, setCloseReason] = useState<string>("RESOLVED")
  const [closeNote, setCloseNote] = useState("")
  const [closing, setClosing] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const d = await getFeedbackDetail(feedbackId)
      setDetail(d)
      setNextStatus(d.status)
      setTagsDraft((d.tags ?? []).join(", "))
      setImpactDraft(d.impactLabel ?? "")
      setAssigneeDraft(d.assigneeId ?? "")
    } catch (e) {
      setError(userMessage(e))
    } finally {
      setLoading(false)
    }
  }, [feedbackId])

  useEffect(() => {
    if (feedbackId) void load()
  }, [feedbackId, load])

  useEffect(() => {
    void listAdmins({ limit: 100 })
      .then((res) => setAdmins((res.data ?? []).filter((a) => a.isActive)))
      .catch(() => setAdmins([]))
  }, [])

  useEffect(() => {
    if (!feedbackId) return
    void findDuplicateFeedback(feedbackId)
      .then((res) => setDuplicates(res.items ?? []))
      .catch(() => setDuplicates([]))
  }, [feedbackId])

  const fail = (title: string, e: unknown) => {
    toast.show({ title, description: userMessage(e), tone: "danger" })
  }

  const handleLoadContact = async () => {
    if (contactLoading) return
    setContactLoading(true)
    try {
      setContact(await getFeedbackContact(feedbackId))
    } catch (e) {
      fail("Gagal memuat kontak", e)
    } finally {
      setContactLoading(false)
    }
  }

  const handleCopyContact = async () => {
    const value = contact?.contact ?? contact?.maskedContact
    if (!value) return
    try {
      await navigator.clipboard.writeText(value)
      toast.show({ title: "Kontak disalin", tone: "success" })
    } catch {
      toast.show({ title: "Gagal menyalin kontak", tone: "danger" })
    }
  }

  const actions = useMemo(
    () => ({
      status: async () => {
        setUpdating(true)
        try {
          await updateFeedbackStatus(feedbackId, nextStatus)
          await load()
          toast.show({ title: "Status diperbarui", tone: "success" })
        } catch (e) {
          fail("Gagal memperbarui status", e)
        } finally {
          setUpdating(false)
        }
      },
      note: async () => {
        const note = noteDraft.trim()
        if (!note || savingNote) return
        setSavingNote(true)
        try {
          await addFeedbackNote(feedbackId, note)
          setNoteDraft("")
          await load()
          toast.show({ title: "Catatan ditambahkan", tone: "success" })
        } catch (e) {
          fail("Gagal menambah catatan", e)
        } finally {
          setSavingNote(false)
        }
      },
      tags: async () => {
        if (savingTags) return
        setSavingTags(true)
        try {
          const tags = tagsDraft
            .split(",")
            .map((t) => t.trim())
            .filter(Boolean)
            .slice(0, 20)
          await updateFeedbackTags(feedbackId, tags, impactDraft || null)
          await load()
          toast.show({ title: "Tags & impact diperbarui", tone: "success" })
        } catch (e) {
          fail("Gagal memperbarui tags", e)
        } finally {
          setSavingTags(false)
        }
      },
      assign: async () => {
        if (savingAssign) return
        setSavingAssign(true)
        try {
          if (assigneeDraft) await assignFeedback(feedbackId, assigneeDraft)
          else await unassignFeedback(feedbackId)
          await load()
          toast.show({ title: assigneeDraft ? "Masukan ditugaskan" : "Tugas dibatalkan", tone: "success" })
        } catch (e) {
          fail("Gagal mengubah penugasan", e)
        } finally {
          setSavingAssign(false)
        }
      },
      reply: async () => {
        const message = replyDraft.trim()
        if (!message || sendingReply) return
        setSendingReply(true)
        try {
          await replyToFeedback(feedbackId, message)
          setReplyDraft("")
          await load()
          toast.show({ title: "Balasan terkirim", tone: "success" })
        } catch (e) {
          fail("Gagal mengirim balasan", e)
        } finally {
          setSendingReply(false)
        }
      },
      escalate: async () => {
        const reason = escalateReason.trim()
        if (!reason || escalating) return
        setEscalating(true)
        try {
          await escalateFeedback(feedbackId, escalateType, reason)
          setEscalateOpen(false)
          setEscalateReason("")
          await load()
          toast.show({ title: "Masukan dieskalasi", tone: "info" })
        } catch (e) {
          fail("Gagal eskalasi", e)
        } finally {
          setEscalating(false)
        }
      },
      close: async () => {
        if (closing) return
        setClosing(true)
        try {
          // BAI-006: backend /close hanya menerima { reason } — catatan
          // penutupan disimpan sebagai catatan internal agar tidak hilang.
          const note = closeNote.trim()
          if (note) await addFeedbackNote(feedbackId, note)
          await closeFeedback(feedbackId, closeReason)
          setCloseOpen(false)
          setCloseNote("")
          await load()
          toast.show({ title: "Masukan ditutup", tone: "success" })
        } catch (e) {
          fail("Gagal menutup masukan", e)
        } finally {
          setClosing(false)
        }
      },
    }),
    [
      feedbackId,
      nextStatus,
      noteDraft,
      savingNote,
      tagsDraft,
      impactDraft,
      savingTags,
      assigneeDraft,
      savingAssign,
      replyDraft,
      sendingReply,
      escalateType,
      escalateReason,
      escalating,
      closeReason,
      closeNote,
      closing,
      load,
      toast,
    ],
  )

  const consent = detail?.contactConsent ?? contact?.consent ?? false
  const hasContact = Boolean(detail?.contact ?? contact?.maskedContact ?? contact?.contact)

  return (
    <RoleGate href="/feedback">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-h2 font-bold text-text-primary">Detail Masukan</h1>
          <p className="mt-1 text-body text-text-secondary">
            {detail ? `ID: ${detail.id}` : "Peninjauan umpan balik pengguna."}
          </p>
        </div>
        <Button variant="secondary" size="sm" fullWidth={false} onClick={load}>
          Muat ulang
        </Button>
      </div>

      {loading ? (
        <div className="flex min-h-[40vh] items-center justify-center gap-2">
          <Spinner size="md" />
          <p className="text-body text-text-secondary">Memuat detail masukan…</p>
        </div>
      ) : error || !detail ? (
        <Card>
          <EmptyState
            title="Gagal memuat detail masukan"
            description={error ?? "Data tidak ditemukan."}
            action={
              <Button variant="secondary" fullWidth={false} onClick={load}>
                Coba lagi
              </Button>
            }
          />
        </Card>
      ) : (
        <>
          <div className="grid gap-4 xl:grid-cols-2">
            {/* Isi masukan */}
            <Card padded={false}>
              <CardHeader
                title="Masukan"
                action={
                  <Badge tone={FEEDBACK_STATUS_TONE[detail.status] ?? "neutral"}>
                    {FEEDBACK_STATUS_LABEL[detail.status] ?? detail.status}
                  </Badge>
                }
              />
              <CardBody>
                <p className="text-body text-text-primary">{detail.message}</p>
                <dl className="mt-4 space-y-2">
                  <div className="flex justify-between gap-2 text-body">
                    <dt className="text-caption font-semibold text-text-secondary">Kategori</dt>
                    <dd className="text-right text-text-primary">{detail.category}</dd>
                  </div>
                  <div className="flex justify-between gap-2 text-body">
                    <dt className="text-caption font-semibold text-text-secondary">Rating</dt>
                    <dd className="text-right">
                      <StarRating value={detail.rating} />
                    </dd>
                  </div>
                  <div className="flex justify-between gap-2 text-body">
                    <dt className="text-caption font-semibold text-text-secondary">Platform</dt>
                    <dd className="text-right text-text-primary">{detail.platform}</dd>
                  </div>
                  {detail.appVersion ? (
                    <div className="flex justify-between gap-2 text-body">
                      <dt className="text-caption font-semibold text-text-secondary">Versi aplikasi</dt>
                      <dd className="text-right font-mono text-text-primary">{detail.appVersion}</dd>
                    </div>
                  ) : null}
                  <div className="flex justify-between gap-2 text-body">
                    <dt className="text-caption font-semibold text-text-secondary">Waktu</dt>
                    <dd className="text-right text-text-primary">{formatDateTimeWIB(detail.createdAt)}</dd>
                  </div>
                  <div className="flex justify-between gap-2 text-body">
                    <dt className="text-caption font-semibold text-text-secondary">Akun</dt>
                    <dd className="text-right text-text-primary">
                      {detail.account.isGuest
                        ? "Tamu (tanpa akun)"
                        : detail.account.fullName || detail.account.email || detail.userId}
                    </dd>
                  </div>
                  <div className="flex justify-between gap-2 text-body">
                    <dt className="text-caption font-semibold text-text-secondary">Risiko</dt>
                    <dd>
                      <Badge tone={FEEDBACK_RISK_TONE[detail.riskFlag] ?? "neutral"} variant="outline">
                        {FEEDBACK_RISK_LABEL[detail.riskFlag] ?? detail.riskFlag}
                      </Badge>
                    </dd>
                  </div>
                  {detail.slaDueAt ? (
                    <div className="flex justify-between gap-2 text-body">
                      <dt className="text-caption font-semibold text-text-secondary">Tenggat SLA</dt>
                      <dd className="text-right text-text-primary">{formatDateTimeWIB(detail.slaDueAt)}</dd>
                    </div>
                  ) : null}
                </dl>

                {duplicates.length > 0 ? (
                  <div className="mt-4 rounded-sm bg-surface p-3">
                    <p className="text-caption font-semibold text-text-secondary">
                      Kemungkinan duplikat ({duplicates.length})
                    </p>
                    <ul className="mt-2 space-y-1">
                      {duplicates.slice(0, 5).map((d) => (
                        <li key={d.id} className="text-caption text-text-primary">
                          <a href={`/feedback/${d.id}`} className="text-info-text hover:underline">
                            {d.messagePreview.slice(0, 80)}
                          </a>{" "}
                          <span className="text-text-tertiary">· {formatDateTimeWIB(d.createdAt)}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </CardBody>
            </Card>

            {/* Kontak pengirim */}
            <Card padded={false}>
              <CardHeader title="Kontak pengirim" />
              <CardBody>
                {!contact ? (
                  <div className="space-y-2">
                    <p className="text-body text-text-secondary">
                      Kontak ditampilkan dalam bentuk termasking demi privasi. Muat kontak untuk
                      melihat izin hubungi.
                    </p>
                    <Button variant="secondary" fullWidth={false} loading={contactLoading} onClick={handleLoadContact}>
                      Muat kontak
                    </Button>
                  </div>
                ) : (
                  <div className="space-y-3">
                    <p className="font-mono text-h3 text-text-primary">
                      {contact.visibleToRole && contact.contact ? contact.contact : (contact.maskedContact ?? "—")}
                    </p>
                    <div className="flex flex-wrap gap-2">
                      <Badge tone={contact.consent ? "success" : "neutral"} variant="outline">
                        {contact.consent ? "Izin hubungi: Ya" : "Izin hubungi: Tidak"}
                      </Badge>
                      {contact.visibleToRole ? null : (
                        <Badge tone="neutral" variant="outline">
                          Kontak asli tidak terlihat untuk role Anda
                        </Badge>
                      )}
                    </div>
                    {!consent ? (
                      <p className="text-caption text-text-secondary">
                        Pengirim tidak memberi izin untuk dihubungi terkait masukan ini. Hubungan
                        langsung dinonaktifkan untuk menghormati privasi pengirim.
                      </p>
                    ) : null}
                    <div className="flex flex-wrap gap-2">
                      <span
                        title={consent ? undefined : "Pengirim belum memberi izin untuk dihubungi"}
                        className={!consent ? "cursor-not-allowed" : undefined}
                      >
                        <Button
                          variant="primary"
                          fullWidth={false}
                          disabled={!consent || !hasContact}
                          onClick={handleCopyContact}
                        >
                          {contact.consent ? "Hubungi (salin kontak)" : "Hubungi"}
                        </Button>
                      </span>
                    </div>
                  </div>
                )}
              </CardBody>
            </Card>

            {/* Status & penugasan */}
            <Card padded={false}>
              <CardHeader title="Status & penugasan" />
              <CardBody>
                <div className="flex flex-wrap items-end gap-3">
                  <Select
                    label="Status"
                    options={STATUS_OPTIONS}
                    value={nextStatus}
                    onChange={(e) => setNextStatus(e.target.value as FeedbackStatus)}
                    className="min-w-52 flex-1"
                  />
                  <Button variant="primary" fullWidth={false} loading={updating} disabled={nextStatus === detail.status} onClick={actions.status}>
                    Simpan status
                  </Button>
                </div>
                <div className="mt-4 flex flex-wrap items-end gap-3">
                  <Select
                    label="Penanggung jawab"
                    options={[
                      { value: "", label: "Tanpa penugasan" },
                      ...admins.map((a) => ({ value: a.id, label: `${a.fullName} (${a.role})` })),
                    ]}
                    value={assigneeDraft}
                    onChange={(e) => setAssigneeDraft(e.target.value)}
                    className="min-w-52 flex-1"
                  />
                  <Button variant="secondary" fullWidth={false} loading={savingAssign} onClick={actions.assign}>
                    Simpan penugasan
                  </Button>
                </div>
                {detail.assignee ? (
                  <p className="mt-2 text-caption text-text-secondary">
                    Saat ini: {detail.assignee.fullName}
                  </p>
                ) : null}
              </CardBody>
            </Card>

            {/* Tags & impact */}
            <Card padded={false}>
              <CardHeader title="Tags & impact" />
              <CardBody>
                <div className="flex flex-wrap gap-2">
                  {(detail.tags ?? []).length === 0 ? (
                    <span className="text-caption text-text-secondary">Belum ada tag.</span>
                  ) : (
                    detail.tags.map((t) => (
                      <Badge key={t} tone="neutral" variant="outline">
                        {t}
                      </Badge>
                    ))
                  )}
                  {detail.impactLabel ? (
                    <Badge tone="accent" variant="outline">
                      Impact: {detail.impactLabel}
                    </Badge>
                  ) : null}
                </div>
                <div className="mt-4 flex flex-wrap items-end gap-3">
                  <Input
                    label="Tags (pisahkan koma)"
                    value={tagsDraft}
                    onChange={(e) => setTagsDraft(e.target.value)}
                    placeholder="mis. pembayaran, android, crash"
                    className="min-w-52 flex-1"
                  />
                  <Select
                    label="Impact"
                    options={[
                      { value: "", label: "Tanpa label" },
                      ...FEEDBACK_IMPACT_LABELS.map((l) => ({ value: l, label: l })),
                    ]}
                    value={impactDraft}
                    onChange={(e) => setImpactDraft(e.target.value)}
                    className="w-44"
                  />
                  <Button variant="secondary" fullWidth={false} loading={savingTags} onClick={actions.tags}>
                    Simpan
                  </Button>
                </div>
              </CardBody>
            </Card>
          </div>

          {/* Balasan ke akun */}
          <Card padded={false} className="mt-4">
            <CardHeader title="Balasan ke akun pengirim" />
            <CardBody>
              {(detail.replies?.length ?? 0) === 0 ? (
                <p className="text-body text-text-secondary">Belum ada balasan.</p>
              ) : (
                <ul className="space-y-3">
                  {detail.replies!.map((r) => (
                    <li key={r.id} className="rounded-sm bg-surface px-4 py-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <Badge tone="accent">{r.author?.fullName ?? "Admin"}</Badge>
                        <span className="text-caption text-text-secondary">{formatDateTimeWIB(r.createdAt)}</span>
                      </div>
                      <p className="mt-2 text-body text-text-primary">{r.message}</p>
                    </li>
                  ))}
                </ul>
              )}
              <div className="mt-4 space-y-3">
                <TextArea
                  label="Tulis balasan"
                  rows={3}
                  value={replyDraft}
                  onChange={(e) => setReplyDraft(e.target.value)}
                  placeholder="Tulis balasan untuk pengirim masukan…"
                  maxLength={2000}
                />
                <Button variant="primary" fullWidth={false} loading={sendingReply} disabled={replyDraft.trim().length === 0} onClick={actions.reply}>
                  Kirim balasan
                </Button>
              </div>
            </CardBody>
          </Card>

          {/* Catatan internal + timeline */}
          <div className="mt-4 grid gap-4 xl:grid-cols-2">
            <Card padded={false}>
              <CardHeader title="Catatan internal" />
              <CardBody>
                {(detail.notes?.length ?? 0) === 0 ? (
                  <p className="text-body text-text-secondary">Belum ada catatan internal.</p>
                ) : (
                  <ul className="space-y-3">
                    {detail.notes!.map((n) => (
                      <li key={n.id} className="rounded-sm bg-surface px-4 py-3">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <span className="text-caption font-semibold text-text-secondary">
                            {n.author?.fullName ?? "Admin"}
                          </span>
                          <span className="text-caption text-text-tertiary">{formatDateTimeWIB(n.createdAt)}</span>
                        </div>
                        <p className="mt-2 text-body text-text-primary">{n.note}</p>
                      </li>
                    ))}
                  </ul>
                )}
                <div className="mt-4 space-y-3">
                  <TextArea
                    label="Tambah catatan internal"
                    rows={2}
                    value={noteDraft}
                    onChange={(e) => setNoteDraft(e.target.value)}
                    placeholder="Catatan khusus admin (tidak terlihat pengirim)…"
                    maxLength={1000}
                  />
                  <Button variant="secondary" fullWidth={false} loading={savingNote} disabled={noteDraft.trim().length === 0} onClick={actions.note}>
                    Tambah catatan
                  </Button>
                </div>
              </CardBody>
            </Card>

            <Card padded={false}>
              <CardHeader title="Timeline audit" />
              <CardBody>
                {(detail.audit?.length ?? 0) === 0 ? (
                  <p className="text-body text-text-secondary">Belum ada riwayat audit.</p>
                ) : (
                  <ol className="space-y-3">
                    {detail.audit!.map((a) => (
                      <li key={a.id} className="flex gap-3">
                        <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-border" />
                        <div className="min-w-0">
                          <p className="text-body font-semibold text-text-primary">{a.action}</p>
                          {a.detail ? <p className="text-caption text-text-secondary">{a.detail}</p> : null}
                          <p className="text-caption text-text-tertiary">
                            {a.actor?.fullName ?? "Sistem"} · {formatDateTimeWIB(a.createdAt)}
                          </p>
                        </div>
                      </li>
                    ))}
                  </ol>
                )}
              </CardBody>
            </Card>
          </div>

          {/* Aksi sensitif */}
          <Card padded={false} className="mt-4">
            <CardHeader title="Eskalasi & penutupan" />
            <CardBody>
              <div className="flex flex-wrap gap-2">
                <Button variant="secondary" fullWidth={false} onClick={() => setEscalateOpen(true)}>
                  Eskalasi fraud/keamanan
                </Button>
                <Button variant="secondary" fullWidth={false} onClick={() => setCloseOpen(true)} disabled={detail.status === "CLOSED"}>
                  Tutup masukan
                </Button>
              </div>
              {detail.closedAt ? (
                <p className="mt-3 text-caption text-text-secondary">
                  Ditutup pada {formatDateTimeWIB(detail.closedAt)}
                  {detail.closedReason ? ` — ${FEEDBACK_CLOSE_REASON_LABEL[detail.closedReason] ?? detail.closedReason}` : ""}
                </p>
              ) : null}
            </CardBody>
          </Card>

          <Dialog
            open={escalateOpen}
            onClose={() => setEscalateOpen(false)}
            title="Eskalasi masukan"
          >
            <div className="space-y-4">
              <p className="text-body text-text-secondary">
                Eskalasi menandai masukan sebagai risiko fraud atau keamanan untuk ditindaklanjuti
                tim terkait.
              </p>
              <Select
                label="Jenis risiko"
                options={[
                  { value: "FRAUD_RISK", label: "Risiko fraud" },
                  { value: "SECURITY_RISK", label: "Risiko keamanan" },
                ]}
                value={escalateType}
                onChange={(e) => setEscalateType(e.target.value as "SECURITY_RISK" | "FRAUD_RISK")}
              />
              <TextArea
                label="Alasan eskalasi"
                rows={3}
                value={escalateReason}
                onChange={(e) => setEscalateReason(e.target.value)}
                placeholder="Jelaskan alasan eskalasi…"
                maxLength={1000}
              />
              <div className="flex justify-end gap-2">
                <Button variant="secondary" fullWidth={false} onClick={() => setEscalateOpen(false)}>
                  Batal
                </Button>
                <Button
                  variant="primary"
                  fullWidth={false}
                  loading={escalating}
                  disabled={escalateReason.trim().length === 0}
                  onClick={actions.escalate}
                >
                  Eskalasi
                </Button>
              </div>
            </div>
          </Dialog>

          <Dialog open={closeOpen} onClose={() => setCloseOpen(false)} title="Tutup masukan">
            <div className="space-y-4">
              <Select
                label="Alasan penutupan"
                options={FEEDBACK_CLOSE_REASON_OPTIONS}
                value={closeReason}
                onChange={(e) => setCloseReason(e.target.value)}
              />
              <TextArea
                label="Catatan penutupan (opsional)"
                rows={2}
                value={closeNote}
                onChange={(e) => setCloseNote(e.target.value)}
                placeholder="Catatan internal penutupan…"
                maxLength={1000}
              />
              <div className="flex justify-end gap-2">
                <Button variant="secondary" fullWidth={false} onClick={() => setCloseOpen(false)}>
                  Batal
                </Button>
                <Button variant="primary" fullWidth={false} loading={closing} onClick={actions.close}>
                  Tutup masukan
                </Button>
              </div>
            </div>
          </Dialog>
        </>
      )}
    </RoleGate>
  )
}
