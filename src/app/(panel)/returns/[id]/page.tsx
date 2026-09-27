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
import { Spinner } from "@/components/ui/spinner"
import { useToast } from "@/components/ui/toast"
import { RoleGate } from "@/components/admin/role-gate"
import {
  getAdminReturnDetail,
  adminEscalateReturn,
  adminApproveReturnRefund,
  adminRejectReturn,
  adminExtendSellerDeadline,
  adminForceResolveReturn,
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
const APPROVABLE_STATUSES = ["APPROVED", "RECEIVED"]
const TERMINAL_STATUSES = ["RESOLVED_REFUND", "RESOLVED_EXCHANGE", "RESOLVED_REPAIR", "CANCELLED", "EXPIRED"]

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
  const id = decodeURIComponent(params.id)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [detail, setDetail] = useState<ReturnDetail | null>(null)
  const [actionKind, setActionKind] = useState<ReturnActionKind | null>(null)
  const [confirming, setConfirming] = useState(false)

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
        case "escalate":
          await adminEscalateReturn(id, input.note || undefined)
          break
        case "approve":
          await adminApproveReturnRefund(id, { refundAmountSen: input.refundAmountSen, note: input.note || undefined })
          break
        case "reject":
          await adminRejectReturn(id, { rejectReasonCode: input.rejectReasonCode ?? "LAINNYA", note: input.note || undefined })
          break
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

  const status = detail ? String(detail.status) : ""
  const canEarly = EARLY_STATUSES.includes(status)
  const canApprove = APPROVABLE_STATUSES.includes(status)
  const canForce = detail ? !TERMINAL_STATUSES.includes(status) : false
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
              <div className="mt-3 flex flex-wrap gap-2">
                {canEarly ? (
                  <>
                    <Button variant="secondary" fullWidth={false} loading={confirming} onClick={() => setActionKind("escalate")}>
                      Eskalasi ke sengketa
                    </Button>
                    <Button variant="secondary" fullWidth={false} loading={confirming} onClick={() => setActionKind("reject")}>
                      Tolak retur
                    </Button>
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
                {!canEarly && !canApprove && !canForce ? (
                  <p className="text-small text-text-secondary">Tidak ada aksi tersedia untuk status ini.</p>
                ) : null}
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
