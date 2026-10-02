/**
 * Kahade admin — step-up authentication (verifikasi ulang identitas per aksi).
 *
 * SEC-503: aksi sensitif TIDAK BOLEH hanya mengandalkan sesi yang masih
 * valid — sesi curian (XSS / token bocor) akan lolos semua pemeriksaan
 * client-side. Pola yang benar: sebelum aksi kritis, admin memasukkan ulang
 * kata sandi; server menerbitkan token sekali pakai (single-use, TTL 2–5
 * menit, terikat aksi + target) yang WAJIB dilampirkan via header
 * `X-Step-Up-Token` pada request aksi tersebut. Server menolak 403 bila
 * header absen/tidak valid — enforcement di server, bukan di UI.
 *
 * Kontrak backend (`POST /v1/admin/auth/step-up`):
 *   request  `{ password, action, targetId? }`
 *   respons  `{ stepUpToken, expiresAt }`
 *
 * Backend paralel sedang membangun endpoint ini — kode di sini defensif:
 * bila endpoint belum ada (404), `requestStepUpToken` melempar
 * `StepUpNotSupportedError` (BUKAN crash generik) agar UI bisa menampilkan
 * pesan yang jelas dan MEMBATALKAN aksi (fail-closed).
 */
import { adminHttp } from "@/lib/api/admin-client"

/** Nama header pembawa token step-up — dipakai semua aksi kritis. */
export const STEP_UP_HEADER = "X-Step-Up-Token"

/**
 * Dilempar `requestStepUpToken` bila backend menjawab 404 — endpoint
 * step-up belum di-deploy di backend (backend lama). Pemanggil HARUS
 * memperlakukannya sebagai fail-closed: batalkan aksi, jangan lanjutkan
 * tanpa token.
 */
export class StepUpNotSupportedError extends Error {
  constructor(
    message = "Backend belum mendukung verifikasi per aksi (endpoint POST /v1/admin/auth/step-up tidak ditemukan).",
  ) {
    super(message)
    this.name = "StepUpNotSupportedError"
  }
}

type StepUpResponse = {
  stepUpToken: string
  expiresAt: string
}

/**
 * Minta token step-up sekali pakai dari server untuk satu aksi sensitif.
 *
 * @param action   nama aksi server, mis. "admin.reset-2fa"
 * @param targetId id target aksi (mis. id admin target), bila ada
 * @param password kata sandi admin yang sedang login (verifikasi ulang)
 * @returns token sekali pakai untuk header `X-Step-Up-Token`
 * @throws StepUpNotSupportedError bila backend 404 (endpoint belum ada)
 * @throws Error lain (kredensial salah, dsb.) diteruskan apa adanya
 */
export async function requestStepUpToken(
  action: string,
  targetId: string | undefined,
  password: string,
): Promise<string> {
  let res: StepUpResponse
  try {
    res = await adminHttp.post<StepUpResponse>("/v1/admin/auth/step-up", {
      password,
      action,
      targetId,
    })
  } catch (err) {
    if ((err as { status?: number } | null)?.status === 404) {
      throw new StepUpNotSupportedError()
    }
    throw err
  }
  if (!res?.stepUpToken) {
    throw new Error("Respons step-up tidak valid dari server.")
  }
  return res.stepUpToken
}

/** Bangun header `{ "X-Step-Up-Token": token }` untuk request aksi kritis. */
export function stepUpHeaders(token: string): Record<string, string> {
  return { [STEP_UP_HEADER]: token }
}
