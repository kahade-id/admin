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
  | { requiresMfaSetup: true; tempToken: string }
  | { requiresMfa?: false; requiresMfaSetup?: false; accessToken: string; admin: AdminProfile }

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
  if (!("requiresMfa" in res) && !("requiresMfaSetup" in res)) {
    const token = (res as { accessToken: string }).accessToken
    if (token) setAdminAccessToken(token)
  }
  return res
}

/**
 * 03-#8: mulai enroll MFA — dipanggil dengan tempToken dari login yang
 * mengembalikan requiresMfaSetup. Mengembalikan otpauthUrl + secret.
 */
export async function adminMfaSetup(tempToken: string): Promise<{ otpauthUrl: string; secret: string }> {
  return adminHttp.post<{ otpauthUrl: string; secret: string }>("/v1/admin/auth/mfa/setup", {
    tempToken,
  })
}

/**
 * 03-#8: selesaikan enroll MFA — verifikasi TOTP, aktifkan MFA, terima sesi.
 */
export async function adminMfaEnable(tempToken: string, totpToken: string): Promise<AdminProfile> {
  const res = await adminHttp.post<{ accessToken: string; admin: AdminProfile }>(
    "/v1/admin/auth/mfa/enable",
    { tempToken, totpToken },
  )
  setAdminAccessToken(res.accessToken)
  return res.admin
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
