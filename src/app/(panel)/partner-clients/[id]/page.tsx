"use client"

/**
 * Admin — detail klien API mitra (G451–G475).
 *
 * Route: `/partner-clients/[id]`. HANYA SUPER_ADMIN (local gate; backend
 * otoritas RBAC). Kunci & webhook & kuota & audit.
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
import { useAuth } from "@/lib/auth-context"
import { formatDateTimeWIB } from "@/lib/format"
import { userMessage } from "@/lib/api/response"
import {
  challengeWebhookEndpoint,
  getPartnerAuditLog,
  getPartnerClient,
  issuePartnerKey,
  listWebhookDeliveries,
  registerWebhookEndpoint,
  replayWebhookDelivery,
  revokePartnerKey,
  rotatePartnerKey,
  sendTestWebhook,
  type PartnerAuditEntry,
  type PartnerClientDetail,
  type PartnerDelivery,
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

export default function PartnerClientDetailPage() {
  const { id } = useParams<{ id: string }>()
  const { state, role } = useAuth()
  const toast = useToast()

  const allowed = role === "SUPER_ADMIN"

  const [loading, setLoading] = useState(true)
  const [detail, setDetail] = useState<PartnerClientDetail | null>(null)
  const [deliveries, setDeliveries] = useState<PartnerDelivery[]>([])
  const [audit, setAudit] = useState<PartnerAuditEntry[]>([])

  const [showKeyDialog, setShowKeyDialog] = useState(false)
  const [keyForm, setKeyForm] = useState({ label: "", scopes: "", ttlDays: "" })
  const [issuing, setIssuing] = useState(false)
  const [plaintext, setPlaintext] = useState<string | null>(null)
  const [plaintextKeyId, setPlaintextKeyId] = useState<string | null>(null)

  const [showEndpointDialog, setShowEndpointDialog] = useState(false)
  const [endpointForm, setEndpointForm] = useState({ url: "", events: "" })
  const [registering, setRegistering] = useState(false)

  const [revokingKeyId, setRevokingKeyId] = useState<string | null>(null)
  const [revokeReason, setRevokeReason] = useState("")
  const [acting, setActing] = useState(false)

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
    const scopes = keyForm.scopes.split(",").map((s) => s.trim()).filter(Boolean)
    if (scopes.length === 0) {
      toast.show({ title: "Scope wajib", description: "Isi minimal satu scope.", tone: "danger" })
      return
    }
    setIssuing(true)
    try {
      const issued = await issuePartnerKey(id, {
        label: keyForm.label.trim() || undefined,
        scopes,
        ttlDays: keyForm.ttlDays ? Number(keyForm.ttlDays) : undefined,
      })
      setPlaintext(issued.plaintext)
      setPlaintextKeyId(issued.id)
      setShowKeyDialog(false)
      setKeyForm({ label: "", scopes: "", ttlDays: "" })
      await load()
    } catch (e) {
      toast.show({ title: "Gagal menerbitkan kunci", description: userMessage(e), tone: "danger" })
    } finally {
      setIssuing(false)
    }
  }

  const handleRotate = async (keyId: string) => {
    setActing(true)
    try {
      const issued = await rotatePartnerKey(id, keyId)
      setPlaintext(issued.plaintext)
      setPlaintextKeyId(issued.id)
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

  const c = detail?.client ?? null
  const keys = detail?.keys ?? []
  const endpoints = detail?.endpoints ?? []

  return (
    <div className="flex flex-col gap-6">
      <div>
        <a href="/partner-clients" className="text-body text-info-text hover:underline">
          ← Kembali ke daftar klien
        </a>
        <h1 className="mt-2 text-title font-bold text-text-primary">
          {c?.name ?? "Memuat…"}
        </h1>
        {c ? (
          <div className="mt-2 flex flex-wrap gap-2">
            <Badge tone={c.environment === "PRODUCTION" ? "info" : "neutral"}>{c.environment}</Badge>
            <Badge tone={c.status === "ACTIVE" ? "success" : "danger"}>{c.status}</Badge>
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
                <KeyValue label="Scope" value={(c.scopes ?? []).join(", ")} />
                <KeyValue label="Kuota harian" value={c.dailyQuota != null ? String(c.dailyQuota) : "—"} mono />
                <KeyValue label="Request hari ini" value={String(detail?.usage.requestsToday ?? 0)} mono />
                <KeyValue
                  label="Pemakaian kuota"
                  value={detail?.usage.quotaUsedPct != null ? `${detail.usage.quotaUsedPct}%` : "—"}
                  mono
                />
                <KeyValue label="Dibuat" value={formatDateTimeWIB(c.createdAt)} />
              </dl>
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
                    { key: "col1", header: "Label", render: (k) => k.label ?? "—" },
                    { key: "col2", header: "Prefix", render: (k) => <span className="font-mono">{k.keyPrefix}</span> },
                    { key: "col3", header: "Scope", render: (k) => (k.scopes ?? []).join(", ") },
                    { key: "col4", header: "Kedaluwarsa", render: (k) => (k.expiresAt ? formatDateTimeWIB(k.expiresAt) : "—") },
                    { key: "col5", header: "Status",
                      render: (k) =>
                        k.revokedAt ? (
                          <Badge tone="danger">Dicabut</Badge>
                        ) : (
                          <Badge tone="success">Aktif</Badge>
                        ),
                    },
                    { key: "col6", header: "",
                      render: (k) =>
                        !k.revokedAt ? (
                          <div className="flex gap-2">
                            <button
                              type="button"
                              className="text-body text-info-text hover:underline"
                              disabled={acting}
                              onClick={() => void handleRotate(k.id)}
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
                    { key: "col7", header: "URL", render: (e) => <span className="font-mono text-caption">{e.url}</span> },
                    { key: "col8", header: "Event", render: (e) => (e.events ?? []).join(", ") },
                    { key: "col9", header: "Status",
                      render: (e) => (
                        <Badge tone={e.status === "ACTIVE" ? "success" : e.status === "CHALLENGED" ? "warning" : "neutral"}>
                          {e.status}
                        </Badge>
                      ),
                    },
                    { key: "col10", header: "Pengiriman terakhir", render: (e) => e.lastDeliveryAt ? formatDateTimeWIB(e.lastDeliveryAt) : "—" },
                    { key: "col11", header: "",
                      render: (e) => (
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

          {/* G466–G468 — pengiriman & replay */}
          <Card padded={false}>
            <CardHeader title={`Pengiriman webhook (${deliveries.length})`} />
            <CardBody>
              {deliveries.length === 0 ? (
                <p className="text-body text-text-secondary">Belum ada pengiriman.</p>
              ) : (
                <DataTable
                  columns={[
                    { key: "col12", header: "Event", render: (d) => d.eventType },
                    { key: "col13", header: "Status",
                      render: (d) => (
                        <Badge tone={d.status === "DELIVERED" ? "success" : d.status === "DEAD_LETTER" ? "danger" : "warning"}>
                          {d.status}
                        </Badge>
                      ),
                    },
                    { key: "col14", header: "Percobaan", render: (d) => String(d.attempts) },
                    { key: "col15", header: "Retry berikut", render: (d) => (d.nextRetryAt ? formatDateTimeWIB(d.nextRetryAt) : "—") },
                    { key: "col16", header: "Waktu", render: (d) => formatDateTimeWIB(d.createdAt) },
                    { key: "col17", header: "",
                      render: (d) =>
                        d.status === "FAILED" || d.status === "DEAD_LETTER" ? (
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

          {/* G455 — audit */}
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
                        {a.detail ? <p className="mt-1 text-body text-text-primary">{a.detail}</p> : null}
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

      {/* Dialog terbitkan kunci */}
      <Dialog
        open={showKeyDialog}
        onClose={() => {
          if (!issuing) setShowKeyDialog(false)
        }}
        title="Terbitkan kunci API"
        description="Plaintext kunci hanya ditampilkan SATU KALI setelah ini. Simpan di tempat aman."
        footer={
          <div className="flex flex-col gap-3">
            <Field label="Label (opsional)">
              <Input
                value={keyForm.label}
                onChange={(e) => setKeyForm((f) => ({ ...f, label: e.target.value }))}
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
        onClose={() => {
          setPlaintext(null)
          setPlaintextKeyId(null)
        }}
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
                onClick={() => {
                  setPlaintext(null)
                  setPlaintextKeyId(null)
                }}
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
