/**
 * Kahade admin — kelola subscription Kahade+ (daftar, detail, pembatalan,
 * pemberian manual/grant).
 *
 * Endpoint: GET/POST/PATCH `/v1/admin/subscriptions/*`
 *
 * Kontrak backend (Kahade+, tetap):
 * - GET /v1/admin/subscriptions?page&limit&status&search → {data, pagination}
 * - GET /v1/admin/subscriptions/:id → detail + usage periode berjalan
 * - POST /v1/admin/subscriptions/:id/cancel {reason?}
 * - POST /v1/admin/subscriptions/grant
 *   {userId, plan: 'MONTHLY'|'YEARLY', durationDays: number, reason: string}
 *
 * Catatan kontrak:
 * - Status valid: ACTIVE, EXPIRED, CANCELLED; plan valid: MONTHLY, YEARLY.
 *   Ejaan lama (CANCELED) tetap ditoleransi saat menampilkan agar drift
 *   respons tidak merusak UI.
 * - Harga dikembalikan sebagai rupiah (number).
 * - `cancelSubscription` hanya valid untuk status ACTIVE/PENDING;
 *   backend 400 untuk status lain.
 */
import { adminHttp } from "@/lib/api/admin-client"
import type { Paginated } from "@/lib/api/admin/kyc"
import { STEP_UP_HEADER } from "@/lib/api/admin/step-up"

/** Opsi step-up untuk mutasi subscription — backend mewajibkan @RequireStepUp. */
export type SubscriptionStepUpOpts = { stepUpToken?: string }

function stepUpHeader(opts?: SubscriptionStepUpOpts): Record<string, string> {
  return opts?.stepUpToken ? { [STEP_UP_HEADER]: opts.stepUpToken } : {}
}

export type SubscriptionStatus =
  | "ACTIVE"
  | "CANCELED"
  | "CANCELLED"
  | "EXPIRED"
  | "PENDING"
  | "SUSPENDED"
  // ESI-007 (audit integrasi 2026-09-30): `PAUSED` anggota resmi enum backend
  // `SubscriptionStatus` — jeda sementara dengan auto-resume via scheduler;
  // sebelumnya tak dikenal admin sehingga tampil mentah tanpa label/tone.
  | "PAUSED"

export type SubscriptionPlan = "MONTHLY" | "YEARLY"

export type SubscriptionUser = {
  id?: string
  userId?: string
  username?: string | null
  fullName?: string | null
  email?: string | null
  [key: string]: unknown
}

/** Penggunaan kuota fee pada periode berjalan. */
export type SubscriptionFeeUsage = {
  used?: number | null
  limit?: number | null
  remaining?: number | null
  periodStart?: string | null
  periodEnd?: string | null
  [key: string]: unknown
}

/**
 * Penggunaan kuota fee periode berjalan — kontrak backend
 * `getSubscriptionDetail` (kunci: feeWaivedAmount/feeWaiverLimit/
 * feeWaiverRemaining).
 * P1-2 (audit integrasi 2026-10-06): mapping lama membaca `currentUsage`
 * yang tidak dikirim backend → kartu periode berjalan tampil angka lifetime.
 */
export type SubscriptionCurrentPeriodUsage = {
  periodStart?: string | null
  periodEnd?: string | null
  feeWaivedAmount?: number | null
  feeWaiverLimit?: number | null
  feeWaiverRemaining?: number | null
  [key: string]: unknown
}

export type SubscriptionItem = {
  id: string
  userId?: string
  plan?: SubscriptionPlan | string
  status?: SubscriptionStatus | string
  price?: number
  currentPeriodStart?: string | null
  currentPeriodEnd?: string | null
  cancelledAt?: string | null
  createdAt?: string
  user?: SubscriptionUser | null
  /** Ringkasan penggunaan kuota fee (bila dikembalikan di daftar). */
  feeUsage?: SubscriptionFeeUsage | null
  [key: string]: unknown
}

export type SubscriptionDetail = SubscriptionItem & {
  originalPrice?: number | null
  feeSavingsUsed?: number | null
  feeSavingsLimit?: number | null
  /** Penggunaan kuota fee pada periode berjalan (kontrak baru). */
  currentUsage?: SubscriptionFeeUsage | null
  /**
   * Penggunaan kuota fee periode berjalan — kunci backend aktual.
   * P1-2 (audit integrasi 2026-10-06): backend kirim `currentPeriodUsage`,
   * bukan `currentUsage`.
   */
  currentPeriodUsage?: SubscriptionCurrentPeriodUsage | null
  paymentTx?: {
    txId?: string
    status?: string
    amount?: number
    createdAt?: string
    [key: string]: unknown
  } | null
  /** Riwayat perubahan status (bila dikembalikan backend). */
  history?: Array<{
    id?: string
    action?: string
    status?: string
    note?: string | null
    createdAt?: string
    [key: string]: unknown
  }> | null
  [key: string]: unknown
}

export type CancelSubscriptionResult = {
  message: string
  subscriptionId: string
  status: string
}

export type GrantSubscriptionInput = {
  userId: string
  plan: "MONTHLY" | "YEARLY"
  durationDays: number
  reason: string
}

/**
 * ADM-225: bentuk aktual respons backend grantSubscription — objek
 * subscription ({...subscription, price, feeSavingsUsed, feeSavingsLimit}),
 * BUKAN envelope {message, subscriptionId, status}.
 */
export type GrantSubscriptionResult = {
  id: string
  userId: string
  plan: string
  status: string
  price: number
  feeSavingsUsed: number
  feeSavingsLimit: number
  startDate?: string | null
  endDate?: string | null
  [key: string]: unknown
}

/** Daftar subscription Kahade+; filter status & pencarian pengguna. */
export function listSubscriptions(query?: {
  page?: number
  limit?: number
  status?: "ACTIVE" | "EXPIRED" | "CANCELLED"
  search?: string
}): Promise<Paginated<SubscriptionItem>> {
  return adminHttp.get<Paginated<SubscriptionItem>>("/v1/admin/subscriptions", {
    query: {
      page: query?.page,
      limit: query?.limit,
      status: query?.status,
      search: query?.search?.trim() || undefined,
    },
  })
}

/** Detail subscription: user, periode, usage periode berjalan, riwayat. */
export function getSubscriptionDetail(
  subId: string,
): Promise<SubscriptionDetail> {
  return adminHttp.get<SubscriptionDetail>(
    `/v1/admin/subscriptions/${encodeURIComponent(subId)}`,
  )
}

/**
 * Paksa batalkan subscription (intervensi admin). Hanya untuk status
 * ACTIVE/PENDING; backend 400 untuk status lain.
 */
export function cancelSubscription(
  subId: string,
  reason?: string,
): Promise<CancelSubscriptionResult> {
  const body: { reason?: string } = {}
  const trimmed = reason?.trim()
  if (trimmed) body.reason = trimmed
  return adminHttp.post<CancelSubscriptionResult>(
    `/v1/admin/subscriptions/${encodeURIComponent(subId)}/cancel`,
    body,
  )
}

/**
 * Beri subscription Kahade+ secara manual ke pengguna.
 * `durationDays`: durasi dalam hari; `reason`: alasan wajib (audit).
 */
export function grantSubscription(
  input: GrantSubscriptionInput,
  opts?: SubscriptionStepUpOpts,
): Promise<GrantSubscriptionResult> {
  return adminHttp.post<GrantSubscriptionResult>(
    "/v1/admin/subscriptions/grant",
    {
      userId: input.userId,
      plan: input.plan,
      durationDays: input.durationDays,
      reason: input.reason.trim(),
    },
    { headers: stepUpHeader(opts) },
  )
}

/**
 * ADM-212: kode promo langganan gratis (keputusan produk 2026-09-26).
 * Kontrak backend (`admin-subscriptions.controller.ts`, tetap):
 * - POST /v1/admin/subscriptions/promo-codes {code, durationDays, maxRedemptions?, assignedUserId?, expiresAt?, note?}
 * - GET  /v1/admin/subscriptions/promo-codes?page&limit → paginated {data,total,page,limit,totalPages}
 * - POST /v1/admin/subscriptions/promo-codes/:id/disable
 * - POST /v1/admin/subscriptions/promo-codes/:id/enable
 */

export type PromoCodeStatus = "ACTIVE" | "DISABLED"

export type PromoCode = {
  id: string
  code: string
  durationDays: number
  maxRedemptions?: number | null
  currentRedemptions?: number
  assignedUserId?: string | null
  assignedUser?: { id?: string; username?: string | null } | null
  status?: PromoCodeStatus | string
  expiresAt?: string | null
  note?: string | null
  createdAt?: string
  updatedAt?: string
  [key: string]: unknown
}

export type CreatePromoCodeInput = {
  /** 3–32 karakter: A-Z, 0-9, _, - (dinormalisasi UPPERCASE oleh backend). */
  code: string
  /** Durasi langganan gratis dalam hari (1–366). */
  durationDays: number
  /** Batas total pemakaian; null = tak terbatas. Default 1 (sekali pakai). */
  maxRedemptions?: number | null
  /** Kunci kode hanya untuk user ini (opsional). */
  assignedUserId?: string
  /** Masa berlaku kode (ISO 8601, opsional). */
  expiresAt?: string
  /** Catatan admin, mis. nama penerima (opsional). */
  note?: string
}

/** Daftar kode promo (terbaru dulu). */
export function listPromoCodes(
  page = 1,
  limit = 20,
): Promise<Paginated<PromoCode>> {
  return adminHttp.get<Paginated<PromoCode>>(
    "/v1/admin/subscriptions/promo-codes",
    { query: { page, limit } },
  )
}

/** Buat kode promo baru. Backend: @RequireStepUp('subscription.promoCode.create'). */
export function createPromoCode(
  input: CreatePromoCodeInput,
  opts?: SubscriptionStepUpOpts,
): Promise<PromoCode> {
  const body: Record<string, unknown> = {
    code: input.code.trim(),
    durationDays: input.durationDays,
  }
  if (input.maxRedemptions !== undefined) body.maxRedemptions = input.maxRedemptions
  if (input.assignedUserId?.trim()) body.assignedUserId = input.assignedUserId.trim()
  if (input.expiresAt) body.expiresAt = input.expiresAt
  if (input.note?.trim()) body.note = input.note.trim()
  return adminHttp.post<PromoCode>("/v1/admin/subscriptions/promo-codes", body, {
    headers: stepUpHeader(opts),
  })
}

/**
 * Nonaktifkan kode promo (status → DISABLED).
 * Backend: @RequireStepUp('subscription.promoCode.toggle','id').
 */
export function disablePromoCode(
  id: string,
  opts?: SubscriptionStepUpOpts,
): Promise<PromoCode> {
  return adminHttp.post<PromoCode>(
    `/v1/admin/subscriptions/promo-codes/${encodeURIComponent(id)}/disable`,
    {},
    { headers: stepUpHeader(opts) },
  )
}

/**
 * Aktifkan kembali kode promo (status → ACTIVE).
 * Backend: @RequireStepUp('subscription.promoCode.toggle','id').
 */
export function enablePromoCode(
  id: string,
  opts?: SubscriptionStepUpOpts,
): Promise<PromoCode> {
  return adminHttp.post<PromoCode>(
    `/v1/admin/subscriptions/promo-codes/${encodeURIComponent(id)}/enable`,
    {},
    { headers: stepUpHeader(opts) },
  )
}
