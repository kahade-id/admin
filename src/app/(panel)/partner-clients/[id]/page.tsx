"use client"

/**
 * Admin — detail klien API mitra (G451–G475).
 *
 * Route: `/partner-clients/[id]`. HANYA SUPER_ADMIN (local gate; backend
 * otoritas RBAC). Kunci & webhook & kuota & audit.
 *
 * Kontrak diselaraskan dengan backend (ADM-304–ADM-313, ADM-321–ADM-322):
 * detail me-return { client, keys, endpoints, usage } dengan keys teredaksi
 * di level atas; respons penerbitan/rotasi = { key, plaintext }.
 */

import { useCallback, useEffect, useState } from "react"
import { useParams } from "next/navigation"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardBody, CardHeader } from "@/components/ui/card"
import { Dialog } from "@/components/ui/dialog"
import { EmptyState } from "@/components/ui/empty-state"
import { Field, Input, TextArea } from "@/components/ui/input"
import { Spinner } from "@/components/ui/spinner"
import { DataTable } from "@/components/ui/table"
import { useToast } from "@/components/ui/toast"
import { Select } from "@/components/admin/select"
import { RoleGate } from "@/components/admin/role-gate"
import { formatDateTimeWIB } from "@/lib/format"
import { userMessage } from "@/lib/api/response"
import {
  challengeWebhookEndpoint,
  deleteWebhookEndpoint,
  deliveryCanReplay,
  deliveryStatusLabel,
  deliveryStatusTone,
  getPartnerAuditLog,
  getPartnerClient,
  issuePartnerKey,
  listWebhookDeliveries,
  registerWebhookEndpoint,
  replayWebhookDelivery,
  revokePartnerKey,
  rotatePartnerKey,
  sendTestWebhook,
  updatePartnerClient,
  updateWebhookEndpoint,
  type PartnerAuditEntry,
  type PartnerClientDetail,
  type PartnerClientStatus,
  type PartnerDelivery,
  type PartnerKeySummary,
  type PartnerWebhookEndpoint,
} from "@/lib/api/admin/partner-clients"
import type { ReactNode } from "react"

function KeyValue({ label, value, mono = false }: { label: string; value: ReactNode; mono?: boolean }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-border py-2 last:border-b-0">
      <dt className="text-caption text-text-secondary">{label}</dt>
      <dd className={`text-body text-text-primary ${mono ? "font-mono" : ""}`}>{value}</dd>
    </div>
  )
}

function clientStatusTone(s: PartnerClientStatus): "success" | "warning" | "danger" | "neutral" {
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

// ADM-427: gate halaman via RoleGate (roles dari MENU rbac), bukan cek role inline.
export default function PartnerClientDetailPage() {
  return (
    <RoleGate href="/partner-clients">
      <PartnerClientDetailInner />
    </RoleGate>
  )
}

function PartnerClientDetailInner() {
  const { id } = useParams<{ id: string }>()
  const toast = useToast()

  const [loading, setLoading] = useState(true)
  const [detail, setDetail] = useState<PartnerClientDetail | null>(null)
  const [deliveries, setDeliveries] = useState<PartnerDelivery[]>([])
  const [audit, setAudit] = useState<PartnerAuditEntry[]>([])

  const [showKeyDialog, setShowKeyDialog] = useState(false)
  // ADM-306: { name*, scopes*, expiresAt? } (ttlDays → expiresAt ISO).
  const [keyForm, setKeyForm] = useState({ name: "", scopes: "", ttlDays: "" })
  const [issuing, setIssuing] = useState(false)
  const [plaintext, setPlaintext] = useState<string | null>(null)

  const [showEndpointDialog, setShowEndpointDialog] = useState(false)
  const [endpointForm, setEndpointForm] = useState({ url: "", events: "" })
  const [registering, setRegistering] = useState(false)

  const [revokingKeyId, setRevokingKeyId] = useState<string | null>(null)
  const [revokeReason, setRevokeReason] = useState("")
  // ADM-321: konfirmasi rotasi.
  const [rotatingKey, setRotatingKey] = useState<PartnerKeySummary | null>(null)
  const [acting, setActing] = useState(false)

  // ADM-313: kelola klien (status/kuota/rate-limit + alasan audit).
  const [manageForm, setManageForm] = useState({ status: "ACTIVE", quotaPerDay: "", rateLimitPerMinute: "", reason: "" })
  const [managing, setManaging] = useState(false)
  const [manageInit, setManageInit] = useState(false)

  // ADM-322: edit & hapus endpoint webhook.
  const [editingEndpoint, setEditingEndpoint] = useState<PartnerWebhookEndpoint | null>(null)
  const [editEndpointForm, setEditEndpointForm] = useState({ url: "", events: "", isActive: true })
  const [deletingEndpoint, setDeletingEndpoint] = useState<PartnerWebhookEndpoint | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [d, del, a] = await Promise.all([
        getPartnerClient(id),
        listWebhookDeliveries(id, 1, 20),
        getPartnerAuditLog(id, 50),
      ])
      setDetail(d)
      setDeliveries(del.items ?? [])
      setAudit(a ?? [])
    } catch (e) {
      toast.show({ title: "Gagal memuat detail", description: userMessage(e), tone: "danger" })
    } finally {
      setLoading(false)
    }
  }, [id, toast])

  useEffect(() => {
    void load()
  }, [load])

  // Sinkronkan form kelola dengan data klien sekali saja.
  useEffect(() => {
    const c = detail?.client
    if (c && !manageInit) {
      setManageForm({
        status: c.status,
        quotaPerDay: String(c.quotaPerDay),
        rateLimitPerMinute: String(c.rateLimitPerMinute),
        reason: "",
      })
      setManageInit(true)
    }
  }, [detail, manageInit])

  const copyPlaintext = async () => {
    if (!plaintext) return
    try {
      await navigator.clipboard.writeText(plaintext)
      toast.show({ title: "Disalin", description: "Kunci API disalin ke clipboard.", tone: "success" })
    } catch {
      toast.show({ title: "Gagal menyalin", description: "Salin manual dari kolom di bawah.", tone: "danger" })
    }
  }

  const handleIssueKey = async () => {
    const name = keyForm.name.trim()
    if (name.length < 3) {
      toast.show({ title: "Nama kunci wajib", description: "Minimal 3 karakter.", tone: "danger" })
      return
    }
    const scopes = keyForm.scopes.split(",").map((s) => s.trim()).filter(Boolean)
    if (scopes.length === 0) {
      toast.show({ title: "Scope wajib", description: "Isi minimal satu scope.", tone: "danger" })
      return
    }
    // ADM-306: ttlDays → expiresAt ISO (atau tanpa kedaluwarsa).
    let expiresAt: string | undefined
    if (keyForm.ttlDays.trim()) {
      const days = Number(keyForm.ttlDays)
      if (!Number.isFinite(days) || days <= 0) {
        toast.show({ title: "TTL tidak valid", description: "TTL hari harus bilangan positif.", tone: "danger" })
        return
      }
      expiresAt = new Date(Date.now() + days * 86_400_000).toISOString()
    }
    setIssuing(true)
    try {
      // Respons { key, plaintext } — ADM-306.
      const issued = await issuePartnerKey(id, { name, scopes, expiresAt })
      setPlaintext(issued.plaintext)
      setShowKeyDialog(false)
      setKeyForm({ name: "", scopes: "", ttlDays: "" })
      await load()
    } catch (e) {
      toast.show({ title: "Gagal menerbitkan kunci", description: userMessage(e), tone: "danger" })
    } finally {
      setIssuing(false)
    }
  }

  // ADM-321: rotasi lewat dialog konfirmasi (kunci lama overlap 24 jam).
  const handleRotate = async () => {
    if (!rotatingKey) return
    setActing(true)
    try {
      const issued = await rotatePartnerKey(id, rotatingKey.id)
      setPlaintext(issued.plaintext)
      setRotatingKey(null)
      toast.show({ title: "Berhasil", description: "Kunci baru diterbitkan — kunci lama overlap 24 jam.", tone: "success" })
      await load()
    } catch (e) {
      toast.show({ title: "Gagal rotasi", description: userMessage(e), tone: "danger" })
    } finally {
      setActing(false)
    }
  }

  const handleRevoke = async () => {
    if (!revokingKeyId) return
    if (revokeReason.trim().length < 10) {
      toast.show({ title: "Alasan wajib", description: "Minimal 10 karakter (diaudit).", tone: "danger" })
      return
    }
    setActing(true)
    try {
      await revokePartnerKey(id, revokingKeyId, revokeReason.trim())
      toast.show({ title: "Berhasil", description: "Kunci dicabut seketika.", tone: "success" })
      setRevokingKeyId(null)
      setRevokeReason("")
      await load()
    } catch (e) {
      toast.show({ title: "Gagal mencabut", description: userMessage(e), tone: "danger" })
    } finally {
      setActing(false)
    }
  }

  const handleRegisterEndpoint = async () => {
    const url = endpointForm.url.trim()
    if (!/^https:\/\//.test(url)) {
      toast.show({ title: "URL tidak valid", description: "Endpoint webhook harus HTTPS.", tone: "danger" })
      return
    }
    const events = endpointForm.events.split(",").map((s) => s.trim()).filter(Boolean)
    if (events.length === 0) {
      toast.show({ title: "Event wajib", description: "Isi minimal satu tipe event.", tone: "danger" })
      return
    }
    setRegistering(true)
    try {
      await registerWebhookEndpoint(id, { url, events })
      toast.show({ title: "Berhasil", description: "Endpoint didaftarkan — tantangan verifikasi dikirim.", tone: "success" })
      setShowEndpointDialog(false)
      setEndpointForm({ url: "", events: "" })
      await load()
    } catch (e) {
      toast.show({ title: "Gagal mendaftar endpoint", description: userMessage(e), tone: "danger" })
    } finally {
      setRegistering(false)
    }
  }

  // ADM-322: edit endpoint (URL/event/status aktif).
  const handleEditEndpoint = async () => {
    if (!editingEndpoint) return
    const url = editEndpointForm.url.trim()
    if (!/^https:\/\//.test(url)) {
      toast.show({ title: "URL tidak valid", description: "Endpoint webhook harus HTTPS.", tone: "danger" })
      return
    }
    const events = editEndpointForm.events.split(",").map((s) => s.trim()).filter(Boolean)
    if (events.length === 0) {
      toast.show({ title: "Event wajib", description: "Isi minimal satu tipe event.", tone: "danger" })
      return
    }
    setActing(true)
    try {
      await updateWebhookEndpoint(id, editingEndpoint.id, {
        url,
        events,
        isActive: editEndpointForm.isActive,
      })
      toast.show({ title: "Berhasil", description: "Endpoint diperbarui — URL baru memicu re-verifikasi.", tone: "success" })
      setEditingEndpoint(null)
      await load()
    } catch (e) {
      toast.show({ title: "Gagal memperbarui", description: userMessage(e), tone: "danger" })
    } finally {
      setActing(false)
    }
  }

  // ADM-322: hapus endpoint (konfirmasi).
  const handleDeleteEndpoint = async () => {
    if (!deletingEndpoint) return
    setActing(true)
    try {
      await deleteWebhookEndpoint(id, deletingEndpoint.id)
      toast.show({ title: "Berhasil", description: "Endpoint dihapus.", tone: "success" })
      setDeletingEndpoint(null)
      await load()
    } catch (e) {
      toast.show({ title: "Gagal menghapus", description: userMessage(e), tone: "danger" })
    } finally {
      setActing(false)
    }
  }

  // ADM-313: kelola klien — status (suspend/revoke/restore), kuota, rate limit.
  const handleManage = async () => {
    const c = detail?.client
    if (!c) return
    const statusChanged = manageForm.status !== c.status
    const reason = manageForm.reason.trim()
    if (statusChanged && reason.length < 10) {
      toast.show({ title: "Alasan wajib", description: "Perubahan status butuh alasan min. 10 karakter (diaudit).", tone: "danger" })
      return
    }
    const quotaPerDay = manageForm.quotaPerDay.trim() ? Number(manageForm.quotaPerDay) : undefined
    const rateLimitPerMinute = manageForm.rateLimitPerMinute.trim() ? Number(manageForm.rateLimitPerMinute) : undefined
    if (quotaPerDay !== undefined && (!Number.isInteger(quotaPerDay) || quotaPerDay < 0)) {
      toast.show({ title: "Kuota tidak valid", description: "Kuota harian harus bilangan bulat ≥ 0.", tone: "danger" })
      return
    }
    if (rateLimitPerMinute !== undefined && (!Number.isInteger(rateLimitPerMinute) || rateLimitPerMinute < 1)) {
      toast.show({ title: "Rate limit tidak valid", description: "Rate limit harus bilangan bulat ≥ 1.", tone: "danger" })
      return
    }
    if (
      !statusChanged &&
      quotaPerDay === c.quotaPerDay &&
      rateLimitPerMinute === c.rateLimitPerMinute
    ) {
      toast.show({ title: "Tidak ada perubahan", tone: "info" })
      return
    }
    setManaging(true)
    try {
      await updatePartnerClient(id, {
        ...(statusChanged ? { status: manageForm.status as PartnerClientStatus, reason } : {}),
        ...(quotaPerDay !== undefined && quotaPerDay !== c.quotaPerDay ? { quotaPerDay } : {}),
        ...(rateLimitPerMinute !== undefined && rateLimitPerMinute !== c.rateLimitPerMinute ? { rateLimitPerMinute } : {}),
      })
      toast.show({ title: "Berhasil", description: "Klien diperbarui dan diaudit.", tone: "success" })
      setManageForm((f) => ({ ...f, reason: "" }))
      setManageInit(false)
      await load()
    } catch (e) {
      toast.show({ title: "Gagal memperbarui", description: userMessage(e), tone: "danger" })
    } finally {
      setManaging(false)
    }
  }

  const c = detail?.client ?? null
  const keys = detail?.keys ?? []
  const endpoints = detail?.endpoints ?? []
  const usage = detail?.usage

  return (
    <div className="flex flex-col gap-6">
      <div>
        <a href="/partner-clients" className="text-body text-info-text hover:underline">
          ← Kembali ke daftar klien
        </a>
        <h1 className="mt-2 text-title font-bold text-text-primary">
          {c?.orgName ?? "Memuat…"}
        </h1>
        {c ? (
          <div className="mt-2 flex flex-wrap gap-2">
            <Badge tone={c.isSandbox ? "neutral" : "info"}>{c.isSandbox ? "SANDBOX" : "PRODUCTION"}</Badge>
            <Badge tone={clientStatusTone(c.status)}>{c.status}</Badge>
          </div>
        ) : null}
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16">
          <Spinner size="md" />
        </div>
      ) : c ? (
        <>
          <Card padded={false}>
            <CardHeader title="Ringkasan" />
            <CardBody>
              <dl>
                <KeyValue label="Kuota harian" value={String(c.quotaPerDay)} mono />
                <KeyValue label="Rate limit/menit" value={String(c.rateLimitPerMinute)} mono />
                {/* ADM-308/326: todayCalls + errorRatePct dari backend. */}
                <KeyValue label="Request hari ini" value={String(usage?.todayCalls ?? 0)} mono />
                <KeyValue
                  label="Pemakaian kuota"
                  value={usage?.quotaUsedPct != null ? `${usage.quotaUsedPct}%` : "—"}
                  mono
                />
                <KeyValue
                  label="Tingkat error"
                  value={usage?.errorRatePct != null ? `${usage.errorRatePct}%` : "—"}
                  mono
                />
                <KeyValue label="ID pemilik" value={c.ownerUserId ?? "—"} mono />
                <KeyValue label="Dibuat" value={formatDateTimeWIB(c.createdAt)} />
              </dl>
            </CardBody>
          </Card>

          {/* ADM-313 — kelola klien: suspend/aktifkan/cabut + kuota + rate limit */}
          <Card padded={false}>
            <CardHeader title="Kelola klien" />
            <CardBody>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Status">
                  <Select
                    value={manageForm.status}
                    onChange={(e) => setManageForm((f) => ({ ...f, status: e.target.value }))}
                    options={[
                      { value: "ACTIVE", label: "Aktif" },
                      { value: "SUSPENDED", label: "Ditangguhkan" },
                      { value: "REVOKED", label: "Dicabut" },
                    ]}
                  />
                </Field>
                <Field label="Alasan perubahan status (wajib bila status berubah, min. 10 char)">
                  <Input
                    value={manageForm.reason}
                    onChange={(e) => setManageForm((f) => ({ ...f, reason: e.target.value }))}
                    placeholder="Contoh: penyalahgunaan kuota oleh mitra…"
                  />
                </Field>
                <Field label="Kuota harian">
                  <Input
                    value={manageForm.quotaPerDay}
                    onChange={(e) => setManageForm((f) => ({ ...f, quotaPerDay: e.target.value }))}
                    inputMode="numeric"
                  />
                </Field>
                <Field label="Rate limit per menit">
                  <Input
                    value={manageForm.rateLimitPerMinute}
                    onChange={(e) => setManageForm((f) => ({ ...f, rateLimitPerMinute: e.target.value }))}
                    inputMode="numeric"
                  />
                </Field>
              </div>
              <div className="mt-3 flex justify-end">
                <Button variant="primary" size="sm" fullWidth={false} loading={managing} onClick={() => void handleManage()}>
                  Simpan perubahan
                </Button>
              </div>
              <p className="mt-2 text-caption text-text-secondary">
                Suspended/Revoked memblokir pemakaian kunci; semua perubahan dicatat di audit log.
              </p>
            </CardBody>
          </Card>

          {/* G452–G456 — kunci API */}
          <Card padded={false}>
            <CardHeader
              title={`Kunci API (${keys.length})`}
              action={
                <Button variant="primary" size="sm" fullWidth={false} onClick={() => setShowKeyDialog(true)}>
                  Terbitkan kunci
                </Button>
              }
            />
            <CardBody>
              {keys.length === 0 ? (
                <EmptyState title="Belum ada kunci" description="Terbitkan kunci pertama untuk klien ini." />
              ) : (
                <DataTable
                  columns={[
                    { key: "col1", header: "Nama", render: (k: PartnerKeySummary) => k.name ?? "—" },
                    { key: "col2", header: "Prefix", render: (k: PartnerKeySummary) => <span className="font-mono">{k.keyPrefix}</span> },
                    { key: "col3", header: "Scope", render: (k: PartnerKeySummary) => (k.scopes ?? []).join(", ") },
                    { key: "col4", header: "Kedaluwarsa", render: (k: PartnerKeySummary) => (k.expiresAt ? formatDateTimeWIB(k.expiresAt) : "—") },
                    { key: "col5", header: "Status",
                      render: (k: PartnerKeySummary) =>
                        k.revokedAt ? (
                          <Badge tone="danger">Dicabut</Badge>
                        ) : k.validUntil ? (
                          <Badge tone="warning">Overlap rotasi</Badge>
                        ) : (
                          <Badge tone="success">Aktif</Badge>
                        ),
                    },
                    { key: "col6", header: "",
                      render: (k: PartnerKeySummary) =>
                        !k.revokedAt ? (
                          <div className="flex gap-2">
                            <button
                              type="button"
                              className="text-body text-info-text hover:underline"
                              disabled={acting}
                              onClick={() => setRotatingKey(k)}
                            >
                              Rotasi
                            </button>
                            <button
                              type="button"
                              className="text-body text-danger-text hover:underline"
                              onClick={() => setRevokingKeyId(k.id)}
                            >
                              Cabut
                            </button>
                          </div>
                        ) : null,
                    },
                  ]}
                  rows={keys}
                  rowKey={(k) => k.id}
                />
              )}
            </CardBody>
          </Card>

          {/* G460–G465 — endpoint webhook */}
          <Card padded={false}>
            <CardHeader
              title={`Endpoint webhook (${endpoints.length})`}
              action={
                <Button variant="secondary" size="sm" fullWidth={false} onClick={() => setShowEndpointDialog(true)}>
                  Daftarkan endpoint
                </Button>
              }
            />
            <CardBody>
              {endpoints.length === 0 ? (
                <EmptyState title="Belum ada endpoint" description="Daftarkan URL HTTPS penerima webhook." />
              ) : (
                <DataTable
                  columns={[
                    { key: "col7", header: "URL", render: (e: PartnerWebhookEndpoint) => <span className="font-mono text-caption">{e.url}</span> },
                    { key: "col8", header: "Event", render: (e: PartnerWebhookEndpoint) => (e.events ?? []).join(", ") },
                    { key: "col9", header: "Status",
                      render: (e: PartnerWebhookEndpoint) => (
                        <Badge tone={e.status === "ACTIVE" ? "success" : e.status === "CHALLENGED" ? "warning" : "neutral"}>
                          {e.status}
                        </Badge>
                      ),
                    },
                    { key: "col10", header: "Pengiriman terakhir", render: (e: PartnerWebhookEndpoint) => e.lastDeliveryAt ? formatDateTimeWIB(e.lastDeliveryAt) : "—" },
                    { key: "col11", header: "",
                      render: (e: PartnerWebhookEndpoint) => (
                        <div className="flex gap-2">
                          <button
                            type="button"
                            className="text-body text-info-text hover:underline"
                            disabled={acting}
                            onClick={() => void (async () => {
                              setActing(true)
                              try {
                                await challengeWebhookEndpoint(id, e.id)
                                toast.show({ title: "Tantangan dikirim", description: "Menunggu verifikasi pemilik domain.", tone: "success" })
                                await load()
                              } catch (err) {
                                toast.show({ title: "Gagal", description: userMessage(err), tone: "danger" })
                              } finally { setActing(false) }
                            })()}
                          >
                            Tantangan
                          </button>
                          <button
                            type="button"
                            className="text-body text-info-text hover:underline"
                            disabled={acting}
                            onClick={() => void (async () => {
                              setActing(true)
                              try {
                                await sendTestWebhook(id, e.id)
                                toast.show({ title: "Event uji diantrekan", description: "Cek status di daftar pengiriman.", tone: "success" })
                                await load()
                              } catch (err) {
                                toast.show({ title: "Gagal", description: userMessage(err), tone: "danger" })
                              } finally { setActing(false) }
                            })()}
                          >
                            Uji
                          </button>
                          {/* ADM-322: edit & hapus endpoint */}
                          <button
                            type="button"
                            className="text-body text-info-text hover:underline"
                            disabled={acting}
                            onClick={() => {
                              setEditingEndpoint(e)
                              setEditEndpointForm({ url: e.url, events: (e.events ?? []).join(", "), isActive: e.isActive })
                            }}
                          >
                            Edit
                          </button>
                          <button
                            type="button"
                            className="text-body text-danger-text hover:underline"
                            disabled={acting}
                            onClick={() => setDeletingEndpoint(e)}
                          >
                            Hapus
                          </button>
                        </div>
                      ),
                    },
                  ]}
                  rows={endpoints}
                  rowKey={(e) => e.id}
                />
              )}
            </CardBody>
          </Card>

          {/* G466–G468 — pengiriman & replay (ADM-311) */}
          <Card padded={false}>
            <CardHeader title={`Pengiriman webhook (${deliveries.length})`} />
            <CardBody>
              {deliveries.length === 0 ? (
                <p className="text-body text-text-secondary">Belum ada pengiriman.</p>
              ) : (
                <DataTable
                  columns={[
                    { key: "col12", header: "Event", render: (d: PartnerDelivery) => d.eventType },
                    { key: "col13", header: "Status",
                      render: (d: PartnerDelivery) => (
                        <Badge tone={deliveryStatusTone(d.status)}>{deliveryStatusLabel(d.status)}</Badge>
                      ),
                    },
                    { key: "col14", header: "Percobaan", render: (d: PartnerDelivery) => String(d.attempt) },
                    { key: "col15", header: "Retry berikut", render: (d: PartnerDelivery) => (d.nextRetryAt ? formatDateTimeWIB(d.nextRetryAt) : "—") },
                    { key: "col16", header: "Waktu", render: (d: PartnerDelivery) => formatDateTimeWIB(d.createdAt) },
                    { key: "col17", header: "",
                      render: (d: PartnerDelivery) =>
                        deliveryCanReplay(d.status) ? (
                          <button
                            type="button"
                            className="text-body text-info-text hover:underline"
                            disabled={acting}
                            onClick={() => void (async () => {
                              setActing(true)
                              try {
                                await replayWebhookDelivery(id, d.id)
                                toast.show({ title: "Diantrekan ulang", description: "Pengiriman manual dicatat di audit.", tone: "success" })
                                await load()
                              } catch (err) {
                                toast.show({ title: "Gagal", description: userMessage(err), tone: "danger" })
                              } finally { setActing(false) }
                            })()}
                          >
                            Putar ulang
                          </button>
                        ) : null,
                    },
                  ]}
                  rows={deliveries}
                  rowKey={(d) => d.id}
                />
              )}
            </CardBody>
          </Card>

          {/* G455 — audit (ADM-312: description + ipAddress) */}
          <Card padded={false}>
            <CardHeader title={`Audit log (${audit.length})`} />
            <CardBody>
              {audit.length === 0 ? (
                <p className="text-body text-text-secondary">Belum ada entri audit.</p>
              ) : (
                <ol className="flex flex-col gap-2">
                  {audit.map((a) => (
                    <li key={a.id} className="flex flex-wrap items-baseline justify-between gap-2 border-b border-border py-2 last:border-b-0">
                      <div>
                        <Badge tone="neutral">{a.action}</Badge>
                        {a.description ? <p className="mt-1 text-body text-text-primary">{a.description}</p> : null}
                        {a.ipAddress ? <p className="mt-1 font-mono text-caption text-text-secondary">IP: {a.ipAddress}</p> : null}
                      </div>
                      <p className="text-caption text-text-secondary">{formatDateTimeWIB(a.createdAt)}</p>
                    </li>
                  ))}
                </ol>
              )}
            </CardBody>
          </Card>
        </>
      ) : (
        <EmptyState title="Tidak ditemukan" description="Klien mitra tidak ada." />
      )}

      {/* Dialog terbitkan kunci (ADM-306: name wajib) */}
      <Dialog
        open={showKeyDialog}
        onClose={() => {
          if (!issuing) setShowKeyDialog(false)
        }}
        title="Terbitkan kunci API"
        description="Plaintext kunci hanya ditampilkan SATU KALI setelah ini. Simpan di tempat aman."
        footer={
          <div className="flex flex-col gap-3">
            <Field label="Nama kunci (wajib)">
              <Input
                value={keyForm.name}
                onChange={(e) => setKeyForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="mis. production-key-1"
              />
            </Field>
            <Field label="Scope (koma, wajib)">
              <Input
                value={keyForm.scopes}
                onChange={(e) => setKeyForm((f) => ({ ...f, scopes: e.target.value }))}
                placeholder="orders:read, webhooks:write"
              />
            </Field>
            <Field label="TTL hari (opsional)">
              <Input
                value={keyForm.ttlDays}
                onChange={(e) => setKeyForm((f) => ({ ...f, ttlDays: e.target.value }))}
                inputMode="numeric"
                placeholder="kosong = tanpa kedaluwarsa"
              />
            </Field>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" fullWidth={false} disabled={issuing} onClick={() => setShowKeyDialog(false)}>
                Batal
              </Button>
              <Button variant="primary" fullWidth={false} loading={issuing} onClick={() => void handleIssueKey()}>
                Terbitkan
              </Button>
            </div>
          </div>
        }
      />

      {/* Dialog tampil sekali: plaintext kunci */}
      <Dialog
        open={plaintext !== null}
        onClose={() => setPlaintext(null)}
        title="Kunci API baru — simpan sekarang"
        description="Kunci ini TIDAK akan ditampilkan lagi. Salin sebelum menutup."
        footer={
          <div className="flex flex-col gap-3">
            <div className="rounded-sm border border-border bg-surface-elevated p-3 font-mono text-body text-text-primary break-all select-all">
              {plaintext}
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="secondary" fullWidth={false} onClick={() => void copyPlaintext()}>
                Salin
              </Button>
              <Button
                variant="primary"
                fullWidth={false}
                onClick={() => setPlaintext(null)}
              >
                Saya sudah menyimpan
              </Button>
            </div>
          </div>
        }
      />

      {/* Dialog daftarkan endpoint */}
      <Dialog
        open={showEndpointDialog}
        onClose={() => {
          if (!registering) setShowEndpointDialog(false)
        }}
        title="Daftarkan endpoint webhook"
        description="URL harus HTTPS publik (anti-SSRF di backend). Tantangan verifikasi dikirim otomatis."
        footer={
          <div className="flex flex-col gap-3">
            <Field label="URL (wajib, HTTPS)">
              <Input
                value={endpointForm.url}
                onChange={(e) => setEndpointForm((f) => ({ ...f, url: e.target.value }))}
                placeholder="https://mitra.example.com/webhooks/kahade"
              />
            </Field>
            <Field label="Event (koma, wajib)">
              <Input
                value={endpointForm.events}
                onChange={(e) => setEndpointForm((f) => ({ ...f, events: e.target.value }))}
                placeholder="order.paid, order.shipped"
              />
            </Field>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" fullWidth={false} disabled={registering} onClick={() => setShowEndpointDialog(false)}>
                Batal
              </Button>
              <Button variant="primary" fullWidth={false} loading={registering} onClick={() => void handleRegisterEndpoint()}>
                Daftarkan
              </Button>
            </div>
          </div>
        }
      />

      {/* ADM-322: dialog edit endpoint */}
      <Dialog
        open={editingEndpoint !== null}
        onClose={() => {
          if (!acting) setEditingEndpoint(null)
        }}
        title="Edit endpoint webhook"
        description="URL baru memicu re-verifikasi otomatis di backend."
        footer={
          <div className="flex flex-col gap-3">
            <Field label="URL (wajib, HTTPS)">
              <Input
                value={editEndpointForm.url}
                onChange={(e) => setEditEndpointForm((f) => ({ ...f, url: e.target.value }))}
              />
            </Field>
            <Field label="Event (koma, wajib)">
              <Input
                value={editEndpointForm.events}
                onChange={(e) => setEditEndpointForm((f) => ({ ...f, events: e.target.value }))}
              />
            </Field>
            <Field label="Status">
              <Select
                value={editEndpointForm.isActive ? "true" : "false"}
                onChange={(e) => setEditEndpointForm((f) => ({ ...f, isActive: e.target.value === "true" }))}
                options={[
                  { value: "true", label: "Aktif" },
                  { value: "false", label: "Nonaktif" },
                ]}
              />
            </Field>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" fullWidth={false} disabled={acting} onClick={() => setEditingEndpoint(null)}>
                Batal
              </Button>
              <Button variant="primary" fullWidth={false} loading={acting} onClick={() => void handleEditEndpoint()}>
                Simpan
              </Button>
            </div>
          </div>
        }
      />

      {/* ADM-322: dialog hapus endpoint (konfirmasi) */}
      <Dialog
        open={deletingEndpoint !== null}
        onClose={() => {
          if (!acting) setDeletingEndpoint(null)
        }}
        title="Hapus endpoint webhook"
        description={deletingEndpoint ? `Hapus endpoint ${deletingEndpoint.url}? Pengiriman ke endpoint ini berhenti.` : ""}
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="ghost" fullWidth={false} disabled={acting} onClick={() => setDeletingEndpoint(null)}>
              Batal
            </Button>
            <Button variant="destructive" fullWidth={false} loading={acting} onClick={() => void handleDeleteEndpoint()}>
              Hapus
            </Button>
          </div>
        }
      />

      {/* ADM-321: dialog konfirmasi rotasi kunci */}
      <Dialog
        open={rotatingKey !== null}
        onClose={() => {
          if (!acting) setRotatingKey(null)
        }}
        title="Rotasi kunci API"
        description={
          rotatingKey
            ? `Rotasi kunci "${rotatingKey.name ?? rotatingKey.keyPrefix}"? Kunci lama tetap berlaku 24 jam (overlap), mitra harus mengganti kredensial sebelum kedaluwarsa.`
            : ""
        }
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="ghost" fullWidth={false} disabled={acting} onClick={() => setRotatingKey(null)}>
              Batal
            </Button>
            <Button variant="primary" fullWidth={false} loading={acting} onClick={() => void handleRotate()}>
              Rotasi sekarang
            </Button>
          </div>
        }
      />

      {/* Dialog cabut kunci */}
      <Dialog
        open={revokingKeyId !== null}
        onClose={() => {
          if (!acting) {
            setRevokingKeyId(null)
            setRevokeReason("")
          }
        }}
        title="Cabut kunci API"
        description="Pencabutan berlaku SEGERA. Alasan wajib (min. 10 karakter) dan diaudit."
        footer={
          <div className="flex flex-col gap-3">
            <TextArea
              label="Alasan pencabutan (wajib)"
              value={revokeReason}
              onChange={(e) => setRevokeReason(e.target.value)}
              rows={3}
              placeholder="Contoh: kunci bocor di log publik mitra…"
            />
            <div className="flex justify-end gap-2">
              <Button
                variant="ghost"
                fullWidth={false}
                disabled={acting}
                onClick={() => {
                  setRevokingKeyId(null)
                  setRevokeReason("")
                }}
              >
                Batal
              </Button>
              <Button variant="destructive" fullWidth={false} loading={acting} onClick={() => void handleRevoke()}>
                Cabut sekarang
              </Button>
            </div>
          </div>
        }
      />
    </div>
  )
}
