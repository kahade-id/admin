/** Kahade admin — auth (login, 2FA, refresh, logout, profil). */
import {
  adminHttp,
  clearAdminAccessToken,
  getAdminAccessToken,
  setAdminAccessToken,
} from "@/lib/api/admin-client"

export type AdminProfile = {
  id: string
  adminId: string
  fullName: string
  email: string
  role: string
  isActive: boolean
  isMfaEnabled: boolean
  lastLoginAt: string | null
}

export type AdminLoginResult =
  | { requiresMfa: true; tempToken: string }
  | { requiresMfa?: false; accessToken: string; admin: AdminProfile }

export async function adminLogin(
  email: string,
  password: string,
  totpToken?: string,
): Promise<AdminLoginResult> {
  const res = await adminHttp.post<AdminLoginResult>("/v1/admin/auth/login", {
    email,
    password,
    totpToken: totpToken || undefined,
  })
  if (!("requiresMfa" in res) || !res.requiresMfa) {
    const token = (res as { accessToken: string }).accessToken
    if (token) await setAdminAccessToken(token)
  }
  return res
}

export async function adminVerify2fa(tempToken: string, totpToken: string): Promise<AdminProfile> {
  const res = await adminHttp.post<{ accessToken: string; admin: AdminProfile }>(
    "/v1/admin/auth/2fa/verify",
    { tempToken, totpToken },
  )
  await setAdminAccessToken(res.accessToken)
  return res.admin
}

export async function adminLogout(): Promise<void> {
  try {
    await adminHttp.post("/v1/admin/auth/logout")
  } catch {
    // Best-effort: token lokal tetap dihapus.
  }
  await clearAdminAccessToken()
}

export function getAdminProfile(): Promise<AdminProfile> {
  return adminHttp.get<AdminProfile>("/v1/admin/auth/profile")
}

export function isAdminLoggedIn(): boolean {
  return !!getAdminAccessToken()
}
