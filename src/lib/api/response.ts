/**
 * Kahade Admin Web — response helpers (port ringkas dari frontend).
 *
 * `unwrapResponse` mempertahankan kontrak backend: envelope
 * `{success, data, message?}` di-unwrap; `success:false` dilempar
 * sebagai `ApiError`; envelope murni `{data, message?}` tanpa `success`
 * ikut di-unwrap.
 */

/** Error API dengan info yang cukup untuk ditampilkan ke admin. */
export class ApiError extends Error {
  readonly code: string
  readonly status?: number
  readonly backendCode?: string
  readonly validationMessages?: string[]

  constructor(opts: {
    code?: string
    message?: string
    status?: number
    backendCode?: string
    validationMessages?: string[]
  }) {
    super(opts.message ?? "Terjadi kesalahan.")
    this.name = "ApiError"
    this.code = opts.code ?? "UNKNOWN"
    this.status = opts.status
    this.backendCode = opts.backendCode
    this.validationMessages = opts.validationMessages
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function messageOf(body: Record<string, unknown>): string {
  const m = body.message
  return typeof m === "string" && m ? m : "Permintaan gagal."
}

export function unwrapResponse(value: unknown): unknown {
  const body = asRecord(value)
  if (!body || typeof body.success !== "boolean") {
    if (
      body &&
      "data" in body &&
      Object.keys(body).every((k) => k === "data" || k === "message")
    ) {
      return body.data
    }
    return value
  }
  if (!body.success) {
    const backendCode =
      typeof body.code === "string"
        ? body.code
        : typeof body.errorCode === "string"
          ? body.errorCode
          : undefined
    throw new ApiError({ code: backendCode ?? "BAD_REQUEST", message: messageOf(body), backendCode })
  }
  if (!("data" in body)) return value
  return body.data ?? (typeof body.message === "string" ? { message: body.message } : null)
}

/** Ambil pesan yang layak tampil dari error tak dikenal. */
export function userMessage(err: unknown): string {
  if (err instanceof ApiError) return err.message
  if (err instanceof Error && err.message) return err.message
  return "Terjadi kesalahan. Coba lagi."
}
