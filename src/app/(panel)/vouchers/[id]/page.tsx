/**
 * Admin — Detail voucher.
 *
 * Menampilkan: status + alarm kuota (>80% terpakai), pratinjau dampak
 * penonaktifan (pengguna aktif dihitung dari data detail), riwayat
 * pemakaian per pengguna DENGAN MASKING (email/nomor disamarkan,
 * mis. a***@x.com), serta aksi nonaktifkan.
 */
"use client"

import Link from "next/link"
import { useCallback, useEffect, useState, type ReactNode } from "react"
import { useParams, useRouter } from "next/navigation"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardBody, CardHeader } from "@/components/ui/card"
import { ConfirmDialog, Dialog } from "@/components/ui/dialog"
import { EmptyState } from "@/components/ui/empty-state"
import { Spinner } from "@/components/ui/spinner"
import { useToast } from "@/components/ui/toast"
import { RoleGate } from "@/components/admin/role-gate"
import { userMessage } from "@/lib/api/response"
import { newIdempotencyKey } from "@/lib/api/admin/finance"
import { formatDateTimeWIB, formatIDR, formatNumber } from "@/lib/format"
import {
  deactivateVoucher,
  reactivateVoucher,
  getVoucherDetail,
  type AdminVoucherDetail,
  type AdminVoucherItem,
  type AdminVoucherType,
} from "@/lib/api/admin/vouchers"
import { maskEmail, maskPhone } from "@/lib/pii"
import { quotaRatio } from "../../campaigns/lib"

const VOUCHER_TYPE_LABEL: Record<AdminVoucherType, string> = {
  FEE_DISCOUNT_FLAT: "Diskon fee (nominal)",
  FEE_DISCOUNT_PERCENT: "Diskon fee (persen)",
  WALLET_CASHBACK: "Cashback wallet",
  TOPUP_BONUS: "Bonus top-up",
}

const APPLICABILITY_LABEL: Record<string, string> = {
  ALL: "Semua",
  BUYER_ONLY: "Pembeli saja",
  SELLER_ONLY: "Penjual saja",
  NEW_USER: "Pengguna baru",
  DORMANT_USER: "Pengguna dormant",
}

function KeyValue({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-2 border-b border-border py-2.5 last:border-b-0">
      <dt className="shrink-0 text-caption font-semibold text-text-secondary">{label}</dt>
      <dd className="min-w-0 flex-1 text-right text-body text-text-primary">{value}</dd>
    </div>
  )
}

function voucherValueLabel(v: AdminVoucherItem): string {
  if (v.discountAmount != null) return formatIDR(v.discountAmount)
  if (v.discountPercent != null)
    return `${v.discountPercent}%${v.maxDiscountAmount != null ? ` (maks ${formatIDR(v.maxDiscountAmount)})` : ""}`
  return v.maxDiscountAmount != null ? formatIDR(v.maxDiscountAmount) : "—"
}

function VoucherDetailContent() {
  const params = useParams<{ id: string }>()
  const router = useRouter()
  const toast = useToast()
  const id = decodeURIComponent(params.id)

  const [detail, setDetail] = useState<AdminVoucherDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [deactivateOpen, setDeactivateOpen] = useState(false)
  const [deactivating, setDeactivating] = useState(false)
  const [deactivateKey, setDeactivateKey] = useState<string | null>(null)
  const [reactivateOpen, setReactivateOpen] = useState(false)
  const [reactivating, setReactivating] = useState(false)
  const [reactivateKey, setReactivateKey] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      setDetail(await getVoucherDetail(id))
    } catch (e) {
      setError(userMessage(e))
    } finally {
      setLoading(false)
    }
  }, [id])

  useEffect(() => {
    void load()
  }, [load])

  async function handleReactivate() {
    setReactivating(true)
    try {
      const updated = await reactivateVoucher(id, reactivateKey ?? undefined)
      setDetail((prev) => (prev ? { ...prev, ...updated, isActive: true } : prev))
      setReactivateOpen(false)
      setReactivateKey(null)
      toast.show({ title: "Voucher diaktifkan kembali.", tone: "success" })
    } catch (e) {
      toast.show({ title: "Gagal mengaktifkan kembali voucher", description: userMessage(e), tone: "danger" })
    } finally {
      setReactivating(false)
    }
  }

  async function handleDeactivate() {
    setDeactivating(true)
    try {
      const updated = await deactivateVoucher(id, deactivateKey ?? undefined)
      setDetail((prev) => (prev ? { ...prev, ...updated, isActive: false } : prev))
      setDeactivateOpen(false)
      toast.show({ title: "Voucher dinonaktifkan.", tone: "success" })
    } catch (e) {
      toast.show({ title: "Gagal menonaktifkan voucher", description: userMessage(e), tone: "danger" })
    } finally {
      setDeactivating(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Spinner size="md" />
      </div>
    )
  }

  if (error || !detail) {
    return (
      <EmptyState
        title="Voucher tidak ditemukan"
        description={error ?? "Data voucher tidak tersedia."}
        action={
          <Button variant="secondary" fullWidth={false} onClick={() => router.push("/vouchers")}>
            Kembali ke daftar
          </Button>
        }
      />
    )
  }

  const v = detail
  const usages = v.usages ?? []
  const uniqueUserIds = new Set(usages.map((u) => u.user?.userId ?? u.user?.id).filter(Boolean))
  const ratio = quotaRatio(v.usageCount ?? 0, v.maxUsageTotal)
  const expired = new Date(v.validUntil).getTime() < Date.now()
  const remaining = v.maxUsageTotal != null ? Math.max(0, v.maxUsageTotal - (v.usageCount ?? 0)) : null

  return (
    <div className="flex flex-col gap-5">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-caption text-text-tertiary">
            <Link href="/vouchers" className="hover:underline">
              Voucher
            </Link>{" "}
            / {v.code}
          </p>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <h1 className="font-mono text-h2 font-semibold text-text-primary">{v.code}</h1>
            {!v.isActive ? (
              <Badge tone="neutral" dot>Nonaktif</Badge>
            ) : expired ? (
              <Badge tone="danger" dot>Kedaluwarsa</Badge>
            ) : (
              <Badge tone="success" dot>Aktif</Badge>
            )}
            {ratio != null && ratio > 0.8 ? (
              <Badge tone="warning" dot>
                Kuota {Math.round(ratio * 100)}% terpakai
              </Badge>
            ) : null}
          </div>
          <p className="mt-1 text-body text-text-secondary">{v.name}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {v.isActive ? (
            <Button
              variant="destructive"
              size="sm"
              fullWidth={false}
              onClick={() => {
                setDeactivateKey(newIdempotencyKey())
                setDeactivateOpen(true)
              }}
            >
              Nonaktifkan
            </Button>
          ) : !expired ? (
            <Button
              variant="secondary"
              size="sm"
              fullWidth={false}
              onClick={() => {
                setReactivateKey(newIdempotencyKey())
                setReactivateOpen(true)
              }}
            >
              Aktifkan kembali
            </Button>
          ) : null}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        {/* Informasi voucher */}
        <Card>
          <CardHeader>
            <h2 className="text-h3 font-semibold text-text-primary">Informasi voucher</h2>
          </CardHeader>
          <CardBody>
            <dl>
              <KeyValue label="Tipe" value={VOUCHER_TYPE_LABEL[v.voucherType] ?? v.voucherType} />
              <KeyValue label="Nilai" value={voucherValueLabel(v)} />
              <KeyValue label="Berlaku untuk" value={APPLICABILITY_LABEL[v.applicableTo ?? "ALL"] ?? v.applicableTo ?? "—"} />
              <KeyValue label="Minimal nilai order" value={v.minOrderValue != null ? formatIDR(v.minOrderValue) : "—"} />
              <KeyValue label="Kuota per pengguna" value={v.maxUsagePerUser != null ? formatNumber(v.maxUsagePerUser) : "—"} />
              <KeyValue label="Berlaku dari" value={formatDateTimeWIB(v.validFrom)} />
              <KeyValue label="Berlaku sampai" value={formatDateTimeWIB(v.validUntil)} />
              <KeyValue label="Deskripsi" value={v.description || "—"} />
              <KeyValue label="Dibuat" value={formatDateTimeWIB(v.createdAt)} />
            </dl>
          </CardBody>
        </Card>

        {/* Pratinjau dampak penonaktifan */}
        <Card>
          <CardHeader>
            <h2 className="text-h3 font-semibold text-text-primary">Dampak penonaktifan</h2>
            <p className="mt-1 text-caption text-text-secondary">
              Dihitung dari data detail voucher saat ini.
            </p>
          </CardHeader>
          <CardBody>
            <dl>
              <KeyValue
                label="Pengguna aktif (sudah memakai)"
                value={`${formatNumber(uniqueUserIds.size)} pengguna`}
              />
              <KeyValue label="Total pemakaian tercatat" value={formatNumber(v.usageCount ?? 0)} />
              <KeyValue
                label="Kuota tersisa"
                value={remaining != null ? formatNumber(remaining) : "Tanpa batas"}
              />
              <KeyValue
                label="Efek penonaktifan"
                value={
                  v.isActive
                    ? `${uniqueUserIds.size > 0 ? `${formatNumber(uniqueUserIds.size)} pengguna yang sudah memakai tetap tercatat; ` : ""}${
                        remaining != null
                          ? `${formatNumber(remaining)} kuota tersisa tidak bisa lagi dipakai.`
                          : "voucher tidak bisa lagi dipakai pengguna."
                      }`
                    : "Voucher sudah nonaktif."
                }
              />
            </dl>
          </CardBody>
        </Card>
      </div>

      {/* Riwayat pemakaian — masking PII */}
      <Card>
        <CardHeader>
          <h2 className="text-h3 font-semibold text-text-primary">Riwayat pemakaian</h2>
          <p className="mt-1 text-caption text-text-secondary">
            Email dan nomor HP ditampilkan dalam bentuk termasking demi privasi.
          </p>
        </CardHeader>
        <CardBody>
          {usages.length === 0 ? (
            <p className="text-body text-text-secondary">Belum ada pemakaian tercatat.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-body">
                <thead>
                  <tr className="border-b border-border text-caption font-semibold text-text-secondary">
                    <th className="py-2 pr-4">Waktu</th>
                    <th className="py-2 pr-4">Pengguna</th>
                    <th className="py-2 pr-4">Email (termasking)</th>
                    <th className="py-2 pr-4">No. HP (termasking)</th>
                    <th className="py-2 text-right">Diskon</th>
                  </tr>
                </thead>
                <tbody>
                  {usages.map((u) => (
                    <tr key={u.id} className="border-b border-border last:border-b-0">
                      <td className="py-2 pr-4 whitespace-nowrap text-text-secondary">
                        {formatDateTimeWIB(u.usedAt)}
                      </td>
                      <td className="py-2 pr-4 text-text-primary">
                        {u.user?.fullName || "—"}
                      </td>
                      <td className="py-2 pr-4 font-mono text-[13px] text-text-primary">
                        {maskEmail(u.user?.email)}
                      </td>
                      <td className="py-2 pr-4 font-mono text-[13px] text-text-primary">
                        {maskPhone(u.user?.phone)}
                      </td>
                      <td className="py-2 text-right text-text-primary">
                        {u.discountApplied != null ? formatIDR(u.discountApplied) : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardBody>
      </Card>

      {/* ADM-218: aktifkan kembali voucher nonaktif */}
      <ConfirmDialog
        open={reactivateOpen}
        onClose={() => setReactivateOpen(false)}
        title="Aktifkan kembali voucher?"
        description={`Voucher ${v.code} akan bisa dipakai pengguna lagi sesuai masa berlaku yang tersisa.`}
        confirmLabel="Aktifkan kembali"
        cancelLabel="Batal"
        loading={reactivating}
        onConfirm={() => void handleReactivate()}
      />

      {/* Nonaktifkan dengan pratinjau dampak */}
      <Dialog
        open={deactivateOpen}
        onClose={() => setDeactivateOpen(false)}
        title="Nonaktifkan voucher?"
        description={`Voucher ${v.code} tidak bisa lagi dipakai pengguna. Voucher dapat diaktifkan kembali selama masih dalam masa berlaku.`}
        footer={
          <div className="flex flex-col gap-2">
            <Button variant="destructive" loading={deactivating} onClick={handleDeactivate}>
              Nonaktifkan
            </Button>
            <Button variant="ghost" disabled={deactivating} onClick={() => setDeactivateOpen(false)}>
              Batal
            </Button>
          </div>
        }
      >
        <div className="rounded-sm border border-border bg-surface px-3 py-2 text-body text-text-secondary">
          <p className="font-semibold text-text-primary">Dampak penonaktifan:</p>
          <ul className="mt-1 flex list-disc flex-col gap-1 pl-5">
            <li>{formatNumber(uniqueUserIds.size)} pengguna yang sudah memakai tetap tercatat.</li>
            <li>
              {remaining != null
                ? `${formatNumber(remaining)} kuota tersisa tidak bisa lagi dipakai.`
                : "Voucher tidak bisa lagi dipakai pengguna."}
            </li>
          </ul>
        </div>
      </Dialog>
    </div>
  )
}

export default function VoucherDetailPage() {
  return (
    <RoleGate href="/vouchers">
      <VoucherDetailContent />
    </RoleGate>
  )
}
