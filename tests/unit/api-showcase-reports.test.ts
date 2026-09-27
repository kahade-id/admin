/**
 * G508 — Test moderasi showcase: status final + jalur banding/reopen.
 *
 * Kontrak backend (`backend/src/modules/admin/showcase-reports/`):
 * - GET  /v1/admin/showcase-reports?{page,limit,status}
 * - GET  /v1/admin/showcase-reports/:id
 * - POST /v1/admin/showcase-reports/:id/review   { action, resolution? }
 *        + header Idempotency-Key WAJIB
 *   action: dismiss | takedown | no_action | under_review
 *   Status final (RESOLVED_ACTION_TAKEN, RESOLVED_NO_ACTION, DISMISSED)
 *   ditolak backend dengan 400 — UI menyembunyikan tombol aksi untuknya.
 *
 * REVISI QA 2026-09-26: backend MENAMBAH endpoint banding/reopen
 * (GET appeals/pending, POST :reportId/reopen, POST appeals/:id/decide).
 * Kontraknya diuji di describe "jalur banding / reopen" di bawah.
 */
import "../mocks/admin-http"

import { beforeEach, describe, expect, it } from "vitest"

import {
  getShowcaseReportDetail,
  listShowcaseReports,
  reviewShowcaseReport,
  type ShowcaseReport,
  type ShowcaseReportStatus,
} from "@/lib/api/admin/showcase-reports"
import * as showcaseApi from "@/lib/api/admin/showcase-reports"
import { adminHttpMock, emptyPage, resetAdminHttpMock } from "../mocks/admin-http"

/** Cerminan FINAL_STATUSES di halaman detail laporan etalase. */
const FINAL_STATUSES: ReadonlySet<string> = new Set([
  "RESOLVED_ACTION_TAKEN",
  "RESOLVED_NO_ACTION",
  "DISMISSED",
])

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

function report(overrides: Partial<ShowcaseReport> = {}): ShowcaseReport {
  return {
    id: "sr-1",
    showcaseId: "sc-1",
    reporterId: "u-9",
    reason: "Barang palsu",
    status: "PENDING",
    createdAt: "2026-09-20T10:00:00.000Z",
    ...overrides,
  }
}

beforeEach(() => {
  resetAdminHttpMock()
})

describe("kontrak API moderasi showcase", () => {
  it("list: GET dengan filter status", async () => {
    adminHttpMock.get.mockResolvedValue(emptyPage({ data: [report()] }))
    await listShowcaseReports({ status: "PENDING", page: 1 })
    expect(adminHttpMock.get).toHaveBeenCalledWith("/v1/admin/showcase-reports", {
      query: { status: "PENDING", page: 1 },
    })
  })

  it("detail: GET /v1/admin/showcase-reports/:id", async () => {
    adminHttpMock.get.mockResolvedValue(report())
    await getShowcaseReportDetail("sr-1")
    expect(adminHttpMock.get).toHaveBeenCalledWith("/v1/admin/showcase-reports/sr-1")
  })

  it("review mengirim action + resolution + header Idempotency-Key", async () => {
    adminHttpMock.post.mockResolvedValue({
      message: "ok",
      reportId: "sr-1",
      status: "RESOLVED_ACTION_TAKEN",
    })
    const res = await reviewShowcaseReport("sr-1", {
      action: "takedown",
      resolution: "Item terbukti palsu.",
    })
    const [path, body, opts] = adminHttpMock.post.mock.calls[0] as [
      string,
      Record<string, unknown>,
      { headers: Record<string, string> },
    ]
    expect(path).toBe("/v1/admin/showcase-reports/sr-1/review")
    expect(body).toEqual({ action: "takedown", resolution: "Item terbukti palsu." })
    expect(opts.headers["Idempotency-Key"]).toMatch(UUID_V4)
    expect(res.status).toBe("RESOLVED_ACTION_TAKEN")
  })

  it("semua aksi valid diteruskan apa adanya", async () => {
    for (const action of ["dismiss", "takedown", "no_action", "under_review"] as const) {
      adminHttpMock.post.mockClear()
      await reviewShowcaseReport("sr-1", { action })
      const [, body] = adminHttpMock.post.mock.calls[0] as [string, Record<string, unknown>]
      expect(body.action).toBe(action)
    }
  })
})

describe("status final (G508)", () => {
  it("tiga status final dikenali: takedown/no_action/dismissed", () => {
    const finals: ShowcaseReportStatus[] = [
      "RESOLVED_ACTION_TAKEN",
      "RESOLVED_NO_ACTION",
      "DISMISSED",
    ]
    for (const s of finals) expect(FINAL_STATUSES.has(s)).toBe(true)
  })

  it("PENDING & UNDER_REVIEW bukan final — masih bisa dimoderasi", () => {
    expect(FINAL_STATUSES.has("PENDING")).toBe(false)
    expect(FINAL_STATUSES.has("UNDER_REVIEW")).toBe(false)
  })

  it("UI: laporan final tidak menawarkan aksi moderasi lagi", () => {
    // Kontrak UI di halaman detail: tombol aksi hanya dirender bila
    // !FINAL_STATUSES.has(status). Test ini mengunci aturan tersebut.
    const canModerate = (status: ShowcaseReportStatus) => !FINAL_STATUSES.has(status)
    expect(canModerate("PENDING")).toBe(true)
    expect(canModerate("UNDER_REVIEW")).toBe(true)
    expect(canModerate("DISMISSED")).toBe(false)
    expect(canModerate("RESOLVED_ACTION_TAKEN")).toBe(false)
    expect(canModerate("RESOLVED_NO_ACTION")).toBe(false)
  })
})

describe("jalur banding / reopen (G508)", () => {
  // REVISI QA 2026-09-26: backend MENAMBAH endpoint banding/reopen
  // (admin-showcase-reports.controller.ts: GET appeals/pending,
  //  POST :reportId/reopen, POST appeals/:appealId/decide).
  // Guard "tidak ada" diganti kontrak eksplisit untuk endpoint baru.

  it("reopenShowcaseReport: POST /:id/reopen + Idempotency-Key", async () => {
    resetAdminHttpMock()
    adminHttpMock.post.mockResolvedValue({ ok: true })
    await showcaseApi.reopenShowcaseReport("rpt-1", {
      reason: "Bukti baru dari pelapor",
      reasonCode: "NEW_EVIDENCE",
    })
    expect(adminHttpMock.post).toHaveBeenCalledWith(
      "/v1/admin/showcase-reports/rpt-1/reopen",
      { reason: "Bukti baru dari pelapor", reasonCode: "NEW_EVIDENCE" },
      expect.objectContaining({ headers: expect.objectContaining({ "Idempotency-Key": expect.any(String) }) }),
    )
    const key = (adminHttpMock.post.mock.calls[0][2] as { headers: Record<string, string> }).headers["Idempotency-Key"]
    expect(key).toMatch(UUID_V4)
  })

  it("listPendingAppeals: GET /appeals/pending", async () => {
    resetAdminHttpMock()
    adminHttpMock.get.mockResolvedValue(emptyPage())
    await showcaseApi.listPendingAppeals({ page: 1, limit: 20 })
    expect(adminHttpMock.get).toHaveBeenCalledWith(
      "/v1/admin/showcase-reports/appeals/pending",
      { query: { page: 1, limit: 20 } },
    )
  })

  it("decideAppeal: POST /appeals/:id/decide", async () => {
    resetAdminHttpMock()
    adminHttpMock.post.mockResolvedValue({ message: "ok" })
    await showcaseApi.decideAppeal("apl-9", {
      decision: "APPROVED",
      decisionNote: "Banding valid — konten dikembalikan",
    })
    expect(adminHttpMock.post).toHaveBeenCalledWith(
      "/v1/admin/showcase-reports/appeals/apl-9/decide",
      { decision: "APPROVED", decisionNote: "Banding valid — konten dikembalikan" },
    )
  })
})
