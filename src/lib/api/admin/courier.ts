/**
 * Kahade admin — operasional kurir (GAP-D G242–G250).
 * Backend: /v1/admin/courier (katalog/flag, booking gagal, tracking basi,
 * rekonsiliasi ongkir, refund ongkir).
 *
 * SATUAN UANG (audit alamat & kurir 2026-10-10, F01–F03): semua biaya ongkir
 * (`estimatedCost`, `actualCost`, `diff`, `amount` refund) adalah RUPIAH UTUH
 * — kolom BigInt rupiah di backend. Format dengan `formatIDR`, BUKAN
 * `formatIdrSen` (yang membagi 100 → angka 100× lebih kecil).
 */
import { adminHttp } from "@/lib/api/admin-client"
import type { Paginated } from "@/lib/api/admin/kyc"

export type AdminShipmentItem = {
  id: string
  orderId: string
  providerCode: string
  serviceCode?: string | null
  bookingState: string
  status: string
  trackingNumber?: string | null
  isManual: boolean
  /** Nama layanan katalog (bisa null untuk draf tanpa serviceCode). */
  serviceName?: string | null
  /** RUPIAH utuh (string BigInt). */
  estimatedCost?: string | number | null
  /** RUPIAH utuh (string BigInt). */
  actualCost?: string | number | null
  /** Hitungan server: melewati SLA (bookedAt + etaMax + grace) dan belum terminal. */
  slaBreached?: boolean | null
  lastEventAt?: string | null
  createdAt: string
  [key: string]: unknown
}

export type CourierProviderInfo = {
  providerCode: string
  name: string
  enabled: boolean
  regionWhitelist: string[]
  regionBlacklist: string[]
  priority: number
  [key: string]: unknown
}

export function listAdminShipments(params?: {
  page?: number
  limit?: number
  bookingState?: string
  status?: string
  providerCode?: string
  /** Hanya yang event terakhirnya lebih tua dari N jam (tracking basi). */
  staleHours?: number
  search?: string
}): Promise<Paginated<AdminShipmentItem>> {
  return adminHttp.get<Paginated<AdminShipmentItem>>("/v1/admin/courier/shipments", { query: params })
}

export function listCourierProviders(): Promise<CourierProviderInfo[]> {
  return adminHttp.get<CourierProviderInfo[]>("/v1/admin/courier/providers")
}

export function updateCourierProviderFlag(
  providerCode: string,
  body: { enabled?: boolean; regionWhitelist?: string[]; regionBlacklist?: string[]; priority?: number },
): Promise<CourierProviderInfo> {
  return adminHttp.patch<CourierProviderInfo>(
    `/v1/admin/courier/providers/${encodeURIComponent(providerCode)}`,
    body,
  )
}

export function retryShipmentBooking(shipmentId: string): Promise<unknown> {
  return adminHttp.post(`/v1/admin/courier/shipments/${encodeURIComponent(shipmentId)}/retry-booking`, {})
}

export function refreshShipmentTrackingAdmin(shipmentId: string): Promise<unknown> {
  return adminHttp.post(`/v1/admin/courier/shipments/${encodeURIComponent(shipmentId)}/refresh`, {})
}

export type ShippingReconciliationRow = {
  shipmentId: string
  /** orderId PUBLIK (ORD-…). */
  orderId: string
  providerCode: string
  /** RUPIAH utuh. */
  estimatedCost?: string | number | null
  /** RUPIAH utuh. */
  actualCost?: string | number | null
  /** RUPIAH utuh: actualCost − estimatedCost (negatif = buyer kelebihan bayar). */
  diff?: string | number | null
  [key: string]: unknown
}

export function getShippingReconciliation(params?: { page?: number; limit?: number; onlyMismatch?: boolean }): Promise<
  Paginated<ShippingReconciliationRow>
> {
  return adminHttp.get<Paginated<ShippingReconciliationRow>>("/v1/admin/courier/reconciliation", { query: params })
}

/** `amount` dalam RUPIAH utuh (F03) — selaras `ApproveShippingRefundDto.amount`. */
export function approveShippingRefund(shipmentId: string, body: { amount: number; reason: string }): Promise<unknown> {
  return adminHttp.post(`/v1/admin/courier/shipments/${encodeURIComponent(shipmentId)}/refunds/approve`, body)
}
