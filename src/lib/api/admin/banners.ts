/**
 * Kahade admin — manajemen banner/carousel (batch 43, item #32).
 *
 * KONTRAK ASUMSI (belum diverifikasi ke backend): cabang backend
 * `mega/be-commerce` belum tersedia di remote saat halaman ini dibuat
 * (2026-09-28), sehingga path endpoint berikut adalah asumsi berdasarkan
 * konvensi `/v1/admin/*` yang sudah ada. Sesuaikan dengan kontrak final
 * backend bila berbeda:
 *   GET    /v1/admin/banners            — daftar (query: page, limit, isActive, q)
 *   POST   /v1/admin/banners            — buat banner (idempoten)
 *   GET    /v1/admin/banners/:id        — detail
 *   PATCH  /v1/admin/banners/:id        — ubah
 *   DELETE /v1/admin/banners/:id        — hapus PERMANEN (hard-delete di
 *     backend: `prisma.banner.delete()` — BUKAN soft-delete; tidak bisa
 *     dipulihkan). BAI-030: komentar lama "soft-delete" adalah SALAH.
 *
 * Jadwal tayang: `startsAt`/`endsAt` ISO-8601 opsional; banner tayang bila
 * `isActive` dan (tidak ada jadwal) atau (now dalam rentang jadwal).
 */
import { adminHttp } from "@/lib/api/admin-client"
import type { Paginated } from "@/lib/api/admin/kyc"
import { newIdempotencyKey } from "@/lib/api/admin/finance"

const idemHeaders = (key?: string): Record<string, string> => ({
  "Idempotency-Key": key ?? newIdempotencyKey(),
})

export interface AdminBannerItem {
  id: string
  title: string
  /** URL gambar banner (publik). */
  imageUrl: string
  /** Tautan tujuan saat banner diketuk (deep-link / URL). */
  linkUrl?: string | null
  /** Urutan tampil — makin kecil makin dulu. */
  sortOrder: number
  isActive: boolean
  /**
   * BAI-031 — slot tampil banner (backend: `position`, default "home_top";
   * dipakai `getActiveBanners(position)` untuk filter slot publik).
   */
  position: string
  /** ISO-8601 — null = tanpa batas. */
  startsAt?: string | null
  endsAt?: string | null
  createdAt: string
  updatedAt?: string | null
}

export interface CreateBannerInput {
  title: string
  imageUrl: string
  linkUrl?: string
  sortOrder?: number
  isActive?: boolean
  /** BAI-031 — slot tampil (maks 40 char; kosong = default backend "home_top"). */
  position?: string
  startsAt?: string
  endsAt?: string
}

export type UpdateBannerInput = Partial<CreateBannerInput>

export interface BannerListQuery {
  page?: number
  limit?: number
  /** "true" | "false" — filter status aktif. */
  isActive?: "true" | "false"
  /** Pencarian judul (diteruskan ke backend bila didukung). */
  q?: string
}

/** GET /v1/admin/banners — daftar banner. */
export function listBanners(params?: BannerListQuery): Promise<Paginated<AdminBannerItem>> {
  return adminHttp.get<Paginated<AdminBannerItem>>("/v1/admin/banners", {
    query: params as Record<string, string | number | boolean | null | undefined>,
  })
}

/** POST /v1/admin/banners — buat banner baru (idempoten). */
export function createBanner(
  input: CreateBannerInput,
  idempotencyKey?: string,
): Promise<AdminBannerItem> {
  return adminHttp.post<AdminBannerItem>("/v1/admin/banners", input, {
    headers: idemHeaders(idempotencyKey),
  })
}

/** GET /v1/admin/banners/:id — detail banner. */
export function getBannerDetail(bannerId: string): Promise<AdminBannerItem> {
  return adminHttp.get<AdminBannerItem>(
    `/v1/admin/banners/${encodeURIComponent(bannerId)}`,
  )
}

/** PATCH /v1/admin/banners/:id — ubah banner. */
export function updateBanner(
  bannerId: string,
  input: UpdateBannerInput,
): Promise<AdminBannerItem> {
  return adminHttp.patch<AdminBannerItem>(
    `/v1/admin/banners/${encodeURIComponent(bannerId)}`,
    input,
  )
}

/** DELETE /v1/admin/banners/:id — hapus banner PERMANEN (tidak dapat dipulihkan). */
export function deleteBanner(bannerId: string): Promise<unknown> {
  return adminHttp.delete(`/v1/admin/banners/${encodeURIComponent(bannerId)}`)
}

/** Apakah banner sedang dalam masa tayang menurut jadwalnya. */
export function isBannerLive(b: Pick<AdminBannerItem, "startsAt" | "endsAt">, now = Date.now()): boolean {
  if (b.startsAt && new Date(b.startsAt).getTime() > now) return false
  if (b.endsAt && new Date(b.endsAt).getTime() < now) return false
  return true
}
