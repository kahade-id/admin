"use client"

/**
 * Admin — Detail tiket bantuan: pesan awal + riwayat balasan, form balas,
 * dan ubah status via Select. Tiket dibuat admin dari eskalasi livechat
 * (kolom "Pengguna" = pengguna yang terkait tiket, bukan pembuat tiket).
 *
 * Port dari frontend/app/admin/(panel)/tickets/[id].tsx → web desktop.
 */

import { useCallback, useEffect, useState, type ReactNode } from "react"
import { useParams } from "next/navigation"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardBody, CardHeader } from "@/components/ui/card"
import { EmptyState } from "@/components/ui/empty-state"
import { Spinner } from "@/components/ui/spinner"
import { useToast } from "@/components/ui/toast"
import { RoleGate } from "@/components/admin/role-gate"
import { Select } from "@/components/admin/select"
import {
  getTicketDetail,
  replyToTicket,
  updateTicketStatus,
  type SupportTicket,
  type TicketStatus,
} from "@/lib/api/admin/support"
import { userMessage } from "@/lib/api/response"
import { formatDateTimeWIB } from "@/lib/format"
// ADM-405: email pengguna di-mask secara default (mask-only, tanpa unmask).
import { maskEmail } from "@/lib/pii"
import { MaskedPii } from "@/components/admin/batch139/masked-pii"
import { SplitComposer } from "@/components/admin/batch139/composer-split"
import { DraftStatus, useDraftNote } from "@/components/admin/batch139/draft-notes"
import { useInternalNotes } from "@/components/admin/batch139/use-internal-notes"
import { RevisionBanner, useRevisionGuard } from "@/components/admin/batch139/revision-guard"
import { useAuth } from "@/lib/auth-context"

import { TICKET_STATUS_LABEL, TICKET_STATUS_TONE } from "../maps"

const STATUS_OPTIONS = [
  { value: "OPEN", label: "Terbuka" },
  { value: "IN_PROGRESS", label: "Ditangani" },
  { value: "RESOLVED", label: "Selesai" },
  { value: "CLOSED", label: "Ditutup" },
]

/**
 * Template balasan cepat — konsisten dengan template pesan mediasi sengketa.
 * String statis yang aman; admin bisa mengedit sebelum mengirim.
 */
const REPLY_TEMPLATES = [
  {
    label: "Salam pembuka",
    text: "Halo, terima kasih sudah menghubungi tim Kahade. Tiket Anda sedang kami tangani dan akan segera kami tindak lanjuti.",
  },
  {
    label: "Minta info tambahan",
    text: "Agar bisa kami bantu lebih cepat, mohon info tambahan terkait kendala Anda (mis. ID order/transaksi dan kronologi singkat).",
  },
  {
    label: "Eskalasi",
    text: "Laporan Anda sudah kami teruskan ke tim terkait. Kami akan mengabari perkembangannya melalui tiket ini. Terima kasih atas kesabarannya.",
  },
]

/** Batas karakter draf balasan — selaras maxLength TextArea. */
const REPLY_MAX_LENGTH = 2000

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

export default function TicketDetailPage() {
  const { id } = useParams<{ id: string }>()
  const ticketId = Array.isArray(id) ? id[0] : (id ?? "")
  const toast = useToast()

  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [ticket, setTicket] = useState<SupportTicket | null>(null)
  const { profile } = useAuth()
  const adminId = profile?.adminId ?? "anon"

  // H11: draf autosave — balasan (eksternal) dan catatan internal terpisah.
  const replyDraft = useDraftNote(`ticket:${ticketId}:reply`)
  const internalDraft = useDraftNote(`ticket:${ticketId}:internal`)
  // H12: catatan internal — draf lokal per admin (backend belum punya API).
  const internalNotes = useInternalNotes(`ticket:${ticketId}`, adminId)
  const [sending, setSending] = useState(false)

  const [nextStatus, setNextStatus] = useState<TicketStatus>("IN_PROGRESS")
  const [updating, setUpdating] = useState(false)

  const load = useCallback(
    async (mode: "initial" | "refresh" = "initial") => {
      if (mode === "initial") setLoading(true)
      else setRefreshing(true)
      setError(null)
      try {
        const t = await getTicketDetail(ticketId)
        setTicket(t)
        setNextStatus(t.status)
      } catch (e) {
        setError(userMessage(e))
      } finally {
        setLoading(false)
        setRefreshing(false)
      }
    },
    [ticketId],
  )

  useEffect(() => {
    if (ticketId) void load("initial")
  }, [ticketId, load])

  const fail = (title: string, e: unknown) => {
    toast.show({ title, description: userMessage(e), tone: "danger" })
  }

  const handleReply = async (text?: string) => {
    const body = (text ?? replyDraft.value).trim()
    if (!body || sending) return
    setSending(true)
    try {
      await replyToTicket(ticketId, body)
      replyDraft.clear()
      await load("refresh")
      toast.show({ title: "Balasan terkirim", tone: "success" })
    } catch (e) {
      fail("Gagal mengirim balasan", e)
    } finally {
      setSending(false)
    }
  }

  const handleSaveInternalNote = (text: string) => {
    internalNotes.addNote(text, profile?.fullName?.trim() || "Admin")
    internalDraft.clear()
    toast.show({
      title: "Catatan internal disimpan",
      description: "Draf lokal perangkat ini — belum ada API catatan internal backend.",
      tone: "success",
    })
  }

  const handleStatusChange = async () => {
    if (updating) return
    setUpdating(true)
    try {
      await updateTicketStatus(ticketId, nextStatus)
      await load("refresh")
      toast.show({ title: "Status tiket diperbarui", tone: "success" })
    } catch (e) {
      fail("Gagal memperbarui status", e)
    } finally {
      setUpdating(false)
    }
  }

  const status = ticket ? String(ticket.status) : ""
  const statusChanged = ticket ? nextStatus !== ticket.status : false

  // H08: peringatan bila tiket berubah saat balasan diketik.
  const revGuard = useRevisionGuard({
    recordKey: `ticket:${ticketId}`,
    getRevision: () =>
      getTicketDetail(ticketId).then((t) => (t.updatedAt ?? t.createdAt ?? null) as string | null),
    dirty: replyDraft.hasDraft || internalDraft.hasDraft,
    enabled: !!ticket,
  })

  return (
    <RoleGate href="/tickets">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-h2 font-bold text-text-primary">
            {ticket?.subject ?? "Detail Tiket"}
          </h1>
          <p className="mt-1 text-body text-text-secondary">
            {ticket ? `ID: ${ticket.id}` : "Riwayat balasan dan penanganan tiket."}
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

      {/* H08: peringatan bila tiket berubah saat balasan diketik. */}
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
          <p className="text-body text-text-secondary">Memuat detail tiket…</p>
        </div>
      ) : error || !ticket ? (
        <Card>
          <EmptyState
            title="Gagal memuat detail tiket"
            description={error ?? "Data tidak ditemukan."}
            action={
              <Button variant="secondary" fullWidth={false} onClick={() => load("initial")}>
                Coba lagi
              </Button>
            }
          />
        </Card>
      ) : (
        <div className="grid gap-4 xl:grid-cols-2">
          <Card padded={false}>
            <CardHeader
              title="Tiket"
              action={
                <Badge tone={TICKET_STATUS_TONE[status] ?? "neutral"}>
                  {TICKET_STATUS_LABEL[status] ?? status}
                </Badge>
              }
            />
            <CardBody>
              <p className="text-h3 font-semibold text-text-primary">{ticket.subject}</p>
              {ticket.category ? (
                <p className="mt-1">
                  <Badge tone="neutral" variant="outline">
                    {ticket.category}
                  </Badge>
                </p>
              ) : null}
              <p className="mt-3 text-body text-text-primary">{ticket.message}</p>
              <dl className="mt-4">
                <KeyValue
                  label="Pengguna"
                  value={ticket.user?.fullName?.trim() || ticket.user?.email || ticket.userId}
                />
                {/* H13: email tetap ter-mask; reveal hanya bila canReveal eksplisit. */}
                {ticket.user?.email && ticket.user?.fullName?.trim() ? (
                  <KeyValue
                    label="Email"
                    value={
                      <MaskedPii
                        label="Email pengguna"
                        masked={maskEmail(ticket.user.email)}
                        full={ticket.user.email}
                        kind="email"
                        recordId={ticket.id}
                      />
                    }
                  />
                ) : null}
                <KeyValue label="Dibuat" value={formatDateTimeWIB(ticket.createdAt)} />
                {ticket.updatedAt ? (
                  <KeyValue label="Diperbarui" value={formatDateTimeWIB(ticket.updatedAt)} />
                ) : null}
              </dl>
            </CardBody>
          </Card>

          <Card padded={false}>
            <CardHeader title="Ubah status" />
            <CardBody>
              <div className="flex flex-wrap items-end gap-3">
                <Select
                  label="Status tiket"
                  options={STATUS_OPTIONS}
                  value={nextStatus}
                  onChange={(e) => setNextStatus(e.target.value as TicketStatus)}
                  className="min-w-52 flex-1"
                />
                <Button
                  variant="primary"
                  fullWidth={false}
                  loading={updating}
                  disabled={!statusChanged}
                  onClick={handleStatusChange}
                >
                  Simpan status
                </Button>
              </div>
              <p className="mt-2 text-caption text-text-secondary">
                Status saat ini: {TICKET_STATUS_LABEL[status] ?? status}.
              </p>
            </CardBody>
          </Card>

          <Card padded={false} className="xl:col-span-2">
            <CardHeader title="Riwayat balasan" />
            <CardBody>
              {(ticket.replies?.length ?? 0) === 0 ? (
                <p className="text-body text-text-secondary">Belum ada balasan.</p>
              ) : (
                <ul className="space-y-3">
                  {ticket.replies!.map((r) => (
                    <li key={r.id} className="rounded-sm bg-surface px-4 py-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <Badge tone={r.isAdminReply ? "accent" : "neutral"}>
                          {r.isAdminReply ? "Admin" : "Pengguna"}
                        </Badge>
                        <span className="text-caption text-text-secondary">
                          {formatDateTimeWIB(r.createdAt)}
                        </span>
                      </div>
                      <p className="mt-2 text-body text-text-primary">{r.message}</p>
                    </li>
                  ))}
                </ul>
              )}

              <div className="mt-4 space-y-3">
                {/* Template balasan cepat — konsisten dengan sengketa. */}
                <div className="flex flex-wrap gap-2">
                  {REPLY_TEMPLATES.map((t) => (
                    <Button
                      key={t.label}
                      variant="secondary"
                      size="sm"
                      fullWidth={false}
                      onClick={() => replyDraft.setValue(t.text)}
                      title="Sisipkan template ke kolom balasan (bisa diedit sebelum dikirim)"
                    >
                      {t.label}
                    </Button>
                  ))}
                </div>
                {/* H12: catatan internal (draf lokal per admin). */}
                {internalNotes.notes.length > 0 ? (
                  <ul className="flex flex-col gap-2">
                    {internalNotes.notes.map((n) => (
                      <li
                        key={n.id}
                        className="rounded-sm border border-warning/40 bg-warning/5 px-3 py-2"
                      >
                        <p className="text-caption text-text-secondary">
                          📝 {n.author} · {formatDateTimeWIB(n.at)} · internal (lokal)
                        </p>
                        <p className="mt-1 whitespace-pre-wrap text-body text-text-primary">
                          {n.text}
                        </p>
                      </li>
                    ))}
                  </ul>
                ) : null}
                {/* H12: composer terpisah — default catatan internal; balasan ke
                    pengguna wajib konfirmasi eksplisit. */}
                <SplitComposer
                  internalValue={internalDraft.value}
                  onInternalChange={internalDraft.setValue}
                  externalValue={replyDraft.value}
                  onExternalChange={replyDraft.setValue}
                  onSendInternal={(text) => handleSaveInternalNote(text)}
                  onSendExternal={(text) => void handleReply(text)}
                  sending={sending}
                  internalFooter={
                    <div className="mt-1">
                      <DraftStatus status={internalDraft.status} savedAt={internalDraft.savedAt} />
                    </div>
                  }
                />
                {/* H11: status autosave draf balasan. */}
                <DraftStatus status={replyDraft.status} savedAt={replyDraft.savedAt} />
              </div>
            </CardBody>
          </Card>
        </div>
      )}
    </RoleGate>
  )
}
