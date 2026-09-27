"use client"

/**
 * Admin — Klien API mitra (G451–G475).
 *
 * Route: `/partner-clients` (didaftarkan di sidebar/MENU bersama —
 * integrasi admin 2026-09-27).
 *
 * HANYA SUPER_ADMIN. Backend otoritas RBAC (`admin-partner.controller.ts`).
 * Kebijakan: `backend/docs/partner-api-v1.md`,
 * `backend/docs/partner-security-contract.md`.
 *
 * ATURAN TAMPILAN KUNCI: plaintext hanya dari respons penerbitan/rotasi,
 * tampil sekali di dialog dengan tombol salin — tidak pernah disimpan ulang.
 *
 * Kontrak diselaraskan dengan DTO backend (ADM-305, ADM-307): orgName,
 * isSandbox, rateLimitPerMinute, quotaPerDay — scope melekat pada KUNCI,
 * bukan klien.
 */

import { useCallback, useEffect, useState } from "react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardBody, CardHeader } from "@/components/ui/card"
import { Dialog } from "@/components/ui/dialog"
import { EmptyState } from "@/components/ui/empty-state"
import { Field, Input } from "@/components/ui/input"
import { Spinner } from "@/components/ui/spinner"
import { DataTable } from "@/components/ui/table"
import { useToast } from "@/components/ui/toast"
import { Pagination } from "@/components/admin/pagination"
import { Select } from "@/components/admin/select"
import { useAuth } from "@/lib/auth-context"
import { formatDateTimeWIB } from "@/lib/format"
import { userMessage } from "@/lib/api/response"
import {
  createPartnerClient,
  listPartnerClients,
  type PartnerClient,
  type PartnerClientStatus,
} from "@/lib/api/admin/partner-clients"

const PAGE_SIZE = 20

const ENV_OPTIONS = [
  { value: "", label: "Semua environment" },
  { value: "SANDBOX", label: "Sandbox" },
  { value: "PRODUCTION", label: "Produksi" },
]

const STATUS_OPTIONS = [
  { value: "", label: "Semua status" },
  { value: "ACTIVE", label: "Aktif" },
  { value: "SUSPENDED", label: "Ditangguhkan" },
  { value: "REVOKED", label: "Dicabut" },
]

function statusLabel(s: PartnerClientStatus): string {
  switch (s) {
    case "ACTIVE":
      return "Aktif"
    case "SUSPENDED":
      return "Ditangguhkan"
    case "REVOKED":
      return "Dicabut"
    default:
      return s
  }
}

function statusTone(s: PartnerClientStatus): "success" | "warning" | "danger" | "neutral" {
  switch (s) {
    case "ACTIVE":
      return "success"
    case "SUSPENDED":
      return "warning"
    case "REVOKED":
      return "danger"
    default:
      return "neutral"
  }
}

export default function PartnerClientsPage() {
  const { state, role } = useAuth()
  const toast = useToast()

  const allowed = role === "SUPER_ADMIN"

  const [loading, setLoading] = useState(true)
  const [page, setPage] = useState(1)
  const [items, setItems] = useState<PartnerClient[]>([])
  const [total, setTotal] = useState(0)
  const [env, setEnv] = useState("")
  const [status, setStatus] = useState("")
  const [showCreate, setShowCreate] = useState(false)
  const [creating, setCreating] = useState(false)
  // ADM-305: selaras CreatePartnerClientDto backend
  // (orgName, ownerUserId?, isSandbox?, rateLimitPerMinute?, quotaPerDay?).
  // Scope diisi saat penerbitan kunci, bukan saat buat klien.
  const [form, setForm] = useState({
    orgName: "",
    ownerUserId: "",
    isSandbox: "true",
    rateLimitPerMinute: "",
    quotaPerDay: "",
  })

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await listPartnerClients(page, PAGE_SIZE)
      setItems(res.items ?? [])
      setTotal(res.total ?? 0)
    } catch (e) {
      toast.show({ title: "Gagal memuat klien", description: userMessage(e), tone: "danger" })
    } finally {
      setLoading(false)
    }
  }, [page, toast])

  useEffect(() => {
    if (allowed) void load()
  }, [allowed, load])

  if (state.status === "loading") {
    return (
      <div className="flex items-center justify-center py-16">
        <Spinner size="md" />
      </div>
    )
  }

  if (!allowed) {
    return (
      <EmptyState
        title="Akses ditolak"
        description="Halaman ini hanya untuk SUPER_ADMIN."
      />
    )
  }

  const handleCreate = async () => {
    const orgName = form.orgName.trim()
    if (orgName.length < 3) {
      toast.show({ title: "Nama organisasi wajib", description: "Minimal 3 karakter.", tone: "danger" })
      return
    }
    const quotaPerDay = form.quotaPerDay.trim() ? Number(form.quotaPerDay) : undefined
    const rateLimitPerMinute = form.rateLimitPerMinute.trim() ? Number(form.rateLimitPerMinute) : undefined
    if (quotaPerDay !== undefined && (!Number.isFinite(quotaPerDay) || quotaPerDay <= 0)) {
      toast.show({ title: "Kuota tidak valid", description: "Kuota harian harus bilangan positif.", tone: "danger" })
      return
    }
    if (rateLimitPerMinute !== undefined && (!Number.isFinite(rateLimitPerMinute) || rateLimitPerMinute <= 0)) {
      toast.show({ title: "Rate limit tidak valid", description: "Rate limit per menit harus bilangan positif.", tone: "danger" })
      return
    }
    setCreating(true)
    try {
      await createPartnerClient({
        orgName,
        ownerUserId: form.ownerUserId.trim() || undefined,
        isSandbox: form.isSandbox === "true",
        rateLimitPerMinute,
        quotaPerDay,
      })
      toast.show({ title: "Berhasil", description: "Klien mitra dibuat. Terbitkan kunci dari halaman detail.", tone: "success" })
      setShowCreate(false)
      setForm({ orgName: "", ownerUserId: "", isSandbox: "true", rateLimitPerMinute: "", quotaPerDay: "" })
      await load()
    } catch (e) {
      toast.show({ title: "Gagal membuat klien", description: userMessage(e), tone: "danger" })
    } finally {
      setCreating(false)
    }
  }

  // ADM-307: filter terhadap field backend (isSandbox, status).
  const filtered = items.filter(
    (c) =>
      (env === "" || (c.isSandbox ? "SANDBOX" : "PRODUCTION") === env) &&
      (status === "" || c.status === status),
  )

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-title font-bold text-text-primary">Klien API mitra</h1>
          <p className="text-body text-text-secondary">
            Kelola kunci API, endpoint webhook, dan kuota mitra integrasi.
          </p>
        </div>
        <Button variant="primary" size="sm" fullWidth={false} onClick={() => setShowCreate(true)}>
          Buat klien
        </Button>
      </div>

      <Card padded={false}>
        <CardBody>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Field label="Environment">
              <Select value={env} onChange={(e) => setEnv(e.target.value)} options={ENV_OPTIONS} />
            </Field>
            <Field label="Status">
              <Select value={status} onChange={(e) => setStatus(e.target.value)} options={STATUS_OPTIONS} />
            </Field>
          </div>
        </CardBody>
      </Card>

      <Card padded={false}>
        <CardHeader title={`Daftar klien (${total})`} />
        <CardBody>
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Spinner size="md" />
            </div>
          ) : filtered.length === 0 ? (
            <EmptyState
              title="Belum ada klien"
              description="Buat klien sandbox terlebih dahulu sebelum menerbitkan kunci produksi."
            />
          ) : (
            <DataTable
              columns={[
                { key: "col1", header: "Organisasi", render: (c: PartnerClient) => c.orgName },
                { key: "col2", header: "Environment",
                  render: (c: PartnerClient) => (
                    <Badge tone={c.isSandbox ? "neutral" : "info"}>
                      {c.isSandbox ? "SANDBOX" : "PRODUCTION"}
                    </Badge>
                  ),
                },
                { key: "col3", header: "Status",
                  render: (c: PartnerClient) => (
                    <Badge tone={statusTone(c.status)}>{statusLabel(c.status)}</Badge>
                  ),
                },
                { key: "col4", header: "Kuota/hari", render: (c: PartnerClient) => <span className="font-mono">{c.quotaPerDay}</span> },
                { key: "col5", header: "Rate limit/mnt", render: (c: PartnerClient) => <span className="font-mono">{c.rateLimitPerMinute}</span> },
                { key: "col6", header: "Dibuat",
                  render: (c: PartnerClient) => formatDateTimeWIB(c.createdAt),
                },
                { key: "col7", header: "",
                  render: (c: PartnerClient) => (
                    <a
                      href={`/partner-clients/${c.id}`}
                      className="text-body text-info-text hover:underline"
                    >
                      Kelola
                    </a>
                  ),
                },
              ]}
              rows={filtered}
              rowKey={(c) => c.id}
            />
          )}
          <Pagination
            page={page}
            total={total}
            totalPages={Math.max(1, Math.ceil(total / PAGE_SIZE))}
            pageSize={PAGE_SIZE}
            onPageChange={setPage}
          />
        </CardBody>
      </Card>

      <Dialog
        open={showCreate}
        onClose={() => {
          if (!creating) setShowCreate(false)
        }}
        title="Buat klien mitra"
        description="Klien baru dimulai aktif. Scope diisi saat menerbitkan kunci API (melekat pada kunci, bukan klien)."
        footer={
          <div className="flex flex-col gap-3">
            <Field label="Nama organisasi (wajib)">
              <Input
                value={form.orgName}
                onChange={(e) => setForm((f) => ({ ...f, orgName: e.target.value }))}
                placeholder="Nama perusahaan mitra"
              />
            </Field>
            <Field label="Environment">
              <Select
                value={form.isSandbox}
                onChange={(e) => setForm((f) => ({ ...f, isSandbox: e.target.value }))}
                options={[
                  { value: "true", label: "Sandbox" },
                  { value: "false", label: "Produksi" },
                ]}
              />
            </Field>
            <Field label="Kuota harian (opsional, default 10000)">
              <Input
                value={form.quotaPerDay}
                onChange={(e) => setForm((f) => ({ ...f, quotaPerDay: e.target.value }))}
                inputMode="numeric"
                placeholder="mis. 10000"
              />
            </Field>
            <Field label="Rate limit per menit (opsional, default 100)">
              <Input
                value={form.rateLimitPerMinute}
                onChange={(e) => setForm((f) => ({ ...f, rateLimitPerMinute: e.target.value }))}
                inputMode="numeric"
                placeholder="mis. 100"
              />
            </Field>
            <Field label="ID pemilik (opsional)">
              <Input
                value={form.ownerUserId}
                onChange={(e) => setForm((f) => ({ ...f, ownerUserId: e.target.value }))}
                placeholder="ID pengguna pemilik (opsional)"
              />
            </Field>
            <div className="flex justify-end gap-2">
              <Button
                variant="ghost"
                fullWidth={false}
                disabled={creating}
                onClick={() => setShowCreate(false)}
              >
                Batal
              </Button>
              <Button
                variant="primary"
                fullWidth={false}
                loading={creating}
                onClick={() => void handleCreate()}
              >
                Buat
              </Button>
            </div>
          </div>
        }
      />
    </div>
  )
}
