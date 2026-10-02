/**
 * Admin — Voucher & Kampanye.
 *
 * Dua tab (tab aktif dari search param `?tab=voucher|kampanye`, default
 * voucher):
 * - Voucher: daftar voucher (buat baru + nonaktifkan).
 * - Kampanye: daftar kampanye (buat baru + aktifkan/jeda). Tombol "Aktifkan"
 *   menerbitkan voucher personal ke pengguna yang memenuhi syarat — selalu
 *   diminta konfirmasi dulu.
 *
 * Port dari frontend/app/admin/(panel)/vouchers.tsx → web desktop.
 */
"use client"

import { Suspense, useCallback, useEffect, useState } from "react"
import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"

import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Card, CardBody } from "@/components/ui/card"
import { ConfirmDialog, Dialog } from "@/components/ui/dialog"
import { Input, TextArea } from "@/components/ui/input"
import { DataTable } from "@/components/ui/table"
import { useToast } from "@/components/ui/toast"
import { Select } from "@/components/admin/select"
import { Pagination } from "@/components/admin/pagination"
import { RoleGate } from "@/components/admin/role-gate"
import { cn } from "@/lib/cn"
import { formatDateTimeWIB, formatIDR, formatNumber } from "@/lib/format"
import { userMessage } from "@/lib/api/response"
import { newIdempotencyKey } from "@/lib/api/admin/finance"
import type { Paginated } from "@/lib/api/admin/kyc"
import {
  listVouchers,
  createVoucher,
  deactivateVoucher,
  reactivateVoucher,
  type AdminVoucherItem,
  type AdminVoucherType,
  type AdminVoucherApplicability,
  type CreateVoucherInput,
} from "@/lib/api/admin/vouchers"
import {
  listCampaigns,
  createCampaign,
  activateCampaign,
  pauseCampaign,
  duplicateCampaign,
  type AdminCampaignItem,
  type AdminCampaignType,
  type AdminCampaignStatus,
  type AdminMembershipRank,
  type CreateCampaignInput,
} from "@/lib/api/admin/campaigns"
import {
  CAMPAIGN_TYPES,
  CAMPAIGN_STATUSES,
  MEMBERSHIP_RANKS,
  campaignTypeLabel,
  campaignStatusTone,
  campaignStatusLabel,
  campaignKey,
  dayToISO,
  parseIntInput,
  parseNumberInput,
  quotaRatio,
} from "../campaigns/lib"

const PAGE_SIZE = 20

const VOUCHER_TYPES: { value: AdminVoucherType; label: string }[] = [
  { value: "FEE_DISCOUNT_FLAT", label: "Diskon fee (nominal)" },
  { value: "FEE_DISCOUNT_PERCENT", label: "Diskon fee (persen)" },
  { value: "WALLET_CASHBACK", label: "Cashback dompet" },
  { value: "TOPUP_BONUS", label: "Bonus top-up" },
]

const VOUCHER_APPLICABILITIES: { value: AdminVoucherApplicability; label: string }[] = [
  { value: "ALL", label: "Semua" },
  { value: "BUYER_ONLY", label: "Pembeli saja" },
  { value: "SELLER_ONLY", label: "Penjual saja" },
  { value: "NEW_USER", label: "Pengguna baru" },
  { value: "DORMANT_USER", label: "Pengguna tidak aktif" },
]

function voucherValueLabel(v: AdminVoucherItem): string {
  if (v.discountAmount != null) return formatIDR(v.discountAmount)
  if (v.discountPercent != null)
    return `${v.discountPercent}%${v.maxDiscountAmount != null ? ` (maks ${formatIDR(v.maxDiscountAmount)})` : ""}`
  return v.maxDiscountAmount != null ? formatIDR(v.maxDiscountAmount) : "—"
}

function voucherTypeLabel(t: AdminVoucherType): string {
  return VOUCHER_TYPES.find((x) => x.value === t)?.label ?? t
}

function isExpiredVoucher(v: AdminVoucherItem): boolean {
  return new Date(v.validUntil).getTime() < Date.now()
}

/**
 * Baris tabel: interface dari kontrak API tidak punya implicit index
 * signature sehingga tidak memenuhi `DataTable<Row extends Record<string,
 * unknown>>` — alias lokal ini menutupinya tanpa mengubah kontrak API.
 */
type VoucherRow = AdminVoucherItem & Record<string, unknown>
type CampaignRow = AdminCampaignItem & Record<string, unknown>

/* ------------------------------------------------------------------ */
/* Form voucher                                                         */
/* ------------------------------------------------------------------ */

function VoucherForm({
  onSubmit,
  submitting,
}: {
  onSubmit: (input: CreateVoucherInput) => Promise<void>
  submitting: boolean
}) {
  const [code, setCode] = useState("")
  const [name, setName] = useState("")
  const [description, setDescription] = useState("")
  const [voucherType, setVoucherType] = useState<AdminVoucherType>("FEE_DISCOUNT_FLAT")
  const [discountAmount, setDiscountAmount] = useState("")
  const [discountPercent, setDiscountPercent] = useState("")
  const [maxDiscountAmount, setMaxDiscountAmount] = useState("")
  const [quota, setQuota] = useState("")
  const [maxPerUser, setMaxPerUser] = useState("1")
  const [validFrom, setValidFrom] = useState("")
  const [validUntil, setValidUntil] = useState("")
  const [minOrderValue, setMinOrderValue] = useState("")
  const [applicableTo, setApplicableTo] = useState<AdminVoucherApplicability>("ALL")
  // SP-043: voucher personal — hanya bisa ditebus user dengan ID ini.
  const [assignedToUserId, setAssignedToUserId] = useState("")
  const [formError, setFormError] = useState<string | null>(null)

  async function handleSubmit() {
    setFormError(null)
    if (!code.trim() || !name.trim()) {
      setFormError("Kode dan nama voucher wajib diisi.")
      return
    }
    const from = dayToISO(validFrom, false)
    const until = dayToISO(validUntil, true)
    if (!from || !until) {
      setFormError("Tanggal berlaku wajib diisi (format tanggal valid).")
      return
    }
    if (new Date(until) <= new Date(from)) {
      setFormError("Tanggal berakhir harus setelah tanggal mulai.")
      return
    }
    const input: CreateVoucherInput = {
      code: code.trim().toUpperCase(),
      name: name.trim(),
      voucherType,
      validFrom: from,
      validUntil: until,
      applicableTo,
    }
    if (description.trim()) input.description = description.trim()
    const amount = parseIntInput(discountAmount)
    if (amount !== undefined) input.discountAmount = amount
    const percent = parseNumberInput(discountPercent)
    if (percent !== undefined) input.discountPercent = percent
    const maxDisc = parseIntInput(maxDiscountAmount)
    if (maxDisc !== undefined) input.maxDiscountAmount = maxDisc
    const q = parseIntInput(quota)
    if (q !== undefined) input.maxUsageTotal = q
    const perUser = parseIntInput(maxPerUser)
    if (perUser !== undefined) input.maxUsagePerUser = perUser
    const minOrder = parseIntInput(minOrderValue)
    if (minOrder !== undefined) input.minOrderValue = minOrder
    const assignee = assignedToUserId.trim()
    if (assignee) input.assignedToUserId = assignee
    try {
      await onSubmit(input)
    } catch (e) {
      setFormError(userMessage(e))
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {formError ? (
        <p role="alert" className="text-body text-danger-text">
          {formError}
        </p>
      ) : null}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Input
          label="Kode voucher"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          placeholder="cth. HEMAT50"
          maxLength={30}
          required
        />
        <Input
          label="Nama voucher"
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={100}
          required
        />
      </div>
      <TextArea
        label="Deskripsi"
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        maxLength={500}
        rows={2}
      />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Select
          label="Tipe voucher"
          value={voucherType}
          onChange={(e) => setVoucherType(e.target.value as AdminVoucherType)}
          options={VOUCHER_TYPES.map((t) => ({ value: t.value, label: t.label }))}
        />
        <Select
          label="Berlaku untuk"
          value={applicableTo}
          onChange={(e) => setApplicableTo(e.target.value as AdminVoucherApplicability)}
          options={VOUCHER_APPLICABILITIES.map((a) => ({ value: a.value, label: a.label }))}
        />
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Input
          label="Nominal diskon (Rp)"
          value={discountAmount}
          onChange={(e) => setDiscountAmount(e.target.value)}
          inputMode="numeric"
          placeholder="50000"
        />
        <Input
          label="Diskon (%)"
          value={discountPercent}
          onChange={(e) => setDiscountPercent(e.target.value)}
          inputMode="decimal"
          placeholder="10"
        />
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Input
          label="Maksimal diskon (Rp)"
          value={maxDiscountAmount}
          onChange={(e) => setMaxDiscountAmount(e.target.value)}
          inputMode="numeric"
          placeholder="100000"
        />
        <Input
          label="Minimal nilai order (Rp)"
          value={minOrderValue}
          onChange={(e) => setMinOrderValue(e.target.value)}
          inputMode="numeric"
          placeholder="0"
        />
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Input
          label="Kuota total"
          value={quota}
          onChange={(e) => setQuota(e.target.value)}
          inputMode="numeric"
          placeholder="1000"
          hint="Kosongkan untuk tanpa batas."
        />
        <Input
          label="Kuota per pengguna"
          value={maxPerUser}
          onChange={(e) => setMaxPerUser(e.target.value)}
          inputMode="numeric"
          placeholder="1"
        />
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Input
          label="Berlaku dari"
          type="date"
          value={validFrom}
          onChange={(e) => setValidFrom(e.target.value)}
          required
        />
        <Input
          label="Berlaku sampai"
          type="date"
          value={validUntil}
          onChange={(e) => setValidUntil(e.target.value)}
          required
        />
      </div>
      <Input
        label="ID pengguna (voucher personal)"
        value={assignedToUserId}
        onChange={(e) => setAssignedToUserId(e.target.value)}
        placeholder="cth. usr_… — kosongkan untuk voucher umum"
        hint="Bila diisi, hanya pengguna dengan ID ini yang bisa menebus. ID salah ditolak server."
      />
      <Button loading={submitting} onClick={handleSubmit}>
        Buat voucher
      </Button>
    </div>
  )
}
/* ------------------------------------------------------------------ */
/* Tab voucher                                                          */
/* ------------------------------------------------------------------ */

function ErrorCard({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <Card>
      <CardBody className="flex flex-col gap-3">
        <p role="alert" className="text-body text-danger-text">
          {message}
        </p>
        <div className="max-w-xs">
          <Button variant="secondary" onClick={onRetry}>
            Coba lagi
          </Button>
        </div>
      </CardBody>
    </Card>
  )
}

function VouchersTab() {
  const toast = useToast()
  const [page, setPage] = useState(1)
  const [statusFilter, setStatusFilter] = useState<"all" | "true" | "false">("all")
  const [search, setSearch] = useState("")
  const [rows, setRows] = useState<AdminVoucherItem[]>([])
  const [total, setTotal] = useState(0)
  const [totalPages, setTotalPages] = useState(1)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [createOpen, setCreateOpen] = useState(false)
  const [creating, setCreating] = useState(false)
  const [createKey, setCreateKey] = useState<string | null>(null)
  const openCreate = () => {
    setCreateOpen(true)
    setCreateKey(newIdempotencyKey())
  }
  const [deactivating, setDeactivating] = useState<AdminVoucherItem | null>(null)
  const [deactivatingNow, setDeactivatingNow] = useState(false)
  const [deactivateKey, setDeactivateKey] = useState<string | null>(null)
  const [reactivating, setReactivating] = useState<AdminVoucherItem | null>(null)
  const [reactivatingNow, setReactivatingNow] = useState(false)
  const [reactivateKey, setReactivateKey] = useState<string | null>(null)
  const openDeactivate = (r: AdminVoucherItem) => {
    setDeactivating(r)
    setDeactivateKey(newIdempotencyKey())
  }
  const openReactivate = (r: AdminVoucherItem) => {
    setReactivating(r)
    setReactivateKey(newIdempotencyKey())
  }
  const [exporting, setExporting] = useState(false)

  /** Filter client-side by kode/nama atas baris yang dimuat. */
  function applySearchFilter(all: AdminVoucherItem[], q: string): AdminVoucherItem[] {
    const needle = q.trim().toLowerCase()
    if (!needle) return all
    return all.filter(
      (r) =>
        r.code.toLowerCase().includes(needle) || r.name.toLowerCase().includes(needle),
    )
  }

  const load = useCallback(
    async (targetPage: number, targetFilter: "all" | "true" | "false", q: string) => {
      setLoading(true)
      setError(null)
      try {
        const res: Paginated<AdminVoucherItem> = await listVouchers({
          page: targetPage,
          limit: PAGE_SIZE,
          isActive: targetFilter === "all" ? undefined : targetFilter,
          search: q.trim() || undefined,
        })
        const filtered = applySearchFilter(res.data ?? [], q)
        setRows(filtered)
        const searching = q.trim() !== ""
        const t = searching ? filtered.length : (res.total ?? filtered.length)
        setTotal(t)
        setTotalPages(searching ? 1 : (res.totalPages ?? Math.max(1, Math.ceil(t / PAGE_SIZE))))
        setPage(targetPage)
      } catch (e) {
        const msg = userMessage(e)
        setError(msg)
        toast.show({ title: "Gagal memuat voucher", description: msg, tone: "danger" })
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

  /** Cari saat tombol ditekan / Enter — berlaku pada daftar yang dimuat + diteruskan ke server. */
  function handleSearch() {
    void load(1, statusFilter, search)
  }

  async function handleCreate(input: CreateVoucherInput) {
    setCreating(true)
    try {
      // ADM-219: satu kunci per sesi buat; retry dialog memakai kunci yang sama.
      await createVoucher(input, createKey ?? undefined)
      setCreateOpen(false)
      toast.show({ title: "Voucher dibuat.", tone: "success" })
      void load(1, statusFilter, search)
    } finally {
      setCreating(false)
    }
  }

  async function handleReactivate() {
    if (!reactivating) return
    setReactivatingNow(true)
    try {
      await reactivateVoucher(
        reactivating.voucherId ?? reactivating.id,
        reactivateKey ?? undefined,
      )
      setReactivating(null)
      setReactivateKey(null)
      toast.show({ title: "Voucher diaktifkan kembali.", tone: "success" })
      void load(page, statusFilter, search)
    } catch (e) {
      toast.show({ title: "Gagal mengaktifkan kembali voucher", description: userMessage(e), tone: "danger" })
    } finally {
      setReactivatingNow(false)
    }
  }

  async function handleDeactivate() {
    if (!deactivating) return
    setDeactivatingNow(true)
    try {
      await deactivateVoucher(
        deactivating.voucherId ?? deactivating.id,
        deactivateKey ?? undefined,
      )
      setDeactivating(null)
      setDeactivateKey(null)
      toast.show({ title: "Voucher dinonaktifkan.", tone: "success" })
      void load(page, statusFilter, search)
    } catch (e) {
      toast.show({ title: "Gagal menonaktifkan voucher", description: userMessage(e), tone: "danger" })
    } finally {
      setDeactivatingNow(false)
    }
  }

  /**
   * Ekspor CSV agregat performa per jenis/periode (tanpa PII): mengambil
   * semua halaman voucher lalu mengagregasi per tipe × bulan berlaku-dari.
   */
  async function handleExportCsv() {
    setExporting(true)
    try {
      const all: AdminVoucherItem[] = []
      const limit = 100
      let p = 1
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const res = await listVouchers({ page: p, limit, isActive: statusFilter === "all" ? undefined : statusFilter })
        all.push(...(res.data ?? []))
        const totalPagesGuess = res.totalPages ?? 1
        if (p >= totalPagesGuess || (res.data ?? []).length < limit) break
        p += 1
        if (p > 50) break // pengaman
      }
      type Agg = { count: number; quota: number; used: number; quotaCapped: number }
      const byKey = new Map<string, Agg>()
      for (const v of all) {
        const d = new Date(v.validFrom)
        const period = Number.isNaN(d.getTime())
          ? "—"
          : `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`
        const key = `${v.voucherType}|${period}`
        const agg = byKey.get(key) ?? { count: 0, quota: 0, used: 0, quotaCapped: 0 }
        agg.count += 1
        agg.used += v.usageCount ?? 0
        if (v.maxUsageTotal != null) {
          agg.quota += v.maxUsageTotal
          agg.quotaCapped += 1
        }
        byKey.set(key, agg)
      }
      const header = ["Tipe voucher", "Periode", "Jumlah voucher", "Total kuota", "Total terpakai", "% terpakai"]
      const lines = [...byKey.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, agg]) => {
          const [type, period] = key.split("|")
          const pct = agg.quota > 0 ? ((agg.used / agg.quota) * 100).toFixed(1) : ""
          return [
            voucherTypeLabel(type as AdminVoucherType),
            period,
            String(agg.count),
            agg.quotaCapped > 0 ? String(agg.quota) : "Tanpa batas",
            String(agg.used),
            pct,
          ]
            .map((c) => `"${String(c).replace(/"/g, '""')}"`)
            .join(",")
        })
      const blob = new Blob([[header.join(","), ...lines].join("\n")], {
        type: "text/csv;charset=utf-8",
      })
      const url = URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url
      a.download = `voucher-agregat-${new Date().toISOString().slice(0, 10)}.csv`
      a.click()
      URL.revokeObjectURL(url)
      toast.show({ title: "CSV agregat diunduh (tanpa PII).", tone: "success" })
    } catch (e) {
      toast.show({ title: "Gagal mengekspor CSV", description: userMessage(e), tone: "danger" })
    } finally {
      setExporting(false)
    }
  }

  /** Badge alarm bila kuota >80% terpakai. */
  function quotaAlarm(r: AdminVoucherItem) {
    const ratio = quotaRatio(r.usageCount ?? 0, r.maxUsageTotal)
    if (ratio == null || ratio <= 0.8) return null
    return (
      <Badge tone="warning" dot>
        Kuota {Math.round(ratio * 100)}% terpakai
      </Badge>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
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
            label="Cari kode/nama"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleSearch()
            }}
            placeholder="cth. HEMAT50"
            className="w-56"
          />
          <Button variant="secondary" fullWidth={false} onClick={handleSearch}>
            Cari
          </Button>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" fullWidth={false} loading={exporting} onClick={handleExportCsv}>
            Ekspor CSV agregat
          </Button>
          <Button fullWidth={false} onClick={openCreate}>
            Buat voucher
          </Button>
        </div>
      </div>

      {error && !loading ? (
        <ErrorCard message={error} onRetry={() => load(page, statusFilter, search)} />
      ) : (
        <>
          <DataTable<VoucherRow>
            columns={[
              {
                key: "code",
                header: "Kode",
                render: (r) => (
                  <div>
                    <Link
                      href={`/vouchers/${encodeURIComponent(r.voucherId ?? r.id)}`}
                      className="font-mono text-[13px] font-semibold text-primary hover:underline"
                    >
                      {r.code}
                    </Link>
                    <p className="text-caption text-text-secondary">{r.name}</p>
                    <p className="text-caption text-text-tertiary">{voucherTypeLabel(r.voucherType)}</p>
                  </div>
                ),
              },
              {
                key: "nominal",
                header: "Nominal",
                render: (r) => voucherValueLabel(r),
              },
              {
                key: "quota",
                header: "Kuota",
                align: "right",
                render: (r) => (
                  <div className="flex flex-col items-end gap-1">
                    <span>
                      {r.maxUsageTotal != null ? formatNumber(r.maxUsageTotal) : "Tanpa batas"}
                    </span>
                    {quotaAlarm(r)}
                  </div>
                ),
              },
              {
                key: "used",
                header: "Terpakai",
                align: "right",
                render: (r) => formatNumber(r.usageCount ?? 0),
              },
              {
                key: "status",
                header: "Status",
                render: (r) => {
                  const expired = isExpiredVoucher(r)
                  if (!r.isActive)
                    return <Badge tone="neutral" dot>Nonaktif</Badge>
                  if (expired)
                    return <Badge tone="danger" dot>Kedaluwarsa</Badge>
                  return <Badge tone="success" dot>Aktif</Badge>
                },
              },
              {
                key: "validUntil",
                header: "Kedaluwarsa",
                render: (r) => formatDateTimeWIB(r.validUntil),
              },
              {
                key: "action",
                header: "",
                align: "right",
                render: (r) => (
                  <div className="flex justify-end gap-2">
                    <Link href={`/vouchers/${encodeURIComponent(r.voucherId ?? r.id)}`}>
                      <Button variant="secondary" size="sm" fullWidth={false}>
                        Detail
                      </Button>
                    </Link>
                    {r.isActive ? (
                      <Button
                        variant="destructive"
                        size="sm"
                        fullWidth={false}
                        onClick={() => openDeactivate(r)}
                      >
                        Nonaktifkan
                      </Button>
                    ) : !isExpiredVoucher(r) ? (
                      <Button
                        variant="secondary"
                        size="sm"
                        fullWidth={false}
                        onClick={() => openReactivate(r)}
                        title="Aktifkan kembali voucher yang dinonaktifkan."
                      >
                        Aktifkan kembali
                      </Button>
                    ) : null}
                  </div>
                ),
              },
            ]}
            rows={rows as VoucherRow[]}
            rowKey={(r) => r.id}
            loading={loading}
            emptyText="Belum ada voucher. Buat voucher baru untuk mulai memberi diskon."
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

      <Dialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        title="Buat voucher baru"
        description="Voucher aktif langsung bisa dipakai pengguna sesuai masa berlaku."
      >
        <VoucherForm
          key="new-voucher"
          onSubmit={handleCreate}
          submitting={creating}
        />
      </Dialog>

      <ConfirmDialog
        open={deactivating != null}
        onClose={() => setDeactivating(null)}
        title="Nonaktifkan voucher?"
        description={
          deactivating
            ? `Voucher ${deactivating.code} tidak bisa lagi dipakai pengguna. Voucher dapat diaktifkan kembali selama masih dalam masa berlaku.`
            : undefined
        }
        confirmLabel="Nonaktifkan"
        onConfirm={handleDeactivate}
        loading={deactivatingNow}
        destructive
      />

      {/* ADM-218: konfirmasi reaktivasi voucher nonaktif */}
      <ConfirmDialog
        open={reactivating != null}
        onClose={() => setReactivating(null)}
        title="Aktifkan kembali voucher?"
        description={
          reactivating
            ? `Voucher ${reactivating.code} akan bisa dipakai pengguna lagi sesuai masa berlaku yang tersisa.`
            : undefined
        }
        confirmLabel="Aktifkan kembali"
        onConfirm={handleReactivate}
        loading={reactivatingNow}
      />
    </div>
  )
}
/* ------------------------------------------------------------------ */
/* Form kampanye                                                        */
/* ------------------------------------------------------------------ */

function CampaignForm({
  onSubmit,
  submitting,
}: {
  onSubmit: (input: CreateCampaignInput) => Promise<void>
  submitting: boolean
}) {
  const [name, setName] = useState("")
  const [description, setDescription] = useState("")
  const [type, setType] = useState<AdminCampaignType>("FEE_PROMO")
  const [startsAt, setStartsAt] = useState("")
  const [endsAt, setEndsAt] = useState("")
  const [promoCode, setPromoCode] = useState("")
  const [discountValue, setDiscountValue] = useState("")
  const [discountPercent, setDiscountPercent] = useState("")
  const [maxDiscount, setMaxDiscount] = useState("")
  const [targetAudience, setTargetAudience] = useState("")
  const [targetMinRank, setTargetMinRank] = useState<"" | AdminMembershipRank>("")
  const [targetDormantDays, setTargetDormantDays] = useState("")
  const [targetNewUserOnly, setTargetNewUserOnly] = useState(false)
  const [maxRedemptions, setMaxRedemptions] = useState("")
  const [rolloutPercent, setRolloutPercent] = useState("")
  const [formError, setFormError] = useState<string | null>(null)

  async function handleSubmit() {
    setFormError(null)
    if (name.trim().length < 3) {
      setFormError("Nama kampanye minimal 3 karakter.")
      return
    }
    const start = dayToISO(startsAt, false)
    const end = dayToISO(endsAt, true)
    if (!start || !end) {
      setFormError("Tanggal mulai/selesai wajib diisi (format tanggal valid).")
      return
    }
    if (new Date(end) <= new Date(start)) {
      setFormError("Tanggal selesai harus setelah tanggal mulai.")
      return
    }
    const input: CreateCampaignInput = {
      name: name.trim(),
      type,
      startsAt: start,
      endsAt: end,
      targetNewUserOnly,
    }
    if (description.trim()) input.description = description.trim()
    if (promoCode.trim()) input.promoCode = promoCode.trim().toUpperCase()
    const dv = parseIntInput(discountValue)
    if (dv !== undefined) input.discountValue = dv
    const dp = parseNumberInput(discountPercent)
    if (dp !== undefined) input.discountPercent = dp
    const md = parseIntInput(maxDiscount)
    if (md !== undefined) input.maxDiscount = md
    if (targetAudience.trim()) input.targetAudience = targetAudience.trim()
    if (targetMinRank) input.targetMinRank = targetMinRank
    const dd = parseIntInput(targetDormantDays)
    if (dd !== undefined) input.targetDormantDays = dd
    const mr = parseIntInput(maxRedemptions)
    if (mr !== undefined) input.maxRedemptions = mr
    const rp = parseIntInput(rolloutPercent)
    if (rp !== undefined) input.rolloutPercent = rp
    try {
      await onSubmit(input)
    } catch (e) {
      setFormError(userMessage(e))
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {formError ? (
        <p role="alert" className="text-body text-danger-text">
          {formError}
        </p>
      ) : null}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Input
          label="Nama kampanye"
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={100}
          required
        />
        <Select
          label="Tipe kampanye"
          value={type}
          onChange={(e) => setType(e.target.value as AdminCampaignType)}
          options={CAMPAIGN_TYPES.map((t) => ({ value: t.value, label: t.label }))}
        />
      </div>
      <TextArea
        label="Deskripsi"
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        maxLength={1000}
        rows={2}
      />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Input
          label="Mulai"
          type="date"
          value={startsAt}
          onChange={(e) => setStartsAt(e.target.value)}
          required
        />
        <Input
          label="Selesai"
          type="date"
          value={endsAt}
          onChange={(e) => setEndsAt(e.target.value)}
          required
        />
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Input
          label="Kode promo (opsional)"
          value={promoCode}
          onChange={(e) => setPromoCode(e.target.value)}
          maxLength={32}
          placeholder="cth. PROMOQ3"
        />
        <Input
          label="Label audiens (opsional)"
          value={targetAudience}
          onChange={(e) => setTargetAudience(e.target.value)}
          maxLength={500}
          placeholder="cth. Pengguna tidak aktif 30 hari"
        />
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Input
          label="Diskon (Rp)"
          value={discountValue}
          onChange={(e) => setDiscountValue(e.target.value)}
          inputMode="numeric"
        />
        <Input
          label="Diskon (%)"
          value={discountPercent}
          onChange={(e) => setDiscountPercent(e.target.value)}
          inputMode="decimal"
        />
        <Input
          label="Maks. diskon (Rp)"
          value={maxDiscount}
          onChange={(e) => setMaxDiscount(e.target.value)}
          inputMode="numeric"
        />
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Select
          label="Rank minimum (opsional)"
          value={targetMinRank}
          onChange={(e) => setTargetMinRank(e.target.value as "" | AdminMembershipRank)}
          options={[
            { value: "", label: "Tanpa batas rank" },
            ...MEMBERSHIP_RANKS.map((r) => ({ value: r.value, label: r.label })),
          ]}
        />
        <Input
          label="Tidak aktif (hari)"
          value={targetDormantDays}
          onChange={(e) => setTargetDormantDays(e.target.value)}
          inputMode="numeric"
          hint="Target pengguna tidak aktif minimal sekian hari."
        />
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Input
          label="Maks. penukaran"
          value={maxRedemptions}
          onChange={(e) => setMaxRedemptions(e.target.value)}
          inputMode="numeric"
          hint="Kosongkan untuk tanpa batas."
        />
        <Input
          label="Rollout (%)"
          value={rolloutPercent}
          onChange={(e) => setRolloutPercent(e.target.value)}
          inputMode="numeric"
          hint="Hanya bisa dinaikkan, tidak bisa diturunkan."
        />
      </div>
      <label className="flex cursor-pointer select-none items-center gap-2.5">
        <input
          type="checkbox"
          checked={targetNewUserOnly}
          onChange={(e) => setTargetNewUserOnly(e.target.checked)}
          className="h-4 w-4 accent-primary"
        />
        <span className="text-body text-text-primary">Hanya pengguna baru</span>
      </label>
      <Button loading={submitting} onClick={handleSubmit}>
        Buat kampanye
      </Button>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Tab kampanye — diekspor agar dipakai ulang halaman /campaigns        */
/* ------------------------------------------------------------------ */

export function CampaignsTab() {
  const toast = useToast()
  const router = useRouter()
  const [page, setPage] = useState(1)
  const [statusFilter, setStatusFilter] = useState<"" | AdminCampaignStatus>("")
  const [creatorFilter, setCreatorFilter] = useState("")
  const [startsFromFilter, setStartsFromFilter] = useState("")
  const [startsToFilter, setStartsToFilter] = useState("")
  const [rows, setRows] = useState<AdminCampaignItem[]>([])
  const [total, setTotal] = useState(0)
  const [totalPages, setTotalPages] = useState(1)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [createOpen, setCreateOpen] = useState(false)
  const [creating, setCreating] = useState(false)
  const [confirm, setConfirm] = useState<
    { kind: "activate" | "pause"; item: AdminCampaignItem } | null
  >(null)
  // BAI-007: backend activate/pause mewajibkan { reason } (min 5 char).
  const [confirmReason, setConfirmReason] = useState("")
  const [confirming, setConfirming] = useState(false)
  const [duplicateTarget, setDuplicateTarget] = useState<AdminCampaignItem | null>(null)
  const [duplicating, setDuplicating] = useState(false)

  interface CampaignFilters {
    status: "" | AdminCampaignStatus
    creator: string
    startsFrom: string
    startsTo: string
  }

  const filters: CampaignFilters = {
    status: statusFilter,
    creator: creatorFilter.trim(),
    startsFrom: startsFromFilter,
    startsTo: startsToFilter,
  }

  /** Filter client-side atas baris yang dimuat (fallback bila backend belum mendukung param). */
  function applyLocalFilters(all: AdminCampaignItem[], f: CampaignFilters): AdminCampaignItem[] {
    return all.filter((r) => {
      if (f.creator) {
        const hay = `${r.createdByName ?? ""} ${r.createdBy ?? ""}`.toLowerCase()
        if (!hay.includes(f.creator.toLowerCase())) return false
      }
      if (f.startsFrom) {
        const from = new Date(`${f.startsFrom}T00:00:00`).getTime()
        if (Number.isNaN(new Date(r.startsAt).getTime()) || new Date(r.startsAt).getTime() < from)
          return false
      }
      if (f.startsTo) {
        const to = new Date(`${f.startsTo}T23:59:59`).getTime()
        if (Number.isNaN(new Date(r.startsAt).getTime()) || new Date(r.startsAt).getTime() > to)
          return false
      }
      return true
    })
  }

  const load = useCallback(
    async (targetPage: number, f: CampaignFilters) => {
      setLoading(true)
      setError(null)
      try {
        const res: Paginated<AdminCampaignItem> = await listCampaigns({
          page: targetPage,
          limit: PAGE_SIZE,
          status: f.status === "" ? undefined : f.status,
          createdBy: f.creator || undefined,
          from: f.startsFrom || undefined,
          to: f.startsTo || undefined,
        })
        const filtered = applyLocalFilters(res.data ?? [], f)
        setRows(filtered)
        // Bila filter lokal aktif, total mencerminkan hasil filter pada halaman ini.
        const localActive = Boolean(f.creator || f.startsFrom || f.startsTo)
        const t = localActive ? filtered.length : (res.total ?? filtered.length)
        setTotal(t)
        setTotalPages(localActive ? 1 : (res.totalPages ?? Math.max(1, Math.ceil(t / PAGE_SIZE))))
        setPage(targetPage)
      } catch (e) {
        const msg = userMessage(e)
        setError(msg)
        toast.show({ title: "Gagal memuat kampanye", description: msg, tone: "danger" })
      } finally {
        setLoading(false)
      }
    },
    [toast],
  )

  useEffect(() => {
    void load(1, filters)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load, statusFilter, creatorFilter, startsFromFilter, startsToFilter])

  async function handleCreate(input: CreateCampaignInput) {
    setCreating(true)
    try {
      await createCampaign(input)
      setCreateOpen(false)
      toast.show({ title: "Kampanye dibuat.", tone: "success" })
      void load(1, filters)
    } finally {
      setCreating(false)
    }
  }

  async function handleDuplicate() {
    if (!duplicateTarget) return
    const id = campaignKey(duplicateTarget)
    setDuplicating(true)
    try {
      const dup = await duplicateCampaign(id)
      setDuplicateTarget(null)
      toast.show({ title: "Kampanye diduplikasi ke draf.", tone: "success" })
      void load(1, filters)
      router.push(`/campaigns/${encodeURIComponent(campaignKey(dup))}`)
    } catch (e) {
      toast.show({ title: "Gagal menduplikasi kampanye", description: userMessage(e), tone: "danger" })
      setDuplicateTarget(null)
    } finally {
      setDuplicating(false)
    }
  }

  async function handleConfirm() {
    if (!confirm) return
    // BAI-007: backend activate/pause mewajibkan { reason } (min 5 char).
    const reason = confirmReason.trim()
    if (reason.length < 5) {
      toast.show({ title: "Alasan wajib diisi (minimal 5 karakter)", tone: "danger" })
      return
    }
    const id = campaignKey(confirm.item)
    setConfirming(true)
    try {
      if (confirm.kind === "activate") {
        const res = await activateCampaign(id, reason)
        const issued = res.voucherIssuance?.issued
        toast.show({
          title: "Kampanye diaktifkan.",
          description:
            issued != null ? `${formatNumber(issued)} voucher personal diterbitkan.` : undefined,
          tone: "success",
        })
      } else {
        await pauseCampaign(id, reason)
        toast.show({ title: "Kampanye dijeda.", tone: "success" })
      }
      setConfirm(null)
      setConfirmReason("")
      void load(page, filters)
    } catch (e) {
      toast.show({
        title: confirm.kind === "activate" ? "Gagal mengaktifkan kampanye" : "Gagal menjeda kampanye",
        description: userMessage(e),
        tone: "danger",
      })
    } finally {
      setConfirming(false)
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-wrap items-end gap-3">
          <Select
            label="Filter status"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as "" | AdminCampaignStatus)}
            options={[
              { value: "", label: "Semua status" },
              ...CAMPAIGN_STATUSES.map((s) => ({ value: s.value, label: s.label })),
            ]}
            className="w-44"
          />
          <Input
            label="Filter pembuat"
            value={creatorFilter}
            onChange={(e) => setCreatorFilter(e.target.value)}
            placeholder="cth. admin@kahade.id"
            className="w-56"
          />
          <Input
            label="Mulai dari"
            type="date"
            value={startsFromFilter}
            onChange={(e) => setStartsFromFilter(e.target.value)}
            className="w-44"
          />
          <Input
            label="Mulai sampai"
            type="date"
            value={startsToFilter}
            onChange={(e) => setStartsToFilter(e.target.value)}
            className="w-44"
          />
        </div>
        <Button fullWidth={false} onClick={() => setCreateOpen(true)}>
          Buat kampanye
        </Button>
      </div>

      {error && !loading ? (
        <ErrorCard message={error} onRetry={() => load(page, filters)} />
      ) : (
        <>
          <DataTable<CampaignRow>
            columns={[
              {
                key: "name",
                header: "Kampanye",
                render: (r) => (
                  <div>
                    <Link
                      href={`/campaigns/${encodeURIComponent(campaignKey(r))}`}
                      className="font-semibold text-primary hover:underline"
                    >
                      {r.name}
                    </Link>
                    <p className="text-caption text-text-secondary">
                      {campaignTypeLabel(r.type)}
                      {r.promoCode ? ` · ${r.promoCode}` : ""}
                    </p>
                  </div>
                ),
              },
              {
                key: "status",
                header: "Status",
                render: (r) => (
                  <Badge tone={campaignStatusTone(r.status)} dot>
                    {campaignStatusLabel(r.status)}
                  </Badge>
                ),
              },
              {
                key: "period",
                header: "Periode",
                render: (r) => (
                  <span className="whitespace-nowrap">
                    {formatDateTimeWIB(r.startsAt)} — {formatDateTimeWIB(r.endsAt)}
                  </span>
                ),
              },
              {
                key: "redemptions",
                header: "Penukaran",
                align: "right",
                render: (r) =>
                  r.maxRedemptions != null
                    ? `${formatNumber(r.currentRedemptions ?? 0)} / ${formatNumber(r.maxRedemptions)}`
                    : formatNumber(r.currentRedemptions ?? 0),
              },
              {
                key: "action",
                header: "",
                align: "right",
                render: (r) => {
                  const canActivate = r.status === "DRAFT" || r.status === "PAUSED"
                  const canPause = r.status === "ACTIVE"
                  return (
                    <div className="flex justify-end gap-2">
                      <Link href={`/campaigns/${encodeURIComponent(campaignKey(r))}`}>
                        <Button variant="secondary" size="sm" fullWidth={false}>
                          Detail
                        </Button>
                      </Link>
                      <Button
                        variant="secondary"
                        size="sm"
                        fullWidth={false}
                        onClick={() => setDuplicateTarget(r)}
                        title="Duplikasi kampanye ke draf baru"
                      >
                        Duplikasi
                      </Button>
                      {canActivate ? (
                        <Button
                          size="sm"
                          fullWidth={false}
                          onClick={() => {
                            setConfirmReason("")
                            setConfirm({ kind: "activate", item: r })
                          }}
                        >
                          Aktifkan
                        </Button>
                      ) : null}
                      {canPause ? (
                        <Button
                          variant="secondary"
                          size="sm"
                          fullWidth={false}
                          onClick={() => {
                            setConfirmReason("")
                            setConfirm({ kind: "pause", item: r })
                          }}
                        >
                          Jeda
                        </Button>
                      ) : null}
                    </div>
                  )
                },
              },
            ]}
            rows={rows as CampaignRow[]}
            rowKey={(r) => campaignKey(r)}
            loading={loading}
            emptyText="Belum ada kampanye. Buat kampanye untuk menerbitkan voucher personal."
          />
          <Pagination
            page={page}
            totalPages={totalPages}
            total={total}
            pageSize={PAGE_SIZE}
            onPageChange={(p) => load(p, filters)}
            disabled={loading}
          />
        </>
      )}

      <Dialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        title="Buat kampanye baru"
        description="Kampanye dibuat sebagai draf — aktifkan untuk menerbitkan voucher personal."
      >
        <CampaignForm
          key="new-campaign"
          onSubmit={handleCreate}
          submitting={creating}
        />
      </Dialog>

      {/* BAI-007: alasan wajib (min 5 char) untuk aktifkan/jeda kampanye */}
      <Dialog
        open={confirm != null}
        onClose={() => setConfirm(null)}
        title={confirm?.kind === "activate" ? "Aktifkan kampanye?" : "Jeda kampanye?"}
        description={
          confirm
            ? confirm.kind === "activate"
              ? `Mengaktifkan "${confirm.item.name}" akan menerbitkan voucher personal kepada pengguna yang memenuhi syarat. Lanjutkan?`
              : `Kampanye "${confirm.item.name}" akan dijeda — voucher personal baru tidak diterbitkan.`
            : undefined
        }
        footer={
          <div className="flex flex-col gap-2">
            <Button
              variant="primary"
              loading={confirming}
              disabled={confirmReason.trim().length < 5}
              onClick={handleConfirm}
            >
              {confirm?.kind === "activate" ? "Aktifkan" : "Jeda"}
            </Button>
            <Button variant="ghost" disabled={confirming} onClick={() => setConfirm(null)}>
              Batal
            </Button>
          </div>
        }
      >
        <TextArea
          label="Alasan (wajib, min. 5 karakter)"
          rows={3}
          value={confirmReason}
          onChange={(e) => setConfirmReason(e.target.value)}
          placeholder="Tulis alasan perubahan status kampanye…"
          maxLength={1000}
          error={
            confirmReason.length > 0 && confirmReason.trim().length < 5
              ? "Minimal 5 karakter"
              : undefined
          }
        />
      </Dialog>

      <ConfirmDialog
        open={duplicateTarget != null}
        onClose={() => setDuplicateTarget(null)}
        title="Duplikasi kampanye?"
        description={
          duplicateTarget
            ? `Buat draf kampanye baru dari "${duplicateTarget.name}" dengan pengaturan yang sama.`
            : undefined
        }
        confirmLabel="Duplikasi"
        onConfirm={handleDuplicate}
        loading={duplicating}
      />
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Halaman                                                             */
/* ------------------------------------------------------------------ */

type Tab = "voucher" | "kampanye"

function VouchersPageContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const tab: Tab = searchParams.get("tab") === "kampanye" ? "kampanye" : "voucher"

  function setTab(t: Tab) {
    router.replace(`?tab=${t}`, { scroll: false })
  }

  const tabs: { value: Tab; label: string }[] = [
    { value: "voucher", label: "Voucher" },
    { value: "kampanye", label: "Kampanye" },
  ]

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-h2 font-semibold text-text-primary">Voucher &amp; Kampanye</h1>
        <p className="mt-1 text-body text-text-secondary">
          Kelola voucher diskon dan kampanye penerbitan voucher personal.
        </p>
      </div>

      <div
        role="tablist"
        aria-label="Tab voucher dan kampanye"
        className="flex w-full max-w-md gap-1 rounded-sm border border-border bg-surface p-1"
      >
        {tabs.map((t) => (
          <button
            key={t.value}
            type="button"
            role="tab"
            aria-selected={tab === t.value}
            onClick={() => setTab(t.value)}
            className={cn(
              "flex-1 rounded-xs px-4 py-2 text-body font-semibold transition-colors",
              tab === t.value
                ? "bg-primary text-primary-foreground"
                : "text-text-secondary hover:text-text-primary",
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "voucher" ? <VouchersTab /> : <CampaignsTab />}
    </div>
  )
}

export default function VouchersPage() {
  return (
    <RoleGate href="/vouchers">
      <Suspense>
        <VouchersPageContent />
      </Suspense>
    </RoleGate>
  )
}
