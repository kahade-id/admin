/** Kahade admin — dashboard & ringkasan platform. */
import { adminHttp } from "@/lib/api/admin-client"

export type DashboardSummary = {
  totalUsers?: number
  activeUsers?: number
  totalOrders?: number
  activeEscrow?: number
  totalRevenue?: number
  pendingKyc?: number
  pendingDisputes?: number
  pendingWithdrawals?: number
  [key: string]: unknown
}

export type RecentActivityItem = {
  id: string
  action: string
  description?: string
  adminName?: string
  createdAt: string
  [key: string]: unknown
}

export type OrderStats = {
  status: string
  count: number
}[]

export function getDashboardSummary(): Promise<DashboardSummary> {
  return adminHttp.get<DashboardSummary>("/v1/admin/dashboard/summary")
}

export function getDashboardCharts(params?: { period?: string }): Promise<unknown> {
  return adminHttp.get("/v1/admin/dashboard/charts", { query: params })
}

export function getDashboardOrderStats(): Promise<OrderStats> {
  return adminHttp.get<OrderStats>("/v1/admin/dashboard/order-stats")
}

export function getRecentActivity(params?: { limit?: number }): Promise<RecentActivityItem[]> {
  return adminHttp.get<RecentActivityItem[]>("/v1/admin/dashboard/recent-activity", {
    query: params,
  })
}

export function getUserGrowth(params?: { period?: string }): Promise<unknown> {
  return adminHttp.get("/v1/admin/dashboard/user-growth", { query: params })
}
