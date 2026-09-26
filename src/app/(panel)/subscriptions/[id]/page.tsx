/**
 * Admin — Detail subscription Kahade+: paket, periode, sisa kuota fee pada
 * periode berjalan, dan riwayat. Aksi pembatalan dengan alasan (status
 * ACTIVE/PENDING).
 *
 * GET /v1/admin/subscriptions/:id → detail + usage periode berjalan.
 */
"use client"

import Link from "next/link"
import { useCallback, useEffect, useState, type ReactNode } from "react"
import { useParams } from "next/navigation"

import { Badge, type BadgeTone } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardBody, CardHeader } from "@/components/ui/card"
import { Dialog } from "@/components/ui/dialog"
import { EmptyState } from "@/components/ui/empty-state"
import { TextArea } from "@/components/ui/input"
import { Spinner } from "@/components/ui/spinner"
import { useToast } from "@/components/ui/toast"
import { RoleGate } from "@/components/admin/role-gate"
import {
  cancelSubscription,
  getSubscriptionDetail,
  type SubscriptionDetail,
} from "@/lib/api/admin/subscriptions"
import { userMessage } from "@/lib/api/response"
import { formatDateTimeWIB } from "@/lib/format"

const STATUS_LABEL: Record<string, string> = {
  ACTIVE: "Aktif",
  CANCELED: "Dibatalkan",
  CANCELLED: "Dibatalkan",
  EXPIRED: "Kedaluwarsa",
  PENDING: "Menunggu",
  SUSPENDED: "Ditangguhkan",
}

const STATUS_TONE: Record<string, BadgeTone> = {
  ACTIVE: "success",
  CANCELED: "neutral",
  CANCELLED: "neutral",
  EXPIRED: "neutral",
  PENDING: "warning",
  SUSPENDED: "danger",
}

const PLAN_LABEL: Record<string, string> = {
  MONTHLY: "Bulanan",
  YEARLY: "Tahunan",
  ANNUAL: "Tahunan",
}

const CANCELLABLE: string[] = ["ACTIVE", "PENDING"]

function formatRupiah(n: unknown): string {
  if (typeof n !== "number" || !Number.isFinite(n)) return "—"
  return `Rp${Math.trunc(n).toLocaleString("id-ID")}`
}

function KeyValue({
  label,
  value,
  mono = false,
}: {
  label: string
  value: ReactNode
  mono?: boolean
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-2 border-b border-border py-2.5 last:border-b-0">
      <dt className="shrink-0 text-caption font-semibold text-text-secondary">
        {label}
      </dt>
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

type FeeUsage = {
  used: number | null
  limit: number | null
  remaining: number | null
}

function feeUsage(d: SubscriptionDetail): FeeUsage | null {
  const u = d.currentUsage ?? d.feeUsage
  const usedRaw = u?.used ?? d.feeSavingsUsed
  const used = typeof usedRaw === "number" ? usedRaw : null
  const limitRaw = u?.limit ?? d.feeSavingsLimit
  const limit = typeof limitRaw === "number" ? limitRaw : null
  if (used == null && limit == null) return null
  const remaining =
    typeof u?.remaining === "number"
      ? u.remaining
      : used != null && limit != null
        ? Math.max(0, limit - used)
        : null
  return { used, limit, remaining }
}

export default function SubscriptionDetailPage() {
  const { id } = useParams<{ id: string }>()
  const subId = Array.isArray(id) ? id[0] : (id ?? "")
  const toast = useToast()

  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [detail, setDetail] = useState<SubscriptionDetail | null>(null)

  const [cancelOpen, setCancelOpen] = useState(false)
  const [cancelReason, setCancelReason] = useState("")
  const [cancelling, setCancelling] = useState(false)

  const load = useCallback(
    async (mode: "initial" | "refresh" = "initial") => {
      if (mode === "initial") setLoading(true)
      else setRefreshing(true)
      setError(null)
      try {
        setDetail(await getSubscriptionDetail(subId))
      } catch (e) {
        setError(userMessage(e))
      } finally {
        setLoading(false)
        setRefreshing(false)
      }
    },
    [subId],
  )

  useEffect(() => {
    if (subId) void load("initial")
  }, [subId, load])

  const handleCancel = async () => {
    if (cancelling) return
    setCancelling(true)
    try {
      await cancelSubscription(subId, cancelReason)
      toast.show({
        title: "Subscription dibatalkan",
        tone: "success",
      })
      setCancelOpen(false)
      setCancelReason("")
      await load("refresh")
    } catch (e) {
      toast.show({
        title: "Gagal membatalkan subscription",
        description: userMessage(e),
        tone: "danger",
      })
    } finally {
      setCancelling(false)
    }
  }

  const status = detail ? String(detail.status ?? "") : ""
  const canCancel = CANCELLABLE.includes(status)
  const usage = detail ? feeUsage(detail) : null
  const usagePct =
    usage && usage.limit && usage.limit > 0 && usage.used != null
      ? Math.min(100, Math.max(0, (usage.used / usage.limit) * 100))
      : null

  return (
    <RoleGate href="/subscriptions">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="mb-1">
            <Link
              href="/subscriptions"
              className="text-caption font-semibold text-info-text hover:underline"
            >
              ← Kembali ke daftar subscription
            </Link>
          </p>
          <h1 className="text-h2 font-bold text-text-primary">Detail Subscription</h1>
          <p className="mt-1 text-body text-text-secondary">
            {detail ? `ID: ${detail.id}` : "Paket, periode, kuota fee, dan riwayat."}
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

      {loading ? (
        <div className="flex min-h-[40vh] items-center justify-center gap-2">
          <Spinner size="md" />
          <p className="text-body text-text-secondary">
            Memuat detail subscription…
          </p>
        </div>
      ) : error || !detail ? (
        <Card>
          <EmptyState
            title="Gagal memuat detail subscription"
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
              title="Paket & Periode"
              action={
                <div className="flex gap-2">
                  <Badge tone="info">
                    {PLAN_LABEL[String(detail.plan)] ?? String(detail.plan ?? "—")}
                  </Badge>
                  <Badge tone={STATUS_TONE[status] ?? "neutral"}>
                    {STATUS_LABEL[status] ?? status}
                  </Badge>
                </div>
              }
            />
            <CardBody>
              <dl>
                <KeyValue
                  label="Pengguna"
                  value={
                    detail.user?.fullName ??
                    detail.user?.username ??
                    detail.user?.email ??
                    detail.userId ??
                    "—"
                  }
                />
                {detail.user?.email ? (
                  <KeyValue label="Email" value={detail.user.email} />
                ) : null}
                <KeyValue label="Harga" value={formatRupiah(detail.price)} />
                <KeyValue
                  label="Periode mulai"
                  value={formatDateTimeWIB(detail.currentPeriodStart)}
                />
                <KeyValue
                  label="Periode berakhir"
                  value={formatDateTimeWIB(detail.currentPeriodEnd)}
                />
                <KeyValue
                  label="Dibuat"
                  value={formatDateTimeWIB(detail.createdAt)}
                />
                {detail.cancelledAt ? (
                  <KeyValue
                    label="Dibatalkan"
                    value={formatDateTimeWIB(detail.cancelledAt)}
                  />
                ) : null}
              </dl>

              <div className="mt-4">
                <Button
                  variant="destructive"
                  fullWidth={false}
                  disabled={!canCancel}
                  title={
                    canCancel
                      ? "Batalkan subscription ini"
                      : "Hanya subscription Aktif/Menunggu yang bisa dibatalkan"
                  }
                  onClick={() => setCancelOpen(true)}
                >
                  Batalkan subscription
                </Button>
              </div>
            </CardBody>
          </Card>

          <Card padded={false}>
            <CardHeader title="Sisa kuota fee — periode berjalan" />
            <CardBody>
              {!usage ? (
                <p className="text-body text-text-secondary">
                  Data penggunaan kuota fee tidak tersedia untuk subscription ini.
                </p>
              ) : (
                <>
                  {usagePct != null ? (
                    <div className="mb-3">
                      <div
                        className="h-2 overflow-hidden rounded-full bg-surface-elevated"
                        role="progressbar"
                        aria-valuenow={Math.round(usagePct)}
                        aria-valuemin={0}
                        aria-valuemax={100}
                      >
                        <div
                          className="h-full rounded-full bg-primary"
                          style={{ width: `${usagePct}%` }}
                        />
                      </div>
                      <p className="mt-2 text-caption text-text-secondary">
                        Terpakai {usagePct.toFixed(0)}% dari kuota periode ini.
                      </p>
                    </div>
                  ) : null}
                  <dl>
                    <KeyValue label="Terpakai" value={formatRupiah(usage.used)} />
                    <KeyValue label="Kuota periode" value={formatRupiah(usage.limit)} />
                    <KeyValue
                      label="Sisa kuota"
                      value={
                        <span className="font-semibold text-success-text">
                          {formatRupiah(usage.remaining)}
                        </span>
                      }
                    />
                  </dl>
                </>
              )}
            </CardBody>
          </Card>

          <Card padded={false} className="xl:col-span-2">
            <CardHeader title="Riwayat" />
            <CardBody>
              {detail.paymentTx ? (
                <>
                  <p className="mb-2 text-caption font-semibold text-text-secondary">
                    Pembayaran terakhir
                  </p>
                  <dl className="mb-4">
                    <KeyValue
                      label="ID transaksi"
                      value={detail.paymentTx.txId ?? "—"}
                      mono
                    />
                    <KeyValue
                      label="Status"
                      value={String(detail.paymentTx.status ?? "—")}
                    />
                    <KeyValue
                      label="Nominal"
                      value={formatRupiah(detail.paymentTx.amount)}
                    />
                    <KeyValue
                      label="Waktu"
                      value={formatDateTimeWIB(detail.paymentTx.createdAt)}
                    />
                  </dl>
                </>
              ) : null}

              {(detail.history?.length ?? 0) === 0 ? (
                <p className="text-body text-text-secondary">
                  Belum ada riwayat perubahan status yang tercatat.
                </p>
              ) : (
                <ul className="space-y-2">
                  {detail.history!.map((h, i) => (
                    <li
                      key={h.id ?? `${i}-${h.createdAt}`}
                      className="rounded-sm bg-surface px-4 py-3"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="font-semibold text-text-primary">
                          {h.action ?? h.status ?? "Perubahan"}
                        </p>
                        <span className="text-caption text-text-secondary">
                          {formatDateTimeWIB(h.createdAt)}
                        </span>
                      </div>
                      {h.note ? (
                        <p className="mt-1 text-body text-text-secondary">{h.note}</p>
                      ) : null}
                    </li>
                  ))}
                </ul>
              )}
            </CardBody>
          </Card>
        </div>
      )}

      <Dialog
        open={cancelOpen}
        onClose={() => (cancelling ? undefined : setCancelOpen(false))}
        title="Batalkan subscription?"
        description="Subscription akan dibatalkan segera. Tindakan ini tidak bisa dibatalkan."
      >
        <TextArea
          label="Alasan pembatalan (opsional)"
          rows={3}
          value={cancelReason}
          onChange={(e) => setCancelReason(e.target.value)}
          placeholder="Cth. Permintaan pengguna via tiket #123…"
          maxLength={500}
          disabled={cancelling}
        />
        <div className="mt-5 flex flex-col gap-2">
          <Button
            variant="destructive"
            loading={cancelling}
            onClick={handleCancel}
          >
            Ya, batalkan
          </Button>
          <Button
            variant="ghost"
            disabled={cancelling}
            onClick={() => setCancelOpen(false)}
          >
            Batal
          </Button>
        </div>
      </Dialog>
    </RoleGate>
  )
}
