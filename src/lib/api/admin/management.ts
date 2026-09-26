/** Kahade admin — manajemen akun admin (tim). */
import { adminHttp } from "@/lib/api/admin-client"
import type { Paginated } from "@/lib/api/admin/kyc"

/**
 * UUID v4 untuk `Idempotency-Key`. Backend mewajibkan header ini pada semua
 * endpoint mutasi (`@Idempotency()`): create, update, delete, reset-2fa,
 * unlock — tanpa header, backend menolak dengan 400 IDEMPOTENCY_KEY_REQUIRED.
 * Pola sama seperti `src/lib/api/admin/finance.ts`.
 */
function newIdempotencyKey(): string {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = Math.floor(Math.random() * 16)
    const v = c === "x" ? r : (r & 0x3) | 0x8
    return v.toString(16)
  })
}

const idempotencyHeaders = (): Record<string, string> => ({
  "Idempotency-Key": newIdempotencyKey(),
})

/**
 * Nilai enum AdminRole di backend (prisma):
 * SUPER_ADMIN, DISPUTE_ADMIN, KYC_ADMIN, FINANCE_ADMIN, CUSTOMER_SUPPORT.
 */
export type AdminRole =
  | "SUPER_ADMIN"
  | "DISPUTE_ADMIN"
  | "KYC_ADMIN"
  | "FINANCE_ADMIN"
  | "CUSTOMER_SUPPORT"

export const ADMIN_ROLES: readonly AdminRole[] = [
  "SUPER_ADMIN",
  "DISPUTE_ADMIN",
  "KYC_ADMIN",
  "FINANCE_ADMIN",
  "CUSTOMER_SUPPORT",
] as const

export interface AdminUserItem {
  id: string
  adminId?: string
  fullName: string
  email: string
  role: AdminRole
  isActive: boolean
  isMfaEnabled?: boolean
  lockedUntil?: string | null
  lastLoginAt?: string | null
  lastLoginIp?: string | null
  createdBy?: string | null
  createdAt: string
  updatedAt?: string
}

export interface CreateAdminInput {
  fullName: string
  email: string
  /** min 12 karakter, mengandung huruf besar, huruf kecil, angka, karakter khusus. */
  password: string
  role: AdminRole
}

export interface UpdateAdminInput {
  fullName?: string
  role?: AdminRole
  isActive?: boolean
}

/** GET /v1/admin/management — daftar akun admin. */
export function listAdmins(params?: {
  page?: number
  limit?: number
  search?: string
}): Promise<Paginated<AdminUserItem>> {
  return adminHttp.get<Paginated<AdminUserItem>>("/v1/admin/management", {
    query: params,
  })
}

/** POST /v1/admin/management — buat akun admin baru. */
export function createAdmin(input: CreateAdminInput): Promise<AdminUserItem> {
  return adminHttp.post<AdminUserItem>("/v1/admin/management", input, {
    headers: idempotencyHeaders(),
  })
}

/** GET /v1/admin/management/:id — detail akun admin. */
export function getAdmin(id: string): Promise<AdminUserItem> {
  return adminHttp.get<AdminUserItem>(
    `/v1/admin/management/${encodeURIComponent(id)}`,
  )
}

/** PUT /v1/admin/management/:id — ubah akun admin (nama, peran, status aktif). */
export function updateAdmin(
  id: string,
  input: UpdateAdminInput,
): Promise<AdminUserItem> {
  return adminHttp.put<AdminUserItem>(
    `/v1/admin/management/${encodeURIComponent(id)}`,
    input,
    { headers: idempotencyHeaders() },
  )
}

/** DELETE /v1/admin/management/:id — soft-delete akun admin. */
export function deleteAdmin(id: string): Promise<{ message: string }> {
  return adminHttp.delete<{ message: string }>(
    `/v1/admin/management/${encodeURIComponent(id)}`,
    { headers: idempotencyHeaders() },
  )
}

/** POST /v1/admin/management/:id/reset-2fa — reset 2FA akun admin. */
export function resetAdmin2fa(id: string): Promise<{ message: string }> {
  return adminHttp.post<{ message: string }>(
    `/v1/admin/management/${encodeURIComponent(id)}/reset-2fa`,
    undefined,
    { headers: idempotencyHeaders() },
  )
}

/** POST /v1/admin/management/:id/unlock — buka akun admin yang terkunci. */
export function unlockAdmin(id: string): Promise<{ message: string }> {
  return adminHttp.post<{ message: string }>(
    `/v1/admin/management/${encodeURIComponent(id)}/unlock`,
    undefined,
    { headers: idempotencyHeaders() },
  )
}
