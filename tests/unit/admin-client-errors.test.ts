/**
 * ADM-06/ADM-16 (audit etalase 2026-10-10) — `adminHttp` membaca envelope
 * error backend (HttpExceptionFilter):
 *   { success:false, message, data:null, errors:{ code, message, fields?, data?, retryAfter? } }
 * Sebelumnya hanya `code` level atas yang dibaca → `err.code` selalu kosong,
 * sehingga branching UI (REPORT_ALREADY_RESOLVED, CAPTCHA_REQUIRED, …) mati.
 * `fetch` yang reject (offline/DNS/CORS) → pesan Indonesia yang jujur.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/lib/api/config", () => ({ API_BASE_URL: "https://api.test" }))

import { adminHttp, NETWORK_ERROR_MESSAGE, type AdminHttpError } from "@/lib/api/admin-client"
import { errorCode } from "@/lib/api/response"

type FakeResponse = {
  ok: boolean
  status: number
  headers: { get: (name: string) => string | null }
  json: () => Promise<unknown>
}

function fakeResponse(status: number, body: unknown, headers: Record<string, string> = {}): FakeResponse {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name) => headers[name] ?? headers[name.toLowerCase()] ?? null },
    json: async () => body,
  }
}

const fetchMock = vi.fn<(input: string, init?: RequestInit) => Promise<FakeResponse>>()

beforeEach(() => {
  fetchMock.mockReset()
  vi.stubGlobal("fetch", fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

async function expectError(p: Promise<unknown>): Promise<AdminHttpError> {
  try {
    await p
  } catch (e) {
    return e as AdminHttpError
  }
  throw new Error("expected rejection")
}

describe("adminHttp — envelope error backend", () => {
  it("errors.code / errors.message / errors.fields / errors.data dibaca", async () => {
    fetchMock.mockResolvedValue(
      fakeResponse(400, {
        success: false,
        message: "Report state changed; reload and try again",
        data: null,
        errors: {
          code: "REPORT_ALREADY_RESOLVED",
          message: "Report state changed; reload and try again",
          fields: { status: ["invalid transition"] },
          data: { currentStatus: "DISMISSED" },
        },
      }),
    )
    const err = await expectError(adminHttp.post("/v1/admin/showcase-reports/r1/review", { action: "dismiss" }))
    expect(err.status).toBe(400)
    expect(err.code).toBe("REPORT_ALREADY_RESOLVED")
    expect(err.message).toBe("Report state changed; reload and try again")
    expect(err.fields).toEqual({ status: ["invalid transition"] })
    expect(err.data).toEqual({ currentStatus: "DISMISSED" })
    expect(errorCode(err)).toBe("REPORT_ALREADY_RESOLVED")
  })

  it("kode level atas (kontrak lama) tetap dibaca sebagai fallback", async () => {
    fetchMock.mockResolvedValue(fakeResponse(409, { code: "VALIDATION_ERROR", message: "Comment is already hidden" }))
    const err = await expectError(adminHttp.patch("/v1/admin/showcase/comments/c1", { action: "hide" }))
    expect(err.status).toBe(409)
    expect(err.code).toBe("VALIDATION_ERROR")
    // SYS-A-001: kode yang ada di katalog → copy spesifik, bukan pesan mentah.
    expect(err.message).toBe("Data tidak valid. Periksa field yang ditandai lalu coba lagi.")
  })

  it("429: retryAfter dari errors.retryAfter bila header absen", async () => {
    fetchMock.mockResolvedValue(
      fakeResponse(429, { success: false, message: "Too many", errors: { code: "RATE_LIMITED", message: "Too many", retryAfter: 42 } }),
    )
    const err = await expectError(adminHttp.get("/v1/admin/showcase/comments"))
    expect(err.retryAfter).toBe(42)
    expect(err.code).toBe("RATE_LIMITED")
  })

  it("body bukan JSON → pesan fallback dengan status, tanpa crash", async () => {
    fetchMock.mockResolvedValue({
      ...fakeResponse(502, null),
      json: async () => {
        throw new SyntaxError("Unexpected token <")
      },
    })
    const err = await expectError(adminHttp.get("/v1/admin/showcase/comments"))
    expect(err.status).toBe(502)
    expect(err.message).toBe("Admin API 502")
    expect(err.code).toBeUndefined()
  })
})

describe("adminHttp — fetch gagal (ADM-16)", () => {
  it("TypeError: Failed to fetch → NETWORK_ERROR dengan pesan Indonesia, status 0", async () => {
    fetchMock.mockRejectedValue(new TypeError("Failed to fetch"))
    const err = await expectError(adminHttp.get("/v1/admin/showcase/comments"))
    expect(err.code).toBe("NETWORK_ERROR")
    expect(err.status).toBe(0)
    expect(err.message).toBe(NETWORK_ERROR_MESSAGE)
    expect(err.message).not.toMatch(/Failed to fetch/)
  })

  it("AbortError (pembatalan disengaja) diteruskan apa adanya", async () => {
    const abort = new Error("aborted")
    abort.name = "AbortError"
    fetchMock.mockRejectedValue(abort)
    const err = await expectError(adminHttp.get("/v1/admin/showcase/comments"))
    expect(err).toBe(abort)
  })
})
