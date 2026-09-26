/** Kahade admin — barrel ekspor modul API admin (fondasi + moderasi). */
export * from "@/lib/api/admin/auth"
export * from "@/lib/api/admin/dashboard"
export * from "@/lib/api/admin/kyc"
export * from "@/lib/api/admin/business"
export * from "@/lib/api/admin/disputes"
export * from "@/lib/api/admin/support"
export * from "@/lib/api/admin/reports"
export * from "@/lib/api/admin/chat"
export * from "@/lib/api/admin/badges"
export * from "@/lib/api/admin/verified"
export * from "@/lib/api/admin/finance"
export * from "@/lib/api/admin/orders"
export * from "@/lib/api/admin/users"
export * from "@/lib/api/admin/vouchers"
export * from "@/lib/api/admin/campaigns"
export * from "@/lib/api/admin/system"
export * from "@/lib/api/admin/management"
export * from "@/lib/api/admin/ratings"
export * from "@/lib/api/admin/referral"
export * from "@/lib/api/admin/subscriptions"
/** Klaim asuransi Kahade+: nama disambiguasi dari modul finance (tak ada bentrok). */
export * from "@/lib/api/admin/insurance-claims"
/**
 * Analytics diekspor eksplisit (bukan `export *`) karena `getUserGrowth`
 * juga diekspor `dashboard` — dialiaskan agar keduanya tetap tersedia.
 */
export {
  getAnalyticsOverview,
  getOrderStats,
  getTopUsers,
  getUserGrowth as getAnalyticsUserGrowth,
  type AnalyticsOverview,
  type OrderStatRow,
  type OrderStatsGroupBy,
  type TopUser,
  type TopUserMetric,
  type UserGrowthRow,
} from "@/lib/api/admin/analytics"
/**
 * Disambiguasi `KycStatus`: diekspor `kyc` maupun `users` — dipilih versi
 * `kyc` agar barrel tidak ambigu (TS2308). Koordinator layar user dapat
 * meninjau ulang pilihan ini bila butuh varian `users`.
 */
export type { KycStatus } from "@/lib/api/admin/kyc"
export { AdminAuthError } from "@/lib/api/admin-client"
