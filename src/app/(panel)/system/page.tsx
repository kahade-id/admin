/**
 * Admin — Sistem.
 *
 * (a) Config sistem — daftar key/value + ubah. Perubahan config finansial
 *     tidak langsung berlaku: masuk antrean persetujuan (status pending) dan
 *     butuh persetujuan admin lain.
 * (b) Persetujuan config pending — setujui/tolak (tolak wajib alasan;
 *     penolakan hanya sah oleh admin berbeda dari pengusul).
 * (c) Broadcast — form judul + pesan + kanal + audiens + kirim (konfirmasi),
 *     plus riwayat pengiriman sesi ini.
 * (d) Webhook dead-letter — daftar + retry/resolve.
 * (e) Audit log admin — daftar read-only + filter.
 *
 * Port dari frontend/app/admin/(panel)/system.tsx → web desktop.
 */
"use client"

import { useCallback, useEffect, useState } from "react"

import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Card, CardBody, CardHeader } from "@/components/ui/card"
import { ConfirmDialog, Dialog } from "@/components/ui/dialog"
import { Input, TextArea } from "@/components/ui/input"
import { DataTable } from "@/components/ui/table"
import { useToast } from "@/components/ui/toast"
import { Select } from "@/components/admin/select"
import { Pagination } from "@/components/admin/pagination"
import { RoleGate } from "@/components/admin/role-gate"
import { formatDateTimeWIB, formatNumber } from "@/lib/format"
import { userMessage } from "@/lib/api/response"
import type { Paginated } from "@/lib/api/admin/kyc"
import {
  listConfigs,
  updateConfig,
  listPendingConfigChanges,
  approveConfigChange,
  rejectConfigChange,
  sendBroadcast,
  listAuditLogs,
  listWebhookLogs,
  retryWebhook,
  resolveWebhook,
  type AdminSystemConfig,
  type PendingConfigChange,
  type AdminAuditLogItem,
  type AdminWebhookLogItem,
  type BroadcastAudience,
  type BroadcastChannel,
} from "@/lib/api/admin/system"

const PAGE_SIZE = 20

/**
 * Baris tabel: interface dari kontrak API tidak punya implicit index
 * signature sehingga tidak memenuhi `DataTable<Row extends Record<string,
 * unknown>>` — alias lokal ini menutupinya tanpa mengubah kontrak API.
 */
type ConfigRow = AdminSystemConfig & Record<string, unknown>
type WebhookRow = AdminWebhookLogItem & Record<string, unknown>
type AuditRow = AdminAuditLogItem & Record<string, unknown>

function Section({
  title,
  description,
  children,
}: {
  title: string
  description?: string
  children: React.ReactNode
}) {
  return (
    <section className="flex flex-col gap-3">
      <div>
        <h2 className="text-h3 font-semibold text-text-primary">{title}</h2>
        {description ? (
          <p className="mt-1 text-body text-text-secondary">{description}</p>
        ) : null}
      </div>
      {children}
    </section>
  )
}

function ErrorCard({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <Card>
      <CardBody className="flex flex-col gap-3">
        <p role="alert" className="text-body text-danger-text">
          {message}
        </p>
        <div className="max-w-xs">
          <Button variant="secondary" onClick={onRetry}>
            Coba lagi
          </Button>
        </div>
      </CardBody>
    </Card>
  )
}

function CheckRow({
  label,
  checked,
  onChange,
}: {
  label: string
  checked: boolean
  onChange: (v: boolean) => void
}) {
  return (
    <label className="flex cursor-pointer select-none items-center gap-2.5">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="h-4 w-4 accent-primary"
      />
      <span className="text-body text-text-primary">{label}</span>
    </label>
  )
}

/* ------------------------------------------------------------------ */
/* (a) Config sistem                                                    */
/* ------------------------------------------------------------------ */

function ConfigSection({ reloadSignal }: { reloadSignal: number }) {
  const toast = useToast()
  const [configs, setConfigs] = useState<AdminSystemConfig[]>([])
  const [pendingKeys, setPendingKeys] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [editing, setEditing] = useState<AdminSystemConfig | null>(null)
  const [value, setValue] = useState("")
  const [description, setDescription] = useState("")
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [list, pending] = await Promise.all([
        listConfigs(),
        listPendingConfigChanges(),
      ])
      setConfigs(list)
      setPendingKeys(new Set(pending.map((p) => p.key)))
    } catch (e) {
      const msg = userMessage(e)
      setError(msg)
      toast.show({ title: "Gagal memuat config", description: msg, tone: "danger" })
    } finally {
      setLoading(false)
    }
  }, [toast])

  useEffect(() => {
    void load()
  }, [load, reloadSignal])

  function openEdit(c: AdminSystemConfig) {
    setEditing(c)
    setValue(c.value)
    setDescription(c.description ?? "")
    setFormError(null)
  }

  async function handleSave() {
    if (!editing) return
    setFormError(null)
    if (!value.trim()) {
      setFormError("Nilai config wajib diisi.")
      return
    }
    setSaving(true)
    try {
      const res = await updateConfig(
        editing.key,
        value.trim(),
        description.trim() ? description.trim() : undefined,
      )
      setEditing(null)
      if ("proposedValue" in res) {
        // Perubahan config finansial: masuk antrean persetujuan.
        toast.show({
          title: "Menunggu persetujuan",
          description:
            "Perubahan config finansial memerlukan persetujuan admin lain sebelum berlaku.",
          tone: "info",
        })
      } else {
        toast.show({ title: "Config diperbarui.", tone: "success" })
      }
      void load()
    } catch (e) {
      setFormError(userMessage(e))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Section
      title="Config sistem"
      description="Perubahan config finansial (fee/komisi) tidak langsung berlaku — menunggu persetujuan admin lain."
    >
      {error && !loading ? (
        <ErrorCard message={error} onRetry={load} />
      ) : (
        <DataTable<ConfigRow>
          columns={[
            {
              key: "key",
              header: "Key",
              render: (r) => (
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-[13px] font-semibold">{r.key}</span>
                  {pendingKeys.has(r.key) ? (
                    <Badge tone="warning" dot>
                      Menunggu persetujuan
                    </Badge>
                  ) : null}
                </div>
              ),
            },
            {
              key: "value",
              header: "Nilai",
              render: (r) => (
                <span className="break-all font-mono text-[13px]">{r.value}</span>
              ),
            },
            {
              key: "description",
              header: "Deskripsi",
              render: (r) => (
                <span className="text-text-secondary">{r.description ?? "—"}</span>
              ),
            },
            {
              key: "dataType",
              header: "Tipe",
              render: (r) => <Badge tone="neutral">{r.dataType}</Badge>,
            },
            {
              key: "updatedAt",
              header: "Diubah",
              render: (r) => formatDateTimeWIB(r.updatedAt),
            },
            {
              key: "action",
              header: "",
              align: "right",
              render: (r) => (
                <Button
                  variant="secondary"
                  size="sm"
                  fullWidth={false}
                  onClick={() => openEdit(r)}
                >
                  Ubah
                </Button>
              ),
            },
          ]}
          rows={configs as ConfigRow[]}
          rowKey={(r) => r.id}
          loading={loading}
          emptyText="Tidak ada config sistem."
        />
      )}

      <Dialog
        open={editing != null}
        onClose={() => setEditing(null)}
        title={editing ? `Ubah config: ${editing.key}` : "Ubah config"}
        description="Bila key ini tergolong finansial, perubahan masuk antrean persetujuan."
      >
        <div className="flex flex-col gap-4">
          {formError ? (
            <p role="alert" className="text-body text-danger-text">
              {formError}
            </p>
          ) : null}
          <TextArea
            label="Nilai"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            rows={3}
            required
          />
          <Input
            label="Deskripsi (opsional)"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            maxLength={500}
          />
          <Button loading={saving} onClick={handleSave}>
            Simpan
          </Button>
        </div>
      </Dialog>
    </Section>
  )
}
/* ------------------------------------------------------------------ */
/* (b) Persetujuan config pending                                      */
/* ------------------------------------------------------------------ */

function PendingApprovalsSection({
  reloadSignal,
  onChanged,
}: {
  reloadSignal: number
  onChanged: () => void
}) {
  const toast = useToast()
  const [items, setItems] = useState<PendingConfigChange[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [approving, setApproving] = useState<PendingConfigChange | null>(null)
  const [approvingNow, setApprovingNow] = useState(false)
  const [rejecting, setRejecting] = useState<PendingConfigChange | null>(null)
  const [rejectReason, setRejectReason] = useState("")
  const [rejectingNow, setRejectingNow] = useState(false)
  const [rejectError, setRejectError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      setItems(await listPendingConfigChanges())
    } catch (e) {
      const msg = userMessage(e)
      setError(msg)
      toast.show({ title: "Gagal memuat persetujuan", description: msg, tone: "danger" })
    } finally {
      setLoading(false)
    }
  }, [toast])

  useEffect(() => {
    void load()
  }, [load, reloadSignal])

  async function handleApprove() {
    if (!approving) return
    setApprovingNow(true)
    try {
      await approveConfigChange(approving.key)
      setApproving(null)
      toast.show({ title: "Perubahan disetujui dan diterapkan.", tone: "success" })
      void load()
      onChanged()
    } catch (e) {
      toast.show({
        title: "Gagal menyetujui perubahan",
        description: userMessage(e),
        tone: "danger",
      })
    } finally {
      setApprovingNow(false)
    }
  }

  async function handleReject() {
    if (!rejecting) return
    setRejectError(null)
    if (!rejectReason.trim()) {
      setRejectError("Alasan penolakan wajib diisi.")
      return
    }
    setRejectingNow(true)
    try {
      // CATATAN: kontrak API rejectConfigChange(key) dan backend tidak
      // menerima field alasan — alasan wajib dikumpulkan di UI (aturan
      // bisnis) namun saat ini tidak tersimpan di server. Lihat laporan.
      await rejectConfigChange(rejecting.key)
      const reason = rejectReason.trim()
      setRejecting(null)
      setRejectReason("")
      toast.show({
        title: "Perubahan ditolak.",
        description: `Alasan: ${reason}`,
        tone: "success",
      })
      void load()
      onChanged()
    } catch (e) {
      setRejectError(userMessage(e))
    } finally {
      setRejectingNow(false)
    }
  }

  return (
    <Section
      title="Persetujuan config"
      description="Perubahan config finansial hanya sah bila disetujui admin yang berbeda dari pengusul."
    >
      {error && !loading ? (
        <ErrorCard message={error} onRetry={load} />
      ) : loading ? (
        <Card>
          <CardBody>
            <p className="text-body text-text-secondary">Memuat…</p>
          </CardBody>
        </Card>
      ) : items.length === 0 ? (
        <Card>
          <CardBody>
            <p className="text-body text-text-secondary">
              Tidak ada perubahan config finansial yang menunggu persetujuan.
            </p>
          </CardBody>
        </Card>
      ) : (
        <div className="flex flex-col gap-3">
          {items.map((p) => (
            <Card key={p.key}>
              <CardHeader
                title={p.key}
                action={
                  <Badge tone="warning" dot>
                    Pending
                  </Badge>
                }
              />
              <CardBody className="flex flex-col gap-2">
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  <div>
                    <p className="text-caption text-text-secondary">Nilai saat ini</p>
                    <p className="break-all font-mono text-[13px]">{p.currentValue ?? "—"}</p>
                  </div>
                  <div>
                    <p className="text-caption text-text-secondary">Nilai usulan</p>
                    <p className="break-all font-mono text-[13px] font-semibold">
                      {p.proposedValue}
                    </p>
                  </div>
                </div>
                {p.proposedDescription ? (
                  <p className="text-body text-text-secondary">{p.proposedDescription}</p>
                ) : null}
                <p className="text-caption text-text-tertiary">
                  Diusulkan oleh <span className="font-mono">{p.proposedBy}</span> ·{" "}
                  {formatDateTimeWIB(p.proposedAt)}
                  {p.ipAddress ? ` · ${p.ipAddress}` : ""}
                </p>
                <div className="flex flex-wrap gap-2 pt-1">
                  <Button
                    size="sm"
                    fullWidth={false}
                    onClick={() => setApproving(p)}
                  >
                    Setujui
                  </Button>
                  <Button
                    variant="destructive"
                    size="sm"
                    fullWidth={false}
                    onClick={() => {
                      setRejecting(p)
                      setRejectReason("")
                      setRejectError(null)
                    }}
                  >
                    Tolak
                  </Button>
                </div>
              </CardBody>
            </Card>
          ))}
        </div>
      )}

      <ConfirmDialog
        open={approving != null}
        onClose={() => setApproving(null)}
        title="Setujui perubahan?"
        description={
          approving
            ? `Config ${approving.key} akan diubah menjadi "${approving.proposedValue}" dan langsung berlaku. Pastikan Anda bukan pengusul perubahan ini.`
            : undefined
        }
        confirmLabel="Setujui"
        onConfirm={handleApprove}
        loading={approvingNow}
      />

      <Dialog
        open={rejecting != null}
        onClose={() => setRejecting(null)}
        title="Tolak perubahan?"
        description={
          rejecting
            ? `Perubahan config ${rejecting.key} akan dibatalkan. Alasan penolakan wajib diisi.`
            : undefined
        }
      >
        <div className="flex flex-col gap-4">
          {rejectError ? (
            <p role="alert" className="text-body text-danger-text">
              {rejectError}
            </p>
          ) : null}
          <TextArea
            label="Alasan penolakan"
            value={rejectReason}
            onChange={(e) => setRejectReason(e.target.value)}
            maxLength={500}
            rows={3}
            required
          />
          <Button variant="destructive" loading={rejectingNow} onClick={handleReject}>
            Tolak perubahan
          </Button>
        </div>
      </Dialog>
    </Section>
  )
}

/* ------------------------------------------------------------------ */
/* (c) Broadcast                                                        */
/* ------------------------------------------------------------------ */

const BROADCAST_AUDIENCES: { value: BroadcastAudience; label: string }[] = [
  { value: "all", label: "Semua pengguna" },
  { value: "active", label: "Pengguna aktif" },
  { value: "kahade_plus", label: "Kahade Plus" },
  { value: "verified", label: "Terverifikasi" },
]

type SentBroadcast = {
  id: number
  title: string
  audience: string
  channels: string
  recipientCount: number
  sentAt: string
}

function BroadcastSection() {
  const toast = useToast()
  const [title, setTitle] = useState("")
  const [body, setBody] = useState("")
  const [inApp, setInApp] = useState(true)
  const [push, setPush] = useState(true)
  const [audience, setAudience] = useState<BroadcastAudience>("all")
  const [confirming, setConfirming] = useState(false)
  const [sending, setSending] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [history, setHistory] = useState<SentBroadcast[]>([])

  function openConfirm() {
    setFormError(null)
    if (title.trim().length < 3 || body.trim().length < 3) {
      setFormError("Judul dan pesan minimal 3 karakter.")
      return
    }
    if (!inApp && !push) {
      setFormError("Pilih minimal satu kanal pengiriman.")
      return
    }
    setConfirming(true)
  }

  async function handleSend() {
    const channels: BroadcastChannel[] = []
    if (inApp) channels.push("in_app")
    if (push) channels.push("push")
    setSending(true)
    try {
      const res = await sendBroadcast({
        title: title.trim(),
        body: body.trim(),
        channels,
        targetAudience: audience,
      })
      const audienceLabel =
        BROADCAST_AUDIENCES.find((a) => a.value === audience)?.label ?? audience
      const channelLabel = channels
        .map((c) => (c === "in_app" ? "In-app" : "Push"))
        .join(" + ")
      setHistory((prev) => [
        {
          id: Date.now(),
          title: title.trim(),
          audience: audienceLabel,
          channels: channelLabel,
          recipientCount: res.recipientCount,
          sentAt: new Date().toISOString(),
        },
        ...prev,
      ])
      setConfirming(false)
      toast.show({
        title: "Broadcast terkirim.",
        description: `${formatNumber(res.recipientCount)} penerima.`,
        tone: "success",
      })
      setTitle("")
      setBody("")
    } catch (e) {
      setFormError(userMessage(e))
      setConfirming(false)
    } finally {
      setSending(false)
    }
  }

  return (
    <Section title="Broadcast" description="Kirim pengumuman ke pengguna melalui kanal yang dipilih.">
      <Card>
        <CardBody className="flex flex-col gap-4">
          {formError ? (
            <p role="alert" className="text-body text-danger-text">
              {formError}
            </p>
          ) : null}
          <Input
            label="Judul"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={100}
            required
          />
          <TextArea
            label="Pesan"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            maxLength={500}
            rows={3}
            required
          />
          <div className="flex flex-col gap-2">
            <p className="text-label font-semibold text-text-secondary">Kanal pengiriman</p>
            <CheckRow
              label="Notifikasi dalam aplikasi"
              checked={inApp}
              onChange={setInApp}
            />
            <CheckRow label="Push notification" checked={push} onChange={setPush} />
          </div>
          <Select
            label="Target audiens"
            value={audience}
            onChange={(e) => setAudience(e.target.value as BroadcastAudience)}
            options={BROADCAST_AUDIENCES.map((a) => ({ value: a.value, label: a.label }))}
          />
          <div className="max-w-xs">
            <Button loading={sending} onClick={openConfirm}>
              Kirim broadcast
            </Button>
          </div>
        </CardBody>
      </Card>

      <div className="flex flex-col gap-2">
        <h3 className="text-label font-semibold text-text-secondary">
          Riwayat pengiriman (sesi ini)
        </h3>
        {history.length === 0 ? (
          <p className="text-body text-text-secondary">
            Belum ada broadcast yang dikirim pada sesi ini.
          </p>
        ) : (
          <DataTable<SentBroadcast>
            columns={[
              { key: "title", header: "Judul", render: (r) => r.title },
              { key: "audience", header: "Audiens", render: (r) => r.audience },
              { key: "channels", header: "Kanal", render: (r) => r.channels },
              {
                key: "recipientCount",
                header: "Penerima",
                align: "right",
                render: (r) => formatNumber(r.recipientCount),
              },
              { key: "sentAt", header: "Dikirim", render: (r) => formatDateTimeWIB(r.sentAt) },
            ]}
            rows={history}
            rowKey={(r) => String(r.id)}
            emptyText="Belum ada broadcast yang dikirim."
          />
        )}
      </div>

      <ConfirmDialog
        open={confirming}
        onClose={() => setConfirming(false)}
        title="Kirim broadcast?"
        description={`Broadcast "${title.trim()}" akan dikirim ke ${
          BROADCAST_AUDIENCES.find((a) => a.value === audience)?.label ?? audience
        }. Lanjutkan?`}
        confirmLabel="Kirim"
        onConfirm={handleSend}
        loading={sending}
      />
    </Section>
  )
}
/* ------------------------------------------------------------------ */
/* (d) Webhook dead-letter                                              */
/* ------------------------------------------------------------------ */

function WebhookSection() {
  const toast = useToast()
  const [page, setPage] = useState(1)
  const [rows, setRows] = useState<AdminWebhookLogItem[]>([])
  const [total, setTotal] = useState(0)
  const [totalPages, setTotalPages] = useState(1)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [retryingId, setRetryingId] = useState<string | null>(null)
  const [resolving, setResolving] = useState<AdminWebhookLogItem | null>(null)
  const [resolution, setResolution] = useState("")
  const [resolvingNow, setResolvingNow] = useState(false)
  const [resolveError, setResolveError] = useState<string | null>(null)

  const load = useCallback(
    async (targetPage: number) => {
      setLoading(true)
      setError(null)
      try {
        const res: Paginated<AdminWebhookLogItem> = await listWebhookLogs({
          page: targetPage,
          limit: PAGE_SIZE,
          deadLettered: "true",
        })
        setRows(res.data ?? [])
        const t = res.meta?.total ?? res.total ?? res.data?.length ?? 0
        setTotal(t)
        setTotalPages(res.meta?.totalPages ?? Math.max(1, Math.ceil(t / PAGE_SIZE)))
        setPage(targetPage)
      } catch (e) {
        const msg = userMessage(e)
        setError(msg)
        toast.show({ title: "Gagal memuat webhook", description: msg, tone: "danger" })
      } finally {
        setLoading(false)
      }
    },
    [toast],
  )

  useEffect(() => {
    void load(1)
  }, [load])

  async function handleRetry(item: AdminWebhookLogItem) {
    setRetryingId(item.id)
    try {
      await retryWebhook(item.id)
      toast.show({ title: "Webhook diantre ulang.", tone: "success" })
      void load(page)
    } catch (e) {
      toast.show({ title: "Gagal mengantre ulang", description: userMessage(e), tone: "danger" })
    } finally {
      setRetryingId(null)
    }
  }

  async function handleResolve() {
    if (!resolving) return
    setResolveError(null)
    if (!resolution.trim()) {
      setResolveError("Catatan penyelesaian wajib diisi.")
      return
    }
    setResolvingNow(true)
    try {
      await resolveWebhook(resolving.id, resolution.trim())
      setResolving(null)
      setResolution("")
      toast.show({ title: "Webhook diselesaikan.", tone: "success" })
      void load(page)
    } catch (e) {
      setResolveError(userMessage(e))
    } finally {
      setResolvingNow(false)
    }
  }

  return (
    <Section
      title="Webhook dead-letter"
      description="Webhook yang gagal diproses dan masuk antrean dead-letter."
    >
      {error && !loading ? (
        <ErrorCard message={error} onRetry={() => load(page)} />
      ) : (
        <>
          <DataTable<WebhookRow>
            columns={[
              {
                key: "source",
                header: "Sumber",
                render: (r) => (
                  <div>
                    <p className="font-semibold">{r.source}</p>
                    <p className="text-caption text-text-secondary">
                      {r.event}
                      {r.transactionId ? ` · ${r.transactionId}` : ""}
                    </p>
                  </div>
                ),
              },
              {
                key: "status",
                header: "Status",
                render: (r) =>
                  r.isProcessed ? (
                    <Badge tone="success" dot>
                      Diproses
                    </Badge>
                  ) : (
                    <Badge tone="danger" dot>
                      Gagal
                    </Badge>
                  ),
              },
              {
                key: "retryCount",
                header: "Percobaan",
                align: "right",
                render: (r) => formatNumber(r.retryCount),
              },
              {
                key: "errorMessage",
                header: "Error",
                render: (r) => (
                  <span className="block max-w-md truncate text-text-secondary" title={r.errorMessage ?? ""}>
                    {r.errorMessage ?? "—"}
                  </span>
                ),
              },
              {
                key: "deadLetteredAt",
                header: "Dead-letter",
                render: (r) => formatDateTimeWIB(r.deadLetteredAt),
              },
              {
                key: "action",
                header: "",
                align: "right",
                render: (r) =>
                  r.isProcessed ? (
                    <span className="text-caption text-text-tertiary">—</span>
                  ) : (
                    <div className="flex justify-end gap-2">
                      <Button
                        variant="secondary"
                        size="sm"
                        fullWidth={false}
                        loading={retryingId === r.id}
                        onClick={() => handleRetry(r)}
                      >
                        Retry
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        fullWidth={false}
                        onClick={() => {
                          setResolving(r)
                          setResolution("")
                          setResolveError(null)
                        }}
                      >
                        Resolve
                      </Button>
                    </div>
                  ),
              },
            ]}
            rows={rows as WebhookRow[]}
            rowKey={(r) => r.id}
            loading={loading}
            emptyText="Tidak ada dead-letter. Semua webhook berhasil diproses."
          />
          <Pagination
            page={page}
            totalPages={totalPages}
            total={total}
            pageSize={PAGE_SIZE}
            onPageChange={load}
            disabled={loading}
          />
        </>
      )}

      <Dialog
        open={resolving != null}
        onClose={() => setResolving(null)}
        title="Resolve webhook"
        description="Menandai webhook sebagai diselesaikan manual — retry otomatis dihentikan."
      >
        <div className="flex flex-col gap-4">
          {resolveError ? (
            <p role="alert" className="text-body text-danger-text">
              {resolveError}
            </p>
          ) : null}
          <TextArea
            label="Catatan penyelesaian"
            value={resolution}
            onChange={(e) => setResolution(e.target.value)}
            maxLength={500}
            rows={3}
            required
          />
          <Button loading={resolvingNow} onClick={handleResolve}>
            Tandai selesai
          </Button>
        </div>
      </Dialog>
    </Section>
  )
}

/* ------------------------------------------------------------------ */
/* (e) Audit log admin (read-only)                                      */
/* ------------------------------------------------------------------ */

function AuditLogSection() {
  const toast = useToast()
  const [page, setPage] = useState(1)
  const [rows, setRows] = useState<AdminAuditLogItem[]>([])
  const [total, setTotal] = useState(0)
  const [totalPages, setTotalPages] = useState(1)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [actionFilter, setActionFilter] = useState("")
  const [targetTypeFilter, setTargetTypeFilter] = useState("")
  const [startDate, setStartDate] = useState("")
  const [endDate, setEndDate] = useState("")

  const load = useCallback(
    async (
      targetPage: number,
      filters: { action: string; targetType: string; startDate: string; endDate: string },
    ) => {
      setLoading(true)
      setError(null)
      try {
        const res: Paginated<AdminAuditLogItem> = await listAuditLogs({
          page: targetPage,
          limit: PAGE_SIZE,
          action: filters.action.trim() || undefined,
          targetType: filters.targetType.trim() || undefined,
          startDate: filters.startDate
            ? new Date(`${filters.startDate}T00:00:00`).toISOString()
            : undefined,
          endDate: filters.endDate
            ? new Date(`${filters.endDate}T23:59:59`).toISOString()
            : undefined,
        })
        setRows(res.data ?? [])
        const t = res.meta?.total ?? res.total ?? res.data?.length ?? 0
        setTotal(t)
        setTotalPages(res.meta?.totalPages ?? Math.max(1, Math.ceil(t / PAGE_SIZE)))
        setPage(targetPage)
      } catch (e) {
        const msg = userMessage(e)
        setError(msg)
        toast.show({ title: "Gagal memuat audit log", description: msg, tone: "danger" })
      } finally {
        setLoading(false)
      }
    },
    [toast],
  )

  useEffect(() => {
    void load(1, { action: "", targetType: "", startDate: "", endDate: "" })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function currentFilters() {
    return {
      action: actionFilter,
      targetType: targetTypeFilter,
      startDate,
      endDate,
    }
  }

  function applyFilters() {
    void load(1, currentFilters())
  }

  function resetFilters() {
    setActionFilter("")
    setTargetTypeFilter("")
    setStartDate("")
    setEndDate("")
    void load(1, { action: "", targetType: "", startDate: "", endDate: "" })
  }

  return (
    <Section title="Audit log admin" description="Catatan aktivitas admin — read-only.">
      <Card>
        <CardBody className="flex flex-col gap-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Input
              label="Aksi"
              value={actionFilter}
              onChange={(e) => setActionFilter(e.target.value)}
              placeholder="cth. CONFIG_APPROVE"
            />
            <Input
              label="Tipe target"
              value={targetTypeFilter}
              onChange={(e) => setTargetTypeFilter(e.target.value)}
              placeholder="cth. SYSTEM_CONFIG"
            />
            <Input
              label="Dari tanggal"
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
            />
            <Input
              label="Sampai tanggal"
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
            />
          </div>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" fullWidth={false} onClick={applyFilters} disabled={loading}>
              Terapkan filter
            </Button>
            <Button
              variant="secondary"
              size="sm"
              fullWidth={false}
              onClick={resetFilters}
              disabled={loading}
            >
              Reset
            </Button>
          </div>
        </CardBody>
      </Card>

      {error && !loading ? (
        <ErrorCard message={error} onRetry={() => load(page, currentFilters())} />
      ) : (
        <>
          <DataTable<AuditRow>
            columns={[
              {
                key: "createdAt",
                header: "Waktu",
                render: (r) => (
                  <span className="whitespace-nowrap">{formatDateTimeWIB(r.createdAt)}</span>
                ),
              },
              {
                key: "action",
                header: "Aksi",
                render: (r) => <span className="font-mono text-[13px]">{r.action}</span>,
              },
              {
                key: "description",
                header: "Deskripsi",
                render: (r) => (
                  <span className="block max-w-md truncate text-text-secondary" title={r.description}>
                    {r.description}
                  </span>
                ),
              },
              {
                key: "target",
                header: "Target",
                render: (r) =>
                  r.targetType ? (
                    <span className="font-mono text-[13px]">
                      {r.targetType}
                      {r.targetId ? ` · ${r.targetId.slice(0, 8)}…` : ""}
                    </span>
                  ) : (
                    <span className="text-text-tertiary">—</span>
                  ),
              },
              {
                key: "adminId",
                header: "Admin",
                render: (r) => (
                  <span className="font-mono text-[13px]">{r.adminId.slice(0, 8)}…</span>
                ),
              },
              {
                key: "ipAddress",
                header: "IP",
                render: (r) => r.ipAddress ?? "—",
              },
            ]}
            rows={rows as AuditRow[]}
            rowKey={(r) => r.id}
            loading={loading}
            emptyText="Belum ada aktivitas admin yang tercatat pada filter ini."
          />
          <Pagination
            page={page}
            totalPages={totalPages}
            total={total}
            pageSize={PAGE_SIZE}
            onPageChange={(p) => load(p, currentFilters())}
            disabled={loading}
          />
        </>
      )}
    </Section>
  )
}

/* ------------------------------------------------------------------ */
/* Halaman                                                             */
/* ------------------------------------------------------------------ */

export default function SystemPage() {
  const [reloadSignal, setReloadSignal] = useState(0)

  return (
    <RoleGate href="/system">
      <div className="flex flex-col gap-8">
        <div>
          <h1 className="text-h2 font-semibold text-text-primary">Sistem</h1>
          <p className="mt-1 text-body text-text-secondary">
            Konfigurasi, persetujuan, broadcast, webhook, dan audit log.
          </p>
        </div>

        <ConfigSection reloadSignal={reloadSignal} />
        <PendingApprovalsSection
          reloadSignal={reloadSignal}
          onChanged={() => setReloadSignal((n) => n + 1)}
        />
        <BroadcastSection />
        <WebhookSection />
        <AuditLogSection />
      </div>
    </RoleGate>
  )
}
