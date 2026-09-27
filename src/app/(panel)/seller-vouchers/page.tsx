/**
 * Admin — Voucher buatan penjual/seller (batch 43, item #11).
 *
 * Daftar voucher yang dibuat penjual dari aplikasi mobile: admin memantau
 * + menonaktifkan voucher bermasalah. Pembuatan voucher tidak dilakukan
 * dari admin.
 *
 * Kontrak endpoint adalah ASUMSI (lihat src/lib/api/admin/seller-vouchers.ts).
 */
"use client"

import Link from "next/link"
import { useCallback, useEffect, useState } from "react"

import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Card, CardBody } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { DataTable } from "@/components/ui/table"
import { useToast } from "@/components/ui/toast"
import { Pagination } from "@/components/admin/pagination"
import { RoleGate } from "@/components/admin/role-gate"
import { Select } from "@/components/admin/select"
import { userMessage } from "@/lib/api/response"
import { formatDateTimeWIB, formatIDR, formatNumber } from "@/lib/format"
import {
  listSellerVouchers,
  type SellerVoucherItem,
} from "@/lib/api/admin/seller-vouchers"

const PAGE_SIZE = 20

type SellerVoucherRow = SellerVoucherItem & Record<string, unknown>

function discountLabel(v: SellerVoucherItem): string {
  if (v.discountAmount != null) return formatIDR(v.discountAmount)
  if (v.discountPercent != null)
    return `${v.discountPercent}%${v.maxDiscountAmount != null ? ` (maks ${formatIDR(v.maxDiscountAmount)})` : ""}`
  return v.maxDiscountAmount != null ? formatIDR(v.maxDiscountAmount) : "—"
}

function isExpired(v: SellerVoucherItem): boolean {
  return new Date(v.endsAt).getTime() < Date.now()
}

function statusBadge(v: SellerVoucherItem) {
  if (!v.isActive) return <Badge tone="neutral" dot>Nonaktif</Badge>
  if (isExpired(v)) return <Badge tone="danger" dot>Kedaluwarsa</Badge>
  return <Badge tone="success" dot>Aktif</Badge>
}

function SellerVouchersPageContent() {
  const toast = useToast()
  const [page, setPage] = useState(1)
  const [statusFilter, setStatusFilter] = useState<"all" | "true" | "false">("all")
  const [search, setSearch] = useState("")
  const [rows, setRows] = useState<SellerVoucherItem[]>([])
  const [total, setTotal] = useState(0)
  const [totalPages, setTotalPages] = useState(1)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(
    async (targetPage: number, targetFilter: "all" | "true" | "false", q: string) => {
      setLoading(true)
      setError(null)
      try {
        const res = await listSellerVouchers({
          page: targetPage,
          limit: PAGE_SIZE,
          isActive: targetFilter === "all" ? undefined : targetFilter,
          q: q.trim() || undefined,
        })
        setRows(res.data ?? [])
        const t = res.total ?? (res.data ?? []).length
        setTotal(t)
        setTotalPages(res.totalPages ?? Math.max(1, Math.ceil(t / PAGE_SIZE)))
        setPage(targetPage)
      } catch (e) {
        const msg = userMessage(e)
        setError(msg)
        toast.show({ title: "Gagal memuat voucher seller", description: msg, tone: "danger" })
      } finally {
        setLoading(false)
      }
    },
    [toast],
  )

  useEffect(() => {
    void load(1, statusFilter, search)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load, statusFilter])

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-h2 font-semibold text-text-primary">Voucher Seller</h1>
        <p className="mt-1 text-body text-text-secondary">
          Pantau voucher yang dibuat penjual dari aplikasi. Nonaktifkan
          voucher yang melanggar ketentuan dari halaman detail.
        </p>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <Select
          label="Filter status"
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as "all" | "true" | "false")}
          options={[
            { value: "all", label: "Semua status" },
            { value: "true", label: "Aktif" },
            { value: "false", label: "Nonaktif" },
          ]}
          className="w-44"
        />
        <Input
          label="Cari kode/nama/penjual"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void load(1, statusFilter, search)
          }}
          placeholder="cth. TOKO10"
          className="w-56"
        />
        <Button variant="secondary" fullWidth={false} onClick={() => load(1, statusFilter, search)}>
          Cari
        </Button>
      </div>

      {error && !loading ? (
        <Card>
          <CardBody className="flex flex-col gap-3">
            <p role="alert" className="text-body text-danger-text">
              {error}
            </p>
            <p className="text-caption text-text-secondary">
              Endpoint voucher seller mungkin belum tersedia di backend —
              kontrak masih asumsi (batch 43).
            </p>
            <div className="max-w-xs">
              <Button variant="secondary" fullWidth={false} onClick={() => load(page, statusFilter, search)}>
                Coba lagi
              </Button>
            </div>
          </CardBody>
        </Card>
      ) : (
        <>
          <DataTable<SellerVoucherRow>
            columns={[
              {
                key: "code",
                header: "Voucher",
                render: (r) => (
                  <div>
                    <Link
                      href={`/seller-vouchers/${encodeURIComponent(r.id)}`}
                      className="font-mono text-[13px] font-semibold text-primary hover:underline"
                    >
                      {r.code}
                    </Link>
                    <p className="text-caption text-text-secondary">{r.name}</p>
                    <p className="text-caption text-text-tertiary">
                      {r.sellerShopName ?? r.sellerName ?? "Penjual"}
                    </p>
                  </div>
                ),
              },
              {
                key: "discount",
                header: "Diskon",
                render: (r) => discountLabel(r),
              },
              {
                key: "usage",
                header: "Terpakai",
                align: "right",
                render: (r) =>
                  r.usageQuota != null
                    ? `${formatNumber(r.usageCount ?? 0)} / ${formatNumber(r.usageQuota)}`
                    : formatNumber(r.usageCount ?? 0),
              },
              {
                key: "status",
                header: "Status",
                render: (r) => statusBadge(r),
              },
              {
                key: "endsAt",
                header: "Berakhir",
                render: (r) => formatDateTimeWIB(r.endsAt),
              },
              {
                key: "action",
                header: "",
                align: "right",
                render: (r) => (
                  <div className="flex justify-end gap-2">
                    <Link href={`/seller-vouchers/${encodeURIComponent(r.id)}`}>
                      <Button variant="secondary" size="sm" fullWidth={false}>
                        Detail
                      </Button>
                    </Link>
                  </div>
                ),
              },
            ]}
            rows={rows as SellerVoucherRow[]}
            rowKey={(r) => r.id}
            loading={loading}
            emptyText="Belum ada voucher seller."
          />
          <Pagination
            page={page}
            totalPages={totalPages}
            total={total}
            pageSize={PAGE_SIZE}
            onPageChange={(p) => load(p, statusFilter, search)}
            disabled={loading}
          />
        </>
      )}
    </div>
  )
}

export default function SellerVouchersPage() {
  return (
    <RoleGate href="/seller-vouchers">
      <SellerVouchersPageContent />
    </RoleGate>
  )
}
