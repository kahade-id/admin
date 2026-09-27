/**
 * Admin — Subscription Kahade+: daftar subscription + detail, pembatalan
 * dengan alasan, dan pemberian manual (grant).
 *
 * - Filter status (ACTIVE/EXPIRED/CANCELED) & plan (MONTHLY/YEARLY) +
 *   pencarian pengguna (server-side, kontrak ?search) + paginasi bernomor.
 * - Kolom "Detail" → halaman detail (plan, periode, sisa kuota fee periode
 *   berjalan, riwayat).
 * - Aksi "Batalkan" (hanya status ACTIVE/PENDING) via Dialog dengan alasan
 *   opsional → POST /:id/cancel {reason?}.
 * - Aksi "Beri manual" → Dialog form grant: cari pengguna → plan →
 *   durasi (hari) → alasan wajib → POST /subscriptions/grant.
 *
 * Kontrak backend (Kahade+, tetap):
 * GET /v1/admin/subscriptions?page&limit&status&search → {data, pagination}
 * POST /v1/admin/subscriptions/:id/cancel {reason?}
 * POST /v1/admin/subscriptions/grant {userId, plan, durationDays, reason}
 */
"use client"

import Link from "next/link"
import { useCallback, useEffect, useMemo, useState } from "react"

import { Badge, type BadgeTone } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { ConfirmDialog, Dialog } from "@/components/ui/dialog"
import { EmptyState } from "@/components/ui/empty-state"
import { Input, TextArea } from "@/components/ui/input"
import { Spinner } from "@/components/ui/spinner"
import { DataTable } from "@/components/ui/table"
import { useToast } from "@/components/ui/toast"
import { Pagination } from "@/components/admin/pagination"
import { RoleGate } from "@/components/admin/role-gate"
import { Select } from "@/components/admin/select"
import {
  cancelSubscription,
  createPromoCode,
  disablePromoCode,
  enablePromoCode,
  grantSubscription,
  listPromoCodes,
  listSubscriptions,
  type PromoCode,
  type SubscriptionItem,
  type SubscriptionPlan,
} from "@/lib/api/admin/subscriptions"
import { listAdminUsers, type AdminUserSummary } from "@/lib/api/admin/users"
import type { Paginated } from "@/lib/api/admin/kyc"
import { userMessage } from "@/lib/api/response"
import { formatDateTimeWIB } from "@/lib/format"
// ADM-405: email pengguna di-mask secara default (mask-only, tanpa unmask).
import { maskEmail } from "@/lib/pii"

const PAGE_SIZE = 20
const SEARCH_DEBOUNCE_MS = 400
const USER_SEARCH_DEBOUNCE_MS = 300
const USER_SEARCH_LIMIT = 8

type StatusFilter = "all" | "ACTIVE" | "EXPIRED" | "CANCELLED"
type PlanFilter = "all" | "MONTHLY" | "YEARLY"

const STATUS_OPTIONS = [
  { value: "all", label: "Semua status" },
  { value: "ACTIVE", label: "Aktif" },
  { value: "EXPIRED", label: "Kedaluwarsa" },
  // SP-026: backend hanya menerima enum Prisma `CANCELLED` (2 L) — nilai
  // `CANCELED` (1 L) me-return 400 INVALID_STATUS. Pakai nilai kanonis.
  { value: "CANCELLED", label: "Dibatalkan" },
]

const PLAN_OPTIONS = [
  { value: "all", label: "Semua plan" },
  { value: "MONTHLY", label: "Bulanan" },
  { value: "YEARLY", label: "Tahunan" },
]

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

/** Status yang boleh dibatalkan paksa (aturan backend: 400 untuk lainnya). */
const CANCELLABLE: string[] = ["ACTIVE", "PENDING"]

function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs)
    return () => clearTimeout(timer)
  }, [value, delayMs])
  return debounced
}

/** "Rp1.234.567" — non-finite → "—". */
function formatRupiah(n: unknown): string {
  if (typeof n !== "number" || !Number.isFinite(n)) return "—"
  return `Rp${Math.trunc(n).toLocaleString("id-ID")}`
}

function userDisplay(s: SubscriptionItem): string {
  return s.user?.fullName ?? s.user?.username ?? "—"
}

function periodLabel(s: SubscriptionItem): string {
  if (!s.currentPeriodStart && !s.currentPeriodEnd) return "—"
  return `${formatDateTimeWIB(s.currentPeriodStart)} — ${formatDateTimeWIB(s.currentPeriodEnd)}`
}

function paginateTotal<T>(
  res: Paginated<T>,
  pageSize: number,
): { total: number; totalPages: number } {
  const total = res.total ?? res.data?.length ?? 0
  const totalPages = res.totalPages ?? Math.max(1, Math.ceil(total / pageSize))
  return { total, totalPages }
}

export default function SubscriptionsPage() {
  const toast = useToast()

  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [rows, setRows] = useState<SubscriptionItem[]>([])
  const [total, setTotal] = useState(0)
  const [totalPages, setTotalPages] = useState(1)
  const [page, setPage] = useState(1)

  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all")
  const [planFilter, setPlanFilter] = useState<PlanFilter>("all")
  const [search, setSearch] = useState("")
  const debouncedSearch = useDebouncedValue(search, SEARCH_DEBOUNCE_MS)

  const [cancelTarget, setCancelTarget] = useState<SubscriptionItem | null>(null)
  const [cancelReason, setCancelReason] = useState("")
  const [cancelling, setCancelling] = useState(false)

  const [grantOpen, setGrantOpen] = useState(false)
  // ADM-212: kelola kode promo langganan gratis
  const [promoOpen, setPromoOpen] = useState(false)

  const load = useCallback(
    async (
      mode: "initial" | "refresh" = "initial",
      targetPage = page,
      targetStatus = statusFilter,
      targetPlan = planFilter,
      targetSearch = debouncedSearch,
    ) => {
      if (mode === "initial") setLoading(true)
      else setRefreshing(true)
      setError(null)
      try {
        const res = await listSubscriptions({
          page: targetPage,
          limit: PAGE_SIZE,
          status: targetStatus === "all" ? undefined : targetStatus,
          search: targetSearch.trim() || undefined,
        })
        // Kontrak tidak menyediakan filter plan — saring lokal bila dipilih.
        const data = (res.data ?? []).filter((s) =>
          targetPlan === "all" ? true : String(s.plan) === targetPlan,
        )
        setRows(data)
        const { total: t, totalPages: tp } = paginateTotal(res, PAGE_SIZE)
        setTotal(t)
        setTotalPages(tp)
      } catch (e) {
        const msg = userMessage(e)
        setError(msg)
        toast.show({
          title: "Gagal memuat subscription",
          description: msg,
          tone: "danger",
        })
      } finally {
        setLoading(false)
        setRefreshing(false)
      }
    },
    [page, statusFilter, planFilter, debouncedSearch, toast],
  )

  useEffect(() => {
    void load("initial")
  }, [load])

  const handleStatusChange = (v: StatusFilter) => {
    setStatusFilter(v)
    setPage(1)
    void load("initial", 1, v, planFilter, debouncedSearch)
  }

  const handlePlanChange = (v: PlanFilter) => {
    setPlanFilter(v)
    setPage(1)
    void load("initial", 1, statusFilter, v, debouncedSearch)
  }

  const handlePageChange = (p: number) => {
    setPage(p)
    void load("initial", p, statusFilter, planFilter, debouncedSearch)
  }

  const closeCancel = useCallback(() => {
    if (cancelling) return
    setCancelTarget(null)
    setCancelReason("")
  }, [cancelling])

  const confirmCancel = useCallback(async () => {
    if (!cancelTarget || cancelling) return
    setCancelling(true)
    try {
      await cancelSubscription(cancelTarget.id, cancelReason)
      toast.show({
        title: "Subscription dibatalkan",
        description: userDisplay(cancelTarget),
        tone: "success",
      })
      setCancelTarget(null)
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
  }, [cancelTarget, cancelling, cancelReason, toast, load])

  const handleGranted = useCallback(() => {
    setGrantOpen(false)
    void load("refresh")
  }, [load])

  const showPlanFilterNote = useMemo(() => planFilter !== "all", [planFilter])

  return (
    <RoleGate href="/subscriptions">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-h2 font-bold text-text-primary">Subscription</h1>
          <p className="mt-1 text-body text-text-secondary">
            Langganan Kahade+ pengguna. Pembatalan paksa hanya untuk status
            Aktif/Menunggu dan tercatat di audit log.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="secondary"
            size="sm"
            fullWidth={false}
            loading={refreshing}
            onClick={() => load("refresh")}
          >
            Muat ulang
          </Button>
          <Button
            variant="primary"
            size="sm"
            fullWidth={false}
            onClick={() => setGrantOpen(true)}
          >
            Beri manual
          </Button>
          <Button
            variant="secondary"
            size="sm"
            fullWidth={false}
            onClick={() => setPromoOpen(true)}
          >
            Kode promo
          </Button>
        </div>
      </div>

      <div className="mb-4 flex flex-wrap items-end gap-3">
        <Select
          label="Status"
          options={STATUS_OPTIONS}
          value={statusFilter}
          onChange={(e) => handleStatusChange(e.target.value as StatusFilter)}
          className="w-52"
        />
        <Select
          label="Plan"
          options={PLAN_OPTIONS}
          value={planFilter}
          onChange={(e) => handlePlanChange(e.target.value as PlanFilter)}
          className="w-52"
        />
        <div className="min-w-64 flex-1">
          <Input
            label="Cari"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Nama pengguna, username, email…"
          />
        </div>
      </div>

      {loading ? (
        <div className="flex min-h-[40vh] items-center justify-center gap-2">
          <Spinner size="md" />
          <p className="text-body text-text-secondary">Memuat subscription…</p>
        </div>
      ) : error ? (
        <Card>
          <EmptyState
            title="Gagal memuat subscription"
            description={error}
            action={
              <Button
                variant="secondary"
                fullWidth={false}
                onClick={() => load("initial")}
              >
                Coba lagi
              </Button>
            }
          />
        </Card>
      ) : (
        <>
          <DataTable<SubscriptionItem>
            columns={[
              {
                key: "user",
                header: "Pengguna",
                render: (s) => (
                  <div className="min-w-44">
                    <p className="font-semibold">{userDisplay(s)}</p>
                    {s.user?.email ? (
                      <p className="text-caption text-text-secondary">
                        {maskEmail(s.user.email)}
                      </p>
                    ) : null}
                  </div>
                ),
              },
              {
                key: "plan",
                header: "Paket",
                render: (s) => (
                  <Badge tone="info">
                    {PLAN_LABEL[String(s.plan)] ?? String(s.plan ?? "—")}
                  </Badge>
                ),
              },
              {
                key: "status",
                header: "Status",
                render: (s) => (
                  <Badge tone={STATUS_TONE[String(s.status)] ?? "neutral"}>
                    {STATUS_LABEL[String(s.status)] ?? String(s.status ?? "—")}
                  </Badge>
                ),
              },
              {
                key: "price",
                header: "Harga",
                align: "right",
                render: (s) => (
                  <span className="whitespace-nowrap font-semibold">
                    {formatRupiah(s.price)}
                  </span>
                ),
              },
              {
                key: "period",
                header: "Periode",
                render: (s) => (
                  <span className="whitespace-nowrap">{periodLabel(s)}</span>
                ),
              },
              {
                key: "currentPeriodEnd",
                header: "Berakhir",
                render: (s) => (
                  <span className="whitespace-nowrap">
                    {formatDateTimeWIB(s.currentPeriodEnd)}
                  </span>
                ),
              },
              {
                key: "action",
                header: "",
                align: "right",
                render: (s) => {
                  const canCancel = CANCELLABLE.includes(String(s.status))
                  return (
                    <div className="flex items-center justify-end gap-2">
                      <Link
                        href={`/subscriptions/${s.id}`}
                        className="font-semibold text-info-text hover:underline"
                      >
                        Detail
                      </Link>
                      <Button
                        variant="destructive"
                        size="sm"
                        fullWidth={false}
                        disabled={!canCancel}
                        title={
                          canCancel
                            ? "Batalkan subscription ini"
                            : "Hanya subscription Aktif/Menunggu yang bisa dibatalkan"
                        }
                        onClick={() => setCancelTarget(s)}
                      >
                        Batalkan
                      </Button>
                    </div>
                  )
                },
              },
            ]}
            rows={rows}
            rowKey={(s) => s.id}
            emptyText={
              debouncedSearch.trim()
                ? "Tidak ada subscription yang cocok dengan pencarian."
                : "Tidak ada subscription pada filter ini."
            }
          />
          {showPlanFilterNote ? (
            <p className="mt-2 text-caption text-text-secondary">
              Filter plan diterapkan lokal pada halaman yang dimuat (kontrak
              daftar belum menyediakan parameter plan).
            </p>
          ) : null}
          <div className="mt-4">
            <Pagination
              page={page}
              totalPages={totalPages}
              total={total}
              pageSize={PAGE_SIZE}
              onPageChange={handlePageChange}
            />
          </div>
        </>
      )}

      {/* Batalkan dengan alasan */}
      <Dialog
        open={cancelTarget != null}
        onClose={closeCancel}
        title="Batalkan subscription?"
        description={
          cancelTarget
            ? `Subscription ${PLAN_LABEL[String(cancelTarget.plan)] ?? cancelTarget.plan ?? ""} milik ${userDisplay(cancelTarget)} akan dibatalkan segera. Tindakan ini tidak bisa dibatalkan.`
            : undefined
        }
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
            onClick={confirmCancel}
          >
            Ya, batalkan
          </Button>
          <Button variant="ghost" disabled={cancelling} onClick={closeCancel}>
            Batal
          </Button>
        </div>
      </Dialog>

      {/* Beri subscription manual */}
      <Dialog
        open={grantOpen}
        onClose={() => setGrantOpen(false)}
        title="Beri subscription manual"
        description="Berikan Kahade+ ke pengguna tanpa pembayaran. Alasan wajib diisi untuk audit."
      >
        <GrantForm key="grant-form" onDone={handleGranted} />
      </Dialog>

      {/* ADM-212: kelola kode promo langganan gratis */}
      <Dialog
        open={promoOpen}
        onClose={() => setPromoOpen(false)}
        title="Kode promo langganan"
        description="Buat kode promo durasi gratis (3/7/14/30 hari dst.), batasi pemakaian, atau nonaktifkan/aktifkan kembali. Setiap perubahan tercatat di audit log."
      >
        {promoOpen ? <PromoCodesPanel key="promo-panel" /> : null}
      </Dialog>
    </RoleGate>
  )
}

/* ------------------------------------------------------------------ */
/* Form grant                                                          */
/* ------------------------------------------------------------------ */

function grantUserLabel(u: AdminUserSummary): string {
  return [u.fullName?.trim(), u.username ? `@${u.username}` : null, u.email]
    .filter(Boolean)
    .join(" · ")
}

function GrantForm({ onDone }: { onDone: () => void }) {
  const toast = useToast()
  const [query, setQuery] = useState("")
  const debouncedQuery = useDebouncedValue(query, USER_SEARCH_DEBOUNCE_MS)
  const [searching, setSearching] = useState(false)
  const [candidates, setCandidates] = useState<AdminUserSummary[]>([])
  const [userId, setUserId] = useState("")
  const [plan, setPlan] = useState<SubscriptionPlan>("MONTHLY")
  const [durationDays, setDurationDays] = useState("30")
  const [reason, setReason] = useState("")
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    const q = debouncedQuery.trim()
    if (q.length < 2) {
      setCandidates([])
      return
    }
    let cancelled = false
    setSearching(true)
    listAdminUsers({ q, limit: USER_SEARCH_LIMIT })
      .then((res) => {
        if (!cancelled) setCandidates(res.data ?? [])
      })
      .catch(() => {
        if (!cancelled) setCandidates([])
      })
      .finally(() => {
        if (!cancelled) setSearching(false)
      })
    return () => {
      cancelled = true
    }
  }, [debouncedQuery])

  const duration = Number.parseInt(durationDays, 10)
  // ADM-224: batas UI 730 hari mengikuti @Max(730) backend; pratinjau wajib
  // sebelum eksekusi agar admin tidak mengisi 1000 hari lalu baru tahu saat 400.
  const durationTooLong = Number.isFinite(duration) && duration > 730
  const valid =
    userId.trim().length > 0 &&
    Number.isFinite(duration) &&
    duration >= 1 &&
    !durationTooLong &&
    reason.trim().length > 0

  const [confirmOpen, setConfirmOpen] = useState(false)
  const selectedUserLabel =
    candidates.find((u) => u.userId === userId)?.fullName?.trim() ||
    candidates.find((u) => u.userId === userId)?.username ||
    userId

  const handleSubmit = async () => {
    if (!valid || submitting) return
    setConfirmOpen(false)
    setSubmitting(true)
    try {
      await grantSubscription({
        userId: userId.trim(),
        plan,
        durationDays: duration,
        reason: reason.trim(),
      })
      toast.show({
        title: "Subscription diberikan",
        description: `Plan ${PLAN_LABEL[plan]} selama ${duration} hari.`,
        tone: "success",
      })
      onDone()
    } catch (e) {
      toast.show({
        title: "Gagal memberikan subscription",
        description: userMessage(e),
        tone: "danger",
      })
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <Input
          label="Cari pengguna"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Ketik minimal 2 huruf — nama, email, username…"
          disabled={submitting}
        />
        {searching ? (
          <p className="mt-2 flex items-center gap-2 text-caption text-text-secondary">
            <Spinner size="sm" /> Mencari pengguna…
          </p>
        ) : debouncedQuery.trim().length >= 2 && candidates.length === 0 ? (
          <p className="mt-2 text-caption text-text-secondary">
            Tidak ada pengguna yang cocok.
          </p>
        ) : null}
        {candidates.length > 0 ? (
          <div className="mt-2">
            <Select
              label="Pilih pengguna"
              value={userId}
              onChange={(e) => setUserId(e.target.value)}
              options={[
                { value: "", label: "— Pilih —" },
                ...candidates.map((u) => ({
                  value: u.userId,
                  label: grantUserLabel(u),
                })),
              ]}
              disabled={submitting}
            />
          </div>
        ) : null}
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Select
          label="Plan"
          value={plan}
          onChange={(e) => setPlan(e.target.value as SubscriptionPlan)}
          options={PLAN_OPTIONS.slice(1)}
          disabled={submitting}
        />
        <Input
          label="Durasi (hari)"
          type="number"
          min={1}
          max={730}
          value={durationDays}
          onChange={(e) => setDurationDays(e.target.value)}
          disabled={submitting}
          hint="Maksimal 730 hari (2 tahun)."
        />
      </div>

      <TextArea
        label="Alasan (wajib)"
        rows={3}
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder="Cth. Kompensasi gangguan layanan 25 Sep…"
        maxLength={500}
        disabled={submitting}
      />

      <div className="flex flex-col gap-2 pt-1">
        <Button
          variant="primary"
          loading={submitting}
          disabled={!valid}
          onClick={() => setConfirmOpen(true)}
        >
          Pratinjau & berikan
        </Button>
      </div>
      {durationTooLong ? (
        <p className="text-caption text-danger-text">
          Durasi maksimal 730 hari — backend menolak nilai lebih besar.
        </p>
      ) : !valid ? (
        <p className="text-caption text-text-secondary">
          Lengkapi: pengguna terpilih, durasi 1–730 hari, dan alasan.
        </p>
      ) : null}

      {/* ADM-224: pratinjau eksplisit sebelum grant dieksekusi */}
      <ConfirmDialog
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        title="Berikan subscription?"
        description={`Pengguna: ${selectedUserLabel}. Plan ${PLAN_LABEL[plan]} selama ${Number.isFinite(duration) ? duration : "—"} hari. Alasan: ${reason.trim() || "—"}`}
        confirmLabel="Ya, berikan"
        cancelLabel="Batal"
        loading={submitting}
        onConfirm={() => void handleSubmit()}
      />
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* ADM-212: panel kelola kode promo langganan gratis                   */
/* ------------------------------------------------------------------ */

const PROMO_TONE: Record<string, BadgeTone> = {
  ACTIVE: "success",
  DISABLED: "neutral",
}

function promoRedemptions(p: PromoCode): string {
  const used = p.currentRedemptions ?? 0
  return p.maxRedemptions == null ? `${used} / ∞` : `${used} / ${p.maxRedemptions}`
}

function PromoCodesPanel() {
  const toast = useToast()
  const [rows, setRows] = useState<PromoCode[]>([])
  const [loading, setLoading] = useState(true)
  const [actingId, setActingId] = useState<string | null>(null)

  const [code, setCode] = useState("")
  const [durationDays, setDurationDays] = useState("30")
  const [maxRedemptions, setMaxRedemptions] = useState("1")
  const [expiresAt, setExpiresAt] = useState("")
  const [note, setNote] = useState("")
  const [creating, setCreating] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await listPromoCodes(1, 20)
      setRows(res.data ?? [])
    } catch (e) {
      toast.show({
        title: "Gagal memuat kode promo",
        description: userMessage(e),
        tone: "danger",
      })
    } finally {
      setLoading(false)
    }
  }, [toast])

  useEffect(() => {
    void load()
  }, [load])

  const codeValid = /^[A-Z0-9_-]{3,32}$/i.test(code.trim())
  const daysValid =
    Number.isInteger(Number(durationDays)) &&
    Number(durationDays) >= 1 &&
    Number(durationDays) <= 366
  const maxValid =
    maxRedemptions.trim() === "" ||
    (Number.isInteger(Number(maxRedemptions)) && Number(maxRedemptions) >= 1)
  const formValid = codeValid && daysValid && maxValid

  const handleCreate = async () => {
    if (!formValid || creating) return
    setCreating(true)
    try {
      await createPromoCode({
        code: code.trim().toUpperCase(),
        durationDays: Number(durationDays),
        maxRedemptions:
          maxRedemptions.trim() === "" ? null : Number(maxRedemptions),
        expiresAt: expiresAt ? new Date(expiresAt).toISOString() : undefined,
        note: note.trim() || undefined,
      })
      toast.show({
        title: "Kode promo dibuat",
        description: code.trim().toUpperCase(),
        tone: "success",
      })
      setCode("")
      setDurationDays("30")
      setMaxRedemptions("1")
      setExpiresAt("")
      setNote("")
      await load()
    } catch (e) {
      toast.show({
        title: "Gagal membuat kode promo",
        description: userMessage(e),
        tone: "danger",
      })
    } finally {
      setCreating(false)
    }
  }

  const handleToggle = async (p: PromoCode) => {
    if (actingId) return
    setActingId(p.id)
    try {
      if (String(p.status) === "ACTIVE") await disablePromoCode(p.id)
      else await enablePromoCode(p.id)
      toast.show({
        title: String(p.status) === "ACTIVE" ? "Kode dinonaktifkan" : "Kode diaktifkan",
        description: p.code,
        tone: "success",
      })
      await load()
    } catch (e) {
      toast.show({
        title: "Gagal mengubah status kode",
        description: userMessage(e),
        tone: "danger",
      })
    } finally {
      setActingId(null)
    }
  }

  return (
    <div className="space-y-5">
      {/* Form buat kode */}
      <div>
        <p className="text-caption font-semibold text-text-secondary">
          Buat kode promo baru
        </p>
        <div className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Input
            label="Kode (3–32: A–Z, 0–9, _, -)"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="KAHADPLUS-VIP-001"
            maxLength={32}
            disabled={creating}
          />
          <Input
            label="Durasi gratis (hari, 1–366)"
            type="number"
            min={1}
            max={366}
            value={durationDays}
            onChange={(e) => setDurationDays(e.target.value)}
            disabled={creating}
          />
          <Input
            label="Batas pakai (kosong = tak terbatas)"
            type="number"
            min={1}
            value={maxRedemptions}
            onChange={(e) => setMaxRedemptions(e.target.value)}
            placeholder="1"
            disabled={creating}
          />
          <Input
            label="Kedaluwarsa (opsional)"
            type="date"
            value={expiresAt}
            onChange={(e) => setExpiresAt(e.target.value)}
            disabled={creating}
          />
        </div>
        <div className="mt-3">
          <TextArea
            label="Catatan (opsional)"
            rows={2}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Cth. Untuk pemenang giveaway September…"
            maxLength={500}
            disabled={creating}
          />
        </div>
        <div className="mt-3">
          <Button
            variant="primary"
            loading={creating}
            disabled={!formValid}
            onClick={() => void handleCreate()}
          >
            Buat kode promo
          </Button>
          {!formValid ? (
            <p className="mt-1 text-caption text-text-secondary">
              Kode 3–32 karakter (A–Z, 0–9, _, -) dan durasi 1–366 hari.
            </p>
          ) : null}
        </div>
      </div>

      {/* Daftar kode */}
      <div>
        <p className="mb-2 text-caption font-semibold text-text-secondary">
          Kode promo (terbaru dulu)
        </p>
        {loading ? (
          <div className="flex items-center gap-2 py-6 text-body text-text-secondary">
            <Spinner size="sm" /> Memuat…
          </div>
        ) : (
          <DataTable<PromoCode>
            columns={[
              {
                key: "code",
                header: "Kode",
                render: (p) => (
                  <span className="font-mono font-semibold">{p.code}</span>
                ),
              },
              {
                key: "duration",
                header: "Durasi",
                render: (p) => <span>{p.durationDays} hari</span>,
              },
              {
                key: "redemptions",
                header: "Terpakai",
                render: (p) => <span>{promoRedemptions(p)}</span>,
              },
              {
                key: "status",
                header: "Status",
                render: (p) => (
                  <Badge tone={PROMO_TONE[String(p.status)] ?? "neutral"}>
                    {String(p.status) === "ACTIVE" ? "Aktif" : "Nonaktif"}
                  </Badge>
                ),
              },
              {
                key: "expires",
                header: "Kedaluwarsa",
                render: (p) => (
                  <span className="text-caption text-text-secondary">
                    {p.expiresAt ? formatDateTimeWIB(p.expiresAt) : "—"}
                  </span>
                ),
              },
              {
                key: "action",
                header: "",
                align: "right",
                render: (p) => (
                  <Button
                    variant="secondary"
                    size="sm"
                    fullWidth={false}
                    loading={actingId === p.id}
                    disabled={actingId != null}
                    onClick={() => void handleToggle(p)}
                  >
                    {String(p.status) === "ACTIVE" ? "Nonaktifkan" : "Aktifkan"}
                  </Button>
                ),
              },
            ]}
            rows={rows}
            rowKey={(p) => p.id}
            emptyText="Belum ada kode promo."
          />
        )}
      </div>
    </div>
  )
}
