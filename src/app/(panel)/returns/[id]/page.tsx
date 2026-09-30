"use client"

/**
 * Admin — Detail retur.
 *
 * ADM-112: tombol aksi digate berdasarkan status backend (sama dengan antrean).
 * ADM-113: konfirmasi aksi via dialog (nominal + catatan tervalidasi).
 * ADM-114: jumlah perpanjangan deadline dibaca dari timeline (cap 3x).
 */

import { useCallback, useEffect, useState } from "react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { EmptyState } from "@/components/ui/empty-state"
import { Input } from "@/components/ui/input"
import { Spinner } from "@/components/ui/spinner"
import { useToast } from "@/components/ui/toast"
import { RoleGate } from "@/components/admin/role-gate"
import { useAuth } from "@/lib/auth-context"
import {
  getAdminReturnDetail,
  adminEscalateReturn,
  adminApproveReturnRefund,
  adminRejectReturn,
  adminExtendSellerDeadline,
  adminForceResolveReturn,
  adminConvertReturnToDispute,
  adminAddReturnNote,
  ADMIN_RETURN_STATUS_LABEL,
  type AdminReturnItem,
  type AdminReturnStatus,
} from "@/lib/api/admin/returns"
import { ReturnActionDialog, type ReturnActionKind, type ReturnActionConfirmInput } from "../action-dialog"
import { userMessage } from "@/lib/api/response"
import { formatDateTimeWIB, formatIdrSen } from "@/lib/format"

type TimelineEntry = {
  id?: string
  event?: string
  createdAt?: string
  metadata?: Record<string, unknown> | null
  [key: string]: unknown
}

type ReturnDetail = AdminReturnItem & {
  timeline?: TimelineEntry[]
}

const EARLY_STATUSES = ["REQUESTED", "SELLER_REVIEW"]
// BAI-081: backend hanya mengizinkan APPROVE dari REQUESTED/SELLER_REVIEW
// (sellerRespondAsAdmin guard) — sebelumnya UI menampilkan tombol "Setujui
// refund" di APPROVED/RECEIVED yang selalu 400.
const APPROVABLE_STATUSES = ["REQUESTED", "SELLER_REVIEW"]
const TERMINAL_STATUSES = ["RESOLVED_REFUND", "RESOLVED_EXCHANGE", "RESOLVED_REPAIR", "CANCELLED", "EXPIRED"]
// BAI-082: backend resolveReturn hanya menerima APPROVED/RECEIVED — tombol
// "Tutup paksa" hanya relevan di dua status itu (sebelumnya muncul di semua
// status non-terminal, termasuk REQUESTED yang selalu 400).
const FORCEABLE_STATUSES = ["APPROVED", "RECEIVED"]

function senOf(v: unknown): number | null {
  if (v == null) return null
  const n = typeof v === "string" ? Number(v) : typeof v === "number" ? v : NaN
  return Number.isFinite(n) ? Math.round(n) : null
}

/** ADM-114: hitung perpanjangan deadline dari timeline (backend cap 3x). */
function countDeadlineExtensions(timeline?: TimelineEntry[]): number {
  if (!Array.isArray(timeline)) return 0
  return timeline.filter((t) => String(t.event) === "DEADLINE_EXTENDED").length
}

export default function ReturnDetailPage({ params }: { params: { id: string } }) {
  const toast = useToast()
  const { role } = useAuth()
  const id = params.id
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [detail, setDetail] = useState<ReturnDetail | null>(null)
  const [actionKind, setActionKind] = useState<ReturnActionKind | null>(null)
  const [confirming, setConfirming] = useState(false)
  // BAI-086: true bila eskalasi terakhir tidak menemukan sengketa aktif —
  // tampilkan peringatan + tombol "Buat sengketa dari retur".
  const [needsConversion, setNeedsConversion] = useState(false)
  const [converting, setConverting] = useState(false)
  // BAI-093: komposer catatan admin.
  const [noteText, setNoteText] = useState("")
  const [sendingNote, setSendingNote] = useState(false)
  // BAI-098: status kirim notifikasi dari aksi terakhir.
  const [lastNotifStatus, setLastNotifStatus] = useState<boolean | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      setDetail(await getAdminReturnDetail(id))
    } catch (e) {
      setError(userMessage(e))
    } finally {
      setLoading(false)
    }
  }, [id])

  useEffect(() => {
    void load()
  }, [load])

  const confirmAction = async (input: ReturnActionConfirmInput) => {
    if (!actionKind) return
    setConfirming(true)
    try {
      switch (actionKind) {
        case "escalate": {
          // BAI-086/098: tangkap needsManualConversion + notificationDelivered
          // dari respons eskalasi.
          const res = await adminEscalateReturn(id, input.note || undefined)
          setNeedsConversion(res.needsManualConversion === true)
          setLastNotifStatus(typeof res.notificationDelivered === "boolean" ? res.notificationDelivered : null)
          break
        }
        case "approve": {
          const res = await adminApproveReturnRefund(id, { refundAmountSen: input.refundAmountSen, note: input.note || undefined })
          setLastNotifStatus(typeof (res as { notificationDelivered?: boolean }).notificationDelivered === "boolean" ? (res as { notificationDelivered?: boolean }).notificationDelivered! : null)
          break
        }
        case "reject": {
          const res = await adminRejectReturn(id, { rejectReasonCode: input.rejectReasonCode ?? "LAINNYA", note: input.note || undefined })
          setLastNotifStatus(typeof (res as { notificationDelivered?: boolean }).notificationDelivered === "boolean" ? (res as { notificationDelivered?: boolean }).notificationDelivered! : null)
          break
        }
        case "force-resolve":
          await adminForceResolveReturn(id, input.resolution ?? "REFUND", input.note)
          break
        case "extend":
          await adminExtendSellerDeadline(id)
          break
      }
      toast.show({ title: "Berhasil", tone: "success" })
      setActionKind(null)
      await load()
    } catch (e) {
      toast.show({ title: "Gagal", description: userMessage(e), tone: "danger" })
    } finally {
      setConfirming(false)
    }
  }

  // BAI-086: konversi manual retur ESCALATED → sengketa baru.
  const handleConvert = async () => {
    setConverting(true)
    try {
      const res = await adminConvertReturnToDispute(id)
      setNeedsConversion(false)
      setLastNotifStatus(typeof res.notificationDelivered === "boolean" ? res.notificationDelivered : null)
      toast.show({ title: res.created ? `Sengketa ${res.disputeId} dibuat` : `Ditautkan ke sengketa ${res.disputeId}`, tone: "success" })
      await load()
    } catch (e) {
      toast.show({ title: "Gagal membuat sengketa", description: userMessage(e), tone: "danger" })
    } finally {
      setConverting(false)
    }
  }

  // BAI-093: catatan admin pada retur.
  const handleSendNote = async () => {
    const message = noteText.trim()
    if (!message) return
    setSendingNote(true)
    try {
      await adminAddReturnNote(id, message)
      setNoteText("")
      toast.show({ title: "Catatan ditambahkan", tone: "success" })
      await load()
    } catch (e) {
      toast.show({ title: "Gagal menambah catatan", description: userMessage(e), tone: "danger" })
    } finally {
      setSendingNote(false)
    }
  }

  const status = detail ? String(detail.status) : ""
  // BAI-083: REJECT/ESCALATE boleh untuk CUSTOMER_SUPPORT; aksi uang
  // (APPROVE, FORCE_RESOLVE, EXTEND_DEADLINE) hanya SUPER_ADMIN/DISPUTE_ADMIN
  // (backend juga menegakkan di adminAct — ini gating UI).
  const canMoneyAction = role === "SUPER_ADMIN" || role === "DISPUTE_ADMIN"
  const canEarly = EARLY_STATUSES.includes(status)
  const canApprove = canMoneyAction && APPROVABLE_STATUSES.includes(status)
  const canForce = canMoneyAction && detail ? FORCEABLE_STATUSES.includes(status) : false
  const extensionsUsed = countDeadlineExtensions(detail?.timeline)

  return (
    <RoleGate href="/returns">
      <h1 className="text-h2 font-bold text-text-primary">Detail Retur</h1>
      <p className="mt-1 text-body text-text-secondary">ID: {id}</p>
      <div className="mt-4">
        {loading ? (
          <div className="flex min-h-[40vh] items-center justify-center gap-2">
            <Spinner size="md" /><p className="text-body text-text-secondary">Memuat…</p>
          </div>
        ) : error || !detail ? (
          <Card><EmptyState title="Gagal memuat retur" description={error ?? "Tidak ditemukan"} action={<Button variant="secondary" fullWidth={false} onClick={() => load()}>Coba lagi</Button>} /></Card>
        ) : (
          <div className="grid gap-4">
            <Card>
              <div className="flex items-center justify-between">
                <h2 className="text-h3 font-bold">{String(detail.returnId ?? detail.id)}</h2>
                <Badge>{ADMIN_RETURN_STATUS_LABEL[detail.status as AdminReturnStatus] ?? status}</Badge>
              </div>
              <dl className="mt-3 grid gap-2 text-body">
                <div><dt className="text-small text-text-secondary">Order</dt><dd>{String(detail.orderId ?? "—")}</dd></div>
                <div><dt className="text-small text-text-secondary">Alasan</dt><dd>{String(detail.reasonCode ?? "—")}{detail.reasonDetail ? ` — ${String(detail.reasonDetail)}` : ""}</dd></div>
                <div><dt className="text-small text-text-secondary">Resolusi</dt><dd>{String(detail.resolutionType ?? "—")}</dd></div>
                <div>
                  <dt className="text-small text-text-secondary">Refund</dt>
                  <dd>
                    {detail.refundAmount != null ? formatIdrSen(detail.refundAmount as string | number) : "—"}
                    {detail.order?.buyerPayAmount != null ? (
                      <span className="text-small text-text-secondary"> (dibayar pembeli: {formatIdrSen(detail.order.buyerPayAmount as string | number)})</span>
                    ) : null}
                  </dd>
                </div>
                {/* BAI-049: hasil refund DANA (admin only) — diekspos backend dari refundDana map/lookup. */}
                {detail.refundDana ? (
                  <div>
                    <dt className="text-small text-text-secondary">Refund DANA</dt>
                    <dd>
                      <Badge tone={detail.refundDana.status === "REFUNDED" ? "success" : detail.refundDana.status === "REFUND_FAILED" ? "danger" : "neutral"}>
                        {detail.refundDana.status}
                      </Badge>
                      {detail.refundDana.danaReferenceNo ? (
                        <span className="ml-2 font-mono text-small text-text-secondary">{detail.refundDana.danaReferenceNo}</span>
                      ) : null}
                      {detail.refundDana.partnerRefundNo ? (
                        <span className="ml-2 font-mono text-small text-text-secondary">({detail.refundDana.partnerRefundNo})</span>
                      ) : null}
                      {detail.refundDana.amountSen != null ? (
                        <span className="ml-2 text-small text-text-secondary">{formatIdrSen(detail.refundDana.amountSen as string | number)}</span>
                      ) : null}
                      {detail.refundDana.updatedAt ? (
                        <span className="ml-2 text-small text-text-secondary">· {formatDateTimeWIB(String(detail.refundDana.updatedAt))}</span>
                      ) : null}
                    </dd>
                  </div>
                ) : null}
                <div><dt className="text-small text-text-secondary">Diajukan</dt><dd>{formatDateTimeWIB(String(detail.createdAt))}</dd></div>
                {detail.sellerRespondBy ? (
                  <div>
                    <dt className="text-small text-text-secondary">Deadline penjual</dt>
                    <dd>
                      {formatDateTimeWIB(String(detail.sellerRespondBy))}
                      {extensionsUsed > 0 ? <span className="text-small text-text-secondary"> · sudah diperpanjang {extensionsUsed}x dari maks 3x</span> : null}
                    </dd>
                  </div>
                ) : null}
              </dl>
            </Card>
            <Card>
              <h3 className="text-h4 font-bold">Aksi admin</h3>
              {/* BAI-086: peringatan konversi manual pasca-eskalasi. */}
              {needsConversion ? (
                <div className="mt-3 rounded-lg border border-amber-300 bg-amber-50 p-3">
                  <p className="text-body font-medium text-amber-800">
                    Eskalasi tidak menemukan sengketa aktif — retur ini belum punya pemilik.
                  </p>
                  <p className="mt-1 text-small text-amber-700">
                    Buat sengketa baru dari retur ini agar ada mediator yang menangani.
                  </p>
                  <Button
                    variant="primary"
                    fullWidth={false}
                    loading={converting}
                    onClick={() => void handleConvert()}
                    className="mt-2"
                  >
                    Buat sengketa dari retur
                  </Button>
                </div>
              ) : null}
              {/* BAI-098: status kirim notifikasi aksi terakhir. */}
              {lastNotifStatus !== null ? (
                <p className={`mt-2 text-small ${lastNotifStatus ? "text-green-700" : "text-red-700"}`}>
                  {lastNotifStatus
                    ? "Notifikasi ke pembeli & penjual terkirim."
                    : "Notifikasi ke pembeli/penjual GAGAL — kegagalan tercatat di timeline."}
                </p>
              ) : null}
              <div className="mt-3 flex flex-wrap gap-2">
                {canEarly ? (
                  <>
                    <Button variant="secondary" fullWidth={false} loading={confirming} onClick={() => setActionKind("escalate")}>
                      Eskalasi ke sengketa
                    </Button>
                    <Button variant="secondary" fullWidth={false} loading={confirming} onClick={() => setActionKind("reject")}>
                      Tolak retur
                    </Button>
                    {/* BAI-083: perpanjangan deadline = aksi uang → hanya SUPER_ADMIN/DISPUTE_ADMIN. */}
                    {canMoneyAction ? (
                      <Button
                        variant="secondary"
                        fullWidth={false}
                        loading={confirming}
                        disabled={extensionsUsed >= 3}
                        title={extensionsUsed >= 3 ? "Batas perpanjangan (3x) tercapai" : undefined}
                        onClick={() => setActionKind("extend")}
                      >
                        Perpanjang deadline +24 jam
                      </Button>
                    ) : null}
                  </>
                ) : null}
                {canApprove ? (
                  <Button variant="secondary" fullWidth={false} loading={confirming} onClick={() => setActionKind("approve")}>
                    Setujui refund
                  </Button>
                ) : null}
                {canForce ? (
                  <Button variant="secondary" fullWidth={false} loading={confirming} onClick={() => setActionKind("force-resolve")}>
                    Tutup paksa
                  </Button>
                ) : null}
                {!canEarly && !canApprove && !canForce && !needsConversion ? (
                  <p className="text-small text-text-secondary">Tidak ada aksi tersedia untuk status ini.</p>
                ) : null}
              </div>
            </Card>
            {/* BAI-093: komposer catatan admin (terlihat dua pihak). */}
            <Card>
              <h3 className="text-h4 font-bold">Catatan admin</h3>
              <div className="mt-3 flex gap-2">
                <Input
                  value={noteText}
                  onChange={(e) => setNoteText(e.target.value)}
                  placeholder="Tulis catatan untuk pembeli & penjual…"
                  disabled={sendingNote}
                />
                <Button variant="secondary" fullWidth={false} loading={sendingNote} disabled={!noteText.trim()} onClick={() => void handleSendNote()}>
                  Kirim
                </Button>
              </div>
            </Card>
          </div>
        )}
      </div>

      <ReturnActionDialog
        open={actionKind !== null}
        kind={actionKind}
        returnLabel={detail ? String(detail.returnId ?? detail.id) : id}
        currentDeadline={detail?.sellerRespondBy ? formatDateTimeWIB(String(detail.sellerRespondBy)) : null}
        currentRefundSen={senOf(detail?.refundAmount)}
        buyerPaySen={senOf(detail?.order?.buyerPayAmount)}
        extensionsUsed={extensionsUsed}
        confirming={confirming}
        onClose={() => { if (!confirming) setActionKind(null) }}
        onConfirm={(input) => void confirmAction(input)}
      />
    </RoleGate>
  )
}
