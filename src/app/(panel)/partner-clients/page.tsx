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
import { RoleGate } from "@/components/admin/role-gate"
import { formatDateTimeWIB } from "@/lib/format"
import { userMessage } from "@/lib/api/response"
import {
  createPartnerClient,
  listPartnerClients,
  type PartnerClient,
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
]

// ADM-427: gate halaman via RoleGate (roles dari MENU rbac), bukan cek role inline.
export default function PartnerClientsPage() {
  return (
    <RoleGate href="/partner-clients">
      <PartnerClientsInner />
    </RoleGate>
  )
}

function PartnerClientsInner() {
  const toast = useToast()

  const [loading, setLoading] = useState(true)
  const [page, setPage] = useState(1)
  const [items, setItems] = useState<PartnerClient[]>([])
  const [total, setTotal] = useState(0)
  const [env, setEnv] = useState("")
  const [status, setStatus] = useState("")
  const [showCreate, setShowCreate] = useState(false)
  const [creating, setCreating] = useState(false)
  const [form, setForm] = useState({ name: "", environment: "SANDBOX", scopes: "", dailyQuota: "" })

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
    void load()
  }, [load])

  const handleCreate = async () => {
    const name = form.name.trim()
    if (name.length < 3) {
      toast.show({ title: "Nama wajib diisi", description: "Minimal 3 karakter.", tone: "danger" })
      return
    }
    const scopes = form.scopes
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
    if (scopes.length === 0) {
      toast.show({ title: "Scope wajib diisi", description: "Pisahkan dengan koma.", tone: "danger" })
      return
    }
    setCreating(true)
    try {
      await createPartnerClient({
        name,
        environment: form.environment as "SANDBOX" | "PRODUCTION",
        scopes,
        dailyQuota: form.dailyQuota ? Number(form.dailyQuota) : undefined,
      })
      toast.show({ title: "Berhasil", description: "Klien mitra dibuat.", tone: "success" })
      setShowCreate(false)
      setForm({ name: "", environment: "SANDBOX", scopes: "", dailyQuota: "" })
      await load()
    } catch (e) {
      toast.show({ title: "Gagal membuat klien", description: userMessage(e), tone: "danger" })
    } finally {
      setCreating(false)
    }
  }

  const filtered = items.filter(
    (c) =>
      (env === "" || c.environment === env) && (status === "" || c.status === status),
  )

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-title font-bold text-text-primary">Klien API mitra</h1>
          <p className="text-body text-text-secondary">
            Kelola kunci API, scope, endpoint webhook, dan kuota mitra integrasi.
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
                { key: "col1", header: "Nama", render: (c: PartnerClient) => c.name },
                { key: "col2", header: "Environment",
                  render: (c: PartnerClient) => (
                    <Badge tone={c.environment === "PRODUCTION" ? "info" : "neutral"}>
                      {c.environment}
                    </Badge>
                  ),
                },
                { key: "col3", header: "Status",
                  render: (c: PartnerClient) => (
                    <Badge tone={c.status === "ACTIVE" ? "success" : "danger"}>
                      {c.status === "ACTIVE" ? "Aktif" : "Ditangguhkan"}
                    </Badge>
                  ),
                },
                { key: "col4", header: "Scope",
                  render: (c: PartnerClient) => (
                    <span className="text-caption text-text-secondary">
                      {(c.scopes ?? []).join(", ")}
                    </span>
                  ),
                },
                { key: "col5", header: "Dibuat",
                  render: (c: PartnerClient) => formatDateTimeWIB(c.createdAt),
                },
                { key: "col6", header: "",
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
        description="Klien baru dimulai di environment sandbox. Kunci API diterbitkan dari halaman detail."
        footer={
          <div className="flex flex-col gap-3">
            <Field label="Nama klien (wajib)">
              <Input
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="Nama perusahaan mitra"
              />
            </Field>
            <Field label="Environment">
              <Select
                value={form.environment}
                onChange={(e) => setForm((f) => ({ ...f, environment: e.target.value }))}
                options={[
                  { value: "SANDBOX", label: "Sandbox" },
                  { value: "PRODUCTION", label: "Produksi" },
                ]}
              />
            </Field>
            <Field label="Scope (koma, wajib)">
              <Input
                value={form.scopes}
                onChange={(e) => setForm((f) => ({ ...f, scopes: e.target.value }))}
                placeholder="orders:read, webhooks:write"
              />
            </Field>
            <Field label="Kuota harian (opsional)">
              <Input
                value={form.dailyQuota}
                onChange={(e) => setForm((f) => ({ ...f, dailyQuota: e.target.value }))}
                inputMode="numeric"
                placeholder="mis. 10000"
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
