"use client"

/**
 * Admin — Badge & centang EMAS eksklusif.
 *
 * - DataTable badge: nama + deskripsi, tier (gold = centang emas), jumlah
 *   pemegang.
 * - "Buat badge" → Dialog form (nama, deskripsi, URL ikon opsional).
 * - Per badge, tombol "Detail" → Dialog: daftar pemegang (BadgeHolder) +
 *   "Cabut" per pemegang (ConfirmDialog → revokeBadge), "Beri badge"
 *   (input ID pengguna → awardBadge), "Hapus badge" (ConfirmDialog →
 *   deleteBadge).
 *
 * Port dari frontend/app/admin/(panel)/badges/index.tsx → web desktop.
 */

import { useCallback, useEffect, useState } from "react"

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
import { userMessage } from "@/lib/api/response"
import { formatDateTimeWIB } from "@/lib/format"

const PAGE_SIZE = 20

const TIER_LABEL: Record<string, string> = {
  gold: "Gold — centang emas",
  blue: "Biru",
  gray: "Abu-abu",
}

const TIER_TONE: Record<
  string,
  "neutral" | "info" | "success" | "warning" | "danger" | "accent"
> = {
  gold: "warning",
  blue: "info",
  gray: "neutral",
}

function tierLabel(tier: unknown): string {
  const raw = String(tier ?? "").toLowerCase()
  return TIER_LABEL[raw] ?? (raw || "—")
}

function holderName(h: BadgeHolder): string {
  return (
    h.fullName?.trim() || (h.username ? `@${h.username}` : null) || h.userId.slice(0, 12)
  )
}

type Detail = AdminBadge & { holders?: BadgeHolder[] }

export default function BadgesPage() {
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
        const t = res.meta?.total ?? res.total ?? res.data?.length ?? 0
        setTotal(t)
        setTotalPages(res.meta?.totalPages ?? Math.max(1, Math.ceil(t / PAGE_SIZE)))
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
    <RoleGate href="/badges">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-h2 font-bold text-text-primary">Badge & Centang Emas</h1>
          <p className="mt-1 text-body text-text-secondary">
            Kelola badge verifikasi. Memberi badge tier gold menampilkan centang emas di profil
            aplikasi pengguna — berikan hanya untuk akun terverifikasi atau mitra resmi.
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
                key: "tier",
                header: "Tier",
                render: (r) => {
                  const raw = String(r.tier ?? "").toLowerCase()
                  return <Badge tone={TIER_TONE[raw] ?? "neutral"}>{tierLabel(r.tier)}</Badge>
                },
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
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="text-body font-semibold text-text-primary">{detail.name}</p>
                {detail.description ? (
                  <p className="mt-0.5 text-caption text-text-secondary">{detail.description}</p>
                ) : null}
              </div>
              <Badge tone={TIER_TONE[String(detail.tier ?? "").toLowerCase()] ?? "neutral"}>
                {tierLabel(detail.tier)}
              </Badge>
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
            placeholder="cth: Mitra Terverifikasi"
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
    </RoleGate>
  )
}
