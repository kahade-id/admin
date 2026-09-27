/**
 * Kahade admin — operasional kurir (GAP-D G242–G250).
 * Backend: /v1/admin/courier (katalog/flag, booking gagal, tracking basi,
 * rekonsiliasi ongkir, refund ongkir).
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
  estimatedCost?: string | number | null
  actualCost?: string | number | null
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
  orderId: string
  providerCode: string
  estimatedCostSen?: string | number | null
  actualCostSen?: string | number | null
  diffSen?: string | number | null
  [key: string]: unknown
}

export function getShippingReconciliation(params?: { page?: number; limit?: number; onlyMismatch?: boolean }): Promise<
  Paginated<ShippingReconciliationRow>
> {
  return adminHttp.get<Paginated<ShippingReconciliationRow>>("/v1/admin/courier/reconciliation", { query: params })
}

export function approveShippingRefund(shipmentId: string, body: { amountSen: number; reason: string }): Promise<unknown> {
  return adminHttp.post(`/v1/admin/courier/shipments/${encodeURIComponent(shipmentId)}/refunds/approve`, body)
}
