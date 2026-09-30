/**
 * Admin — Manajemen banner/carousel (batch 43, item #32).
 *
 * CRUD banner: judul, gambar, tautan, urutan, aktif, jadwal tayang.
 * Kontrak endpoint adalah ASUMSI (lihat src/lib/api/admin/banners.ts) —
 * bila backend mega-batch belum menyediakan, halaman menampilkan pesan
 * galat ramah + tombol coba lagi.
 */
"use client"

import Link from "next/link"
import { useCallback, useEffect, useState } from "react"

import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Card, CardBody } from "@/components/ui/card"
import { ConfirmDialog, Dialog } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { DataTable } from "@/components/ui/table"
import { useToast } from "@/components/ui/toast"
import { Pagination } from "@/components/admin/pagination"
import { RoleGate } from "@/components/admin/role-gate"
import { Select } from "@/components/admin/select"
import { userMessage } from "@/lib/api/response"
import { newIdempotencyKey } from "@/lib/api/admin/finance"
import { formatDateTimeWIB } from "@/lib/format"
import {
  createBanner,
  deleteBanner,
  isBannerLive,
  listBanners,
  updateBanner,
  type AdminBannerItem,
  type CreateBannerInput,
} from "@/lib/api/admin/banners"
import { dayToISO, isoToDay, parseIntInput } from "../campaigns/lib"

const PAGE_SIZE = 20

type BannerRow = AdminBannerItem & Record<string, unknown>

function bannerStatusBadge(b: AdminBannerItem) {
  if (!b.isActive) return <Badge tone="neutral" dot>Nonaktif</Badge>
  if (!isBannerLive(b)) return <Badge tone="warning" dot>Jadwal</Badge>
  return <Badge tone="success" dot>Tayang</Badge>
}

/* ------------------------------------------------------------------ */
/* Form banner (buat + ubah)                                            */
/* ------------------------------------------------------------------ */

function BannerForm({
  initial,
  onSubmit,
  submitting,
}: {
  initial?: AdminBannerItem
  onSubmit: (input: CreateBannerInput) => Promise<void>
  submitting: boolean
}) {
  const [title, setTitle] = useState(initial?.title ?? "")
  const [imageUrl, setImageUrl] = useState(initial?.imageUrl ?? "")
  const [linkUrl, setLinkUrl] = useState(initial?.linkUrl ?? "")
  const [sortOrder, setSortOrder] = useState(
    initial != null ? String(initial.sortOrder) : "0",
  )
  const [isActive, setIsActive] = useState(initial?.isActive ?? true)
  // BAI-031 — slot tampil banner (kosong = default backend "home_top").
  const [position, setPosition] = useState(initial?.position ?? "")
  const [startsAt, setStartsAt] = useState(isoToDay(initial?.startsAt))
  const [endsAt, setEndsAt] = useState(isoToDay(initial?.endsAt))
  const [previewBroken, setPreviewBroken] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  async function handleSubmit() {
    setFormError(null)
    if (!title.trim()) {
      setFormError("Judul banner wajib diisi.")
      return
    }
    if (!imageUrl.trim()) {
      setFormError("URL gambar banner wajib diisi.")
      return
    }
    try {
      // Validasi ringan agar salah ketik URL langsung tertangkap di admin.
      // eslint-disable-next-line no-new
      new URL(imageUrl.trim())
      const link = linkUrl.trim()
      if (link && !/^https?:\/\//i.test(link) && !link.startsWith("/")) {
        throw new Error("tautan")
      }
    } catch {
      setFormError("URL gambar/tautan tidak valid (pakai https://… atau path /…).")
      return
    }
    const input: CreateBannerInput = {
      title: title.trim(),
      imageUrl: imageUrl.trim(),
      isActive,
    }
    if (linkUrl.trim()) input.linkUrl = linkUrl.trim()
    const order = parseIntInput(sortOrder)
    if (order !== undefined) input.sortOrder = order
    // BAI-031 — hanya kirim bila diisi; kosong = pakai default backend.
    const pos = position.trim()
    if (pos) input.position = pos
    const from = dayToISO(startsAt, false)
    const until = dayToISO(endsAt, true)
    if (startsAt && !from) {
      setFormError("Tanggal mulai tayang tidak valid.")
      return
    }
    if (endsAt && !until) {
      setFormError("Tanggal akhir tayang tidak valid.")
      return
    }
    if (from && until && new Date(until) <= new Date(from)) {
      setFormError("Tanggal akhir harus setelah tanggal mulai.")
      return
    }
    if (from) input.startsAt = from
    if (until) input.endsAt = until
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
      <Input
        label="Judul banner"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        maxLength={120}
        required
        placeholder="cth. Promo Payday 9.9"
      />
      <Input
        label="URL gambar"
        value={imageUrl}
        onChange={(e) => setImageUrl(e.target.value)}
        placeholder="https://…/banner.jpg"
        hint="URL publik gambar banner (rasio disarankan 16:9 atau sesuai desain aplikasi)."
        required
      />
      {imageUrl.trim() && !previewBroken ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={imageUrl.trim()}
          alt="Pratinjau banner"
          className="h-32 w-full rounded-sm border border-border object-cover"
          onError={() => setPreviewBroken(true)}
        />
      ) : (
        <p className="text-caption text-text-tertiary">
          Pratinjau gambar muncul di sini setelah URL valid diisi.
        </p>
      )}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Input
          label="Tautan (opsional)"
          value={linkUrl}
          onChange={(e) => setLinkUrl(e.target.value)}
          placeholder="cth. /showcase/… atau https://…"
          hint="Tujuan saat banner diketuk di aplikasi. Kosongkan bila tidak ada."
        />
        <Input
          label="Urutan tampil"
          value={sortOrder}
          onChange={(e) => setSortOrder(e.target.value)}
          inputMode="numeric"
          placeholder="0"
          hint="Makin kecil, makin dulu tampil."
        />
        {/* BAI-031 — slot tampil banner (backend: getActiveBanners(position)). */}
        <Input
          label="Posisi slot"
          value={position}
          onChange={(e) => setPosition(e.target.value)}
          placeholder="cth. home_top"
          hint="Slot tampil di aplikasi. Kosongkan untuk default (home_top)."
          maxLength={40}
        />
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Input
          label="Mulai tayang (opsional)"
          type="date"
          value={startsAt}
          onChange={(e) => setStartsAt(e.target.value)}
        />
        <Input
          label="Akhir tayang (opsional)"
          type="date"
          value={endsAt}
          onChange={(e) => setEndsAt(e.target.value)}
        />
      </div>
      <label className="flex cursor-pointer select-none items-center gap-2.5">
        <input
          type="checkbox"
          checked={isActive}
          onChange={(e) => setIsActive(e.target.checked)}
          className="h-4 w-4 accent-primary"
        />
        <span className="text-body text-text-primary">Aktif</span>
      </label>
      <Button loading={submitting} onClick={handleSubmit}>
        {initial ? "Simpan perubahan" : "Buat banner"}
      </Button>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Halaman                                                              */
/* ------------------------------------------------------------------ */

function BannersPageContent() {
  const toast = useToast()
  const [page, setPage] = useState(1)
  const [statusFilter, setStatusFilter] = useState<"all" | "true" | "false">("all")
  const [search, setSearch] = useState("")
  const [rows, setRows] = useState<AdminBannerItem[]>([])
  const [total, setTotal] = useState(0)
  const [totalPages, setTotalPages] = useState(1)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [createOpen, setCreateOpen] = useState(false)
  const [creating, setCreating] = useState(false)
  const [createKey, setCreateKey] = useState<string | null>(null)
  const [editing, setEditing] = useState<AdminBannerItem | null>(null)
  const [updating, setUpdating] = useState(false)
  const [deleting, setDeleting] = useState<AdminBannerItem | null>(null)
  const [deletingNow, setDeletingNow] = useState(false)

  const load = useCallback(
    async (targetPage: number, targetFilter: "all" | "true" | "false", q: string) => {
      setLoading(true)
      setError(null)
      try {
        const res = await listBanners({
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
        toast.show({ title: "Gagal memuat banner", description: msg, tone: "danger" })
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

  async function handleCreate(input: CreateBannerInput) {
    setCreating(true)
    try {
      await createBanner(input, createKey ?? undefined)
      setCreateOpen(false)
      toast.show({ title: "Banner dibuat.", tone: "success" })
      void load(1, statusFilter, search)
    } finally {
      setCreating(false)
    }
  }

  async function handleUpdate(input: CreateBannerInput) {
    if (!editing) return
    setUpdating(true)
    try {
      await updateBanner(editing.id, input)
      setEditing(null)
      toast.show({ title: "Banner diperbarui.", tone: "success" })
      void load(page, statusFilter, search)
    } finally {
      setUpdating(false)
    }
  }

  async function handleDelete() {
    if (!deleting) return
    setDeletingNow(true)
    try {
      await deleteBanner(deleting.id)
      setDeleting(null)
      toast.show({ title: "Banner dihapus.", tone: "success" })
      void load(1, statusFilter, search)
    } catch (e) {
      toast.show({ title: "Gagal menghapus banner", description: userMessage(e), tone: "danger" })
    } finally {
      setDeletingNow(false)
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-h2 font-semibold text-text-primary">Banner &amp; Carousel</h1>
        <p className="mt-1 text-body text-text-secondary">
          Kelola banner promosi yang tampil di aplikasi: judul, gambar, tautan,
          urutan, status aktif, dan jadwal tayang.
        </p>
      </div>

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
            label="Cari judul"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void load(1, statusFilter, search)
            }}
            placeholder="cth. Promo Payday"
            className="w-56"
          />
          <Button variant="secondary" fullWidth={false} onClick={() => load(1, statusFilter, search)}>
            Cari
          </Button>
        </div>
        <Button
          fullWidth={false}
          onClick={() => {
            setCreateKey(newIdempotencyKey())
            setCreateOpen(true)
          }}
        >
          Buat banner
        </Button>
      </div>

      {error && !loading ? (
        <Card>
          <CardBody className="flex flex-col gap-3">
            <p role="alert" className="text-body text-danger-text">
              {error}
            </p>
            <p className="text-caption text-text-secondary">
              Endpoint banner admin mungkin belum tersedia di backend — kontrak
              masih asumsi (batch 43). Pastikan backend sudah di-deploy.
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
          <DataTable<BannerRow>
            columns={[
              {
                key: "title",
                header: "Banner",
                render: (r) => (
                  <div className="flex items-center gap-3">
                    {r.imageUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={r.imageUrl}
                        alt=""
                        className="h-12 w-24 shrink-0 rounded-sm border border-border object-cover"
                      />
                    ) : null}
                    <div>
                      <Link
                        href={`/banners/${encodeURIComponent(r.id)}`}
                        className="font-semibold text-primary hover:underline"
                      >
                        {r.title}
                      </Link>
                      <p className="text-caption text-text-secondary">
                        Urutan {r.sortOrder}
                        {r.linkUrl ? ` · ${r.linkUrl}` : ""}
                      </p>
                    </div>
                  </div>
                ),
              },
              {
                key: "schedule",
                header: "Jadwal tayang",
                render: (r) => (
                  <span className="whitespace-nowrap">
                    {r.startsAt || r.endsAt
                      ? `${r.startsAt ? formatDateTimeWIB(r.startsAt) : "—"} → ${r.endsAt ? formatDateTimeWIB(r.endsAt) : "—"}`
                      : "Tanpa jadwal"}
                  </span>
                ),
              },
              {
                key: "status",
                header: "Status",
                render: (r) => bannerStatusBadge(r),
              },
              {
                key: "action",
                header: "",
                align: "right",
                render: (r) => (
                  <div className="flex justify-end gap-2">
                    <Link href={`/banners/${encodeURIComponent(r.id)}`}>
                      <Button variant="secondary" size="sm" fullWidth={false}>
                        Detail
                      </Button>
                    </Link>
                    <Button
                      variant="secondary"
                      size="sm"
                      fullWidth={false}
                      onClick={() => setEditing(r)}
                    >
                      Ubah
                    </Button>
                    <Button
                      variant="destructive"
                      size="sm"
                      fullWidth={false}
                      onClick={() => setDeleting(r)}
                    >
                      Hapus
                    </Button>
                  </div>
                ),
              },
            ]}
            rows={rows as BannerRow[]}
            rowKey={(r) => r.id}
            loading={loading}
            emptyText="Belum ada banner. Buat banner baru untuk promosi di aplikasi."
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
        title="Buat banner baru"
        description="Banner aktif dan dalam jadwal tayang langsung tampil di aplikasi."
      >
        <BannerForm key="new-banner" onSubmit={handleCreate} submitting={creating} />
      </Dialog>

      <Dialog
        open={editing != null}
        onClose={() => setEditing(null)}
        title="Ubah banner"
        description={editing ? `Mengubah “${editing.title}”.` : undefined}
      >
        {editing ? (
          <BannerForm
            key={editing.id}
            initial={editing}
            onSubmit={handleUpdate}
            submitting={updating}
          />
        ) : null}
      </Dialog>

      <ConfirmDialog
        open={deleting != null}
        onClose={() => setDeleting(null)}
        title="Hapus banner permanen?"
        description={
          deleting
            ? `Banner “${deleting.title}” akan dihapus PERMANEN dari database dan tidak dapat dipulihkan. Riwayat banner ikut hilang.`
            : undefined
        }
        confirmLabel="Ya, hapus permanen"
        onConfirm={handleDelete}
        loading={deletingNow}
        destructive
      />
    </div>
  )
}

export default function BannersPage() {
  return (
    <RoleGate href="/banners">
      <BannersPageContent />
    </RoleGate>
  )
}
