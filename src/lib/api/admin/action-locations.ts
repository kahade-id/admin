/**
 * Kahade admin — Riwayat lokasi aksi pengguna (LKD-001).
 *
 * Endpoint: GET `/v1/admin/action-locations` (disediakan tim backend paralel).
 * Hanya untuk SUPER_ADMIN (+ role fraud/dispute bila backend mengizinkan) —
 * UI menyembunyikan fitur ini dari role lain (lihat section "Riwayat lokasi
 * aksi" di halaman detail pengguna).
 *
 * Dipakai tim fraud/dispute untuk melihat "di titik mana tiap aksi dilakukan":
 * koordinat GPS saat login/registrasi/transaksi/payout, dst.
 */
import { adminHttp } from "@/lib/api/admin-client"

export type ActionLocationItem = {
  id: string
  userId: string
  actionType: string
  referenceType: string | null
  referenceId: string | null
  latitude: number | null
  longitude: number | null
  /** Akurasi horizontal dalam meter (null bila tidak diketahui). */
  accuracy: number | null
  /** "gps" | "network" | "ip" (atau sumber lain dari backend). */
  source: string | null
  /** true bila user menolak berbagi lokasi saat aksi — koordinat null. */
  locationDenied: boolean
  ipAddress: string | null
  /** Flag heuristik backend (mis. lompatan lokasi tidak wajar). */
  suspicious: boolean
  createdAt: string
}

export type ListActionLocationsQuery = {
  userId?: string
  actionType?: string
  referenceType?: string
  referenceId?: string
  /** Jumlah maksimum item (default backend bila kosong). */
  take?: number
}

/**
 * Ambil riwayat lokasi aksi. Bentuk respons defensif karena endpoint masih
 * dikerjakan tim backend paralel: `{ items: [...] } | { data: [...] } | [...]`.
 */
export async function listActionLocations(
  query: ListActionLocationsQuery = {},
): Promise<ActionLocationItem[]> {
  const res = await adminHttp.get<unknown>("/v1/admin/action-locations", {
    query: {
      userId: query.userId?.trim() || undefined,
      actionType: query.actionType?.trim() || undefined,
      referenceType: query.referenceType?.trim() || undefined,
      referenceId: query.referenceId?.trim() || undefined,
      take: query.take,
    },
  })
  if (Array.isArray(res)) return res as ActionLocationItem[]
  if (res && typeof res === "object") {
    const obj = res as Record<string, unknown>
    if (Array.isArray(obj.items)) return obj.items as ActionLocationItem[]
    if (Array.isArray(obj.data)) return obj.data as ActionLocationItem[]
  }
  return []
}
