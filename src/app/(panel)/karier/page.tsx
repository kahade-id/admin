"use client"

/**
 * Admin — Karier: daftar lowongan (Fase F4).
 *
 * Tabel + tombol tambah + toggle aktif/nonaktif. Tambah/edit lewat dialog
 * mengikuti pola halaman KYC (Dialog). Hapus memakai guard 409
 * DELETE_BLOCKED_HAS_APPLICATIONS: bila masih ada pelamar, hapus ditolak
 * dan admin diminta menutup lowongan (PATCH isActive=false) alih-alih
 * menghapus.
 */

import Link from "next/link"
import { useCallback, useEffect, useMemo, useState } from "react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardBody } from "@/components/ui/card"
import { ConfirmDialog, Dialog } from "@/components/ui/dialog"
import { EmptyState } from "@/components/ui/empty-state"
import { Field, Input, TextArea } from "@/components/ui/input"
import { Spinner } from "@/components/ui/spinner"
import { DataTable } from "@/components/ui/table"
import { useToast } from "@/components/ui/toast"
import { Pagination } from "@/components/admin/pagination"
import { RoleGate } from "@/components/admin/role-gate"
import {
  createPosting,
  deletePosting,
  listPostings,
  updatePosting,
  type JobPosting,
  type JobPostingInput,
} from "@/lib/api/admin/karier"
import { ApiError, userMessage } from "@/lib/api/response"
import { formatDateTimeWIB } from "@/lib/format"
import {
  FieldSelect,
  PageHeader,
} from "@/app/(panel)/_components/admin-ui"

const PAGE_SIZE = 20

const TYPE_OPTIONS = [
  { value: "Penuh waktu", label: "Penuh waktu" },
  { value: "Paruh waktu", label: "Paruh waktu" },
  { value: "Kontrak", label: "Kontrak" },
]

function slugifyTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/[\s_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
}

function isBlockedDelete(err: unknown): boolean {
  return err instanceof ApiError && err.backendCode === "DELETE_BLOCKED_HAS_APPLICATIONS"
}

type FormState = {
  title: string
  slug: string
  location: string
  type: string
  equity: string
  summary: string
  description: string
  requirements: string
  sortOrder: string
  isActive: boolean
  slugTouched: boolean
}

function emptyForm(): FormState {
  return {
    title: "",
    slug: "",
    location: "",
    type: TYPE_OPTIONS[0].value,
    equity: "",
    summary: "",
    description: "",
    requirements: "",
    sortOrder: "0",
    isActive: true,
    slugTouched: false,
  }
}

function formFromPosting(p: JobPosting): FormState {
  return {
    title: p.title,
    slug: p.slug,
    location: p.location,
    type: p.type,
    equity: p.equity,
    summary: p.summary,
    description: p.description,
    requirements: p.requirements.join("\n"),
    sortOrder: String(p.sortOrder),
    isActive: p.isActive,
    slugTouched: true,
  }
}

export default function KarierPage() {
  const toast = useToast()
  const [items, setItems] = useState<JobPosting[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [activeFilter, setActiveFilter] = useState<"" | "true" | "false">("")
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState<JobPosting | null>(null)
  const [form, setForm] = useState<FormState>(emptyForm)
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState<JobPosting | null>(null)
  const [deletingBusy, setDeletingBusy] = useState(false)

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await listPostings({
        page,
        limit: PAGE_SIZE,
        active: activeFilter === "" ? undefined : activeFilter === "true",
      })
      setItems(res.items)
      setTotal(res.total)
    } catch (e) {
      setError(userMessage(e))
    } finally {
      setLoading(false)
    }
  }, [page, activeFilter])

  useEffect(() => {
    void load()
  }, [load])

  const openAdd = () => {
    setEditing(null)
    setForm(emptyForm())
    setDialogOpen(true)
  }

  const openEdit = (p: JobPosting) => {
    setEditing(p)
    setForm(formFromPosting(p))
    setDialogOpen(true)
  }

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((f) => ({ ...f, [key]: value }))

  const onTitleChange = (title: string) => {
    setForm((f) => ({
      ...f,
      title,
      slug: f.slugTouched ? f.slug : slugifyTitle(title),
    }))
  }

  const formValid = useMemo(() => {
    if (!form.title.trim()) return false
    if (!form.location.trim()) return false
    if (!form.equity.trim()) return false
    if (!form.summary.trim()) return false
    if (!form.description.trim()) return false
    if (form.slug && !/^[a-z0-9-]+$/.test(form.slug)) return false
    return true
  }, [form])

  const save = async () => {
    if (!formValid || saving) return
    setSaving(true)
    try {
      const requirements = form.requirements
        .split("\n")
        .map((r) => r.trim())
        .filter(Boolean)
      const dto: JobPostingInput = {
        title: form.title.trim(),
        location: form.location.trim(),
        type: form.type,
        equity: form.equity.trim(),
        summary: form.summary.trim(),
        description: form.description.trim(),
        requirements,
        isActive: form.isActive,
        sortOrder: Number(form.sortOrder) || 0,
      }
      if (form.slug.trim()) dto.slug = form.slug.trim()
      if (editing) {
        await updatePosting(editing.id, dto)
        toast.show({ title: "Lowongan diperbarui", tone: "success" })
      } else {
        await createPosting(dto)
        toast.show({ title: "Lowongan ditambahkan", tone: "success" })
      }
      setDialogOpen(false)
      void load()
    } catch (e) {
      toast.show({ title: "Gagal menyimpan lowongan", description: userMessage(e), tone: "danger" })
    } finally {
      setSaving(false)
    }
  }

  const toggleActive = async (p: JobPosting) => {
    try {
      await updatePosting(p.id, { isActive: !p.isActive })
      toast.show({
        title: p.isActive ? "Lowongan ditutup" : "Lowongan dibuka",
        tone: "success",
      })
      void load()
    } catch (e) {
      toast.show({ title: "Gagal mengubah status", description: userMessage(e), tone: "danger" })
    }
  }

  const confirmDelete = async () => {
    if (!deleting) return
    setDeletingBusy(true)
    try {
      await deletePosting(deleting.id)
      toast.show({ title: "Lowongan dihapus", tone: "success" })
      setDeleting(null)
      void load()
    } catch (e) {
      if (isBlockedDelete(e)) {
        toast.show({
          title: "Lowongan tidak bisa dihapus",
          description:
            "Tutup lowongan bila masih ada pelamar (ubah status menjadi nonaktif).",
          tone: "info",
        })
      } else {
        toast.show({ title: "Gagal menghapus lowongan", description: userMessage(e), tone: "danger" })
      }
    } finally {
      setDeletingBusy(false)
    }
  }

  return (
    <RoleGate href="/karier">
      <PageHeader
        title="Karier"
        description="Kelola lowongan pekerjaan: tambah, edit, tutup, dan hapus."
        actions={
          <>
            <Link href="/karier/pelamar">
              <Button variant="secondary">Semua Pelamar</Button>
            </Link>
            <Button variant="primary" onClick={openAdd}>
              Tambah Lowongan
            </Button>
          </>
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <FieldSelect
          label="Status"
          value={activeFilter}
          onChange={(v) => {
            setActiveFilter(v as "" | "true" | "false")
            setPage(1)
          }}
          options={[
            { value: "", label: "Semua" },
            { value: "true", label: "Aktif" },
            { value: "false", label: "Nonaktif" },
          ]}
        />
      </div>

      {loading ? (
        <div className="flex justify-center py-12">
          <Spinner size="md" />
        </div>
      ) : error ? (
        <EmptyState title="Gagal memuat lowongan" description={error} action={
          <Button variant="secondary" onClick={() => void load()}>Coba lagi</Button>
        } />
      ) : items.length === 0 ? (
        <EmptyState
          title="Belum ada lowongan"
          description="Tambahkan lowongan pertama untuk mulai menerima lamaran."
          action={<Button variant="primary" onClick={openAdd}>Tambah Lowongan</Button>}
        />
      ) : (
        <Card>
          <CardBody>
            <DataTable<JobPosting & Record<string, unknown>>
              columns={[
                {
                  key: "title",
                  header: "Lowongan",
                  render: (p) => (
                    <div>
                      <div className="font-semibold text-text-primary">{p.title}</div>
                      <div className="text-caption text-text-secondary">/{p.slug}</div>
                    </div>
                  ),
                },
                { key: "location", header: "Lokasi", render: (p) => p.location },
                { key: "type", header: "Tipe", render: (p) => p.type },
                { key: "equity", header: "Saham/Equity", render: (p) => p.equity },
                {
                  key: "applicationCount",
                  header: "Pelamar",
                  align: "center",
                  render: (p) => (
                    <Link
                      href={`/karier/${p.id}/pelamar`}
                      className="font-semibold text-text-primary underline-offset-2 hover:underline"
                    >
                      {p.applicationCount}
                    </Link>
                  ),
                },
                {
                  key: "isActive",
                  header: "Status",
                  render: (p) => (
                    <Badge tone={p.isActive ? "success" : "neutral"}>
                      {p.isActive ? "Aktif" : "Nonaktif"}
                    </Badge>
                  ),
                },
                {
                  key: "updatedAt",
                  header: "Diperbarui",
                  render: (p) => (
                    <span className="text-caption text-text-secondary">
                      {formatDateTimeWIB(p.updatedAt)}
                    </span>
                  ),
                },
                {
                  key: "actions",
                  header: "Aksi",
                  render: (p) => (
                    <div className="flex flex-wrap gap-1">
                      <Link href={`/karier/${p.id}/pelamar`}>
                        <Button variant="secondary" size="sm">
                          Pelamar
                        </Button>
                      </Link>
                      <Button variant="secondary" size="sm" onClick={() => openEdit(p)}>
                        Edit
                      </Button>
                      <Button variant="secondary" size="sm" onClick={() => void toggleActive(p)}>
                        {p.isActive ? "Tutup" : "Buka"}
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => setDeleting(p)}>
                        Hapus
                      </Button>
                    </div>
                  ),
                },
              ]}
              rows={items}
              rowKey={(p) => p.id}
            />
            <div className="mt-4">
              <Pagination
                page={page}
                totalPages={totalPages}
                total={total}
                pageSize={PAGE_SIZE}
                onPageChange={setPage}
              />
            </div>
          </CardBody>
        </Card>
      )}

      {/* Dialog tambah / edit — mengikuti pola Dialog halaman KYC */}
      <Dialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        title={editing ? "Edit Lowongan" : "Tambah Lowongan"}
        description={
          editing
            ? "Perbarui detail lowongan. Perubahan langsung terlihat di halaman karir publik."
            : "Lowongan baru akan langsung terlihat di halaman karir publik (bila aktif)."
        }
        dirty={form.title.trim().length > 0 || form.description.trim().length > 0}
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="ghost" disabled={saving} onClick={() => setDialogOpen(false)}>
              Batal
            </Button>
            <Button variant="primary" loading={saving} disabled={!formValid} onClick={() => void save()}>
              {editing ? "Simpan" : "Tambah"}
            </Button>
          </div>
        }
      >
        <div className="space-y-4 pt-1">
          <Field label="Judul posisi" required>
            <Input value={form.title} onChange={(e) => onTitleChange(e.target.value)} placeholder="Co-Founder / COO" />
          </Field>
          <Field
            label="Slug URL"
            hint="Otomatis dari judul; huruf kecil, angka, dan tanda hubung saja."
            error={form.slug && !/^[a-z0-9-]+$/.test(form.slug) ? "Slug hanya boleh berisi huruf kecil, angka, dan tanda hubung." : undefined}
          >
            <Input
              value={form.slug}
              onChange={(e) => set("slug", e.target.value)}
              onFocus={() => set("slugTouched", true)}
              placeholder="co-founder-coo"
            />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Lokasi" required>
              <Input value={form.location} onChange={(e) => set("location", e.target.value)} placeholder="Remote / Jakarta" />
            </Field>
            <FieldSelect label="Tipe" value={form.type} onChange={(v) => set("type", v)} options={TYPE_OPTIONS} />
          </div>
          <Field label="Saham/Equity" required hint="Wajib — ditulis eksplisit (tim awal tanpa gaji).">
            <Input value={form.equity} onChange={(e) => set("equity", e.target.value)} placeholder="15% saham" />
          </Field>
          <Field label="Ringkasan" required hint="1–2 kalimat untuk kartu lowongan.">
            <TextArea value={form.summary} onChange={(e) => set("summary", e.target.value)} rows={2} />
          </Field>
          <Field label="Deskripsi" required hint="Tanggung jawab & kualifikasi (markdown).">
            <TextArea value={form.description} onChange={(e) => set("description", e.target.value)} rows={6} />
          </Field>
          <Field label="Persyaratan" hint="Satu persyaratan per baris.">
            <TextArea value={form.requirements} onChange={(e) => set("requirements", e.target.value)} rows={4} placeholder="Minimal 3 tahun pengalaman…&#10;Terbiasa bekerja remote…" />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Urutan tampil">
              <Input
                type="number"
                value={form.sortOrder}
                onChange={(e) => set("sortOrder", e.target.value)}
                min={0}
              />
            </Field>
            <label className="flex items-end gap-2 pb-3">
              <input
                type="checkbox"
                checked={form.isActive}
                onChange={(e) => set("isActive", e.target.checked)}
                className="h-5 w-5 accent-[var(--color-primary,#0f766e)]"
              />
              <span className="text-body text-text-primary">Lowongan aktif</span>
            </label>
          </div>
        </div>
      </Dialog>

      <ConfirmDialog
        open={deleting !== null}
        onClose={() => setDeleting(null)}
        title="Hapus lowongan?"
        description={
          deleting
            ? `Lowongan "${deleting.title}" akan dihapus permanen. Bila masih ada pelamar, penghapusan ditolak (kode 409).`
            : undefined
        }
        confirmLabel="Hapus"
        destructive
        loading={deletingBusy}
        onConfirm={() => void confirmDelete()}
      />
    </RoleGate>
  )
}
