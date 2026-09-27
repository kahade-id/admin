/**
 * Kahade admin — jastip trip (batch 43, item #29).
 *
 * Desain produk yang disetujui user (2026-09-28): etalase khusus trip
 * (judul, deadline order, slot, katalog/request bebas); harga dikunci saat
 * host konfirmasi (barang + fee jastip + ongkir terpisah transparan), buyer
 * membayar via escrow; host gagal dapat barang → refund otomatis. Admin di
 * sini HANYA memantau: daftar + detail trip. Tidak ada aksi finansial.
 *
 * KONTRAK ASUMSI (belum diverifikasi ke backend): cabang backend
 * `mega/be-commerce` belum tersedia di remote saat modul ini dibuat
 * (2026-09-28). Path endpoint berikut adalah asumsi berdasarkan konvensi
 * `/v1/admin/*` yang sudah ada — sesuaikan dengan kontrak final backend
 * bila berbeda:
 *   GET /v1/admin/jastip-trips       — daftar (query: page, limit, status, q)
 *   GET /v1/admin/jastip-trips/:id   — detail trip + item pesanan
 */
import { adminHttp } from "@/lib/api/admin-client"
import type { Paginated } from "@/lib/api/admin/kyc"

export type JastipTripStatus = "OPEN" | "CLOSED" | "COMPLETED" | "CANCELLED" | string

export interface JastipTripItem {
  id: string
  title: string
  hostId: string
  hostName?: string | null
  /** Destinasi/tujuan trip. */
  destination?: string | null
  /** Tenggat pemesanan — ISO-8601. */
  orderDeadline: string
  status: JastipTripStatus
  /** Jumlah slot tersedia (null = tanpa batas). */
  slotCount?: number | null
  orderCount?: number
  createdAt: string
  updatedAt?: string | null
}

export interface JastipOrderItem {
  id: string
  buyerId: string
  buyerName?: string | null
  itemName: string
  /** Rincian transparan: harga barang / fee jastip / ongkir (rupiah). */
  itemPrice?: number | null
  jastipFee?: number | null
  shippingCost?: number | null
  status?: string | null
  createdAt: string
}

export interface JastipTripDetail extends JastipTripItem {
  catalog?: { id: string; name: string; price?: number | null }[]
  orders?: JastipOrderItem[]
}

export interface JastipTripListQuery {
  page?: number
  limit?: number
  status?: JastipTripStatus
  /** Pencarian judul/destinasi/host (diteruskan ke backend bila didukung). */
  q?: string
}

/** GET /v1/admin/jastip-trips — daftar trip jastip. */
export function listJastipTrips(params?: JastipTripListQuery): Promise<Paginated<JastipTripItem>> {
  return adminHttp.get<Paginated<JastipTripItem>>("/v1/admin/jastip-trips", {
    query: params as Record<string, string | number | boolean | null | undefined>,
  })
}

/** GET /v1/admin/jastip-trips/:id — detail trip. */
export function getJastipTripDetail(tripId: string): Promise<JastipTripDetail> {
  return adminHttp.get<JastipTripDetail>(
    `/v1/admin/jastip-trips/${encodeURIComponent(tripId)}`,
  )
}
