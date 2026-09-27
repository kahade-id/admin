"use client"

/**
 * Admin — Detail retur (GAP-D G215).
 * Ringkasan + aksi yang sama dengan halaman antrean.
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
  adminExtendSellerDeadline,
  adminForceCloseReturn,
  ADMIN_RETURN_STATUS_LABEL,
  type AdminReturnItem,
  type AdminReturnStatus,
} from "@/lib/api/admin/returns"
import { userMessage } from "@/lib/api/response"
import { formatDateTimeWIB, formatIdrSen } from "@/lib/format"

export default function ReturnDetailPage({ params }: { params: { id: string } }) {
  const toast = useToast()
  const id = decodeURIComponent(params.id)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [detail, setDetail] = useState<AdminReturnItem | null>(null)
  const [acting, setActing] = useState(false)

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

  async function run(label: string, fn: () => Promise<unknown>, confirm?: string) {
    if (confirm && !window.confirm(confirm)) return
    setActing(true)
    try {
      await fn()
      toast.show({ title: `Berhasil: ${label}`, tone: "success" })
      await load()
    } catch (e) {
      toast.show({ title: `Gagal: ${label}`, description: userMessage(e), tone: "danger" })
    } finally {
      setActing(false)
    }
  }

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
                <Badge>{ADMIN_RETURN_STATUS_LABEL[detail.status as AdminReturnStatus] ?? String(detail.status)}</Badge>
              </div>
              <dl className="mt-3 grid gap-2 text-body">
                <div><dt className="text-small text-text-secondary">Order</dt><dd>{String(detail.orderId ?? "—")}</dd></div>
                <div><dt className="text-small text-text-secondary">Alasan</dt><dd>{String(detail.reasonCode ?? "—")}{detail.reasonDetail ? ` — ${String(detail.reasonDetail)}` : ""}</dd></div>
                <div><dt className="text-small text-text-secondary">Resolusi</dt><dd>{String(detail.resolutionType ?? "—")}</dd></div>
                <div><dt className="text-small text-text-secondary">Refund</dt><dd>{detail.refundAmount != null ? formatIdrSen(detail.refundAmount as string | number) : "—"}</dd></div>
                <div><dt className="text-small text-text-secondary">Diajukan</dt><dd>{formatDateTimeWIB(String(detail.createdAt))}</dd></div>
                {detail.sellerRespondBy ? <div><dt className="text-small text-text-secondary">Deadline penjual</dt><dd>{formatDateTimeWIB(String(detail.sellerRespondBy))}</dd></div> : null}
              </dl>
            </Card>
            <Card>
              <h3 className="text-h4 font-bold">Aksi admin</h3>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button variant="secondary" fullWidth={false} loading={acting}
                  onClick={() => run("eskalasi", () => adminEscalateReturn(id), "Eskalasi ke sengketa? Sengketa yang sudah ada akan dipakai ulang.")}>
                  Eskalasi ke sengketa
                </Button>
                <Button variant="secondary" fullWidth={false} loading={acting}
                  onClick={() => run("setujui refund", () => adminApproveReturnRefund(id), "Setujui refund? Refund dieksekusi sekali (idempoten).")}>
                  Setujui refund
                </Button>
                <Button variant="secondary" fullWidth={false} loading={acting}
                  onClick={() => run("perpanjang deadline", () => adminExtendSellerDeadline(id, 24))}>
                  Perpanjang deadline +24 jam
                </Button>
                <Button variant="secondary" fullWidth={false} loading={acting}
                  onClick={() => {
                    const note = window.prompt("Catatan penutupan paksa (wajib):", "")
                    if (!note) return
                    void run("tutup paksa", () => adminForceCloseReturn(id, { resolution: "ADMIN_CLOSED", note }))
                  }}>
                  Tutup paksa
                </Button>
              </div>
            </Card>
          </div>
        )}
      </div>
    </RoleGate>
  )
}
