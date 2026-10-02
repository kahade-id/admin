/**
 * Kahade admin — moderasi katalog & stok (GAP-D G251–G275).
 * Backend: /v1/admin/inventory (moderasi produk, mutasi stok, bulk).
 */
import { adminHttp } from "@/lib/api/admin-client"
import type { Paginated } from "@/lib/api/admin/kyc"

export type AdminProductItem = {
  id: string
  sku: string
  sellerId: string
  name: string
  category: string
  status: string
  moderationStatus: string
  priceSen: string | number
  quantityAvailable: number
  quantityReserved: number
  requiresBusinessVerification: boolean
  createdAt: string
  [key: string]: unknown
}

export const ADMIN_PRODUCT_MODERATION_LABEL: Record<string, string> = {
  PENDING: "Menunggu moderasi",
  APPROVED: "Disetujui",
  REJECTED: "Ditolak",
  FLAGGED: "Ditandai",
}

/**
 * Label tipe produk (batch 43, item #1): jasa, fisik, digital, lainnya.
 * Nilai enum backend diasumsikan memakai nilai uppercase ini; label
 * fallback menampilkan nilai mentah bila backend mengirim varian lain.
 */
export const ADMIN_PRODUCT_TYPE_LABEL: Record<string, string> = {
  JASA: "Jasa",
  FISIK: "Fisik",
  DIGITAL: "Digital",
  LAINNYA: "Lainnya",
}

export function listAdminProducts(params?: {
  page?: number
  limit?: number
  status?: string
  moderationStatus?: string
  category?: string
  search?: string
}): Promise<Paginated<AdminProductItem>> {
  return adminHttp.get<Paginated<AdminProductItem>>("/v1/admin/inventory/products", { query: params })
}

export function moderateProduct(
  productId: string,
  body: { decision: "APPROVED" | "REJECTED" | "FLAGGED"; note?: string },
): Promise<unknown> {
  return adminHttp.post(`/v1/admin/inventory/products/${encodeURIComponent(productId)}/moderate`, body)
}

export function adminAdjustStock(body: {
  sku: string
  delta: number
  reason: string
}): Promise<unknown> {
  return adminHttp.post("/v1/admin/inventory/adjust", body)
}

export type AdminStockMovement = {
  id: string
  productId: string
  variantId?: string | null
  type: string
  source: string
  actorId: string
  actorRole: string
  reason?: string | null
  quantityChange: number
  beforeAvailable: number
  afterAvailable: number
  createdAt: string
  [key: string]: unknown
}

export function listAdminStockMovements(params?: {
  page?: number
  limit?: number
  productId?: string
  type?: string
}): Promise<Paginated<AdminStockMovement>> {
  return adminHttp.get<Paginated<AdminStockMovement>>("/v1/admin/inventory/movements", { query: params })
}
