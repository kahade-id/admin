/**
 * Kahade Admin — tampilan riwayat lokasi aksi pengguna (LKD-001).
 *
 * Menampilkan "di titik mana tiap aksi dilakukan": koordinat 6 desimal,
 * akurasi (meter), waktu capture (id-ID/WIB), sumber (gps/network/ip),
 * badge "Lokasi ditolak user" bila locationDenied, badge "Suspicious" bila
 * suspicious, alamat IP, dan link Google Maps (target _blank). Embed peta
 * penuh tidak diperlukan — link cukup.
 *
 * RBAC: GET /v1/admin/action-locations hanya untuk SUPER_ADMIN (+ role
 * fraud/dispute bila backend mengizinkan). Karena AdminRole belum punya role
 * "fraud", konsumen (halaman detail pengguna) hanya merender komponen ini
 * untuk SUPER_ADMIN.
 */
"use client"

import { useCallback, useEffect, useState } from "react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { DataTable } from "@/components/ui/table"
import { userMessage } from "@/lib/api/response"
import { formatDateTimeWIB } from "@/lib/format"
import {
  listActionLocations,
  type ActionLocationItem,
} from "@/lib/api/admin/action-locations"

/** Jumlah item per fetch (cukup untuk riwayat fraud tanpa paginasi penuh). */
export const ACTION_LOCATION_TAKE = 50

/** Link Google Maps — koordinat 6 desimal, format titik (bukan koma lokal). */
export function googleMapsLink(lat: number, lng: number): string {
  return `https://www.google.com/maps?q=${lat.toFixed(6)},${lng.toFixed(6)}`
}

/**
 * Format koordinat 6 desimal untuk tampilan. Mengembalikan null bila
 * koordinat tidak lengkap — pemanggil menampilkan "—" tanpa link Maps.
 */
export function formatCoordinates(
  lat: number | null | undefined,
  lng: number | null | undefined,
): string | null {
  if (lat == null || lng == null) return null
  if (Number.isNaN(lat) || Number.isNaN(lng)) return null
  return `${lat.toFixed(6)}, ${lng.toFixed(6)}`
}

/** Label Bahasa Indonesia untuk kode sumber lokasi. */
export function actionLocationSourceLabel(
  source: string | null | undefined,
): string {
  switch ((source ?? "").trim().toLowerCase()) {
    case "gps":
      return "GPS"
    case "network":
      return "Jaringan"
    case "ip":
      return "IP"
    default:
      return source?.trim() || "—"
  }
}

/**
 * Flag lokasi per baris: "Lokasi ditolak user" (user menolak berbagi lokasi)
 * dan "Suspicious" (heuristik backend, mis. lompatan lokasi tidak wajar).
 */
export function ActionLocationFlags({ item }: { item: ActionLocationItem }) {
  if (!item.locationDenied && !item.suspicious) return <span>—</span>
  return (
    <span className="flex flex-wrap gap-1">
      {item.locationDenied ? (
        <Badge tone="warning">Lokasi ditolak user</Badge>
      ) : null}
      {item.suspicious ? <Badge tone="danger">Suspicious</Badge> : null}
    </span>
  )
}

/**
 * Riwayat lokasi aksi satu pengguna (filter by userId). Mengelola
 * loading/error sendiri agar bisa disematkan di section halaman mana pun.
 */
export function ActionLocationHistory({ userId }: { userId: string }) {
  const [items, setItems] = useState<ActionLocationItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      setItems(await listActionLocations({ userId, take: ACTION_LOCATION_TAKE }))
    } catch (e) {
      setError(userMessage(e))
    } finally {
      setLoading(false)
    }
  }, [userId])

  useEffect(() => {
    void load()
  }, [load])

  if (error) {
    return (
      <div className="flex flex-wrap items-center gap-3">
        <p className="text-body text-danger-text">{error}</p>
        <Button size="sm" variant="secondary" fullWidth={false} onClick={load}>
          Coba lagi
        </Button>
      </div>
    )
  }

  return (
    <DataTable<ActionLocationItem>
      columns={[
        {
          key: "createdAt",
          header: "Waktu capture",
          render: (r) => formatDateTimeWIB(r.createdAt),
        },
        {
          key: "actionType",
          header: "Aksi",
          render: (r) => (
            <div>
              <p className="font-medium">{r.actionType}</p>
              {r.referenceType ? (
                <p className="font-mono text-caption text-text-secondary">
                  {r.referenceType}
                  {r.referenceId ? ` · ${r.referenceId}` : ""}
                </p>
              ) : null}
            </div>
          ),
        },
        {
          key: "coordinates",
          header: "Koordinat",
          render: (r) => {
            const coords = formatCoordinates(r.latitude, r.longitude)
            if (
              coords === null ||
              r.latitude == null ||
              r.longitude == null
            ) {
              return <span>—</span>
            }
            return (
              <div>
                <p className="font-mono text-[13px]">{coords}</p>
                <a
                  href={googleMapsLink(r.latitude, r.longitude)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-caption text-info-text underline"
                >
                  Lihat di Maps
                </a>
              </div>
            )
          },
        },
        {
          key: "accuracy",
          header: "Akurasi",
          render: (r) =>
            r.accuracy != null ? `± ${r.accuracy} m` : "—",
        },
        {
          key: "source",
          header: "Sumber",
          render: (r) => actionLocationSourceLabel(r.source),
        },
        {
          key: "flags",
          header: "Flag",
          render: (r) => <ActionLocationFlags item={r} />,
        },
        {
          key: "ipAddress",
          header: "IP",
          render: (r) => (
            <span className="font-mono text-[13px]">{r.ipAddress ?? "—"}</span>
          ),
        },
      ]}
      rows={items}
      rowKey={(r) => r.id}
      loading={loading}
      emptyText="Tidak ada riwayat lokasi aksi untuk pengguna ini."
    />
  )
}
