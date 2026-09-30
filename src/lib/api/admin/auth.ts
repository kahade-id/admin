/**
 * Kahade admin — auth (login, 2FA, refresh, logout, profil, captcha).
 *
 * AUT-001: setiap request login/2FA/MFA menyertakan deviceId — UUID v4 yang
 * digenerate sekali dan dipersisten di localStorage (`kahade.admin.deviceId`).
 * BUKAN rahasia (bukan token); backend mengikat tempToken 2FA/MFA ke
 * perangkat ini sehingga tempToken yang bocor tidak bisa dipakai dari
 * perangkat lain. Tanpa deviceId, backend menolak verifikasi 2FA.
 */
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
  // AUT-011: admin wajib ganti password (akun baru / direset) — login tidak
  // menerbitkan sesi; tempToken hanya untuk first-password-change.
  | { requiresPasswordChange: true; tempToken: string }
  | { requiresMfa?: false; requiresMfaSetup?: false; accessToken: string; admin: AdminProfile }

const ADMIN_DEVICE_ID_KEY = "kahade.admin.deviceId"

/**
 * AUT-001: identitas perangkat admin. Digenerate sekali (crypto.randomUUID)
 * dan dipersisten di localStorage. Bukan secret — boleh di localStorage
 * (berbeda dengan access token yang disimpan di memori modul, lihat
 * admin-client.ts 03-#10).
 */
export function getAdminDeviceId(): string {
  if (typeof window === "undefined" || !window.localStorage) return ""
  try {
    let id = window.localStorage.getItem(ADMIN_DEVICE_ID_KEY)
    if (!id) {
      id =
        typeof crypto !== "undefined" && "randomUUID" in crypto
          ? crypto.randomUUID()
          : `adm-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 14)}`
      window.localStorage.setItem(ADMIN_DEVICE_ID_KEY, id)
    }
    return id
  } catch {
    return ""
  }
}

export async function adminLogin(
  email: string,
  password: string,
  totpToken?: string,
  // AUT-003: slider captcha — wajib bila backend menjawab 401 CAPTCHA_REQUIRED.
  captcha?: { captchaId: string; captchaAnswer: number },
): Promise<AdminLoginResult> {
  const res = await adminHttp.post<AdminLoginResult>("/v1/admin/auth/login", {
    email,
    password,
    totpToken: totpToken || undefined,
    deviceId: getAdminDeviceId() || undefined,
    captchaId: captcha?.captchaId,
    captchaAnswer: captcha?.captchaAnswer,
  })
  if (
    !("requiresMfa" in res) &&
    !("requiresMfaSetup" in res) &&
    !("requiresPasswordChange" in res)
  ) {
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
    deviceId: getAdminDeviceId() || undefined,
  })
}

/**
 * 03-#8: selesaikan enroll MFA — verifikasi TOTP, aktifkan MFA, terima sesi.
 */
export async function adminMfaEnable(tempToken: string, totpToken: string): Promise<AdminProfile> {
  const res = await adminHttp.post<{ accessToken: string; admin: AdminProfile }>(
    "/v1/admin/auth/mfa/enable",
    { tempToken, totpToken, deviceId: getAdminDeviceId() || undefined },
  )
  setAdminAccessToken(res.accessToken)
  return res.admin
}

export async function adminVerify2fa(tempToken: string, totpToken: string): Promise<AdminProfile> {
  const res = await adminHttp.post<{ accessToken: string; admin: AdminProfile }>(
    "/v1/admin/auth/2fa/verify",
    { tempToken, totpToken, deviceId: getAdminDeviceId() || undefined },
  )
  await setAdminAccessToken(res.accessToken)
  return res.admin
}

/**
 * AUT-003: ambil tantangan slider captcha untuk login admin.
 * Kontrak backend (`POST /v1/admin/auth/captcha/generate`):
 * respons `{ challengeId, targetX }` — `targetX` = persen (20–80), dirender
 * sebagai garis tujuan; jawaban `captchaAnswer` = posisi slider pengguna
 * (0–100); backend menerima selisih ≤4 poin, tantangan kedaluwarsa 120 detik,
 * solusi <800 ms dianggap bot.
 */
export function adminGenerateCaptcha(): Promise<{ challengeId: string; targetX: number }> {
  return adminHttp.post<{ challengeId: string; targetX: number }>(
    "/v1/admin/auth/captcha/generate",
    {},
  )
}

/**
 * AUT-004: logout — retry pemutusan sesi server 3x (backoff 500ms/1s, timeout
 * per-percobaan 8 detik) SEBELUM menghapus token lokal. Sebelumnya kegagalan
 * jaringan berarti sesi server tetap hidup walau admin mengira sudah keluar.
 * Token lokal selalu dihapus (finally) — perangkat ini tidak lagi memakai sesi.
 *
 * Mengembalikan `true` bila sesi server terputus; `false` bila ketiga
 * percobaan gagal — sesi server MUNGKIN masih hidup, pemanggil sebaiknya
 * menampilkannya ke user (bukan dicatat diam-diam).
 */
export async function adminLogout(): Promise<{ serverLogoutOk: boolean }> {
  const delays = [500, 1000]
  let serverLogoutOk = false
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, delays[attempt - 1]))
    try {
      await adminHttp.post("/v1/admin/auth/logout", {}, {
        signal: AbortSignal.timeout(8000),
      })
      serverLogoutOk = true
      break
    } catch (err) {
      if (attempt === 2) console.warn("[adminLogout] pemutusan sesi server gagal setelah 3 percobaan:", err)
    }
  }
  await clearAdminAccessToken()
  return { serverLogoutOk }
}

/**
 * AUT-002: ganti password sendiri — butuh password lama; backend memvalidasi
 * policy password admin (min 12 + kompleksitas) dan mencabut SEMUA sesi lain.
 */
export function adminChangePassword(
  currentPassword: string,
  newPassword: string,
): Promise<{ message: string }> {
  return adminHttp.post<{ message: string }>("/v1/admin/auth/change-password", {
    currentPassword,
    newPassword,
  })
}

/**
 * AUT-011: password pertama / setelah reset — dipanggil dengan tempToken dari
 * login yang mengembalikan `requiresPasswordChange`. TIDAK menerbitkan sesi;
 * pemanggil harus login ulang dengan password baru.
 */
export function adminFirstPasswordChange(
  tempToken: string,
  newPassword: string,
): Promise<{ message: string }> {
  return adminHttp.post<{ message: string }>("/v1/admin/auth/first-password-change", {
    tempToken,
    newPassword,
    deviceId: getAdminDeviceId() || undefined,
  })
}

export function getAdminProfile(): Promise<AdminProfile> {
  return adminHttp.get<AdminProfile>("/v1/admin/auth/profile")
}

export function isAdminLoggedIn(): boolean {
  return !!getAdminAccessToken()
}
