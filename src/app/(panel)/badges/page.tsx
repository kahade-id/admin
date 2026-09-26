"use client"

/**
 * Admin — Verifikasi & Badge.
 *
 * DUA SECTION YANG TERPISAH TEGAS:
 *
 * 1. "Tingkat Verifikasi" — 3 tier seal verified (abu/biru/emas):
 *    - Abu  (FULLY_VERIFIED)    : otomatis (email + KYC + HP + alamat + Kahade
 *      Plus). Admin bisa cabut (alasan min 10) / pulihkan — di halaman ini hanya
 *      SUPER_ADMIN (halaman ini dibatasi RBAC ke SUPER_ADMIN; endpoint
 *      verified-gray di users controller juga mengizinkan KYC_ADMIN,
 *      tetapi tidak ada halaman badges untuk KYC_ADMIN).
 *    - Biru (BUSINESS_VERIFIED) : verifikasi manual di halaman Verifikasi Bisnis.
 *    - Emas (TRUSTED_BY_KAHADE) : diberikan manual ke customer pilihan, bisa
 *      dicabut kapan pun. Hanya SUPER_ADMIN.
 * 2. "Badge Event" — badge pencapaian/event (buat/hapus/beri/cabut).
 *    Badge BUKAN verifikasi; model Badge tidak punya tier.
 */

import { useCallback, useEffect, useState } from "react"
import Link from "next/link"

import { Badge } from "@/components/ui/badge"
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
import {
  awardBadge,
  createBadge,
  deleteBadge,
  getBadgeDetail,
  listBadges,
  revokeBadge,
  type AdminBadge,
  type BadgeHolder,
} from "@/lib/api/admin/badges"
import {
  grantGoldVerified,
  revokeGoldVerified,
  revokeGrayVerified,
  restoreGrayVerified,
} from "@/lib/api/admin/verified"
import { userMessage } from "@/lib/api/response"
import { formatDateTimeWIB } from "@/lib/format"
import { useAuth } from "@/lib/auth-context"

const PAGE_SIZE = 20

function holderName(h: BadgeHolder): string {
  return (
    h.fullName?.trim() || (h.username ? `@${h.username}` : null) || h.userId.slice(0, 12)
  )
}

type Detail = AdminBadge & { holders?: BadgeHolder[] }

// ------------------------------------------------------------------
// Section 1: Tingkat Verifikasi
// ------------------------------------------------------------------

function VerificationSection() {
  const toast = useToast()
  const { role } = useAuth()
  const isSuperAdmin = role === "SUPER_ADMIN"
  // AW-009: halaman ini hanya untuk SUPER_ADMIN (MENU di src/lib/rbac.ts).
  // KYC_ADMIN diizinkan backend pada endpoint verified-gray, namun tidak
  // memiliki akses halaman badges — cabang KYC_ADMIN di sini mati dan dihapus.
  const canManageGray = isSuperAdmin

  const [acting, setActing] = useState<string | null>(null)

  // Emas
  const [goldUserId, setGoldUserId] = useState("")
  const [goldGrantOpen, setGoldGrantOpen] = useState(false)
  const [goldRevokeOpen, setGoldRevokeOpen] = useState(false)

  // Abu
  const [grayUserId, setGrayUserId] = useState("")
  const [grayRevokeOpen, setGrayRevokeOpen] = useState(false)
  const [grayRestoreOpen, setGrayRestoreOpen] = useState(false)
  const [grayReason, setGrayReason] = useState("")
  const [grayReasonError, setGrayReasonError] = useState<string | null>(null)

  const fail = (title: string, e: unknown) => {
    toast.show({ title, description: userMessage(e), tone: "danger" })
  }

  const runVerifiedAction = async (
    label: string,
    fn: () => Promise<{ message: string }>,
    successTitle: string,
  ) => {
    setActing(label)
    try {
      const res = await fn()
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

  const needUserId = (value: string): string | null => {
    const v = value.trim()
    return v ? v : null
  }

  // ---- Emas ----
  const handleGoldGrant = () => {
    const target = needUserId(goldUserId)
    if (!target) return
    setGoldGrantOpen(false)
    void runVerifiedAction("gold-grant", () => grantGoldVerified(target), "Tier emas diberikan")
  }

  const handleGoldRevoke = () => {
    const target = needUserId(goldUserId)
    if (!target) return
    setGoldRevokeOpen(false)
    void runVerifiedAction("gold-revoke", () => revokeGoldVerified(target), "Tier emas dicabut")
  }

  // ---- Abu ----
  const handleGrayRevoke = () => {
    const target = needUserId(grayUserId)
    if (!target) return
    const reason = grayReason.trim()
    if (reason.length < 10) {
      setGrayReasonError("Alasan pencabutan minimal 10 karakter.")
      return
    }
    setGrayReasonError(null)
    setGrayRevokeOpen(false)
    setGrayReason("")
    void runVerifiedAction(
      "gray-revoke",
      () => revokeGrayVerified(target, reason),
      "Tier abu dicabut",
    )
  }

  const handleGrayRestore = () => {
    const target = needUserId(grayUserId)
    if (!target) return
    setGrayRestoreOpen(false)
    void runVerifiedAction("gray-restore", () => restoreGrayVerified(target), "Tier abu dipulihkan")
  }

  return (
    <section className="mb-8">
      <div className="mb-4">
        <h2 className="text-h3 font-bold text-text-primary">Tingkat Verifikasi</h2>
        <p className="mt-1 text-body text-text-secondary">
          Seal verified 3 tingkat. Berbeda dengan Badge Event di bawah — badge tidak
          memberi status verifikasi.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        {/* ---- Abu ---- */}
        <Card>
          <div className="mb-2 flex items-center gap-2">
            <Badge tone="neutral">Abu</Badge>
            <p className="font-semibold text-text-primary">Terverifikasi Penuh</p>
          </div>
          <p className="mb-4 text-caption text-text-secondary">
            Diberikan <strong>otomatis</strong> bila: email terverifikasi + KYC disetujui +
            no. HP terverifikasi + alamat lengkap + berlangganan Kahade Plus. Admin dapat
            mencabut atau memulihkannya kapan pun.
          </p>
          {canManageGray ? (
            <div className="space-y-2">
              <Input
                label="ID pengguna"
                value={grayUserId}
                onChange={(e) => setGrayUserId(e.target.value)}
                placeholder="cth: 550e8400-…"
              />
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="secondary"
                  size="sm"
                  fullWidth={false}
                  disabled={!grayUserId.trim() || acting !== null}
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
                  disabled={!grayUserId.trim() || acting !== null}
                  loading={acting === "gray-restore"}
                  onClick={() => setGrayRestoreOpen(true)}
                >
                  Pulihkan abu
                </Button>
              </div>
            </div>
          ) : (
            <p className="text-caption text-text-tertiary">
              Hanya Super Admin dan Admin KYC yang dapat mengelola tier abu.
            </p>
          )}
        </Card>

        {/* ---- Biru ---- */}
        <Card>
          <div className="mb-2 flex items-center gap-2">
            <Badge tone="info">Biru</Badge>
            <p className="font-semibold text-text-primary">Bisnis Terverifikasi</p>
          </div>
          <p className="mb-4 text-caption text-text-secondary">
            Diberikan <strong>manual</strong> oleh admin setelah memeriksa dokumen dan
            legalitas bisnis. Dapat dicabut bila bisnis tidak lagi memenuhi syarat.
          </p>
          <Link href="/business">
            <Button variant="secondary" size="sm" fullWidth={false}>
              Buka Verifikasi Bisnis →
            </Button>
          </Link>
        </Card>

        {/* ---- Emas ---- */}
        <Card>
          <div className="mb-2 flex items-center gap-2">
            <Badge tone="warning">Emas</Badge>
            <p className="font-semibold text-text-primary">Dipercaya Kahade</p>
          </div>
          <p className="mb-4 text-caption text-text-secondary">
            Tier tertinggi — diberikan <strong>manual</strong> oleh Super Admin kepada
            customer pilihan. Dapat dicabut kapan pun.
          </p>
          {isSuperAdmin ? (
            <div className="space-y-2">
              <Input
                label="ID pengguna"
                value={goldUserId}
                onChange={(e) => setGoldUserId(e.target.value)}
                placeholder="cth: 550e8400-…"
              />
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="primary"
                  size="sm"
                  fullWidth={false}
                  disabled={!goldUserId.trim() || acting !== null}
                  loading={acting === "gold-grant"}
                  onClick={() => setGoldGrantOpen(true)}
                >
                  Beri emas
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  fullWidth={false}
                  disabled={!goldUserId.trim() || acting !== null}
                  loading={acting === "gold-revoke"}
                  onClick={() => setGoldRevokeOpen(true)}
                >
                  Cabut emas
                </Button>
              </div>
            </div>
          ) : (
            <p className="text-caption text-text-tertiary">
              Hanya Super Admin yang dapat memberi/mencabut tier emas.
            </p>
          )}
        </Card>
      </div>

      {/* ---- Dialog: beri emas ---- */}
      <ConfirmDialog
        open={goldGrantOpen}
        onClose={() => setGoldGrantOpen(false)}
        title="Beri tier emas?"
        description={`Tier emas (Dipercaya Kahade) akan diberikan ke pengguna "${goldUserId.trim()}". Tier ini untuk customer pilihan.`}
        confirmLabel="Beri emas"
        loading={acting === "gold-grant"}
        onConfirm={handleGoldGrant}
      />

      {/* ---- Dialog: cabut emas ---- */}
      <ConfirmDialog
        open={goldRevokeOpen}
        onClose={() => setGoldRevokeOpen(false)}
        title="Cabut tier emas?"
        description={`Tier emas akan dicabut dari pengguna "${goldUserId.trim()}".`}
        confirmLabel="Cabut emas"
        destructive
        loading={acting === "gold-revoke"}
        onConfirm={handleGoldRevoke}
      />

      {/* ---- Dialog: cabut abu (alasan wajib) ---- */}
      <Dialog
        open={grayRevokeOpen}
        onClose={() => setGrayRevokeOpen(false)}
        title="Cabut tier abu"
        description={`Tier abu (Terverifikasi Penuh) pengguna "${grayUserId.trim()}" akan dicabut. Syarat otomatis tidak berubah — badge hilang sampai dipulihkan.`}
        footer={
          <Button
            variant="destructive"
            loading={acting === "gray-revoke"}
            onClick={handleGrayRevoke}
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

      {/* ---- Dialog: pulihkan abu ---- */}
      <ConfirmDialog
        open={grayRestoreOpen}
        onClose={() => setGrayRestoreOpen(false)}
        title="Pulihkan tier abu?"
        description={`Tier abu (Terverifikasi Penuh) pengguna "${grayUserId.trim()}" akan dipulihkan.`}
        confirmLabel="Pulihkan"
        loading={acting === "gray-restore"}
        onConfirm={handleGrayRestore}
      />
    </section>
  )
}

// ------------------------------------------------------------------
// Section 2: Badge Event
// ------------------------------------------------------------------

function BadgeEventSection() {
  const toast = useToast()

  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [rows, setRows] = useState<AdminBadge[]>([])
  const [total, setTotal] = useState(0)
  const [totalPages, setTotalPages] = useState(1)

  const [createOpen, setCreateOpen] = useState(false)
  const [createName, setCreateName] = useState("")
  const [createNameError, setCreateNameError] = useState<string | null>(null)
  const [createDescription, setCreateDescription] = useState("")
  const [createIconUrl, setCreateIconUrl] = useState("")
  const [creating, setCreating] = useState(false)

  const [detailOpen, setDetailOpen] = useState(false)
  const [detail, setDetail] = useState<Detail | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [detailError, setDetailError] = useState<string | null>(null)
  const [selectedBadgeId, setSelectedBadgeId] = useState<string | null>(null)

  const [awardUserId, setAwardUserId] = useState("")
  const [awardUserError, setAwardUserError] = useState<string | null>(null)
  const [awarding, setAwarding] = useState(false)

  const [revokeTarget, setRevokeTarget] = useState<BadgeHolder | null>(null)
  const [revoking, setRevoking] = useState(false)

  const [deleteOpen, setDeleteOpen] = useState(false)
  const [deleting, setDeleting] = useState(false)

  const load = useCallback(
    async (mode: "initial" | "refresh" = "initial", targetPage = page) => {
      if (mode === "initial") setLoading(true)
      else setRefreshing(true)
      setError(null)
      try {
        const res = await listBadges({ page: targetPage, limit: PAGE_SIZE })
        setRows(res.data ?? [])
        const t = res.total ?? res.data?.length ?? 0
        setTotal(t)
        setTotalPages(res.totalPages ?? Math.max(1, Math.ceil(t / PAGE_SIZE)))
      } catch (e) {
        const msg = userMessage(e)
        setError(msg)
        toast.show({ title: "Gagal memuat badge", description: msg, tone: "danger" })
      } finally {
        setLoading(false)
        setRefreshing(false)
      }
    },
    [page, toast],
  )

  useEffect(() => {
    void load("initial")
  }, [load])

  const handlePageChange = (p: number) => {
    setPage(p)
    void load("initial", p)
  }

  const fail = (title: string, e: unknown) => {
    toast.show({ title, description: userMessage(e), tone: "danger" })
  }

  const loadDetail = async (badgeId: string) => {
    setDetailLoading(true)
    setDetailError(null)
    try {
      setDetail(await getBadgeDetail(badgeId))
    } catch (e) {
      setDetailError(userMessage(e))
    } finally {
      setDetailLoading(false)
    }
  }

  const openDetail = (badge: AdminBadge) => {
    setDetail(null)
    setDetailOpen(true)
    setSelectedBadgeId(badge.id)
    setAwardUserId("")
    setAwardUserError(null)
    void loadDetail(badge.id)
  }

  const closeDetail = () => {
    if (awarding || revoking || deleting) return
    setDetailOpen(false)
  }

  const handleCreate = async () => {
    if (creating) return
    const name = createName.trim()
    if (!name) {
      setCreateNameError("Nama badge wajib diisi.")
      return
    }
    setCreateNameError(null)
    setCreating(true)
    try {
      await createBadge({
        name,
        description: createDescription.trim() || undefined,
        iconUrl: createIconUrl.trim() || undefined,
      })
      toast.show({ title: "Badge dibuat", tone: "success" })
      setCreateOpen(false)
      setCreateName("")
      setCreateDescription("")
      setCreateIconUrl("")
      await load("refresh")
    } catch (e) {
      fail("Gagal membuat badge", e)
    } finally {
      setCreating(false)
    }
  }

  const handleAward = async () => {
    if (!detail || awarding) return
    const userId = awardUserId.trim()
    if (!userId) {
      setAwardUserError("ID pengguna wajib diisi.")
      return
    }
    setAwardUserError(null)
    setAwarding(true)
    try {
      await awardBadge(detail.id, userId)
      toast.show({ title: "Badge diberikan", tone: "success" })
      setAwardUserId("")
      await loadDetail(detail.id)
      await load("refresh")
    } catch (e) {
      fail("Gagal memberi badge", e)
    } finally {
      setAwarding(false)
    }
  }

  const handleRevokeConfirm = async () => {
    if (!detail || !revokeTarget || revoking) return
    setRevoking(true)
    try {
      await revokeBadge(detail.id, revokeTarget.userId)
      toast.show({ title: "Badge dicabut", tone: "success" })
      setRevokeTarget(null)
      await loadDetail(detail.id)
      await load("refresh")
    } catch (e) {
      fail("Gagal mencabut badge", e)
    } finally {
      setRevoking(false)
    }
  }

  const handleDelete = async () => {
    if (!detail || deleting) return
    setDeleting(true)
    try {
      await deleteBadge(detail.id)
      toast.show({ title: "Badge dihapus", tone: "success" })
      setDeleteOpen(false)
      setDetailOpen(false)
      await load("refresh")
    } catch (e) {
      fail("Gagal menghapus badge", e)
    } finally {
      setDeleting(false)
    }
  }

  return (
    <section>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-h3 font-bold text-text-primary">Badge Event</h2>
          <p className="mt-1 text-body text-text-secondary">
            Badge pencapaian/event — misalnya pemenang lomba atau partisipan program.
            Badge <strong>bukan</strong> status verifikasi.
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button
            variant="secondary"
            size="sm"
            fullWidth={false}
            loading={refreshing}
            onClick={() => load("refresh")}
          >
            Muat ulang
          </Button>
          <Button variant="primary" size="sm" fullWidth={false} onClick={() => setCreateOpen(true)}>
            Buat badge
          </Button>
        </div>
      </div>

      {loading ? (
        <div className="flex min-h-[40vh] items-center justify-center gap-2">
          <Spinner size="md" />
          <p className="text-body text-text-secondary">Memuat badge…</p>
        </div>
      ) : error ? (
        <Card>
          <EmptyState
            title="Gagal memuat badge"
            description={error}
            action={
              <Button variant="secondary" fullWidth={false} onClick={() => load("initial")}>
                Coba lagi
              </Button>
            }
          />
        </Card>
      ) : (
        <>
          <DataTable<AdminBadge>
            columns={[
              {
                key: "name",
                header: "Badge",
                render: (r) => (
                  <div>
                    <p className="font-semibold">{r.name}</p>
                    {r.description ? (
                      <p className="text-caption text-text-secondary">{r.description}</p>
                    ) : null}
                  </div>
                ),
              },
              {
                key: "holderCount",
                header: "Pemegang",
                render: (r) => String(r.holderCount ?? 0),
              },
              {
                key: "createdAt",
                header: "Dibuat",
                render: (r) => (r.createdAt ? formatDateTimeWIB(r.createdAt) : "—"),
              },
              {
                key: "action",
                header: "",
                align: "right",
                render: (r) => (
                  <button
                    type="button"
                    onClick={() => openDetail(r)}
                    className="font-semibold text-info-text hover:underline"
                  >
                    Detail
                  </button>
                ),
              },
            ]}
            rows={rows}
            rowKey={(r) => r.id}
            emptyText="Belum ada badge. Buat badge pertama untuk mulai memberi penghargaan."
          />
          <Pagination
            page={page}
            totalPages={totalPages}
            total={total}
            pageSize={PAGE_SIZE}
            onPageChange={handlePageChange}
            className="mt-4"
          />
        </>
      )}

      {/* Dialog detail badge: beri + pemegang + hapus */}
      <Dialog open={detailOpen} onClose={closeDetail} title="Detail badge">
        {detailLoading ? (
          <div className="flex items-center justify-center gap-2 py-8">
            <Spinner size="sm" />
            <p className="text-body text-text-secondary">Memuat detail badge…</p>
          </div>
        ) : detailError ? (
          <div className="py-4 text-center">
            <p className="text-body text-danger-text">{detailError}</p>
            <Button
              variant="secondary"
              size="sm"
              fullWidth={false}
              className="mt-3"
              onClick={() => selectedBadgeId && void loadDetail(selectedBadgeId)}
            >
              Coba lagi
            </Button>
          </div>
        ) : detail ? (
          <div className="space-y-5">
            <div className="min-w-0">
              <p className="text-body font-semibold text-text-primary">{detail.name}</p>
              {detail.description ? (
                <p className="mt-0.5 text-caption text-text-secondary">{detail.description}</p>
              ) : null}
            </div>

            <div className="space-y-2 border-t border-border pt-4">
              <Input
                label="ID pengguna"
                value={awardUserId}
                onChange={(e) => {
                  setAwardUserId(e.target.value)
                  if (awardUserError) setAwardUserError(null)
                }}
                error={awardUserError ?? undefined}
                placeholder="cth: 550e8400-…"
                hint="ID pengguna (bukan username)."
              />
              <Button variant="primary" loading={awarding} onClick={handleAward}>
                Beri badge
              </Button>
            </div>

            <div className="space-y-2 border-t border-border pt-4">
              <p className="text-label font-semibold text-text-secondary">
                Pemegang
                {detail.holders && detail.holders.length > 0
                  ? ` (${detail.holders.length})`
                  : ""}
              </p>
              {detail.holders && detail.holders.length > 0 ? (
                <ul className="space-y-2">
                  {detail.holders.map((h) => (
                    <li
                      key={h.userId}
                      className="flex items-center justify-between gap-2 rounded-sm border border-border px-3 py-2"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-body font-semibold text-text-primary">
                          {holderName(h)}
                        </p>
                        <p className="text-caption text-text-tertiary">
                          Diberi {formatDateTimeWIB(h.awardedAt)}
                        </p>
                      </div>
                      <Button
                        variant="secondary"
                        size="sm"
                        fullWidth={false}
                        onClick={() => setRevokeTarget(h)}
                      >
                        Cabut
                      </Button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-caption text-text-secondary">Belum ada pemegang badge ini.</p>
              )}
            </div>

            <div className="border-t border-border pt-4">
              <Button variant="destructive" fullWidth={false} onClick={() => setDeleteOpen(true)}>
                Hapus badge
              </Button>
            </div>
          </div>
        ) : null}
      </Dialog>

      {/* Cabut badge dari pemegang */}
      <ConfirmDialog
        open={revokeTarget !== null}
        onClose={() => setRevokeTarget(null)}
        title="Cabut badge?"
        description={
          revokeTarget
            ? `Badge akan dicabut dari ${holderName(revokeTarget)}.`
            : undefined
        }
        confirmLabel="Cabut"
        cancelLabel="Batal"
        loading={revoking}
        destructive
        onConfirm={handleRevokeConfirm}
      />

      {/* Hapus badge */}
      <ConfirmDialog
        open={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        title="Hapus badge?"
        description={
          detail
            ? `Badge "${detail.name}" akan dihapus permanen dan tidak bisa dikembalikan.`
            : undefined
        }
        confirmLabel="Hapus"
        cancelLabel="Batal"
        loading={deleting}
        destructive
        onConfirm={handleDelete}
      />

      {/* Buat badge */}
      <Dialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        title="Buat badge baru"
        footer={
          <div className="flex flex-col gap-2">
            <Button variant="primary" loading={creating} onClick={handleCreate}>
              Simpan
            </Button>
            <Button variant="ghost" disabled={creating} onClick={() => setCreateOpen(false)}>
              Batal
            </Button>
          </div>
        }
      >
        <div className="space-y-4">
          <Input
            label="Nama badge"
            required
            value={createName}
            onChange={(e) => {
              setCreateName(e.target.value)
              if (createNameError) setCreateNameError(null)
            }}
            error={createNameError ?? undefined}
            placeholder="cth: Pemenang Lomba Foto"
          />
          <TextArea
            label="Deskripsi"
            rows={3}
            value={createDescription}
            onChange={(e) => setCreateDescription(e.target.value)}
            placeholder="Deskripsi badge (opsional)…"
          />
          <Input
            label="URL ikon"
            value={createIconUrl}
            onChange={(e) => setCreateIconUrl(e.target.value)}
            placeholder="https://… (opsional)"
          />
        </div>
      </Dialog>
    </section>
  )
}

export default function BadgesPage() {
  return (
    <RoleGate href="/badges">
      <div className="mb-6">
        <h1 className="text-h2 font-bold text-text-primary">Verifikasi & Badge</h1>
        <p className="mt-1 text-body text-text-secondary">
          Kelola tier verifikasi pengguna dan badge event. Keduanya domain terpisah.
        </p>
      </div>
      <VerificationSection />
      <BadgeEventSection />
    </RoleGate>
  )
}
