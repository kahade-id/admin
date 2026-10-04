/**
 * Kahade admin — booking jasa (service slot bookings).
 *
 * POIN 2 (unifikasi transaksi escrow): halaman admin daftar booking jasa,
 * READ-ONLY minimal — admin HANYA memantau. TIDAK ada aksi finansial
 * (batal/konfirmasi/paksa) di modul ini.
 *
 * KONTRAK ASUMSI (2026-10-04): belum ada endpoint admin booking jasa di
 * backend saat modul ini dibuat (yang ada hanya user-facing
 * `GET /v1/commerce/service-slots/bookings/mine` — terikat JWT user, tidak
 * bisa dipakai sesi admin). Path berikut mengikuti konvensi `/v1/admin/*`
 * yang sudah ada (lih. `admin/group-buying`, `admin/jastip-trips`):
 *   GET /v1/admin/service-bookings        — daftar (query: page, limit, status, search)
 * Respons diasumsikan bentuk paginasi standar backend
 * { data, total, page, limit, totalPages } dengan tiap baris memuat relasi
 * `slot` (ServiceSlot) dan `user` (pemesan), mengikuti pola
 * `myBookings` di `service-booking.service.ts` backend
 * (status enum backend: SlotBookingStatus = BOOKED|CANCELLED|COMPLETED;
 * `orderId` terisi saat order dibuat dari booking).
 * Sesuaikan dengan kontrak final backend bila berbeda.
 */
import { adminHttp } from "@/lib/api/admin-client"
import type { Paginated } from "@/lib/api/admin/kyc"

/** Selaras enum backend `SlotBookingStatus` (BOOKED|CANCELLED|COMPLETED). */
export type ServiceBookingStatus =
  | "BOOKED"
  | "CANCELLED"
  | "COMPLETED"
  | (string & {})

export type AdminServiceBookingSlot = {
  id?: string
  slotDate?: string
  startTime?: string
  endTime?: string
  capacity?: number
  bookedCount?: number
  showcaseId?: string
  sellerId?: string
  [key: string]: unknown
}

export type AdminServiceBookingItem = {
  id: string
  slotId: string
  userId: string
  /** Terisi saat order dibuat dari booking (soft FK orders.id). */
  orderId?: string | null
  status: ServiceBookingStatus | string
  createdAt: string
  updatedAt?: string
  slot?: AdminServiceBookingSlot | null
  user?: {
    userId?: string
    username?: string | null
    fullName?: string | null
    [key: string]: unknown
  } | null
  [key: string]: unknown
}

export function listAdminServiceBookings(params?: {
  page?: number
  limit?: number
  status?: string
  /** Cari berdasarkan ID booking / ID user / ID order (asumsi didukung backend). */
  search?: string
}): Promise<Paginated<AdminServiceBookingItem>> {
  return adminHttp.get<Paginated<AdminServiceBookingItem>>(
    "/v1/admin/service-bookings",
    { query: params },
  )
}
