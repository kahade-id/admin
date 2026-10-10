/**
 * Admin — Detail banner (batch 43, item #32).
 *
 * Menampilkan pratinjau gambar, tautan, urutan, status + jadwal tayang.
 * Ubah dilakukan dari halaman daftar (dialog); halaman ini read-only agar
 * tetap konsisten dengan pola detail voucher.
 */
"use client"

import Link from "next/link"
import { useCallback, useEffect, useState, type ReactNode } from "react"
import { useParams } from "next/navigation"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardBody, CardHeader } from "@/components/ui/card"
import { Spinner } from "@/components/ui/spinner"
import { useToast } from "@/components/ui/toast"
import { RoleGate } from "@/components/admin/role-gate"
import { userMessage } from "@/lib/api/response"
import { formatDateTimeWIB } from "@/lib/format"
import {
  getBannerDetail,
  isBannerLive,
  type AdminBannerItem,
} from "@/lib/api/admin/banners"

function KeyValue({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-2 border-b border-border py-2.5 last:border-b-0">
      <dt className="shrink-0 text-caption font-semibold text-text-secondary">{label}</dt>
      <dd className="min-w-0 flex-1 text-right text-body text-text-primary">{value}</dd>
    </div>
  )
}

function BannerDetailContent() {
  const params = useParams<{ id: string }>()
  const toast = useToast()
  const id = params.id

  const [banner, setBanner] = useState<AdminBannerItem | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [previewBroken, setPreviewBroken] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      setBanner(await getBannerDetail(id))
    } catch (e) {
      const msg = userMessage(e)
      setError(msg)
      toast.show({ title: "Gagal memuat detail banner", description: msg, tone: "danger" })
    } finally {
      setLoading(false)
    }
  }, [id, toast])

  useEffect(() => {
    void load()
  }, [load])

  return (
    <div className="flex flex-col gap-5">
      <div>
        <Link href="/banners" className="text-caption text-primary hover:underline">
          ← Kembali ke daftar banner
        </Link>
        <h1 className="mt-2 text-h2 font-semibold text-text-primary">
          {banner?.title ?? "Detail Banner"}
        </h1>
      </div>

      {loading ? (
        <div className="flex min-h-[30vh] items-center justify-center gap-2">
          <Spinner size="md" />
          <p className="text-body text-text-secondary">Memuat…</p>
        </div>
      ) : error || !banner ? (
        <Card>
          <CardBody className="flex flex-col gap-3">
            <p role="alert" className="text-body text-danger-text">
              {error ?? "Banner tidak ditemukan."}
            </p>
            <div className="max-w-xs">
              <Button variant="secondary" fullWidth={false} onClick={() => load()}>
                Coba lagi
              </Button>
            </div>
          </CardBody>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
          <Card padded={false}>
            <CardHeader title="Pratinjau" />
            <CardBody>
              {banner.imageUrl && !previewBroken ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={banner.imageUrl}
                  alt={banner.title}
                  className="w-full rounded-sm border border-border object-cover"
                  onError={() => setPreviewBroken(true)}
                />
              ) : (
                <p className="text-body text-text-secondary">
                  Gambar tidak dapat dimuat dari URL yang tersimpan.
                </p>
              )}
            </CardBody>
          </Card>

          <Card padded={false}>
            <CardHeader title="Informasi banner" />
            <CardBody>
              <dl>
                <KeyValue
                  label="Status"
                  value={
                    !banner.isActive ? (
                      <Badge tone="neutral" dot>Nonaktif</Badge>
                    ) : isBannerLive(banner) ? (
                      <Badge tone="success" dot>Tayang</Badge>
                    ) : (
                      <Badge tone="warning" dot>Di luar jadwal</Badge>
                    )
                  }
                />
                <KeyValue label="Judul" value={banner.title} />
                <KeyValue
                  label="Tautan"
                  value={
                    banner.linkUrl ? (
                      <span className="break-all font-mono text-caption">{banner.linkUrl}</span>
                    ) : (
                      "—"
                    )
                  }
                />
                <KeyValue label="Urutan tampil" value={banner.sortOrder} />
                <KeyValue
                  label="Mulai tayang"
                  value={banner.startsAt ? formatDateTimeWIB(banner.startsAt) : "Tanpa jadwal"}
                />
                <KeyValue
                  label="Akhir tayang"
                  value={banner.endsAt ? formatDateTimeWIB(banner.endsAt) : "Tanpa jadwal"}
                />
                <KeyValue label="Dibuat" value={formatDateTimeWIB(banner.createdAt)} />
                {banner.updatedAt ? (
                  <KeyValue label="Diperbarui" value={formatDateTimeWIB(banner.updatedAt)} />
                ) : null}
              </dl>
              <p className="mt-4 text-caption text-text-secondary">
                Untuk mengubah banner, gunakan tombol “Ubah” dari halaman daftar.
              </p>
            </CardBody>
          </Card>
        </div>
      )}
    </div>
  )
}

export default function BannerDetailPage() {
  return (
    <RoleGate href="/banners">
      <BannerDetailContent />
    </RoleGate>
  )
}
