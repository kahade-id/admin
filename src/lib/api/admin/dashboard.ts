/**
 * Kahade admin — dashboard & ringkasan platform.
 *
 * Kontrak backend (`backend/src/modules/admin/dashboard/dashboard.service.ts`),
 * diverifikasi 2026-09-26 (batch 6):
 * - `getSummary()` → bentuk BERSARANG:
 *   `{ users: { total, newToday, verified }, orders: { total, active, completed },
 *      disputes: { open }, kyc: { pending }, finance: { totalWalletBalance } }`.
 *   Tidak ada field datar `totalUsers`/`pendingWithdrawals` — kartu "Penarikan
 *   menunggu" diambil dari `GET /v1/admin/finance/summary` (field
 *   `pendingWithdrawals`).
 * - `getOrderStats()` → `{ total, distribution: [{ status, count, percentage }] }`.
 * - `getRecentActivity()` → `{ data: logs }` dengan `logs[].admin = { id, fullName, role }`
 *   (BUKAN `adminName`); backend me-hardcode `take: 20` dan mengabaikan param
 *   `limit` — limit dipotong client-side di `getRecentActivity()`.
 * - `getCharts(query)` menerima `period` + `startDate`/`endDate` (ChartQueryDto).
 */
import { adminHttp } from "@/lib/api/admin-client"

/** Bentuk bersarang dari GET /v1/admin/dashboard/summary (backend). */
export type DashboardSummary = {
  users?: { total?: number; newToday?: number; verified?: number }
  orders?: { total?: number; active?: number; completed?: number }
  disputes?: { open?: number }
  kyc?: { pending?: number }
  finance?: { totalWalletBalance?: number }
  [key: string]: unknown
}

export type OrderStatsItem = {
  status: string
  count: number
  percentage?: number
}

export type OrderStats = OrderStatsItem[]

/** Respons mentah GET /v1/admin/dashboard/order-stats. */
export type OrderStatsResponse = {
  total: number
  distribution: OrderStatsItem[]
}

type RawActivityItem = {
  id: string
  action: string
  targetType?: string
  targetId?: string
  description?: string | null
  createdAt: string
  admin?: { id?: string; fullName?: string | null; role?: string } | null
  [key: string]: unknown
}

export type RecentActivityItem = {
  id: string
  action: string
  description?: string
  /** Dipetakan dari `admin.fullName` backend (AW-003). */
  adminName?: string
  createdAt: string
  [key: string]: unknown
}

export function getDashboardSummary(): Promise<DashboardSummary> {
  return adminHttp.get<DashboardSummary>("/v1/admin/dashboard/summary")
}

/** Param GET /v1/admin/dashboard/charts (ChartQueryDto backend). */
export type DashboardChartParams = {
  period?: string
  startDate?: string
  endDate?: string
}

export type DashboardChartPoint = {
  date: string
  orders: number
  revenue: number
}

export type DashboardChartsResponse = {
  period?: string
  data: DashboardChartPoint[]
}

export function getDashboardCharts(
  params?: DashboardChartParams,
): Promise<DashboardChartsResponse> {
  return adminHttp.get<DashboardChartsResponse>("/v1/admin/dashboard/charts", {
    query: params,
  })
}

/**
 * AW-002: backend mengembalikan `{ total, distribution }`, bukan array di root.
 * Adaptor mengembalikan array `distribution` agar pemanggil tetap sederhana.
 */
export async function getDashboardOrderStats(): Promise<OrderStats> {
  const res = await adminHttp.get<OrderStats | OrderStatsResponse>(
    "/v1/admin/dashboard/order-stats",
  )
  if (Array.isArray(res)) return res
  return Array.isArray(res?.distribution) ? res.distribution : []
}

/**
 * AW-003: backend mengembalikan `{ data: logs }` dengan `admin: { fullName }`.
 * Adaptor memetakan `adminName` dan memotong sesuai `limit` yang diminta —
 * backend me-hardcode `take: 20` dan mengabaikan query `limit`.
 */
export async function getRecentActivity(params?: {
  limit?: number
}): Promise<RecentActivityItem[]> {
  const res = await adminHttp.get<{ data: RawActivityItem[] } | RawActivityItem[]>(
    "/v1/admin/dashboard/recent-activity",
    { query: params },
  )
  const raw = Array.isArray(res) ? res : (res?.data ?? [])
  const mapped: RecentActivityItem[] = raw.map((item) => ({
    ...item,
    description: item.description ?? undefined,
    adminName: item.admin?.fullName ?? undefined,
  }))
  // Backend mengabaikan limit (hardcode 20) — potong di client agar kontrak
  // `limit` yang dijanjikan fungsi ini benar-benar dihormati.
  return params?.limit != null ? mapped.slice(0, params.limit) : mapped
}
