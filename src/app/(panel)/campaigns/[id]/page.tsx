/**
 * Admin — Detail kampanye.
 *
 * Menampilkan: status, field terkunci (badge "Terkunci"), ringkasan
 * penukaran & estimasi biaya promo, jadwal (WIB), preview segmen target +
 * estimasi penerima, riwayat versi & audit perubahan (GET :id/versions —
 * disembunyikan bila endpoint belum tersedia/404), serta aksi: ubah,
 * duplikasi ke draf, aktifkan/jeda, hapus draf (dengan error backend bila
 * kampanye sudah menerbitkan voucher).
 */
"use client"

import Link from "next/link"
import { useCallback, useEffect, useState, type ReactNode } from "react"
import { useParams, useRouter } from "next/navigation"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardBody, CardHeader } from "@/components/ui/card"
import { ConfirmDialog, Dialog } from "@/components/ui/dialog"
import { EmptyState } from "@/components/ui/empty-state"
import { Spinner } from "@/components/ui/spinner"
import { useToast } from "@/components/ui/toast"
import { RoleGate } from "@/components/admin/role-gate"
import { userMessage, ApiError } from "@/lib/api/response"
import { formatDateTimeWIB, formatIDR, formatNumber } from "@/lib/format"
import {
  activateCampaign,
  deleteCampaign,
  duplicateCampaign,
  getCampaign,
  getCampaignVersions,
  pauseCampaign,
  type AdminCampaignItem,
  type AdminCampaignVersion,
} from "@/lib/api/admin/campaigns"
import {
  campaignKey,
  campaignStatusLabel,
  campaignStatusTone,
  campaignTypeLabel,
  membershipRankLabel,
  LOCKED_CAMPAIGN_FIELDS,
} from "../lib"

function KeyValue({ label, value, mono = false }: { label: string; value: ReactNode; mono?: boolean }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-2 border-b border-border py-2.5 last:border-b-0">
      <dt className="shrink-0 text-caption font-semibold text-text-secondary">{label}</dt>
      <dd
        className={
          mono
            ? "min-w-0 flex-1 break-all text-right font-mono text-[13px] text-text-primary"
            : "min-w-0 flex-1 text-right text-body text-text-primary"
        }
      >
        {value}
      </dd>
    </div>
  )
}

function isNotFound(err: unknown): boolean {
  return err instanceof ApiError && err.status === 404
}

function formatChangeValue(v: unknown): string {
  if (v == null) return "—"
  if (typeof v === "boolean") return v ? "Ya" : "Tidak"
  if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}T/.test(v)) return formatDateTimeWIB(v)
  if (typeof v === "object") return JSON.stringify(v)
  return String(v)
}

function VersionChanges({ version }: { version: AdminCampaignVersion }) {
  const { changes } = version
  if (changes == null) return <span className="text-text-tertiary">—</span>
  if (Array.isArray(changes)) {
    if (changes.length === 0) return <span className="text-text-tertiary">—</span>
    return (
      <ul className="flex flex-col gap-1">
        {changes.map((c, i) => {
          if (typeof c === "string")
            return (
              <li key={i} className="text-body text-text-primary">
                {c}
              </li>
            )
          const rec = c as { field?: string; from?: unknown; to?: unknown }
          return (
            <li key={i} className="text-body text-text-primary">
              <span className="font-semibold">{String(rec.field ?? "?")}</span>:{" "}
              {formatChangeValue(rec.from)} → {formatChangeValue(rec.to)}
            </li>
          )
        })}
      </ul>
    )
  }
  return (
    <ul className="flex flex-col gap-1">
      {Object.entries(changes).map(([field, value]) => (
        <li key={field} className="text-body text-text-primary">
          <span className="font-semibold">{field}</span>: {formatChangeValue(value)}
        </li>
      ))}
    </ul>
  )
}

function CampaignDetailContent() {
  const params = useParams<{ id: string }>()
  const router = useRouter()
  const toast = useToast()
  const id = params.id

  const [campaign, setCampaign] = useState<AdminCampaignItem | null>(null)
  const [versions, setVersions] = useState<AdminCampaignVersion[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const [duplicateOpen, setDuplicateOpen] = useState(false)
  const [duplicating, setDuplicating] = useState(false)
  const [toggling, setToggling] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const detail = await getCampaign(id)
      setCampaign(detail)
      // Riwayat versi: endpoint opsional — sembunyikan section bila 404.
      try {
        const v = await getCampaignVersions(id)
        setVersions(v)
      } catch (ve) {
        if (!isNotFound(ve)) {
          // Gagal non-404: anggap riwayat kosong, jangan ganggu halaman.
        }
        setVersions(null)
      }
    } catch (e) {
      setError(userMessage(e))
    } finally {
      setLoading(false)
    }
  }, [id])

  useEffect(() => {
    void load()
  }, [load])

  async function handleDelete() {
    setDeleting(true)
    setDeleteError(null)
    try {
      await deleteCampaign(id)
      toast.show({ title: "Draf kampanye dihapus.", tone: "success" })
      router.push("/campaigns")
    } catch (e) {
      // Error backend (mis. kampanye sudah menerbitkan voucher) ditampilkan.
      setDeleteError(userMessage(e))
    } finally {
      setDeleting(false)
    }
  }

  async function handleDuplicate() {
    setDuplicating(true)
    try {
      const dup = await duplicateCampaign(id)
      toast.show({ title: "Kampanye diduplikasi ke draf.", tone: "success" })
      router.push(`/campaigns/${encodeURIComponent(campaignKey(dup))}`)
    } catch (e) {
      toast.show({ title: "Gagal menduplikasi kampanye", description: userMessage(e), tone: "danger" })
    } finally {
      setDuplicating(false)
      setDuplicateOpen(false)
    }
  }

  async function handleToggleActive() {
    if (!campaign) return
    setToggling(true)
    try {
      if (campaign.status === "ACTIVE") {
        await pauseCampaign(id)
        toast.show({ title: "Kampanye dijeda.", tone: "success" })
      } else {
        const res = await activateCampaign(id)
        const issued = res.voucherIssuance?.issued
        toast.show({
          title: "Kampanye diaktifkan.",
          description:
            issued != null ? `${formatNumber(issued)} voucher personal diterbitkan.` : undefined,
          tone: "success",
        })
      }
      void load()
    } catch (e) {
      toast.show({ title: "Gagal mengubah status kampanye", description: userMessage(e), tone: "danger" })
    } finally {
      setToggling(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Spinner size="md" />
      </div>
    )
  }

  if (error || !campaign) {
    return (
      <EmptyState
        title="Kampanye tidak ditemukan"
        description={error ?? "Data kampanye tidak tersedia."}
        action={
          <Button variant="secondary" fullWidth={false} onClick={() => router.push("/campaigns")}>
            Kembali ke daftar
          </Button>
        }
      />
    )
  }

  const c = campaign
  const key = campaignKey(c)
  const now = Date.now()
  const startMs = new Date(c.startsAt).getTime()
  const endMs = new Date(c.endsAt).getTime()
  const scheduleLabel = Number.isNaN(startMs) || Number.isNaN(endMs)
    ? "—"
    : now < startMs
      ? "Belum mulai"
      : now > endMs
        ? "Selesai"
        : "Berjalan"
  const used = c.currentRedemptions ?? 0
  const remaining = c.maxRedemptions != null ? Math.max(0, c.maxRedemptions - used) : null
  const promoUnitValue = c.discountValue ?? c.maxDiscount ?? null
  const estimatedCost = promoUnitValue != null ? promoUnitValue * used : null
  const canDelete = c.status === "DRAFT"
  const canActivate = c.status === "DRAFT" || c.status === "PAUSED"
  const canPause = c.status === "ACTIVE"

  const segmentCriteria: string[] = []
  if (c.targetAudience) segmentCriteria.push(`Label audiens: ${c.targetAudience}`)
  if (c.targetMinRank) segmentCriteria.push(`Rank minimum: ${membershipRankLabel(c.targetMinRank)}`)
  if (c.targetDormantDays != null) segmentCriteria.push(`Dormant minimal ${formatNumber(c.targetDormantDays)} hari`)
  if (c.targetNewUserOnly) segmentCriteria.push("Hanya pengguna baru")
  if (c.rolloutPercent != null) segmentCriteria.push(`Rollout bertahap ${c.rolloutPercent}% dari segmen`)

  return (
    <div className="flex flex-col gap-5">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-caption text-text-tertiary">
            <Link href="/campaigns" className="hover:underline">
              Kampanye
            </Link>{" "}
            / {key}
          </p>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <h1 className="text-h2 font-semibold text-text-primary">{c.name}</h1>
            <Badge tone={campaignStatusTone(c.status)} dot>
              {campaignStatusLabel(c.status)}
            </Badge>
          </div>
          <p className="mt-1 text-body text-text-secondary">
            {campaignTypeLabel(c.type)}
            {c.promoCode ? ` · Kode promo: ${c.promoCode}` : ""}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href={`/campaigns/${encodeURIComponent(key)}/edit`}>
            <Button variant="secondary" size="sm" fullWidth={false}>
              Ubah
            </Button>
          </Link>
          <Button variant="secondary" size="sm" fullWidth={false} onClick={() => setDuplicateOpen(true)}>
            Duplikasi ke draf
          </Button>
          {canActivate ? (
            <Button size="sm" fullWidth={false} loading={toggling} onClick={handleToggleActive}>
              Aktifkan
            </Button>
          ) : null}
          {canPause ? (
            <Button variant="secondary" size="sm" fullWidth={false} loading={toggling} onClick={handleToggleActive}>
              Jeda
            </Button>
          ) : null}
          {canDelete ? (
            <Button
              variant="destructive"
              size="sm"
              fullWidth={false}
              onClick={() => {
                setDeleteError(null)
                setDeleteOpen(true)
              }}
            >
              Hapus draf
            </Button>
          ) : null}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        {/* Ringkasan */}
        <Card>
          <CardHeader>
            <h2 className="text-h3 font-semibold text-text-primary">Ringkasan</h2>
          </CardHeader>
          <CardBody>
            <dl>
              <KeyValue label="Status" value={campaignStatusLabel(c.status)} />
              <KeyValue label="Tipe" value={campaignTypeLabel(c.type)} />
              <KeyValue label="Deskripsi" value={c.description || "—"} />
              <KeyValue label="Kode promo" value={c.promoCode || "—"} mono />
              <KeyValue label="Pembuat" value={c.createdByName || c.createdBy || "—"} />
              <KeyValue label="Dibuat" value={formatDateTimeWIB(c.createdAt)} />
              <KeyValue label="Diubah" value={formatDateTimeWIB(c.updatedAt)} />
            </dl>
          </CardBody>
        </Card>

        {/* Ringkasan penukaran & biaya promo */}
        <Card>
          <CardHeader>
            <h2 className="text-h3 font-semibold text-text-primary">Penukaran &amp; biaya promo</h2>
          </CardHeader>
          <CardBody>
            <dl>
              <KeyValue
                label="Penukaran"
                value={
                  c.maxRedemptions != null
                    ? `${formatNumber(used)} / ${formatNumber(c.maxRedemptions)}`
                    : formatNumber(used)
                }
              />
              <KeyValue label="Sisa kuota" value={remaining != null ? formatNumber(remaining) : "Tanpa batas"} />
              <KeyValue
                label="Estimasi biaya promo"
                value={
                  estimatedCost != null
                    ? `${formatIDR(estimatedCost)} (${formatNumber(used)} penukaran × ${formatIDR(promoUnitValue)})`
                    : "—"
                }
              />
              <KeyValue
                label="Nilai per penukaran"
                value={
                  promoUnitValue != null
                    ? formatIDR(promoUnitValue)
                    : c.discountPercent != null
                      ? `${c.discountPercent}%`
                      : "—"
                }
              />
            </dl>
            <p className="mt-3 text-caption text-text-tertiary">
              Estimasi biaya dihitung dari nilai promo per penukaran × jumlah penukaran saat ini.
            </p>
          </CardBody>
        </Card>

        {/* Jadwal */}
        <Card>
          <CardHeader>
            <h2 className="text-h3 font-semibold text-text-primary">Jadwal</h2>
          </CardHeader>
          <CardBody>
            <dl>
              <KeyValue label="Mulai" value={formatDateTimeWIB(c.startsAt)} />
              <KeyValue label="Berakhir" value={formatDateTimeWIB(c.endsAt)} />
              <KeyValue label="Zona waktu" value="Asia/Jakarta (WIB)" />
              <KeyValue label="Status jadwal" value={scheduleLabel} />
            </dl>
          </CardBody>
        </Card>

        {/* Segmen target */}
        <Card>
          <CardHeader>
            <h2 className="text-h3 font-semibold text-text-primary">Segmen target</h2>
          </CardHeader>
          <CardBody>
            {segmentCriteria.length > 0 ? (
              <ul className="flex flex-col gap-2">
                {segmentCriteria.map((s, i) => (
                  <li key={i} className="flex items-start gap-2 text-body text-text-primary">
                    <span aria-hidden className="text-text-tertiary">
                      •
                    </span>
                    {s}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-body text-text-secondary">Tanpa batasan segmen — berlaku untuk semua pengguna.</p>
            )}
            <dl className="mt-4">
              <KeyValue
                label="Estimasi penerima"
                value={
                  c.maxRedemptions != null
                    ? `Maksimal ${formatNumber(c.maxRedemptions)} penukaran`
                    : "Tanpa batas penukaran"
                }
              />
            </dl>
            <p className="mt-3 text-caption text-text-tertiary">
              Estimasi dihitung dari kuota penukaran dan persentase rollout kampanye.
            </p>
          </CardBody>
        </Card>
      </div>

      {/* Field terkunci */}
      <Card>
        <CardHeader>
          <h2 className="text-h3 font-semibold text-text-primary">Field terkunci</h2>
          <p className="mt-1 text-caption text-text-secondary">
            Field berikut tidak dapat diubah setelah kampanye dibuat — termasuk saat masih draf — untuk
            menjaga integritas promo.
          </p>
        </CardHeader>
        <CardBody>
          <ul className="flex flex-col gap-2">
            {LOCKED_CAMPAIGN_FIELDS.map((f) => (
              <li key={f.key} className="flex items-center justify-between gap-2">
                <span className="text-body text-text-primary">{f.label}</span>
                <Badge tone="neutral" variant="outline">
                  Terkunci
                </Badge>
              </li>
            ))}
          </ul>
        </CardBody>
      </Card>

      {/* Riwayat versi & audit perubahan — disembunyikan bila endpoint belum ada (404) */}
      {versions ? (
        <Card>
          <CardHeader>
            <h2 className="text-h3 font-semibold text-text-primary">Riwayat versi &amp; audit perubahan</h2>
          </CardHeader>
          <CardBody>
            {versions.length === 0 ? (
              <p className="text-body text-text-secondary">Belum ada riwayat perubahan.</p>
            ) : (
              <ol className="flex flex-col gap-4">
                {versions.map((v, i) => (
                  <li key={v.id ?? i} className="border-b border-border pb-4 last:border-b-0 last:pb-0">
                    <div className="flex flex-wrap items-center gap-2">
                      {v.version != null ? (
                        <Badge tone="info" variant="outline">
                          v{v.version}
                        </Badge>
                      ) : null}
                      <span className="text-body font-semibold text-text-primary">
                        {v.action ?? "Perubahan"}
                      </span>
                      <span className="text-caption text-text-tertiary">
                        {v.actorName || v.changedBy || "—"} · {formatDateTimeWIB(v.changedAt)}
                      </span>
                    </div>
                    {v.note ? (
                      <p className="mt-1 text-body text-text-secondary">{v.note}</p>
                    ) : null}
                    <div className="mt-2">
                      <VersionChanges version={v} />
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </CardBody>
        </Card>
      ) : null}

      {/* Hapus draf — error backend (mis. sudah terbit voucher) ditampilkan di dialog */}
      <Dialog
        open={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        title="Hapus draf kampanye?"
        description={`"${c.name}" akan dihapus permanen. Hanya draf yang belum menerbitkan voucher yang bisa dihapus.`}
        footer={
          <div className="flex flex-col gap-2">
            <Button variant="destructive" loading={deleting} onClick={handleDelete}>
              Hapus
            </Button>
            <Button variant="ghost" disabled={deleting} onClick={() => setDeleteOpen(false)}>
              Batal
            </Button>
          </div>
        }
      >
        {deleteError ? (
          <p role="alert" className="pt-2 text-body text-danger-text">
            {deleteError}
          </p>
        ) : null}
      </Dialog>

      {/* Duplikasi */}
      <ConfirmDialog
        open={duplicateOpen}
        onClose={() => setDuplicateOpen(false)}
        title="Duplikasi ke draf?"
        description={`Buat draf kampanye baru dari "${c.name}" dengan pengaturan yang sama.`}
        confirmLabel="Duplikasi"
        onConfirm={handleDuplicate}
        loading={duplicating}
      />
    </div>
  )
}

export default function CampaignDetailPage() {
  return (
    <RoleGate href="/campaigns">
      <CampaignDetailContent />
    </RoleGate>
  )
}
