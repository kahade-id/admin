/**
 * Admin — Ubah kampanye.
 *
 * Form → updateCampaign. Field yang terkunci (tipe & parameter diskon)
 * ditampilkan nonaktif dengan badge "Terkunci". Sebelum menyimpan,
 * admin melihat PRATINJAU diff (sebelum vs sesudah) — hanya field yang
 * berubah yang dikirim ke server.
 *
 * Validasi client: nama ≥3 karakter; tanggal valid & selesai > mulai;
 * rollout 1–100; maks. penukaran > 0.
 */
"use client"

import Link from "next/link"
import { useCallback, useEffect, useState } from "react"
import { useParams, useRouter } from "next/navigation"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardBody, CardHeader } from "@/components/ui/card"
import { EmptyState } from "@/components/ui/empty-state"
import { Input, TextArea } from "@/components/ui/input"
import { Spinner } from "@/components/ui/spinner"
import { useToast } from "@/components/ui/toast"
import { RoleGate } from "@/components/admin/role-gate"
import { Select } from "@/components/admin/select"
import { userMessage } from "@/lib/api/response"
import { formatDateTimeWIB } from "@/lib/format"
import {
  getCampaign,
  updateCampaign,
  type AdminCampaignItem,
  type AdminMembershipRank,
  type UpdateCampaignInput,
} from "@/lib/api/admin/campaigns"
import {
  campaignKey,
  campaignTypeLabel,
  campaignStatusLabel,
  membershipRankLabel,
  MEMBERSHIP_RANKS,
  LOCKED_CAMPAIGN_FIELDS,
  dayToISO,
  isoToDay,
  parseIntInput,
} from "../../lib"

interface EditableValues {
  name: string
  description: string
  startsAt: string
  endsAt: string
  promoCode: string
  targetAudience: string
  targetMinRank: "" | AdminMembershipRank
  targetDormantDays: string
  targetNewUserOnly: boolean
  maxRedemptions: string
  rolloutPercent: string
}

interface DiffRow {
  label: string
  before: string
  after: string
}

function toEditable(c: AdminCampaignItem): EditableValues {
  return {
    name: c.name ?? "",
    description: c.description ?? "",
    startsAt: isoToDay(c.startsAt),
    endsAt: isoToDay(c.endsAt),
    promoCode: c.promoCode ?? "",
    targetAudience: c.targetAudience ?? "",
    targetMinRank: c.targetMinRank ?? "",
    targetDormantDays: c.targetDormantDays != null ? String(c.targetDormantDays) : "",
    targetNewUserOnly: c.targetNewUserOnly ?? false,
    maxRedemptions: c.maxRedemptions != null ? String(c.maxRedemptions) : "",
    rolloutPercent: c.rolloutPercent != null ? String(c.rolloutPercent) : "",
  }
}

function formatRank(r: "" | AdminMembershipRank): string {
  return r ? membershipRankLabel(r) : "—"
}

function buildDiff(original: AdminCampaignItem, v: EditableValues): DiffRow[] {
  const base = toEditable(original)
  const rows: DiffRow[] = []
  const push = (label: string, before: string, after: string) => {
    if (before !== after) rows.push({ label, before, after })
  }
  push("Nama kampanye", base.name, v.name.trim())
  push("Deskripsi", base.description || "—", v.description.trim() || "—")
  push("Mulai", formatDateTimeWIB(original.startsAt), formatDateTimeWIB(dayToISO(v.startsAt, false)))
  push("Berakhir", formatDateTimeWIB(original.endsAt), formatDateTimeWIB(dayToISO(v.endsAt, true)))
  push("Kode promo", base.promoCode || "—", v.promoCode.trim().toUpperCase() || "—")
  push("Label audiens", base.targetAudience || "—", v.targetAudience.trim() || "—")
  push("Rank minimum", formatRank(base.targetMinRank), formatRank(v.targetMinRank))
  push(
    "Dormant (hari)",
    base.targetDormantDays || "—",
    v.targetDormantDays.trim() || "—",
  )
  push(
    "Hanya pengguna baru",
    base.targetNewUserOnly ? "Ya" : "Tidak",
    v.targetNewUserOnly ? "Ya" : "Tidak",
  )
  push("Maks. penukaran", base.maxRedemptions || "Tanpa batas", v.maxRedemptions.trim() || "Tanpa batas")
  push("Rollout (%)", base.rolloutPercent || "—", v.rolloutPercent.trim() || "—")
  return rows
}

function buildInput(original: AdminCampaignItem, v: EditableValues): UpdateCampaignInput {
  const base = toEditable(original)
  const input: UpdateCampaignInput = {}
  const name = v.name.trim()
  if (name !== base.name) input.name = name
  const description = v.description.trim()
  if (description !== base.description) input.description = description
  const start = dayToISO(v.startsAt, false)
  if (start && start !== original.startsAt) input.startsAt = start
  const end = dayToISO(v.endsAt, true)
  if (end && end !== original.endsAt) input.endsAt = end
  const promo = v.promoCode.trim().toUpperCase()
  if (promo !== base.promoCode) input.promoCode = promo
  const audience = v.targetAudience.trim()
  if (audience !== base.targetAudience) input.targetAudience = audience
  if (v.targetMinRank !== base.targetMinRank) input.targetMinRank = v.targetMinRank || undefined
  const dormant = parseIntInput(v.targetDormantDays)
  if ((v.targetDormantDays.trim() || "") !== base.targetDormantDays) {
    input.targetDormantDays = dormant
  }
  if (v.targetNewUserOnly !== base.targetNewUserOnly) input.targetNewUserOnly = v.targetNewUserOnly
  const maxR = parseIntInput(v.maxRedemptions)
  if ((v.maxRedemptions.trim() || "") !== base.maxRedemptions) input.maxRedemptions = maxR
  const rollout = parseIntInput(v.rolloutPercent)
  if ((v.rolloutPercent.trim() || "") !== base.rolloutPercent) input.rolloutPercent = rollout
  return input
}

function CampaignEditContent() {
  const params = useParams<{ id: string }>()
  const router = useRouter()
  const toast = useToast()
  const id = decodeURIComponent(params.id)

  const [original, setOriginal] = useState<AdminCampaignItem | null>(null)
  const [values, setValues] = useState<EditableValues | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [formError, setFormError] = useState<string | null>(null)
  const [showPreview, setShowPreview] = useState(false)
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const detail = await getCampaign(id)
      setOriginal(detail)
      setValues(toEditable(detail))
    } catch (e) {
      setError(userMessage(e))
    } finally {
      setLoading(false)
    }
  }, [id])

  useEffect(() => {
    void load()
  }, [load])

  function set<K extends keyof EditableValues>(key: K, value: EditableValues[K]) {
    setValues((prev) => (prev ? { ...prev, [key]: value } : prev))
    setShowPreview(false)
  }

  function validate(v: EditableValues): string | null {
    if (v.name.trim().length < 3) return "Nama kampanye minimal 3 karakter."
    const start = dayToISO(v.startsAt, false)
    const end = dayToISO(v.endsAt, true)
    if (!start || !end) return "Tanggal mulai/selesai wajib diisi (format tanggal valid)."
    if (new Date(end) <= new Date(start)) return "Tanggal selesai harus setelah tanggal mulai."
    const rollout = parseIntInput(v.rolloutPercent)
    if (v.rolloutPercent.trim() !== "") {
      if (rollout === undefined || !Number.isInteger(rollout) || rollout < 1 || rollout > 100) {
        return "Rollout harus bilangan bulat 1–100."
      }
    }
    const maxR = parseIntInput(v.maxRedemptions)
    if (v.maxRedemptions.trim() !== "") {
      if (maxR === undefined || !Number.isInteger(maxR) || maxR <= 0) {
        return "Maks. penukaran harus bilangan bulat lebih dari 0."
      }
    }
    const dormant = parseIntInput(v.targetDormantDays)
    if (v.targetDormantDays.trim() !== "") {
      if (dormant === undefined || !Number.isInteger(dormant) || dormant < 0) {
        return "Dormant (hari) harus bilangan bulat 0 atau lebih."
      }
    }
    return null
  }

  function handlePreview() {
    if (!values) return
    const err = validate(values)
    setFormError(err)
    if (!err) setShowPreview(true)
  }

  async function handleSave() {
    if (!original || !values) return
    const err = validate(values)
    setFormError(err)
    if (err) {
      setShowPreview(false)
      return
    }
    const input = buildInput(original, values)
    setSaving(true)
    try {
      await updateCampaign(id, input)
      toast.show({ title: "Kampanye diperbarui.", tone: "success" })
      router.push(`/campaigns/${encodeURIComponent(campaignKey(original))}`)
    } catch (e) {
      setFormError(userMessage(e))
      setShowPreview(false)
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Spinner size="md" />
      </div>
    )
  }

  if (error || !original || !values) {
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

  const diffs = showPreview ? buildDiff(original, values) : []

  return (
    <div className="flex flex-col gap-5">
      <div>
        <p className="text-caption text-text-tertiary">
          <Link href="/campaigns" className="hover:underline">
            Kampanye
          </Link>{" "}
          /{" "}
          <Link href={`/campaigns/${encodeURIComponent(campaignKey(original))}`} className="hover:underline">
            {campaignKey(original)}
          </Link>{" "}
          / Ubah
        </p>
        <h1 className="mt-1 text-h2 font-semibold text-text-primary">Ubah kampanye</h1>
        <p className="mt-1 text-body text-text-secondary">
          {original.name} · {campaignTypeLabel(original.type)} · {campaignStatusLabel(original.status)}
        </p>
      </div>

      {formError ? (
        <p role="alert" className="text-body text-danger-text">
          {formError}
        </p>
      ) : null}

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        {/* Form */}
        <Card>
          <CardHeader>
            <h2 className="text-h3 font-semibold text-text-primary">Pengaturan</h2>
          </CardHeader>
          <CardBody className="flex flex-col gap-4">
            <Input
              label="Nama kampanye"
              value={values.name}
              onChange={(e) => set("name", e.target.value)}
              maxLength={100}
              required
            />
            <TextArea
              label="Deskripsi"
              value={values.description}
              onChange={(e) => set("description", e.target.value)}
              maxLength={1000}
              rows={2}
            />
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Input
                label="Mulai"
                type="date"
                value={values.startsAt}
                onChange={(e) => set("startsAt", e.target.value)}
                required
              />
              <Input
                label="Berakhir"
                type="date"
                value={values.endsAt}
                onChange={(e) => set("endsAt", e.target.value)}
                required
              />
            </div>
            <Input
              label="Kode promo"
              value={values.promoCode}
              onChange={(e) => set("promoCode", e.target.value)}
              maxLength={32}
            />
            <Input
              label="Label audiens"
              value={values.targetAudience}
              onChange={(e) => set("targetAudience", e.target.value)}
              maxLength={500}
            />
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Select
                label="Rank minimum"
                value={values.targetMinRank}
                onChange={(e) => set("targetMinRank", e.target.value as "" | AdminMembershipRank)}
                options={[
                  { value: "", label: "Tanpa batas rank" },
                  ...MEMBERSHIP_RANKS.map((r) => ({ value: r.value, label: r.label })),
                ]}
              />
              <Input
                label="Dormant (hari)"
                value={values.targetDormantDays}
                onChange={(e) => set("targetDormantDays", e.target.value)}
                inputMode="numeric"
              />
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Input
                label="Maks. penukaran"
                value={values.maxRedemptions}
                onChange={(e) => set("maxRedemptions", e.target.value)}
                inputMode="numeric"
                hint="Harus lebih dari 0. Kosongkan untuk tanpa batas."
              />
              <Input
                label="Rollout (%)"
                value={values.rolloutPercent}
                onChange={(e) => set("rolloutPercent", e.target.value)}
                inputMode="numeric"
                hint="Bilangan bulat 1–100. Hanya bisa dinaikkan, tidak bisa diturunkan."
              />
            </div>
            <label className="flex cursor-pointer select-none items-center gap-2.5">
              <input
                type="checkbox"
                checked={values.targetNewUserOnly}
                onChange={(e) => set("targetNewUserOnly", e.target.checked)}
                className="h-4 w-4 accent-primary"
              />
              <span className="text-body text-text-primary">Hanya pengguna baru</span>
            </label>
          </CardBody>
        </Card>

        {/* Field terkunci */}
        <Card>
          <CardHeader>
            <h2 className="text-h3 font-semibold text-text-primary">Field terkunci</h2>
            <p className="mt-1 text-caption text-text-secondary">
              Tidak dapat diubah lewat layar ini.
            </p>
          </CardHeader>
          <CardBody className="flex flex-col gap-4">
            <Input label="Tipe kampanye" value={campaignTypeLabel(original.type)} disabled />
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Input
                label="Nilai diskon (Rp)"
                value={original.discountValue != null ? String(original.discountValue) : "—"}
                disabled
              />
              <Input
                label="Persen diskon (%)"
                value={original.discountPercent != null ? String(original.discountPercent) : "—"}
                disabled
              />
            </div>
            <Input
              label="Maksimal diskon (Rp)"
              value={original.maxDiscount != null ? String(original.maxDiscount) : "—"}
              disabled
            />
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
      </div>

      {/* Pratinjau diff */}
      {showPreview ? (
        <Card>
          <CardHeader>
            <h2 className="text-h3 font-semibold text-text-primary">Pratinjau perubahan</h2>
            <p className="mt-1 text-caption text-text-secondary">
              Periksa perbedaan sebelum menyimpan — hanya field yang berubah yang dikirim ke server.
            </p>
          </CardHeader>
          <CardBody>
            {diffs.length === 0 ? (
              <p className="text-body text-text-secondary">Tidak ada perubahan.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-body">
                  <thead>
                    <tr className="border-b border-border text-caption font-semibold text-text-secondary">
                      <th className="py-2 pr-4">Field</th>
                      <th className="py-2 pr-4">Sebelum</th>
                      <th className="py-2">Sesudah</th>
                    </tr>
                  </thead>
                  <tbody>
                    {diffs.map((d) => (
                      <tr key={d.label} className="border-b border-border last:border-b-0">
                        <td className="py-2 pr-4 font-semibold text-text-primary">{d.label}</td>
                        <td className="py-2 pr-4 text-text-secondary">{d.before}</td>
                        <td className="py-2 font-semibold text-text-primary">{d.after}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardBody>
        </Card>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" fullWidth={false} onClick={handlePreview}>
          Pratinjau perubahan
        </Button>
        <Button fullWidth={false} loading={saving} onClick={handleSave} disabled={!showPreview}>
          Simpan perubahan
        </Button>
        <Link href={`/campaigns/${encodeURIComponent(campaignKey(original))}`}>
          <Button variant="secondary" fullWidth={false}>
            Batal
          </Button>
        </Link>
      </div>
    </div>
  )
}

export default function CampaignEditPage() {
  return (
    <RoleGate href="/campaigns">
      <CampaignEditContent />
    </RoleGate>
  )
}
