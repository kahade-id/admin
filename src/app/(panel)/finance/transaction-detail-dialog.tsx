/**
 * Admin — Keuangan: dialog detail transaksi + timeline.
 *
 * E3 (G326–G350):
 * - Detail diperkaya: pemilik wallet, order, referensi eksternal provider
 *   (providerOrderId, flashTransactionId, irisPayoutId/ref), status
 *   provider, webhook terkait, dan reversal. Metadata & payload webhook
 *   sudah di-mask dari secret oleh backend.
 * - Timeline kronologis: event LEDGER (mutasi wallet), PROVIDER (status
 *   payment transaction), WEBHOOK (webhook diterima), REVERSAL
 *   (kompensasi) — diurutkan menaik oleh backend.
 */
"use client"

import { useEffect, useState } from "react"

import { Badge, type BadgeTone } from "@/components/ui/badge"
import { Card, CardBody } from "@/components/ui/card"
import { Dialog } from "@/components/ui/dialog"
import { Spinner } from "@/components/ui/spinner"
import { useToast } from "@/components/ui/toast"

import {
  getTransactionDetail,
  getTransactionTimeline,
  type AdminTransactionDetail,
  type TimelineEvent,
  type TimelineEventKind,
} from "@/lib/api/admin/finance"
import { userMessage } from "@/lib/api/response"
import { formatDateTimeWIB, formatNumber } from "@/lib/format"
// SEC-505: identitas + nomor VA di-mask (mask-only, tanpa unmask).
import { maskAccountNumber, maskEmail, maskName } from "@/lib/pii"

const KIND_META: Record<TimelineEventKind, { label: string; tone: BadgeTone }> = {
  LEDGER: { label: "Ledger", tone: "neutral" },
  PROVIDER: { label: "Provider", tone: "info" },
  WEBHOOK: { label: "Webhook", tone: "warning" },
  REVERSAL: { label: "Reversal", tone: "danger" },
}

function formatRupiah(n: unknown): string {
  if (typeof n !== "number" || !Number.isFinite(n)) return "—"
  return `Rp${formatNumber(n)}`
}

/** Label Indonesia untuk status transaksi — jangan tampilkan enum mentah (DSC-015). */
const TX_STATUS_LABEL: Record<string, string> = {
  PENDING: "Menunggu",
  PROCESSING: "Diproses",
  SUCCESS: "Berhasil",
  FAILED: "Gagal",
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-caption text-text-secondary">{label}</p>
      <div className="mt-0.5 text-body font-medium text-text-primary">{children}</div>
    </div>
  )
}

export function TransactionDetailDialog({
  txId,
  onClose,
}: {
  txId: string | null
  onClose: () => void
}) {
  const { show } = useToast()
  const [detail, setDetail] = useState<AdminTransactionDetail | null>(null)
  const [timeline, setTimeline] = useState<TimelineEvent[]>([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!txId) return
    let cancelled = false
    setLoading(true)
    setDetail(null)
    setTimeline([])
    Promise.all([getTransactionDetail(txId), getTransactionTimeline(txId)])
      .then(([d, t]) => {
        if (cancelled) return
        setDetail(d)
        setTimeline(t.events ?? [])
      })
      .catch((err: unknown) => {
        if (!cancelled) show({ title: "Gagal memuat detail transaksi.", description: userMessage(err), tone: "danger" })
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [txId, show])

  const ext = detail?.externalRefs
  const provider = detail?.providerStatus

  return (
    <Dialog
      open={txId !== null}
      onClose={onClose}
      title={txId ? `Detail transaksi ${txId}` : "Detail transaksi"}
      description="Data sensitif (payload webhook, metadata) ditampilkan dalam keadaan ter-mask."
      className="max-w-3xl"
    >
      {loading ? (
        <div className="flex items-center gap-2 py-8 text-body text-text-secondary">
          <Spinner size="sm" /> Memuat detail & timeline…
        </div>
      ) : detail ? (
        <div className="space-y-6">
          <div className="grid grid-cols-2 gap-4 md:grid-cols-3">
            <Field label="Nominal">{formatRupiah(detail.amount)}</Field>
            <Field label="Tipe">{String(detail.type)}</Field>
            <Field label="Status">
              <Badge tone={String(detail.status) === "SUCCESS" ? "success" : String(detail.status) === "FAILED" ? "danger" : "warning"}>
                {TX_STATUS_LABEL[String(detail.status)] ?? String(detail.status)}
              </Badge>
            </Field>
            <Field label="Pemilik wallet">
              {/* SEC-505: identitas di-mask. */}
              {detail.owner?.fullName
                ? maskName(detail.owner.fullName)
                : detail.owner?.email
                  ? maskEmail(detail.owner.email)
                  : detail.owner?.userId ?? "—"}
            </Field>
            <Field label="Order">{detail.order?.orderId ?? "—"}</Field>
            <Field label="Waktu">{formatDateTimeWIB(detail.createdAt)}</Field>
          </div>

          <div>
            <h4 className="mb-2 text-body font-semibold text-text-primary">Referensi eksternal</h4>
            <div className="grid grid-cols-2 gap-4 md:grid-cols-3">
              {/* BAI-053: provider lama (Midtrans/Flash/Iris) hanya referensi historis — era DANA. */}
              <Field label="Midtrans order ID (legacy)">{ext?.midtransOrderId ?? "—"}</Field>
              <Field label="Flash transaction ID (legacy)">{ext?.flashTransactionId ?? "—"}</Field>
              <Field label="Iris payout ID (legacy)">{ext?.irisPayoutId ?? "—"}</Field>
              <Field label="Iris ref (legacy)">{ext?.irisRef ?? "—"}</Field>
              {/* SEC-505: nomor VA di-mask. */}
              <Field label="VA (legacy)">{ext?.vaBank && ext?.vaNumber ? `${ext.vaBank} ${maskAccountNumber(ext.vaNumber)}` : "—"}</Field>
            </div>
          </div>

          {provider ? (
            <div>
              <h4 className="mb-2 text-body font-semibold text-text-primary">Status provider</h4>
              <div className="grid grid-cols-2 gap-4 md:grid-cols-3">
                <Field label="Provider">{provider.provider ?? "—"}</Field>
                <Field label="Status">{provider.status ?? "—"}</Field>
                <Field label="Fraud">{provider.fraudStatus ?? "—"}</Field>
                <Field label="Dibayar">{provider.paidAt ? formatDateTimeWIB(provider.paidAt) : "—"}</Field>
                <Field label="Settled">{provider.settledAt ? formatDateTimeWIB(provider.settledAt) : "—"}</Field>
                <Field label="Webhook diterima">{provider.webhookReceivedAt ? formatDateTimeWIB(provider.webhookReceivedAt) : "—"}</Field>
              </div>
            </div>
          ) : null}

          <div>
            <h4 className="mb-2 text-body font-semibold text-text-primary">
              Timeline ({timeline.length})
            </h4>
            {timeline.length === 0 ? (
              <p className="text-body text-text-secondary">Tidak ada event timeline.</p>
            ) : (
              <ol className="space-y-3">
                {timeline.map((ev, i) => {
                  const meta = KIND_META[ev.kind] ?? { label: ev.kind, tone: "neutral" as BadgeTone }
                  return (
                    <li key={`${ev.at}-${i}`} className="flex gap-3">
                      <div className="flex flex-col items-center">
                        <span className="mt-1.5 h-2.5 w-2.5 rounded-full bg-border-strong" aria-hidden />
                        {i < timeline.length - 1 ? <span className="w-px flex-1 bg-border" aria-hidden /> : null}
                      </div>
                      <div className="pb-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge tone={meta.tone}>{meta.label}</Badge>
                          <span className="text-caption text-text-secondary">
                            {formatDateTimeWIB(ev.at)}
                          </span>
                        </div>
                        <p className="mt-1 text-body font-medium text-text-primary">{ev.label}</p>
                        {ev.detail ? (
                          <p className="text-caption text-text-secondary">{ev.detail}</p>
                        ) : null}
                      </div>
                    </li>
                  )
                })}
              </ol>
            )}
          </div>

          {(detail.webhooks?.length ?? 0) > 0 ? (
            <div>
              <h4 className="mb-2 text-body font-semibold text-text-primary">
                Webhook terkait ({detail.webhooks?.length})
              </h4>
              <Card>
                <CardBody>
                  <ul className="space-y-2">
                    {detail.webhooks?.map((w) => (
                      <li key={w.id} className="flex flex-wrap items-center gap-2 text-body">
                        <Badge tone="warning">{w.source}</Badge>
                        <span className="font-medium">{w.event}</span>
                        <span className="text-caption text-text-secondary">
                          {formatDateTimeWIB(w.receivedAt)}
                        </span>
                      </li>
                    ))}
                  </ul>
                </CardBody>
              </Card>
            </div>
          ) : null}

          {detail.reversalTx || (detail.reversals?.length ?? 0) > 0 ? (
            <div>
              <h4 className="mb-2 text-body font-semibold text-text-primary">Reversal</h4>
              <p className="text-body text-text-secondary">
                {detail.reversalTx
                  ? `Dibalik oleh ${detail.reversalTx.txId} (${String(detail.reversalTx.status)})`
                  : `${detail.reversals?.length} transaksi reversal terkait.`}
              </p>
            </div>
          ) : null}
        </div>
      ) : (
        <p className="py-8 text-center text-body text-text-secondary">Tidak ada data.</p>
      )}
    </Dialog>
  )
}
