/**
 * Admin — Detail voucher seller (batch 43, item #11).
 *
 * Menampilkan: info voucher, alarm kuota, riwayat pemakaian DENGAN MASKING
 * (email/nomor disamarkan), serta aksi nonaktifkan (idempoten).
 * Tanpa reaktivasi: voucher seller yang dinonaktifkan admin hanya bisa
 * dibuat ulang oleh penjual dari aplikasi.
 */
"use client"

import Link from "next/link"
import { useCallback, useEffect, useState, type ReactNode } from "react"
import { useParams } from "next/navigation"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardBody, CardHeader } from "@/components/ui/card"
import { ConfirmDialog } from "@/components/ui/dialog"
import { Spinner } from "@/components/ui/spinner"
import { DataTable } from "@/components/ui/table"
import { useToast } from "@/components/ui/toast"
import { RoleGate } from "@/components/admin/role-gate"
import { userMessage } from "@/lib/api/response"
import { newIdempotencyKey } from "@/lib/api/admin/finance"
import { formatDateTimeWIB, formatIDR, formatNumber } from "@/lib/format"
import { maskEmail, maskName, maskPhone } from "@/lib/pii"
import {
  deactivateSellerVoucher,
  getSellerVoucherDetail,
  type SellerVoucherDetail,
  type SellerVoucherItem,
  type SellerVoucherUsage,
} from "@/lib/api/admin/seller-vouchers"
import { quotaRatio } from "../../campaigns/lib"

function KeyValue({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-2 border-b border-border py-2.5 last:border-b-0">
      <dt className="shrink-0 text-caption font-semibold text-text-secondary">{label}</dt>
      <dd className="min-w-0 flex-1 text-right text-body text-text-primary">{value}</dd>
    </div>
  )
}

function discountLabel(v: SellerVoucherItem): string {
  if (v.discountAmount != null) return formatIDR(v.discountAmount)
  if (v.discountPercent != null)
    return `${v.discountPercent}%${v.maxDiscountAmount != null ? ` (maks ${formatIDR(v.maxDiscountAmount)})` : ""}`
  return v.maxDiscountAmount != null ? formatIDR(v.maxDiscountAmount) : "—"
}

function SellerVoucherDetailContent() {
  const params = useParams<{ id: string }>()
  const toast = useToast()
  const id = params.id

  const [detail, setDetail] = useState<SellerVoucherDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [deactivateOpen, setDeactivateOpen] = useState(false)
  const [deactivating, setDeactivating] = useState(false)
  const [deactivateKey, setDeactivateKey] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      setDetail(await getSellerVoucherDetail(id))
    } catch (e) {
      const msg = userMessage(e)
      setError(msg)
      toast.show({ title: "Gagal memuat detail voucher", description: msg, tone: "danger" })
    } finally {
      setLoading(false)
    }
  }, [id, toast])

  useEffect(() => {
    void load()
  }, [load])

  async function handleDeactivate() {
    setDeactivating(true)
    try {
      const updated = await deactivateSellerVoucher(id, deactivateKey ?? undefined)
      setDetail((prev) => (prev ? { ...prev, ...updated, isActive: false } : prev))
      setDeactivateOpen(false)
      setDeactivateKey(null)
      toast.show({ title: "Voucher seller dinonaktifkan.", tone: "success" })
    } catch (e) {
      toast.show({
        title: "Gagal menonaktifkan voucher",
        description: userMessage(e),
        tone: "danger",
      })
    } finally {
      setDeactivating(false)
    }
  }

  const expired = detail ? new Date(detail.endsAt).getTime() < Date.now() : false
  const ratio = detail ? quotaRatio(detail.usageCount ?? 0, detail.usageQuota) : null
  const usages: SellerVoucherUsage[] = detail?.usages ?? []

  return (
    <div className="flex flex-col gap-5">
      <div>
        <Link href="/seller-vouchers" className="text-caption text-primary hover:underline">
          ← Kembali ke daftar voucher seller
        </Link>
        <h1 className="mt-2 font-mono text-h2 font-semibold text-text-primary">
          {detail?.code ?? "Detail Voucher Seller"}
        </h1>
      </div>

      {loading ? (
        <div className="flex min-h-[30vh] items-center justify-center gap-2">
          <Spinner size="md" />
          <p className="text-body text-text-secondary">Memuat…</p>
        </div>
      ) : error || !detail ? (
        <Card>
          <CardBody className="flex flex-col gap-3">
            <p role="alert" className="text-body text-danger-text">
              {error ?? "Voucher tidak ditemukan."}
            </p>
            <div className="max-w-xs">
              <Button variant="secondary" fullWidth={false} onClick={() => load()}>
                Coba lagi
              </Button>
            </div>
          </CardBody>
        </Card>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
            <Card padded={false}>
              <CardHeader title="Informasi voucher" />
              <CardBody>
                <dl>
                  <KeyValue
                    label="Status"
                    value={
                      !detail.isActive ? (
                        <Badge tone="neutral" dot>Nonaktif</Badge>
                      ) : expired ? (
                        <Badge tone="danger" dot>Kedaluwarsa</Badge>
                      ) : (
                        <Badge tone="success" dot>Aktif</Badge>
                      )
                    }
                  />
                  <KeyValue label="Nama" value={detail.name} />
                  <KeyValue
                    label="Penjual"
                    value={detail.sellerShopName ?? detail.sellerName ?? "—"}
                  />
                  <KeyValue label="Diskon" value={discountLabel(detail)} />
                  <KeyValue
                    label="Min. nilai order"
                    value={detail.minOrderValue != null ? formatIDR(detail.minOrderValue) : "—"}
                  />
                  <KeyValue
                    label="Kuota"
                    value={
                      detail.usageQuota != null
                        ? `${formatNumber(detail.usageCount ?? 0)} / ${formatNumber(detail.usageQuota)} terpakai`
                        : "Tanpa batas"
                    }
                  />
                  {ratio != null && ratio > 0.8 ? (
                    <KeyValue
                      label="Alarm kuota"
                      value={
                        <Badge tone="warning" dot>
                          Kuota {Math.round(ratio * 100)}% terpakai
                        </Badge>
                      }
                    />
                  ) : null}
                  <KeyValue label="Mulai" value={formatDateTimeWIB(detail.startsAt)} />
                  <KeyValue label="Berakhir" value={formatDateTimeWIB(detail.endsAt)} />
                </dl>
                {detail.description ? (
                  <p className="mt-3 text-body text-text-secondary">{detail.description}</p>
                ) : null}
                {detail.isActive && !expired ? (
                  <div className="mt-4">
                    <Button
                      variant="destructive"
                      fullWidth={false}
                      onClick={() => {
                        setDeactivateKey(newIdempotencyKey())
                        setDeactivateOpen(true)
                      }}
                    >
                      Nonaktifkan voucher
                    </Button>
                    <p className="mt-2 text-caption text-text-secondary">
                      Voucher yang dinonaktifkan admin tidak bisa dipakai pembeli
                      dan tidak bisa diaktifkan ulang dari admin.
                    </p>
                  </div>
                ) : null}
              </CardBody>
            </Card>

            <Card padded={false}>
              <CardHeader title={`Riwayat pemakaian (${formatNumber(usages.length)})`} />
              <CardBody>
                <DataTable<SellerVoucherUsage & Record<string, unknown>>
                  columns={[
                    {
                      key: "user",
                      header: "Pengguna",
                      render: (r) => (
                        <div>
                          <p className="font-semibold">
                            {maskName(r.user?.fullName)}
                          </p>
                          <p className="text-caption text-text-secondary">
                            {maskEmail(r.user?.email)}
                            {r.user?.phone ? ` · ${maskPhone(r.user.phone)}` : ""}
                          </p>
                        </div>
                      ),
                    },
                    {
                      key: "discount",
                      header: "Diskon",
                      align: "right",
                      render: (r) =>
                        r.discountApplied != null ? formatIDR(r.discountApplied) : "—",
                    },
                    {
                      key: "usedAt",
                      header: "Waktu",
                      render: (r) => (r.usedAt ? formatDateTimeWIB(r.usedAt) : "—"),
                    },
                  ]}
                  rows={usages as (SellerVoucherUsage & Record<string, unknown>)[]}
                  rowKey={(r) => r.id}
                  loading={false}
                  emptyText="Belum ada pemakaian."
                />
              </CardBody>
            </Card>
          </div>

          <ConfirmDialog
            open={deactivateOpen}
            onClose={() => setDeactivateOpen(false)}
            title="Nonaktifkan voucher seller?"
            description={
              `Voucher ${detail.code} milik ${detail.sellerShopName ?? detail.sellerName ?? "penjual"} ` +
              "tidak bisa lagi dipakai pembeli. Tindakan ini tidak bisa dibatalkan dari admin."
            }
            confirmLabel="Nonaktifkan"
            onConfirm={handleDeactivate}
            loading={deactivating}
            destructive
          />
        </>
      )}
    </div>
  )
}

export default function SellerVoucherDetailPage() {
  return (
    <RoleGate href="/seller-vouchers">
      <SellerVoucherDetailContent />
    </RoleGate>
  )
}
