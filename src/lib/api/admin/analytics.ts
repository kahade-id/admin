/**
 * Kahade admin — analitik platform (baca-saja).
 *
 * Endpoint: GET `/v1/admin/analytics/*`
 * (lihat `backend/src/modules/admin/analytics/admin-analytics.controller.ts`).
 *
 * Catatan kontrak:
 * - `getAnalyticsOverview` mengembalikan objek ringkas
 *   `{ users, orders, financial, activeUsers }`; `disputeRate` dalam persen
 *   (0–100). `startDate`/`endDate` opsional (format ISO, mis. "2026-01-01").
 * - `getOrderStats` mengembalikan ARRAY baris per periode
 *   `{ period, totalOrders, completed, disputed, cancelled, gmv, revenue }`;
 *   `groupBy`: "day" | "week" | "month". GMV & revenue = rupiah (number).
 * - `getTopUsers`: ARRAY `{ userId, username, fullName, …, avgRating,
 *   ratingCount, totalOrders, totalVolume, isKycVerified }`;
 *   `metric`: "orders" | "volume" | "rating".
 * - `getUserGrowth`: ARRAY `{ day, newUsers, cumulative }` (hari, WIB).
 */
import { adminHttp, getAdminAccessToken } from "@/lib/api/admin-client"
import { API_BASE_URL } from "@/lib/api/config"

export type AnalyticsOverview = {
  users?: { total?: number; new?: number; [key: string]: unknown } | null
  orders?: {
    total?: number
    completed?: number
    disputed?: number
    cancelled?: number
    disputeRate?: number
    [key: string]: unknown
  } | null
  financial?: { gmv?: number; revenue?: number; [key: string]: unknown } | null
  activeUsers?: number
  [key: string]: unknown
}

export type OrderStatsGroupBy = "day" | "week" | "month"

export type OrderStatRow = {
  period?: string
  totalOrders?: number
  completed?: number
  disputed?: number
  cancelled?: number
  gmv?: number
  revenue?: number
  [key: string]: unknown
}

export type TopUserMetric = "orders" | "volume" | "rating"

export type TopUser = {
  userId?: string
  username?: string | null
  fullName?: string | null
  avatarUrl?: string | null
  membershipRank?: string | null
  avgRating?: number | null
  ratingCount?: number | null
  totalOrders?: number | null
  totalVolume?: number | null
  isKycVerified?: boolean | null
  [key: string]: unknown
}

export type UserGrowthRow = {
  day?: string
  newUsers?: number
  cumulative?: number
  [key: string]: unknown
}

/** Statistik ringkas platform (user, order, GMV, revenue, user aktif). */
export function getAnalyticsOverview(params?: {
  startDate?: string
  endDate?: string
}): Promise<AnalyticsOverview> {
  return adminHttp.get<AnalyticsOverview>("/v1/admin/analytics/overview", {
    query: { startDate: params?.startDate, endDate: params?.endDate },
  })
}

/** Statistik order per periode waktu. */
export function getOrderStats(params?: {
  groupBy?: OrderStatsGroupBy
  startDate?: string
  endDate?: string
}): Promise<OrderStatRow[]> {
  return adminHttp.get<OrderStatRow[]>("/v1/admin/analytics/orders", {
    query: {
      groupBy: params?.groupBy,
      startDate: params?.startDate,
      endDate: params?.endDate,
    },
  })
}

/** Pengguna teratas menurut metrik (order, volume, atau rating). */
export function getTopUsers(params?: {
  limit?: number
  metric?: TopUserMetric
}): Promise<TopUser[]> {
  return adminHttp.get<TopUser[]>("/v1/admin/analytics/top-users", {
    query: { limit: params?.limit, metric: params?.metric },
  })
}

/** Pertumbuhan pengguna per hari (WIB), dengan total kumulatif. */
export function getUserGrowth(params?: {
  startDate?: string
  endDate?: string
}): Promise<UserGrowthRow[]> {
  return adminHttp.get<UserGrowthRow[]>("/v1/admin/analytics/user-growth", {
    query: { startDate: params?.startDate, endDate: params?.endDate },
  })
}

/**
 * BAI-126: unduh CSV ringkasan analitik dari backend
 * (`GET /v1/admin/analytics/export/csv`, lengkap dengan watermark pengekspor
 * ADM-429). Mengembalikan Blob agar pemanggil bisa memicu unduhan browser.
 *
 * `adminHttp` selalu mem-parse JSON, jadi endpoint biner ini memakai `fetch`
 * langsung dengan token admin yang sama.
 */
export async function exportAnalyticsCsv(params?: {
  startDate?: string
  endDate?: string
}): Promise<Blob> {
  const url = new URL(`${API_BASE_URL}/v1/admin/analytics/export/csv`)
  if (params?.startDate) url.searchParams.set("startDate", params.startDate)
  if (params?.endDate) url.searchParams.set("endDate", params.endDate)
  const token = getAdminAccessToken()
  const res = await fetch(url.toString(), {
    method: "GET",
    headers: {
      Accept: "text/csv",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    credentials: "include",
  })
  if (!res.ok) {
    const err = (await res.json().catch(() => null)) as {
      message?: string
    } | null
    throw new Error(
      err?.message ?? `Gagal mengunduh CSV analitik (${res.status})`,
    )
  }
  return res.blob()
}
