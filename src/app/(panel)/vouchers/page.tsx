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
import { formatDateTimeWIB, formatNumber } from "@/lib/format"
import { userMessage } from "@/lib/api/response"
import type { Paginated } from "@/lib/api/admin/kyc"
import {
  listVouchers,
  createVoucher,
  deactivateVoucher,
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
  type AdminCampaignItem,
  type AdminCampaignType,
  type AdminCampaignStatus,
  type AdminMembershipRank,
  type CreateCampaignInput,
} from "@/lib/api/admin/campaigns"

const PAGE_SIZE = 20

const idr = new Intl.NumberFormat("id-ID", {
  style: "currency",
  currency: "IDR",
  maximumFractionDigits: 0,
})

function formatIDR(value: number | null | undefined): string {
  return value == null ? "—" : idr.format(value)
}

function parseIntInput(input: string): number | undefined {
  const t = input.trim()
  if (!t) return undefined
  const n = Number.parseInt(t, 10)
  return Number.isFinite(n) ? n : undefined
}

function parseNumberInput(input: string): number | undefined {
  const t = input.trim().replace(",", ".")
  if (!t) return undefined
  const n = Number(t)
  return Number.isFinite(n) ? n : undefined
}

/** "YYYY-MM-DD" (native date input) → ISO; endOfDay untuk batas akhir. */
function dayToISO(day: string, endOfDay: boolean): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return null
  const d = new Date(`${day}T${endOfDay ? "23:59:59" : "00:00:00"}`)
  if (Number.isNaN(d.getTime())) return null
  return d.toISOString()
}

const VOUCHER_TYPES: { value: AdminVoucherType; label: string }[] = [
  { value: "FEE_DISCOUNT_FLAT", label: "Diskon fee (nominal)" },
  { value: "FEE_DISCOUNT_PERCENT", label: "Diskon fee (persen)" },
  { value: "WALLET_CASHBACK", label: "Cashback wallet" },
  { value: "TOPUP_BONUS", label: "Bonus top-up" },
]

const VOUCHER_APPLICABILITIES: { value: AdminVoucherApplicability; label: string }[] = [
  { value: "ALL", label: "Semua" },
  { value: "BUYER_ONLY", label: "Pembeli saja" },
  { value: "SELLER_ONLY", label: "Penjual saja" },
  { value: "NEW_USER", label: "Pengguna baru" },
  { value: "DORMANT_USER", label: "Pengguna dormant" },
]

const CAMPAIGN_TYPES: { value: AdminCampaignType; label: string }[] = [
  { value: "FEE_PROMO", label: "Promo fee" },
  { value: "SUBSCRIPTION_DISCOUNT", label: "Diskon langganan" },
  { value: "CASHBACK", label: "Cashback" },
]

const CAMPAIGN_STATUSES: { value: AdminCampaignStatus; label: string }[] = [
  { value: "DRAFT", label: "Draf" },
  { value: "ACTIVE", label: "Aktif" },
  { value: "PAUSED", label: "Dijeda" },
  { value: "ENDED", label: "Selesai" },
]

const MEMBERSHIP_RANKS: { value: AdminMembershipRank; label: string }[] = [
  { value: "BRONZE", label: "Bronze" },
  { value: "SILVER", label: "Silver" },
  { value: "GOLD", label: "Gold" },
  { value: "PLATINUM", label: "Platinum" },
  { value: "DIAMOND", label: "Diamond" },
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

function campaignStatusTone(
  status: AdminCampaignStatus,
): "neutral" | "success" | "warning" | "info" {
  switch (status) {
    case "ACTIVE":
      return "success"
    case "PAUSED":
      return "warning"
    case "ENDED":
      return "neutral"
    default:
      return "info"
  }
}

function campaignStatusLabel(status: AdminCampaignStatus): string {
  return CAMPAIGN_STATUSES.find((s) => s.value === status)?.label ?? status
}

function campaignKey(c: AdminCampaignItem): string {
  return c.campaignId || c.id || ""
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
  const [rows, setRows] = useState<AdminVoucherItem[]>([])
  const [total, setTotal] = useState(0)
  const [totalPages, setTotalPages] = useState(1)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [createOpen, setCreateOpen] = useState(false)
  const [creating, setCreating] = useState(false)
  const [deactivating, setDeactivating] = useState<AdminVoucherItem | null>(null)
  const [deactivatingNow, setDeactivatingNow] = useState(false)

  const load = useCallback(
    async (targetPage: number, targetFilter: "all" | "true" | "false") => {
      setLoading(true)
      setError(null)
      try {
        const res: Paginated<AdminVoucherItem> = await listVouchers({
          page: targetPage,
          limit: PAGE_SIZE,
          isActive: targetFilter === "all" ? undefined : targetFilter,
        })
        setRows(res.data ?? [])
        const t = res.meta?.total ?? res.total ?? res.data?.length ?? 0
        setTotal(t)
        setTotalPages(res.meta?.totalPages ?? Math.max(1, Math.ceil(t / PAGE_SIZE)))
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
    void load(1, statusFilter)
  }, [load, statusFilter])

  async function handleCreate(input: CreateVoucherInput) {
    setCreating(true)
    try {
      await createVoucher(input)
      setCreateOpen(false)
      toast.show({ title: "Voucher dibuat.", tone: "success" })
      void load(1, statusFilter)
    } finally {
      setCreating(false)
    }
  }

  async function handleDeactivate() {
    if (!deactivating) return
    setDeactivatingNow(true)
    try {
      await deactivateVoucher(deactivating.voucherId ?? deactivating.id)
      setDeactivating(null)
      toast.show({ title: "Voucher dinonaktifkan.", tone: "success" })
      void load(page, statusFilter)
    } catch (e) {
      toast.show({ title: "Gagal menonaktifkan voucher", description: userMessage(e), tone: "danger" })
    } finally {
      setDeactivatingNow(false)
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Select
          label="Filter status"
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as "all" | "true" | "false")}
          options={[
            { value: "all", label: "Semua status" },
            { value: "true", label: "Aktif" },
            { value: "false", label: "Nonaktif" },
          ]}
          className="w-56"
        />
        <Button fullWidth={false} onClick={() => setCreateOpen(true)}>
          Buat voucher
        </Button>
      </div>

      {error && !loading ? (
        <ErrorCard message={error} onRetry={() => load(page, statusFilter)} />
      ) : (
        <>
          <DataTable<VoucherRow>
            columns={[
              {
                key: "code",
                header: "Kode",
                render: (r) => (
                  <div>
                    <p className="font-mono text-[13px] font-semibold">{r.code}</p>
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
                render: (r) =>
                  r.maxUsageTotal != null ? formatNumber(r.maxUsageTotal) : "Tanpa batas",
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
                render: (r) =>
                  r.isActive ? (
                    <Button
                      variant="destructive"
                      size="sm"
                      fullWidth={false}
                      onClick={() => setDeactivating(r)}
                    >
                      Nonaktifkan
                    </Button>
                  ) : (
                    <span className="text-caption text-text-tertiary">—</span>
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
            onPageChange={(p) => load(p, statusFilter)}
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
            ? `Voucher ${deactivating.code} tidak bisa lagi dipakai pengguna. Tindakan ini tidak dapat dibatalkan.`
            : undefined
        }
        confirmLabel="Nonaktifkan"
        onConfirm={handleDeactivate}
        loading={deactivatingNow}
        destructive
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
          placeholder="cth. Pengguna dormant 30 hari"
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
          label="Dormant (hari)"
          value={targetDormantDays}
          onChange={(e) => setTargetDormantDays(e.target.value)}
          inputMode="numeric"
          hint="Target pengguna dormant minimal sekian hari."
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
  const [page, setPage] = useState(1)
  const [statusFilter, setStatusFilter] = useState<"" | AdminCampaignStatus>("")
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
  const [confirming, setConfirming] = useState(false)

  const load = useCallback(
    async (targetPage: number, targetFilter: "" | AdminCampaignStatus) => {
      setLoading(true)
      setError(null)
      try {
        const res: Paginated<AdminCampaignItem> = await listCampaigns({
          page: targetPage,
          limit: PAGE_SIZE,
          status: targetFilter === "" ? undefined : targetFilter,
        })
        setRows(res.data ?? [])
        const t = res.meta?.total ?? res.total ?? res.data?.length ?? 0
        setTotal(t)
        setTotalPages(res.meta?.totalPages ?? Math.max(1, Math.ceil(t / PAGE_SIZE)))
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
    void load(1, statusFilter)
  }, [load, statusFilter])

  async function handleCreate(input: CreateCampaignInput) {
    setCreating(true)
    try {
      await createCampaign(input)
      setCreateOpen(false)
      toast.show({ title: "Kampanye dibuat.", tone: "success" })
      void load(1, statusFilter)
    } finally {
      setCreating(false)
    }
  }

  async function handleConfirm() {
    if (!confirm) return
    const id = campaignKey(confirm.item)
    setConfirming(true)
    try {
      if (confirm.kind === "activate") {
        const res = await activateCampaign(id)
        const issued = res.voucherIssuance?.issued
        toast.show({
          title: "Kampanye diaktifkan.",
          description:
            issued != null ? `${formatNumber(issued)} voucher personal diterbitkan.` : undefined,
          tone: "success",
        })
      } else {
        await pauseCampaign(id)
        toast.show({ title: "Kampanye dijeda.", tone: "success" })
      }
      setConfirm(null)
      void load(page, statusFilter)
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
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Select
          label="Filter status"
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as "" | AdminCampaignStatus)}
          options={[
            { value: "", label: "Semua status" },
            ...CAMPAIGN_STATUSES.map((s) => ({ value: s.value, label: s.label })),
          ]}
          className="w-56"
        />
        <Button fullWidth={false} onClick={() => setCreateOpen(true)}>
          Buat kampanye
        </Button>
      </div>

      {error && !loading ? (
        <ErrorCard message={error} onRetry={() => load(page, statusFilter)} />
      ) : (
        <>
          <DataTable<CampaignRow>
            columns={[
              {
                key: "name",
                header: "Kampanye",
                render: (r) => (
                  <div>
                    <p className="font-semibold">{r.name}</p>
                    <p className="text-caption text-text-secondary">
                      {CAMPAIGN_TYPES.find((t) => t.value === r.type)?.label ?? r.type}
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
                  if (!canActivate && !canPause)
                    return <span className="text-caption text-text-tertiary">—</span>
                  return (
                    <div className="flex justify-end gap-2">
                      {canActivate ? (
                        <Button
                          size="sm"
                          fullWidth={false}
                          onClick={() => setConfirm({ kind: "activate", item: r })}
                        >
                          Aktifkan
                        </Button>
                      ) : null}
                      {canPause ? (
                        <Button
                          variant="secondary"
                          size="sm"
                          fullWidth={false}
                          onClick={() => setConfirm({ kind: "pause", item: r })}
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
            onPageChange={(p) => load(p, statusFilter)}
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

      <ConfirmDialog
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
        confirmLabel={confirm?.kind === "activate" ? "Aktifkan" : "Jeda"}
        onConfirm={handleConfirm}
        loading={confirming}
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
