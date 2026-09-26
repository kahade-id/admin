"use client"

/**
 * Admin — Detail sengketa: info, riwayat pesan, dan aksi putusan.
 *
 * Alur aksi (sesuai mobile):
 * - "Mulai review" → markDisputeUnderReview (tersedia bila belum
 *   UNDER_REVIEW/RESOLVED).
 * - "Assign" → Dialog input ID admin → assignDispute.
 * - "Resolve" → Dialog: keputusan FULL_BUYER/FULL_SELLER/SPLIT (Select) +
 *   catatan wajib min 100 karakter + winnerId opsional — hanya bila status
 *   UNDER_REVIEW/ESCALATED/ASSIGNED.
 * - Riwayat pesan + kirim pesan sebagai admin.
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
  type DisputeMessage,
} from "@/lib/api/admin/disputes"
import { userMessage } from "@/lib/api/response"
import { formatDateTimeWIB } from "@/lib/format"

import { DISPUTE_STATUS_LABEL, DISPUTE_STATUS_TONE } from "../maps"

type Resolution = "FULL_BUYER" | "FULL_SELLER" | "SPLIT"

const RESOLUTION_OPTIONS = [
  { value: "FULL_BUYER", label: "Menangkan pembeli" },
  { value: "FULL_SELLER", label: "Menangkan penjual" },
  { value: "SPLIT", label: "Bagi dua (split)" },
]

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
  const [resolveOpen, setResolveOpen] = useState(false)
  const [resolution, setResolution] = useState<Resolution>("FULL_BUYER")
  const [notes, setNotes] = useState("")
  const [winnerId, setWinnerId] = useState("")
  const [acting, setActing] = useState<string | null>(null)

  const load = useCallback(
    async (mode: "initial" | "refresh" = "initial") => {
      if (mode === "initial") setLoading(true)
      else setRefreshing(true)
      setError(null)
      try {
        setDispute(await getDisputeDetail(disputeId))
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
      setMessages(Array.isArray(list) ? list : [])
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

  const handleResolve = async () => {
    if (notes.trim().length < 100 || acting) return
    setActing("resolve")
    try {
      await resolveDispute(disputeId, {
        resolution,
        notes: notes.trim(),
        winnerId: winnerId.trim() || undefined,
      })
      setResolveOpen(false)
      setNotes("")
      setWinnerId("")
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
  const canResolve =
    status === "UNDER_REVIEW" || status === "ESCALATED" || status === "ASSIGNED"

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
                <KeyValue
                  label="Ditugaskan ke"
                  value={dispute.assignedAdminId ? String(dispute.assignedAdminId) : "—"}
                />
                <KeyValue label="Dibuat" value={formatDateTimeWIB(dispute.createdAt)} />
                {dispute.updatedAt ? (
                  <KeyValue label="Diperbarui" value={formatDateTimeWIB(dispute.updatedAt)} />
                ) : null}
              </dl>
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
                <Button variant="secondary" fullWidth={false} onClick={() => setAssignOpen(true)}>
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
                  Resolve tersedia setelah sengketa ditugaskan dan ditandai under review.
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
                  {messages.map((m) => (
                    <li key={m.id} className="rounded-sm bg-surface px-4 py-3">
                      <p className="text-caption text-text-secondary">
                        {m.senderId} · {formatDateTimeWIB(m.createdAt)}
                      </p>
                      <p className="mt-1 text-body text-text-primary">{m.message}</p>
                    </li>
                  ))}
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
        description="Masukkan ID admin yang akan menangani sengketa ini."
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
          label="ID Admin"
          value={adminId}
          onChange={(e) => setAdminId(e.target.value)}
          placeholder="cth: adm_123"
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
              disabled={notes.trim().length < 100}
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
          <Input
            label="ID pemenang (opsional)"
            value={winnerId}
            onChange={(e) => setWinnerId(e.target.value)}
            placeholder="cth: usr_123"
          />
        </div>
      </Dialog>
    </RoleGate>
  )
}
