/**
 * Admin — Detail Pengguna (GET /v1/admin/users/:userId + sub-resource).
 *
 * Profil, wallet (+transaksi), sesi aktif (cabut per sesi), order, audit log,
 * dan aksi admin dengan konfirmasi: blokir/buka blokir (alasan min 5),
 * paksa logout, reset kata sandi, hapus flag review, penyesuaian saldo
 * (Dialog form + ConfirmDialog — konfirmasi ganda, SUPER_ADMIN saja).
 *
 * CATATAN KONTRAK: `resetUserPassword` hanya me-return `message` (backend
 * mengirim OTP reset via email — BUKAN link; password lama TETAP berlaku
 * sampai pengguna menyelesaikan reset; lihat ADM-001/ADM-024).
 */
"use client"

import { useCallback, useEffect, useState } from "react"
import { useParams, useRouter } from "next/navigation"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardBody, CardHeader } from "@/components/ui/card"
import { ConfirmDialog, Dialog } from "@/components/ui/dialog"
import { Input, TextArea } from "@/components/ui/input"
import { DataTable } from "@/components/ui/table"
import { useToast } from "@/components/ui/toast"
import { Select } from "@/components/admin/select"
import { RoleGate } from "@/components/admin/role-gate"
import { ActionLocationHistory } from "@/components/admin/action-location-view"
import { useAuth } from "@/lib/auth-context"
import {
  adjustWallet,
  banUser,
  clearReviewFlag,
  forceLogout,
  getAdminUserDetail,
  getUserAuditLog,
  getUserOrders,
  getUserSessions,
  getUserWallet,
  resetUserPassword,
  revokeUserSession,
  unbanUser,
  updateUser,
  suspendUser,
  unsuspendUser,
  type AdminUserAuditEntry,
  type AdminUserDetail,
  type AdminUserOrder,
  type AdminUserSession,
  type AdminUserWallet,
  type AdminUserWalletTransaction,
  type KycStatus,
  type WalletAdjustType,
} from "@/lib/api/admin/users"
import {
  grantGoldVerified,
  revokeGoldVerified,
  revokeGrayVerified,
  restoreGrayVerified,
  getUserVerificationBadges,
  type VerificationBadge,
} from "@/lib/api/admin/verified"
import { userMessage } from "@/lib/api/response"
import { formatDateTimeWIB, formatNumber } from "@/lib/format"
// ADM-405: PII (nama, email, no. HP) di-mask secara default — tanpa tombol unmask (mask-only).
import { maskEmail, maskName, maskPhone } from "@/lib/pii"

import { ErrorBlock, KeyValue, LoadingBlock, PageHeader } from "../../_components/admin-ui"
import { ModerationTab } from "./_components/moderation-tab"
import { DeletionTab } from "./_components/deletion-tab"
import { cn } from "@/lib/cn"

const MAX_ADJUST_IDR = 50_000_000

/**
 * ADM-007: arah mutasi wallet diturunkan dari `type`, BUKAN dari tanda amount
 * (backend selalu menyimpan amount sebagai nominal positif). Backend ikut
 * mengirim field `direction` (DEBIT/CREDIT/UNKNOWN) — dipakai bila ada;
 * fallback ke pemetaan tipe eksplisit di sini agar UI tetap benar bila
 * field belum tersedia. Tipe tak dikenal → UNKNOWN (render netral).
 */
const DEBIT_WALLET_TYPES = new Set([
  "WITHDRAW",
  "FEE_DEDUCT",
  "ADMIN_DEBIT",
  "TRANSFER_SENT",
  "ORDER_LOCK",
  "SUBSCRIPTION_PAYMENT",
])

/** ADM-007: tipe yang menambah saldo (set eksplisit — bukan "selain debit"). */
const CREDIT_WALLET_TYPES = new Set([
  "TOP_UP",
  "ORDER_RELEASE",
  "ORDER_REFUND",
  "REFERRAL_REWARD",
  "ADMIN_CREDIT",
  "DISPUTE_RELEASE",
  "TRANSFER_RECEIVED",
  "CAMPAIGN_CASHBACK",
  "TOPUP_BONUS",
  "MILESTONE_RELEASE",
])

function walletTxDirectionLocal(t: {
  type: string
  direction?: "DEBIT" | "CREDIT" | "UNKNOWN" | null
}): "DEBIT" | "CREDIT" | "UNKNOWN" {
  if (t.direction === "DEBIT" || t.direction === "CREDIT" || t.direction === "UNKNOWN") return t.direction
  // Fallback untuk respons lama tanpa `direction`: peta lokal hanya tipe
  // yang diketahui; yang lain netral (UNKNOWN) — bukan tebakan.
  if (DEBIT_WALLET_TYPES.has(t.type.toUpperCase())) return "DEBIT"
  if (CREDIT_WALLET_TYPES.has(t.type.toUpperCase())) return "CREDIT"
  return "UNKNOWN"
}

function rp(n: number | null | undefined): string {
  return typeof n === "number" ? `Rp ${formatNumber(n)}` : "—"
}

/**
 * Label Bahasa Indonesia untuk kode alasan penguncian wallet (deferred #2).
 * `lockReason` mentah (EN, berisi detail operasional) hanya dipakai sebagai
 * fallback untuk data lama yang belum punya kode.
 */
function walletLockReasonLabel(
  code: string | null | undefined,
  raw: string | null | undefined,
): string | null {
  const LABELS: Record<string, string> = {
    REVERSAL_VERSION_CONFLICT:
      "Terkunci otomatis: konflik versi saat reversal pasca-settlement",
    REVERSAL_INSUFFICIENT_BALANCE:
      "Terkunci otomatis: saldo tidak cukup saat reversal — perlu rekonsiliasi manual",
  }
  if (code && LABELS[code]) return LABELS[code]
  if (!raw) return null
  const lower = raw.toLowerCase()
  if (lower.includes("version conflict"))
    return "Terkunci otomatis: konflik versi saat reversal pasca-settlement"
  if (lower.includes("insufficient balance"))
    return "Terkunci otomatis: saldo tidak cukup saat reversal — perlu rekonsiliasi manual"
  return raw
}

function KycBadge({ status }: { status: KycStatus }) {
  if (!status) return <Badge tone="neutral">—</Badge>
  const upper = status.toUpperCase()
  // BAI-065/BAI-069 + ESI-020: UNVERIFIED & REVOKED punya label eksplisit —
  // jangan tampilkan enum mentah. Tone selaras KYC_STATUS_TONE (kyc/maps.ts).
  if (upper === "APPROVED") return <Badge tone="success">Terverifikasi</Badge>
  if (upper === "PENDING") return <Badge tone="warning">Menunggu</Badge>
  if (upper === "UNVERIFIED") return <Badge tone="neutral">Belum verifikasi</Badge>
  if (upper === "REJECTED") return <Badge tone="danger">Ditolak</Badge>
  if (upper === "REVOKED") return <Badge tone="neutral">Dicabut</Badge>
  return <Badge tone="neutral">{status}</Badge>
}

function orderRole(order: AdminUserOrder, ids: string[]): string {
  const roles: string[] = []
  if (ids.includes(order.buyerId)) roles.push("Pembeli")
  if (ids.includes(order.sellerId)) roles.push("Penjual")
  return roles.length > 0 ? roles.join(" & ") : "—"
}

export default function UserDetailPage() {
  const { id } = useParams<{ id: string }>()
  const userId = Array.isArray(id) ? id[0] : (id ?? "")
  const router = useRouter()
  const toast = useToast()
  const { role } = useAuth()
  const isSuperAdmin = role === "SUPER_ADMIN"

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [detail, setDetail] = useState<AdminUserDetail | null>(null)
  const [wallet, setWallet] = useState<AdminUserWallet | null>(null)
  const [sessions, setSessions] = useState<AdminUserSession[]>([])
  const [orders, setOrders] = useState<AdminUserOrder[]>([])
  const [audit, setAudit] = useState<AdminUserAuditEntry[]>([])
  // ADM-013: "muat lebih" per sub-list (halaman 1 sudah dimuat di loadAll).
  const [moreLoading, setMoreLoading] = useState<Record<string, boolean>>({})
  const [ordersPage, setOrdersPage] = useState(1)
  const [ordersHasMore, setOrdersHasMore] = useState(false)
  const [sessionsPage, setSessionsPage] = useState(1)
  const [sessionsHasMore, setSessionsHasMore] = useState(false)
  const [auditPage, setAuditPage] = useState(1)
  const [auditHasMore, setAuditHasMore] = useState(false)
  // Filter client-side pada tabel aktivitas (aksi + tanggal).
  const [auditActionFilter, setAuditActionFilter] = useState("")
  const [auditDateFilter, setAuditDateFilter] = useState("")
  const [txPage, setTxPage] = useState(1)
  const [txHasMore, setTxHasMore] = useState(false)

  const SUB_LIST_LIMIT = 20

  /** Muat halaman berikutnya untuk sub-list dan tempelkan ke daftar lama. */
  const loadMore = useCallback(
    async (
      key: "orders" | "sessions" | "audit" | "wallet",
      page: number,
      setPage: (p: number) => void,
      setHasMore: (b: boolean) => void,
    ) => {
      if (!userId || moreLoading[key]) return
      setMoreLoading((m) => ({ ...m, [key]: true }))
      try {
        if (key === "orders") {
          const res = await getUserOrders(userId, { page, limit: SUB_LIST_LIMIT })
          setOrders((prev) => [...prev, ...(res.data ?? [])])
          setHasMore(page < (res.totalPages ?? 1))
        } else if (key === "sessions") {
          const res = await getUserSessions(userId, { page, limit: SUB_LIST_LIMIT })
          setSessions((prev) => [...prev, ...(res.data ?? [])])
          setHasMore(page < (res.totalPages ?? 1))
        } else if (key === "audit") {
          const res = await getUserAuditLog(userId, { page, limit: SUB_LIST_LIMIT })
          setAudit((prev) => [...prev, ...(res.data ?? [])])
          setHasMore(page < (res.totalPages ?? 1))
        } else {
          const res = await getUserWallet(userId, { page, limit: SUB_LIST_LIMIT })
          setWallet((prev) =>
            prev
              ? {
                  ...prev,
                  transactions: [...prev.transactions, ...res.transactions],
                  transactionsMeta: res.transactionsMeta,
                }
              : prev,
          )
          setHasMore(page < (res.transactionsMeta?.totalPages ?? 1))
        }
        setPage(page)
      } catch (e) {
        toast.show({
          title: "Gagal memuat data",
          description: userMessage(e),
          tone: "danger",
        })
      } finally {
        setMoreLoading((m) => ({ ...m, [key]: false }))
      }
    },
    [userId, moreLoading, toast],
  )

  function LoadMoreButton({
    section,
    page,
    setPage,
    setHasMore,
    label,
  }: {
    section: "orders" | "sessions" | "audit" | "wallet"
    page: number
    setPage: (p: number) => void
    setHasMore: (b: boolean) => void
    label: string
  }) {
    const hasMore =
      section === "orders"
        ? ordersHasMore
        : section === "sessions"
          ? sessionsHasMore
          : section === "audit"
            ? auditHasMore
            : txHasMore
    if (!hasMore) return null
    return (
      <div className="mt-4 text-center">
        <Button
          variant="secondary"
          size="sm"
          fullWidth={false}
          loading={!!moreLoading[section]}
          onClick={() => loadMore(section, page + 1, setPage, setHasMore)}
        >
          Muat lebih banyak {label}
        </Button>
      </div>
    )
  }
  const [sectionError, setSectionError] = useState<Record<string, string>>({})

  // Tier verifikasi aktif (dari endpoint badge publik; butuh username)
  const [verifiedBadges, setVerifiedBadges] = useState<VerificationBadge[]>([])
  const [verifiedError, setVerifiedError] = useState<string | null>(null)

  // Dialog / konfirmasi
  const [acting, setActing] = useState<string | null>(null)
  const [banOpen, setBanOpen] = useState(false)
  const [banReason, setBanReason] = useState("")
  const [banReasonError, setBanReasonError] = useState<string | null>(null)
  const [unbanOpen, setUnbanOpen] = useState(false)
  // BAI-071: editor tipe akun (whitelist backend: accountType).
  const [accountTypeOpen, setAccountTypeOpen] = useState(false)
  const [accountTypeDraft, setAccountTypeDraft] = useState("PERSONAL")
  // BAI-074: suspend ringan berbatas waktu.
  const [suspendOpen, setSuspendOpen] = useState(false)
  const [suspendReason, setSuspendReason] = useState("")
  const [suspendReasonError, setSuspendReasonError] = useState<string | null>(null)
  const [suspendHours, setSuspendHours] = useState("24")
  const [unsuspendOpen, setUnsuspendOpen] = useState(false)
  const [forceLogoutOpen, setForceLogoutOpen] = useState(false)
  const [resetPasswordOpen, setResetPasswordOpen] = useState(false)
  const [clearFlagOpen, setClearFlagOpen] = useState(false)
  const [revokeTarget, setRevokeTarget] = useState<AdminUserSession | null>(null)

  // Verifikasi: beri/cabut emas, cabut/pulihkan abu
  const [goldGrantOpen, setGoldGrantOpen] = useState(false)
  const [goldRevokeOpen, setGoldRevokeOpen] = useState(false)
  const [grayRevokeOpen, setGrayRevokeOpen] = useState(false)
  const [grayRestoreOpen, setGrayRestoreOpen] = useState(false)
  const [grayReason, setGrayReason] = useState("")
  const [grayReasonError, setGrayReasonError] = useState<string | null>(null)

  // Sesuaikan saldo: form → konfirmasi ringkasan (konfirmasi ganda)
  const [adjustOpen, setAdjustOpen] = useState(false)
  const [adjustConfirmOpen, setAdjustConfirmOpen] = useState(false)
  const [adjustType, setAdjustType] = useState<WalletAdjustType>("CREDIT")
  const [adjustAmount, setAdjustAmount] = useState("")
  const [adjustReason, setAdjustReason] = useState("")
  const [adjustError, setAdjustError] = useState<string | null>(null)

  const loadAll = useCallback(async () => {
    if (!userId) return
    setLoading(true)
    setError(null)
    setSectionError({})
    const [d, w, s, o, a] = await Promise.allSettled([
      getAdminUserDetail(userId),
      getUserWallet(userId, { limit: SUB_LIST_LIMIT }),
      getUserSessions(userId, { limit: SUB_LIST_LIMIT }),
      getUserOrders(userId, { limit: SUB_LIST_LIMIT }),
      getUserAuditLog(userId, { limit: SUB_LIST_LIMIT }),
    ])
    if (d.status === "fulfilled") setDetail(d.value)
    else {
      setError(userMessage(d.reason))
      setLoading(false)
      return
    }
    // Badge verifikasi aktif (butuh username; gagal diam-diam bila profil privat/diblokir)
    setVerifiedError(null)
    const username = d.status === "fulfilled" ? d.value.username : null
    if (username) {
      try {
        const vb = await getUserVerificationBadges(username)
        setVerifiedBadges(vb.badges ?? [])
      } catch (e) {
        setVerifiedBadges([])
        setVerifiedError("Tidak dapat memuat tier verifikasi.")
      }
    } else {
      setVerifiedBadges([])
    }
    const nextErrors: Record<string, string> = {}
    if (w.status === "fulfilled") {
      setWallet(w.value)
      setTxPage(1)
      setTxHasMore(1 < (w.value.transactionsMeta?.totalPages ?? 1))
    } else nextErrors.wallet = userMessage(w.reason)
    if (s.status === "fulfilled") {
      setSessions(s.value.data ?? [])
      setSessionsPage(1)
      setSessionsHasMore(1 < (s.value.totalPages ?? 1))
    } else nextErrors.sessions = userMessage(s.reason)
    if (o.status === "fulfilled") {
      setOrders(o.value.data ?? [])
      setOrdersPage(1)
      setOrdersHasMore(1 < (o.value.totalPages ?? 1))
    } else nextErrors.orders = userMessage(o.reason)
    if (a.status === "fulfilled") {
      setAudit(a.value.data ?? [])
      setAuditPage(1)
      setAuditHasMore(1 < (a.value.totalPages ?? 1))
    } else nextErrors.audit = userMessage(a.reason)
    setSectionError(nextErrors)
    setLoading(false)
  }, [userId])

  useEffect(() => {
    void loadAll()
  }, [loadAll])

  const fail = (title: string, e: unknown) => {
    toast.show({ title, description: userMessage(e), tone: "danger" })
  }

  const runAction = async (
    label: string,
    fn: () => Promise<unknown>,
    successTitle: string,
    successDescription?: string,
  ) => {
    setActing(label)
    try {
      await fn()
      await loadAll()
      toast.show({ title: successTitle, description: successDescription, tone: "success" })
    } catch (e) {
      fail("Aksi gagal", e)
    } finally {
      setActing(null)
    }
  }

  // ---- Aksi ----

  const handleBanConfirm = async () => {
    const reason = banReason.trim()
    if (reason.length < 5) {
      setBanReasonError("Alasan blokir minimal 5 karakter.")
      return
    }
    setBanReasonError(null)
    setBanOpen(false)
    await runAction("ban", () => banUser(userId, reason), "Pengguna diblokir", reason)
    setBanReason("")
  }

  // BAI-071: ubah tipe akun (SUPER_ADMIN + audit di backend).
  const handleAccountTypeConfirm = async () => {
    const next = accountTypeDraft === "BUSINESS" ? "BUSINESS" : "PERSONAL"
    setAccountTypeOpen(false)
    await runAction(
      "account-type",
      () => updateUser(userId, { accountType: next }),
      "Tipe akun diperbarui",
      `accountType → ${next}. Perubahan tercatat di audit log.`,
    )
  }

  // BAI-074: suspend ringan — alasan wajib min 10, durasi 1–720 jam.
  const handleSuspendConfirm = async () => {
    const reason = suspendReason.trim()
    if (reason.length < 10) {
      setSuspendReasonError("Alasan penangguhan minimal 10 karakter.")
      return
    }
    const hours = Number(suspendHours)
    if (!Number.isInteger(hours) || hours < 1 || hours > 720) {
      setSuspendReasonError("Durasi harus bilangan bulat 1–720 jam.")
      return
    }
    setSuspendReasonError(null)
    setSuspendOpen(false)
    await runAction(
      "suspend",
      () => suspendUser(userId, { reason, durationHours: hours }),
      "Pengguna ditangguhkan",
      `Sesi aktif dicabut; login diblokir ${hours} jam (auto-buka).`,
    )
    setSuspendReason("")
    setSuspendHours("24")
  }

  const handleAdjustNext = () => {
    const amount = Number(adjustAmount.replace(/[^0-9]/g, ""))
    const reason = adjustReason.trim()
    if (!Number.isSafeInteger(amount) || amount < 1 || amount > MAX_ADJUST_IDR) {
      setAdjustError(`Nominal harus Rp 1 – Rp ${formatNumber(MAX_ADJUST_IDR)}.`)
      return
    }
    if (reason.length < 5) {
      setAdjustError("Alasan penyesuaian minimal 5 karakter.")
      return
    }
    setAdjustError(null)
    setAdjustOpen(false)
    setAdjustConfirmOpen(true)
  }

  const handleAdjustConfirm = async () => {
    const amount = Number(adjustAmount.replace(/[^0-9]/g, ""))
    const reason = adjustReason.trim()
    setAdjustConfirmOpen(false)
    setActing("adjust")
    try {
      const res = await adjustWallet(userId, { amount, type: adjustType, reason })
      await loadAll()
      toast.show({
        title: "Saldo disesuaikan",
        description: `Mutasi ${res.txId} · saldo akhir ${rp(res.balanceAfter)}.`,
        tone: "success",
      })
      setAdjustAmount("")
      setAdjustReason("")
    } catch (e) {
      fail("Penyesuaian saldo gagal", e)
    } finally {
      setActing(null)
    }
  }

  // ---- Aksi verifikasi (tier abu/biru/emas) ----

  // ADM-410: kelola tier abu hanya SUPER_ADMIN (konsisten dengan gold revoke).
  const canManageGray = isSuperAdmin

  const hasTier = (type: string) =>
    verifiedBadges.some((b) => String(b.type).toUpperCase() === type)

  const handleVerifiedAction = async (
    label: string,
    fn: () => Promise<{ message: string }>,
    successTitle: string,
  ) => {
    setActing(label)
    try {
      const res = await fn()
      await loadAll()
      toast.show({
        title: successTitle,
        description: res.message || undefined,
        tone: "success",
      })
    } catch (e) {
      fail("Aksi verifikasi gagal", e)
    } finally {
      setActing(null)
    }
  }

  const handleGoldGrantConfirm = () => {
    setGoldGrantOpen(false)
    void handleVerifiedAction(
      "gold-grant",
      () => grantGoldVerified(userId),
      "Tier emas diberikan",
    )
  }

  const handleGoldRevokeConfirm = () => {
    setGoldRevokeOpen(false)
    void handleVerifiedAction(
      "gold-revoke",
      () => revokeGoldVerified(userId),
      "Tier emas dicabut",
    )
  }

  const handleGrayRevokeConfirm = () => {
    const reason = grayReason.trim()
    if (reason.length < 10) {
      setGrayReasonError("Alasan pencabutan minimal 10 karakter.")
      return
    }
    setGrayReasonError(null)
    setGrayRevokeOpen(false)
    setGrayReason("")
    void handleVerifiedAction(
      "gray-revoke",
      () => revokeGrayVerified(userId, reason),
      "Tier abu dicabut",
    )
  }

  const handleGrayRestoreConfirm = () => {
    setGrayRestoreOpen(false)
    void handleVerifiedAction(
      "gray-restore",
      () => restoreGrayVerified(userId),
      "Tier abu dipulihkan",
    )
  }

  // ---- Render ----

  const user = detail
  // ADM-405: nama pengguna di-mask secara default di panel.
  const displayName = maskName(user?.fullName?.trim() || null)
  // Filter client-side pada tabel aktivitas (berlaku pada data yang sudah dimuat).
  const filteredAudit = audit.filter((e) => {
    if (auditActionFilter.trim()) {
      const q = auditActionFilter.trim().toLowerCase()
      const hay = `${e.action} ${e.description ?? ""} ${e.entityType ?? ""}`.toLowerCase()
      if (!hay.includes(q)) return false
    }
    if (auditDateFilter) {
      const t = new Date(e.createdAt)
      if (!Number.isFinite(t.getTime())) return false
      const ymd = `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}-${String(t.getDate()).padStart(2, "0")}`
      if (ymd !== auditDateFilter) return false
    }
    return true
  })
  const adjustAmountNum = Number(adjustAmount.replace(/[^0-9]/g, ""))
  const [tab, setTab] = useState<"ringkasan" | "moderasi" | "penghapusan">("ringkasan")

  return (
    <RoleGate href="/users">
      <PageHeader
        title={user ? displayName : "Detail Pengguna"}
        description={user ? `${maskEmail(user.email)} · ID ${user.userId}` : undefined}
        actions={
          <Button
            variant="secondary"
            size="sm"
            fullWidth={false}
            onClick={() => router.push("/users")}
          >
            ← Daftar pengguna
          </Button>
        }
        onRefresh={loadAll}
        refreshing={loading}
      />

      {loading && !user ? (
        <LoadingBlock message="Memuat detail pengguna…" />
      ) : error && !user ? (
        <ErrorBlock
          title="Gagal memuat detail pengguna"
          message={error}
          onRetry={loadAll}
        />
      ) : user ? (
        <>
          {/* ---- Tab: Ringkasan / Moderasi ---- */}
          <div className="mb-5 flex gap-1 border-b border-border" role="tablist" aria-label="Detail pengguna">
            {(
              [
                { key: "ringkasan", label: "Ringkasan" },
                { key: "moderasi", label: "Moderasi" },
                { key: "penghapusan", label: "Penghapusan" },
              ] as const
            ).map((t) => (
              <button
                key={t.key}
                type="button"
                role="tab"
                aria-selected={tab === t.key}
                onClick={() => setTab(t.key)}
                className={cn(
                  "-mb-px border-b-2 px-4 py-2 text-body font-semibold transition-colors",
                  tab === t.key
                    ? "border-primary text-primary"
                    : "border-transparent text-text-secondary hover:text-text-primary",
                )}
              >
                {t.label}
              </button>
            ))}
          </div>

          {tab === "moderasi" ? (
            <ModerationTab userId={userId} userEmail={user.email} />
          ) : tab === "penghapusan" ? (
            <DeletionTab userId={userId} />
          ) : (
            <div className="flex flex-col gap-5">
          {/* ---- Profil ---- */}
          <Card padded={false}>
            <CardHeader
              title="Profil"
              action={
                <span className="flex flex-wrap justify-end gap-1.5">
                  <Badge tone={user.isBanned ? "danger" : "success"}>
                    {user.isBanned ? "Diblokir" : "Aktif"}
                  </Badge>
                  {user.suspended ? (
                    <Badge tone="warning">Ditangguhkan</Badge>
                  ) : null}
                  <KycBadge status={user.kycStatus} />
                  {user.flaggedForReview ? (
                    <Badge tone="warning">Perlu review</Badge>
                  ) : null}
                </span>
              }
            />
            <CardBody>
              <KeyValue label="Nama" value={displayName} />
              {user.username ? (
                <KeyValue label="Username" value={`@${user.username}`} mono />
              ) : null}
              <KeyValue
                label="Email"
                value={
                  <span className="flex flex-wrap items-center justify-end gap-1.5">
                    <span className="break-all">{maskEmail(user.email)}</span>
                    <Badge tone={user.emailVerified ? "success" : "neutral"}>
                      {user.emailVerified ? "Email terverifikasi" : "Email belum verifikasi"}
                    </Badge>
                  </span>
                }
              />
              {user.phoneNumber ? (
                <KeyValue
                  label="No. HP"
                  value={
                    <span className="flex flex-wrap items-center justify-end gap-1.5">
                      <span className="font-mono text-[13px]">{maskPhone(user.phoneNumber)}</span>
                      {user.phoneVerified != null ? (
                        <Badge tone={user.phoneVerified ? "success" : "neutral"}>
                          {user.phoneVerified ? "HP terverifikasi" : "HP belum verifikasi"}
                        </Badge>
                      ) : null}
                    </span>
                  }
                />
              ) : null}
              {user.isBanned && user.banReason ? (
                <KeyValue label="Alasan blokir" value={user.banReason} />
              ) : null}
              {user.membershipRank ? (
                <KeyValue label="Peringkat" value={user.membershipRank} />
              ) : null}
              <KeyValue label="Terdaftar" value={formatDateTimeWIB(user.createdAt)} />
              {/* BAI-071: tipe akun + editor koreksi operasional (SUPER_ADMIN). */}
              <KeyValue
                label="Tipe akun"
                value={
                  <span className="flex flex-wrap items-center justify-end gap-1.5">
                    <Badge tone={user.accountType === "BUSINESS" ? "info" : "neutral"}>
                      {user.accountType === "BUSINESS" ? "Bisnis" : "Personal"}
                    </Badge>
                    {isSuperAdmin ? (
                      <Button
                        variant="secondary"
                        size="sm"
                        fullWidth={false}
                        onClick={() => {
                          setAccountTypeDraft(user.accountType === "BUSINESS" ? "BUSINESS" : "PERSONAL")
                          setAccountTypeOpen(true)
                        }}
                      >
                        Ubah
                      </Button>
                    ) : null}
                  </span>
                }
              />
              {user.lastLoginAt ? (
                <KeyValue
                  label="Login terakhir"
                  value={
                    <span>
                      {formatDateTimeWIB(user.lastLoginAt)}
                      {user.lastLoginIp ? ` · ${user.lastLoginIp}` : ""}
                      {/* BAI-076: backend me-mask IP untuk non-SUPER_ADMIN. */}
                      {user.lastLoginIp?.includes("\u2022") && !isSuperAdmin ? (
                        <span className="block text-caption text-text-tertiary">
                          Disamarkan untuk role Anda
                        </span>
                      ) : null}
                    </span>
                  }
                />
              ) : null}
              <KeyValue
                label="Order"
                value={`${user.totalOrdersAsBuyer} beli · ${user.totalOrdersAsSeller} jual · ${user.totalOrdersCompleted} selesai · ${user.totalOrdersDisputed} sengketa`}
              />
              {user.averageRating != null ? (
                <KeyValue label="Rating rata-rata" value={String(user.averageRating)} />
              ) : null}
              <KeyValue
                label="Sosial"
                value={`${formatNumber(user.followersCount)} pengikut · ${formatNumber(user.followingCount)} mengikuti · ${formatNumber(user.reportsReceivedCount)} laporan diterima`}
              />
              {user.bio ? <KeyValue label="Bio" value={user.bio} /> : null}
              {/* ADM-020: ringkasan pengajuan KYC terakhir + deep-link ke antrean */}
              {user.kycRequests && user.kycRequests.length > 0 ? (
                <KeyValue
                  label="Pengajuan KYC"
                  value={
                    <span className="flex flex-wrap items-center justify-end gap-1.5">
                      <Badge
                        tone={
                          user.kycRequests[0].status === "APPROVED"
                            ? "success"
                            : user.kycRequests[0].status === "REJECTED"
                              ? "danger"
                              : "warning"
                        }
                      >
                        {user.kycRequests[0].status}
                      </Badge>
                      <span className="text-caption text-text-secondary">
                        {formatDateTimeWIB(user.kycRequests[0].createdAt)}
                        {user.kycRequests[0].rejectionReason
                          ? ` · ${user.kycRequests[0].rejectionReason}`
                          : ""}
                      </span>
                      <Button
                        variant="secondary"
                        size="sm"
                        fullWidth={false}
                        onClick={() =>
                          router.push(
                            `/kyc/${encodeURIComponent(user.kycRequests[0].kycId)}`,
                          )
                        }
                      >
                        Tinjau
                      </Button>
                    </span>
                  }
                />
              ) : null}
            </CardBody>
          </Card>

          {/* ---- Verifikasi (tier abu/biru/emas) ---- */}
          <Card padded={false}>
            <CardHeader title="Verifikasi" />
            <CardBody>
              {verifiedError ? (
                <p className="text-body text-text-secondary">{verifiedError}</p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {hasTier("TRUSTED_BY_KAHADE") ? (
                    <Badge tone="warning">Emas — Dipercaya Kahade</Badge>
                  ) : null}
                  {hasTier("BUSINESS_VERIFIED") ? (
                    <Badge tone="info">Biru — Bisnis Terverifikasi</Badge>
                  ) : null}
                  {hasTier("FULLY_VERIFIED") ? (
                    <Badge tone="neutral">Abu — Terverifikasi Penuh</Badge>
                  ) : null}
                  {!hasTier("TRUSTED_BY_KAHADE") &&
                  !hasTier("BUSINESS_VERIFIED") &&
                  !hasTier("FULLY_VERIFIED") ? (
                    <p className="text-body text-text-secondary">
                      Pengguna belum memegang tier verifikasi.
                    </p>
                  ) : null}
                </div>
              )}
              <p className="mt-3 text-caption text-text-tertiary">
                Abu: otomatis (email + KYC + HP + alamat + Kahade Plus) — dapat dicabut/dipulihkan.
                Biru: verifikasi manual di halaman Verifikasi Bisnis. Emas: diberikan manual ke
                customer pilihan.
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                {isSuperAdmin ? (
                  <>
                    <Button
                      variant="primary"
                      size="sm"
                      fullWidth={false}
                      loading={acting === "gold-grant"}
                      onClick={() => setGoldGrantOpen(true)}
                    >
                      Beri emas
                    </Button>
                    <Button
                      variant="secondary"
                      size="sm"
                      fullWidth={false}
                      loading={acting === "gold-revoke"}
                      onClick={() => setGoldRevokeOpen(true)}
                    >
                      Cabut emas
                    </Button>
                  </>
                ) : null}
                {canManageGray ? (
                  <>
                    <Button
                      variant="secondary"
                      size="sm"
                      fullWidth={false}
                      loading={acting === "gray-revoke"}
                      onClick={() => {
                        setGrayReason("")
                        setGrayReasonError(null)
                        setGrayRevokeOpen(true)
                      }}
                    >
                      Cabut abu
                    </Button>
                    <Button
                      variant="secondary"
                      size="sm"
                      fullWidth={false}
                      loading={acting === "gray-restore"}
                      onClick={() => setGrayRestoreOpen(true)}
                    >
                      Pulihkan abu
                    </Button>
                  </>
                ) : null}
                {!isSuperAdmin && !canManageGray ? (
                  <p className="text-caption text-text-tertiary">
                    Role Anda tidak dapat mengelola tier verifikasi.
                  </p>
                ) : null}
              </div>
            </CardBody>
          </Card>

          {/* ---- Wallet ---- */}
          <Card padded={false}>
            <CardHeader
              title="Wallet"
              action={
                isSuperAdmin ? (
                  <Button
                    variant="secondary"
                    size="sm"
                    fullWidth={false}
                    loading={acting === "adjust"}
                    onClick={() => setAdjustOpen(true)}
                  >
                    Sesuaikan saldo
                  </Button>
                ) : null
              }
            />
            <CardBody>
              {sectionError.wallet ? (
                <p className="text-body text-danger-text">{sectionError.wallet}</p>
              ) : user.wallet ? (
                <>
                  <KeyValue label="Saldo total" value={rp(user.wallet.totalBalance)} />
                  <KeyValue
                    label="Saldo tersedia"
                    value={rp(user.wallet.availableBalance)}
                  />
                  <KeyValue label="Saldo escrow" value={rp(user.wallet.escrowBalance)} />
                </>
              ) : (
                <p className="text-body text-text-secondary">Wallet belum dibuat.</p>
              )}
              {wallet ? (
                <>
                  <KeyValue
                    label="Status"
                    value={
                      wallet.isLocked ? (
                        <Badge tone="danger">
                          Terkunci
                          {(() => {
                            const label = walletLockReasonLabel(
                              wallet.lockReasonCode,
                              wallet.lockReason,
                            )
                            return label ? ` · ${label}` : ""
                          })()}
                        </Badge>
                      ) : (
                        <Badge tone="success">Aktif</Badge>
                      )
                    }
                  />
                  <KeyValue
                    label="Topup / tarik hari ini"
                    value={`${rp(wallet.todayTopupAmount)} / ${rp(wallet.todayWithdrawAmount)}`}
                  />
                </>
              ) : null}
            </CardBody>
            <div className="border-t border-border px-5 py-4">
              <p className="mb-3 text-label font-semibold text-text-secondary">
                Transaksi wallet
              </p>
              <DataTable<AdminUserWalletTransaction>
                columns={[
                  {
                    key: "createdAt",
                    header: "Waktu",
                    render: (t) => formatDateTimeWIB(t.createdAt),
                  },
                  {
                    key: "description",
                    header: "Keterangan",
                    render: (t) => t.description?.trim() || t.type,
                  },
                  {
                    key: "type",
                    header: "Tipe",
                    render: (t) => <Badge tone="neutral">{t.type}</Badge>,
                  },
                  {
                    key: "status",
                    header: "Status",
                    render: (t) => <Badge tone="neutral">{t.status}</Badge>,
                  },
                  {
                    key: "amount",
                    header: "Jumlah",
                    align: "right",
                    render: (t) => {
                      const direction = walletTxDirectionLocal(t)
                      // UNKNOWN → netral: tanpa tanda +/- dan tanpa warna,
                      // dengan tooltip penjelasan.
                      if (direction === "UNKNOWN") {
                        return (
                          <span
                            className="text-text-primary"
                            title={`Arah mutasi tipe "${t.type}" belum dipetakan — ditampilkan netral`}
                          >
                            {rp(Math.abs(t.amount))}
                          </span>
                        )
                      }
                      const isDebit = direction === "DEBIT"
                      return (
                        <span
                          className={
                            isDebit ? "text-danger-text" : "text-success-text"
                          }
                        >
                          {isDebit ? "−" : "+"}
                          {rp(Math.abs(t.amount))}
                        </span>
                      )
                    },
                  },
                  {
                    key: "balanceAfter",
                    header: "Saldo akhir",
                    align: "right",
                    render: (t) => rp(t.balanceAfter),
                  },
                ]}
                rows={wallet?.transactions ?? []}
                rowKey={(t) => t.id}
                loading={loading}
                emptyText="Belum ada transaksi wallet."
              />
              <LoadMoreButton
                section="wallet"
                page={txPage}
                setPage={setTxPage}
                setHasMore={setTxHasMore}
                label="transaksi"
              />
            </div>
          </Card>

          {/* ---- Sesi aktif ---- */}
          <Card padded={false}>
            <CardHeader
              title="Sesi aktif"
              action={
                sessions.length > 0 && isSuperAdmin ? (
                  <Button
                    variant="destructive"
                    size="sm"
                    fullWidth={false}
                    loading={acting === "force-logout"}
                    onClick={() => setForceLogoutOpen(true)}
                  >
                    Paksa logout semua
                  </Button>
                ) : null
              }
            />
            <CardBody>
              {sectionError.sessions ? (
                <p className="text-body text-danger-text">{sectionError.sessions}</p>
              ) : (
                <DataTable<AdminUserSession>
                  columns={[
                    {
                      key: "device",
                      header: "Perangkat",
                      render: (s) => (
                        <div>
                          <p className="font-medium">
                            {s.deviceInfo?.trim() || "Perangkat tidak dikenal"}
                          </p>
                          {s.ipAddress ? (
                            <p className="font-mono text-caption text-text-secondary">
                              {s.ipAddress}
                            </p>
                          ) : null}
                        </div>
                      ),
                    },
                    {
                      key: "lastActiveAt",
                      header: "Aktif terakhir",
                      render: (s) => formatDateTimeWIB(s.lastActiveAt),
                    },
                    {
                      key: "expiresAt",
                      header: "Kedaluwarsa",
                      render: (s) => formatDateTimeWIB(s.expiresAt),
                    },
                    {
                      key: "action",
                      header: "",
                      align: "right",
                      render: (s) => (
                        <Button
                          variant="secondary"
                          size="sm"
                          fullWidth={false}
                          loading={acting === `revoke-${s.id}`}
                          onClick={() => setRevokeTarget(s)}
                        >
                          Cabut
                        </Button>
                      ),
                    },
                  ]}
                  rows={sessions}
                  rowKey={(s) => s.id}
                  loading={loading}
                  emptyText="Tidak ada sesi aktif."
                />
              )}
              <LoadMoreButton
                section="sessions"
                page={sessionsPage}
                setPage={setSessionsPage}
                setHasMore={setSessionsHasMore}
                label="sesi"
              />
            </CardBody>
          </Card>

          {/* ---- Order pengguna ---- */}
          <Card padded={false}>
            <CardHeader title="Order pengguna" />
            <CardBody>
              {sectionError.orders ? (
                <p className="text-body text-danger-text">{sectionError.orders}</p>
              ) : (
                <DataTable<AdminUserOrder>
                  columns={[
                    {
                      key: "orderId",
                      header: "ID Order",
                      render: (o) => (
                        <span className="break-all font-mono text-[13px]">
                          {o.orderId}
                        </span>
                      ),
                    },
                    {
                      key: "title",
                      header: "Judul",
                      render: (o) => o.title?.trim() || "—",
                    },
                    {
                      key: "role",
                      header: "Peran",
                      render: (o) => orderRole(o, [user.id, user.userId]),
                    },
                    {
                      key: "status",
                      header: "Status",
                      render: (o) => <Badge tone="neutral">{o.status}</Badge>,
                    },
                    {
                      key: "orderValue",
                      header: "Nilai",
                      align: "right",
                      render: (o) => rp(o.orderValue),
                    },
                    {
                      key: "createdAt",
                      header: "Dibuat",
                      render: (o) => formatDateTimeWIB(o.createdAt),
                    },
                  ]}
                  rows={orders}
                  rowKey={(o) => o.id}
                  loading={loading}
                  emptyText="Pengguna belum pernah bertransaksi."
                />
              )}
              <LoadMoreButton
                section="orders"
                page={ordersPage}
                setPage={setOrdersPage}
                setHasMore={setOrdersHasMore}
                label="order"
              />
            </CardBody>
          </Card>

          {/* ---- Audit log ---- */}
          <Card padded={false}>
            <CardHeader title="Audit log" />
            <CardBody>
              <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Input
                  label="Filter aksi"
                  value={auditActionFilter}
                  onChange={(e) => setAuditActionFilter(e.target.value)}
                  placeholder="Cari aksi / deskripsi / entitas…"
                />
                <Input
                  label="Filter tanggal"
                  type="date"
                  value={auditDateFilter}
                  onChange={(e) => setAuditDateFilter(e.target.value)}
                  hint="Filter berlaku pada aktivitas yang sudah dimuat di bawah."
                />
              </div>
              {sectionError.audit ? (
                <p className="text-body text-danger-text">{sectionError.audit}</p>
              ) : (
                <DataTable<AdminUserAuditEntry>
                  columns={[
                    {
                      key: "createdAt",
                      header: "Waktu",
                      render: (e) => formatDateTimeWIB(e.createdAt),
                    },
                    {
                      key: "action",
                      header: "Aktivitas",
                      render: (e) => (
                        <div>
                          <p className="font-medium">
                            {e.description?.trim() || e.action}
                          </p>
                          {e.entityType ? (
                            <p className="font-mono text-caption text-text-secondary">
                              {e.entityType}
                              {e.entityId ? ` · ${e.entityId}` : ""}
                            </p>
                          ) : null}
                        </div>
                      ),
                    },
                    {
                      key: "ipAddress",
                      header: "IP",
                      render: (e) => (
                        <span className="font-mono text-[13px]">
                          {e.ipAddress ?? "—"}
                        </span>
                      ),
                    },
                  ]}
                  rows={filteredAudit}
                  rowKey={(e) => e.id}
                  loading={loading}
                  emptyText={
                    audit.length === 0
                      ? "Tidak ada jejak audit untuk pengguna ini."
                      : "Tidak ada aktivitas yang cocok dengan filter."
                  }
                />
              )}
              <LoadMoreButton
                section="audit"
                page={auditPage}
                setPage={setAuditPage}
                setHasMore={setAuditHasMore}
                label="aktivitas"
              />
            </CardBody>
          </Card>

          {/* ---- Riwayat lokasi aksi (LKD-001) ----
              Lokasi presisi tiap aksi sensitif: "di titik mana tiap aksi
              dilakukan". Endpoint backend SUPER_ADMIN-only (+ role fraud/
              dispute bila backend mengizinkan) — section disembunyikan dari
              role lain; backend tetap jadi otoritas (403 bila tak berhak). */}
          {isSuperAdmin ? (
            <Card padded={false}>
              <CardHeader title="Riwayat lokasi aksi" />
              <CardBody>
                <ActionLocationHistory userId={userId} />
              </CardBody>
            </Card>
          ) : null}

          {/* ---- Aksi admin ----
              ADM-002: Blokir/Buka blokir, Reset kata sandi = SUPER_ADMIN-only
              di backend — sembunyikan dari CUSTOMER_SUPPORT agar tidak 403.
              "Cabut sesi" per-sesi (di kartu Sesi) & "Hapus flag review"
              memang boleh untuk CS. */}
          <Card padded={false}>
            <CardHeader title="Aksi admin" />
            <CardBody>
              <div className="flex flex-wrap gap-3">
                {isSuperAdmin ? (
                  user.isBanned ? (
                    <Button
                      variant="secondary"
                      size="sm"
                      fullWidth={false}
                      loading={acting === "unban"}
                      onClick={() => setUnbanOpen(true)}
                    >
                      Buka blokir
                    </Button>
                  ) : (
                    <Button
                      variant="destructive"
                      size="sm"
                      fullWidth={false}
                      loading={acting === "ban"}
                      onClick={() => setBanOpen(true)}
                    >
                      Blokir
                    </Button>
                  )
                ) : null}
                {/* BAI-074: suspend ringan berbatas waktu (SUPER_ADMIN). */}
                {isSuperAdmin && !user.isBanned ? (
                  user.suspended ? (
                    <Button
                      variant="secondary"
                      size="sm"
                      fullWidth={false}
                      loading={acting === "unsuspend"}
                      onClick={() => setUnsuspendOpen(true)}
                    >
                      Batalkan penangguhan
                    </Button>
                  ) : (
                    <Button
                      variant="secondary"
                      size="sm"
                      fullWidth={false}
                      loading={acting === "suspend"}
                      onClick={() => {
                        setSuspendReason("")
                        setSuspendHours("24")
                        setSuspendReasonError(null)
                        setSuspendOpen(true)
                      }}
                    >
                      Tangguhkan
                    </Button>
                  )
                ) : null}
                {isSuperAdmin ? (
                  <Button
                    variant="secondary"
                    size="sm"
                    fullWidth={false}
                    loading={acting === "reset-password"}
                    onClick={() => setResetPasswordOpen(true)}
                    disabled={!user.email || user.isBanned || !user.isActive}
                    title={
                      !user.email
                        ? "Akun ini tidak punya email — reset password tidak bisa dikirim (akun phone-only)."
                        : user.isBanned || !user.isActive
                          ? "Akun diblokir/nonaktif — buka blokir dulu sebelum reset kata sandi."
                          : undefined
                    }
                  >
                    Reset kata sandi
                  </Button>
                ) : null}
                {user.flaggedForReview ? (
                  <Button
                    variant="secondary"
                    size="sm"
                    fullWidth={false}
                    loading={acting === "clear-flag"}
                    onClick={() => setClearFlagOpen(true)}
                  >
                    Hapus flag review
                  </Button>
                ) : null}
                {isSuperAdmin && (!user.email || user.isBanned || !user.isActive) ? (
                  <p className="w-full text-caption text-text-tertiary">
                    {!user.email
                      ? "Reset kata sandi dinonaktifkan: akun ini tidak punya email (akun phone-only) — belum ada jalur reset via WhatsApp/HP."
                      : "Reset kata sandi dinonaktifkan: akun diblokir/nonaktif — buka blokir dulu."}
                  </p>
                ) : null}
              </div>
            </CardBody>
          </Card>
            </div>
          )}
        </>
      ) : null}

      {/* ---- BAI-071: ubah tipe akun (whitelist backend) ---- */}
      <Dialog
        open={accountTypeOpen}
        onClose={() => setAccountTypeOpen(false)}
        title="Ubah tipe akun"
        description="Koreksi operasional tipe akun pengguna. Perubahan tercatat di audit log dan badge publik disinkronkan ulang."
        footer={
          <div className="flex flex-col gap-2">
            <Button
              variant="primary"
              loading={acting === "account-type"}
              onClick={handleAccountTypeConfirm}
            >
              Simpan
            </Button>
            <Button
              variant="ghost"
              disabled={acting === "account-type"}
              onClick={() => setAccountTypeOpen(false)}
            >
              Batal
            </Button>
          </div>
        }
      >
        <Select
          label="Tipe akun"
          options={[
            { value: "PERSONAL", label: "Personal" },
            { value: "BUSINESS", label: "Bisnis" },
          ]}
          value={accountTypeDraft}
          onChange={(e) => setAccountTypeDraft(e.target.value)}
        />
      </Dialog>

      {/* ---- BAI-074: tangguhkan (suspend ringan) ---- */}
      <Dialog
        open={suspendOpen}
        onClose={() => setSuspendOpen(false)}
        title="Tangguhkan pengguna"
        description="Penangguhan ringan berbatas waktu: sesi aktif dicabut dan login diblokir sampai durasi habis (buka otomatis). Tercatat di audit log."
        footer={
          <div className="flex flex-col gap-2">
            <Button
              variant="primary"
              loading={acting === "suspend"}
              disabled={suspendReason.trim().length < 10}
              onClick={handleSuspendConfirm}
            >
              Tangguhkan
            </Button>
            <Button
              variant="ghost"
              disabled={acting === "suspend"}
              onClick={() => setSuspendOpen(false)}
            >
              Batal
            </Button>
          </div>
        }
      >
        <div className="space-y-4">
          <TextArea
            label="Alasan penangguhan"
            required
            rows={4}
            value={suspendReason}
            onChange={(e) => setSuspendReason(e.target.value)}
            placeholder="Minimal 10 karakter…"
            maxLength={500}
            hint={`${suspendReason.trim().length} / 10 karakter minimum (maks 500)`}
            error={suspendReasonError ?? undefined}
          />
          <Input
            label="Durasi (jam)"
            type="number"
            min={1}
            max={720}
            value={suspendHours}
            onChange={(e) => setSuspendHours(e.target.value)}
            hint="1–720 jam (maks 30 hari)"
          />
        </div>
      </Dialog>

      {/* ---- BAI-074: batalkan penangguhan ---- */}
      <ConfirmDialog
        open={unsuspendOpen}
        onClose={() => setUnsuspendOpen(false)}
        title="Batalkan penangguhan?"
        description="Penangguhan dibuka sebelum waktunya. Sesi yang dicabut saat penangguhan TIDAK dipulihkan — pengguna harus masuk ulang."
        confirmLabel="Batalkan penangguhan"
        loading={acting === "unsuspend"}
        onConfirm={async () => {
          setUnsuspendOpen(false)
          await runAction("unsuspend", () => unsuspendUser(userId), "Penangguhan dibatalkan")
        }}
      />

      {/* ---- Dialog: blokir ---- */}
      <Dialog
        open={banOpen}
        onClose={() => setBanOpen(false)}
        title="Blokir pengguna"
        description={`Tulis alasan pemblokiran ${displayName}. Pengguna tidak bisa masuk dan bertransaksi.`}
        footer={
          <Button
            variant="destructive"
            loading={acting === "ban"}
            onClick={() => void handleBanConfirm()}
          >
            Blokir pengguna
          </Button>
        }
      >
        <TextArea
          label="Alasan blokir"
          required
          rows={4}
          placeholder="Minimal 5 karakter…"
          value={banReason}
          onChange={(e) => {
            setBanReason(e.target.value)
            setBanReasonError(null)
          }}
          error={banReasonError ?? undefined}
          maxLength={500}
        />
      </Dialog>

      {/* ---- Konfirmasi: buka blokir ---- */}
      <ConfirmDialog
        open={unbanOpen}
        onClose={() => setUnbanOpen(false)}
        title="Buka blokir pengguna?"
        description={`${displayName} akan bisa masuk dan bertransaksi kembali.`}
        confirmLabel="Buka blokir"
        loading={acting === "unban"}
        onConfirm={() => {
          setUnbanOpen(false)
          void runAction("unban", () => unbanUser(userId), "Blokir dibuka")
        }}
      />

      {/* ---- Konfirmasi: paksa logout ---- */}
      <ConfirmDialog
        open={forceLogoutOpen}
        onClose={() => setForceLogoutOpen(false)}
        title="Paksa logout pengguna?"
        description={`Semua sesi aktif ${displayName} akan dicabut.`}
        confirmLabel="Paksa logout"
        destructive
        loading={acting === "force-logout"}
        onConfirm={() => {
          setForceLogoutOpen(false)
          setActing("force-logout")
          forceLogout(userId)
            .then((res) => {
              toast.show({
                title: "Semua sesi dicabut",
                description: `${res.revokedCount} sesi dicabut.`,
                tone: "success",
              })
              return loadAll()
            })
            .catch((e: unknown) => fail("Aksi gagal", e))
            .finally(() => setActing(null))
        }}
      />

      {/* ---- Konfirmasi: cabut sesi ---- */}
      <ConfirmDialog
        open={revokeTarget !== null}
        onClose={() => setRevokeTarget(null)}
        title="Cabut sesi ini?"
        description={
          revokeTarget
            ? `Perangkat "${revokeTarget.deviceInfo?.trim() || "tidak dikenal"}"${revokeTarget.ipAddress ? ` (${revokeTarget.ipAddress})` : ""} akan keluar dan harus login ulang.`
            : undefined
        }
        confirmLabel="Cabut sesi"
        destructive
        loading={revokeTarget != null && acting === `revoke-${revokeTarget.id}`}
        onConfirm={() => {
          const target = revokeTarget
          if (!target) return
          setRevokeTarget(null)
          const label = `revoke-${target.id}`
          setActing(label)
          revokeUserSession(userId, target.id)
            .then(() => loadAll())
            .then(() =>
              toast.show({ title: "Sesi dicabut", tone: "success" }),
            )
            .catch((e: unknown) => fail("Gagal mencabut sesi", e))
            .finally(() => setActing(null))
        }}
      />

      {/* ---- Konfirmasi: reset kata sandi ----
          ADM-001: copy jujur — backend mengirim OTP (BUKAN link), dan kata
          sandi lama TETAP berlaku sampai pengguna menyelesaikan reset. */}
      <ConfirmDialog
        open={resetPasswordOpen}
        onClose={() => setResetPasswordOpen(false)}
        title="Reset kata sandi?"
        description={`Kode OTP reset akan dikirim ke ${user?.email ? maskEmail(user.email) : "email pengguna"}. Kata sandi lama tetap berlaku sampai pengguna menyelesaikan reset dengan kode tersebut.`}
        confirmLabel="Kirim kode OTP"
        loading={acting === "reset-password"}
        onConfirm={() => {
          setResetPasswordOpen(false)
          void runAction(
            "reset-password",
            () => resetUserPassword(userId),
            "Reset kata sandi diproses",
          )
        }}
      />

      {/* ---- Konfirmasi: hapus flag review ---- */}
      <ConfirmDialog
        open={clearFlagOpen}
        onClose={() => setClearFlagOpen(false)}
        title="Hapus flag review?"
        description={`Flag moderasi otomatis pada ${displayName} akan dihapus.`}
        confirmLabel="Hapus flag"
        loading={acting === "clear-flag"}
        onConfirm={() => {
          setClearFlagOpen(false)
          void runAction(
            "clear-flag",
            () => clearReviewFlag(userId),
            "Flag review dihapus",
          )
        }}
      />

      {/* ---- Dialog: sesuaikan saldo (form) ---- */}
      <Dialog
        open={adjustOpen}
        onClose={() => setAdjustOpen(false)}
        title="Sesuaikan saldo"
        description="Penyesuaian manual tercatat sebagai mutasi admin (SUPER_ADMIN)."
        footer={
          <Button
            variant="primary"
            disabled={acting === "adjust"}
            onClick={handleAdjustNext}
          >
            Lanjut ke konfirmasi
          </Button>
        }
      >
        <div className="flex flex-col gap-4">
          <Select
            label="Jenis penyesuaian"
            options={[
              { value: "CREDIT", label: "Kredit (tambah saldo)" },
              { value: "DEBIT", label: "Debit (kurangi saldo)" },
            ]}
            value={adjustType}
            onChange={(e) => setAdjustType(e.target.value as WalletAdjustType)}
          />
          <Input
            label="Jumlah (Rp)"
            required
            placeholder="100000"
            inputMode="numeric"
            value={adjustAmount}
            onChange={(e) => {
              setAdjustAmount(e.target.value.replace(/[^0-9]/g, ""))
              setAdjustError(null)
            }}
            hint={`Rp 1 – Rp ${formatNumber(MAX_ADJUST_IDR)}`}
            error={adjustError ?? undefined}
            maxLength={8}
          />
          <TextArea
            label="Alasan penyesuaian"
            required
            rows={3}
            placeholder="Minimal 5 karakter…"
            value={adjustReason}
            onChange={(e) => {
              setAdjustReason(e.target.value)
              setAdjustError(null)
            }}
            maxLength={1000}
          />
        </div>
      </Dialog>

      {/* ---- Konfirmasi ganda: sesuaikan saldo ---- */}
      <ConfirmDialog
        open={adjustConfirmOpen}
        onClose={() => setAdjustConfirmOpen(false)}
        title="Konfirmasi penyesuaian saldo"
        description={`${adjustType === "CREDIT" ? "Menambah" : "Mengurangi"} saldo ${displayName} sebesar ${rp(adjustAmountNum)} · Alasan: ${adjustReason.trim()}`}
        confirmLabel="Simpan penyesuaian"
        destructive={adjustType === "DEBIT"}
        loading={acting === "adjust"}
        onConfirm={() => void handleAdjustConfirm()}
      />
      {/* ---- Konfirmasi: beri tier emas ---- */}
      <ConfirmDialog
        open={goldGrantOpen}
        onClose={() => setGoldGrantOpen(false)}
        title="Beri tier emas?"
        description={`Tier emas (Dipercaya Kahade) akan diberikan ke ${displayName}. Tier ini untuk customer pilihan.`}
        confirmLabel="Beri emas"
        loading={acting === "gold-grant"}
        onConfirm={handleGoldGrantConfirm}
      />

      {/* ---- Konfirmasi: cabut tier emas ---- */}
      <ConfirmDialog
        open={goldRevokeOpen}
        onClose={() => setGoldRevokeOpen(false)}
        title="Cabut tier emas?"
        description={`Tier emas akan dicabut dari ${displayName}.`}
        confirmLabel="Cabut emas"
        destructive
        loading={acting === "gold-revoke"}
        onConfirm={handleGoldRevokeConfirm}
      />

      {/* ---- Dialog: cabut tier abu (alasan wajib) ---- */}
      <Dialog
        open={grayRevokeOpen}
        onClose={() => setGrayRevokeOpen(false)}
        title="Cabut tier abu"
        description={`Tier abu (Terverifikasi Penuh) ${displayName} akan dicabut. Badge hilang sampai dipulihkan.`}
        footer={
          <Button
            variant="destructive"
            loading={acting === "gray-revoke"}
            onClick={handleGrayRevokeConfirm}
          >
            Cabut tier abu
          </Button>
        }
      >
        <TextArea
          label="Alasan pencabutan"
          required
          rows={4}
          placeholder="Minimal 10 karakter…"
          value={grayReason}
          onChange={(e) => {
            setGrayReason(e.target.value)
            setGrayReasonError(null)
          }}
          error={grayReasonError ?? undefined}
          maxLength={1000}
        />
      </Dialog>

      {/* ---- Konfirmasi: pulihkan tier abu ---- */}
      <ConfirmDialog
        open={grayRestoreOpen}
        onClose={() => setGrayRestoreOpen(false)}
        title="Pulihkan tier abu?"
        description={`Tier abu (Terverifikasi Penuh) ${displayName} akan dipulihkan.`}
        confirmLabel="Pulihkan"
        loading={acting === "gray-restore"}
        onConfirm={handleGrayRestoreConfirm}
      />
    </RoleGate>
  )
}
