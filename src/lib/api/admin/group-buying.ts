/**
 * Kahade admin — patungan grup / group buying (batch 43, item #30).
 *
 * Desain produk yang disetujui user (2026-09-28): semua peserta membayar ke
 * escrow dulu sebelum deadline; target tercapai → cair ke host, gagal →
 * auto-refund. Admin di sini HANYA memantau: daftar + detail (progres,
 * peserta, status). TIDAK ada aksi finansial di halaman admin (pencairan /
 * refund / pembatalan dijalankan otomatis backend atau lewat jalur dispute).
 * Bila backend nanti menyediakan endpoint aksi, sengaja TIDAK dipanggil
 * dari modul ini sampai ada keputusan eksplisit.
 *
 * KONTRAK ASUMSI (belum diverifikasi ke backend): cabang backend
 * `mega/be-commerce` belum tersedia di remote saat modul ini dibuat
 * (2026-09-28). Path endpoint berikut adalah asumsi berdasarkan konvensi
 * `/v1/admin/*` yang sudah ada — sesuaikan dengan kontrak final backend
 * bila berbeda:
 *   GET /v1/admin/group-buying        — daftar (query: page, limit, status, q)
 *   GET /v1/admin/group-buying/:id    — detail (progres + daftar peserta)
 */
import { adminHttp } from "@/lib/api/admin-client"
import type { Paginated } from "@/lib/api/admin/kyc"

export type GroupBuyStatus =
  | "OPEN"
  | "FUNDED"
  | "FAILED"
  | "DISBURSED"
  | "CANCELLED"
  | string

export interface GroupBuyItem {
  id: string
  title: string
  hostId: string
  hostName?: string | null
  /** Target dana (rupiah). */
  targetAmount: number
  /** Dana terkumpul di escrow (rupiah). */
  collectedAmount: number
  participantCount: number
  maxParticipants?: number | null
  status: GroupBuyStatus
  /** Tenggat pembayaran peserta — ISO-8601. */
  deadline: string
  createdAt: string
  updatedAt?: string | null
}

export interface GroupBuyParticipant {
  userId: string
  userName?: string | null
  /** Kontribusi peserta (rupiah). */
  amount: number
  /** true bila dana peserta sudah masuk escrow. */
  hasPaid: boolean
  joinedAt: string
  paidAt?: string | null
}

export interface GroupBuyDetail extends GroupBuyItem {
  participants: GroupBuyParticipant[]
  /** Mode pembagian: bagi rata (default) / nominal custom. */
  splitMode?: "EQUAL" | "CUSTOM" | string | null
  /** Nominal yang dicairkan ke host (bila sudah cair). */
  disbursedAmount?: number | null
}

export interface GroupBuyListQuery {
  page?: number
  limit?: number
  status?: GroupBuyStatus
  /** Pencarian judul/host (diteruskan ke backend bila didukung). */
  q?: string
}

/** GET /v1/admin/group-buying — daftar patungan. */
export function listGroupBuys(params?: GroupBuyListQuery): Promise<Paginated<GroupBuyItem>> {
  return adminHttp.get<Paginated<GroupBuyItem>>("/v1/admin/group-buying", {
    query: params as Record<string, string | number | boolean | null | undefined>,
  })
}

/** GET /v1/admin/group-buying/:id — detail patungan (progres + peserta). */
export function getGroupBuyDetail(groupBuyId: string): Promise<GroupBuyDetail> {
  return adminHttp.get<GroupBuyDetail>(
    `/v1/admin/group-buying/${encodeURIComponent(groupBuyId)}`,
  )
}
