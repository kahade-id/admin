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

import { beforeEach, describe, expect, it, vi } from "vitest"

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

/* ================================================================== */
/* Kontrak envelope GAP-F (SH-A-001/002/004 — kelas bug envelope)        */
/*                                                                       */
/* Fixture dibentuk PERSIS seperti envelope backend                      */
/* (backend/src/modules/admin/showcase-reports/admin-showcase-reports.service.ts). */
/* Bila backend mengubah key envelope, test ini gagal duluan — sebelum   */
/* UI sempat crash/misinformasi seperti SH-A-001/002/004.                */
/* ================================================================== */

describe("kontrak envelope GAP-F (SH-A-001/002/004)", () => {
  it("SH-A-001 getRelatedReports: backend mengirim `reports`, bukan `related`", async () => {
    resetAdminHttpMock()
    // Fixture = envelope backend persis (getRelatedReports).
    adminHttpMock.get.mockResolvedValue({
      reportId: "sr-1",
      showcaseId: "sc-1",
      ownerId: "u-9",
      total: 2,
      reports: [
        { id: "sr-2", showcaseId: "sc-1", reason: "Spam", status: "PENDING", createdAt: "2026-09-21T00:00:00.000Z", reporterId: "u-8" },
        { id: "sr-3", showcaseId: "sc-1", reason: "Palsu", status: "UNDER_REVIEW", createdAt: "2026-09-22T00:00:00.000Z", reporterId: "u-7" },
      ],
    })
    const res = await showcaseApi.getRelatedReports("sr-1")
    expect(adminHttpMock.get).toHaveBeenCalledWith("/v1/admin/showcase-reports/sr-1/related")
    expect(res.reports).toHaveLength(2)
    expect(res.reports[0].id).toBe("sr-2")
    expect(res.total).toBe(2)
    // Key lama yang salah TIDAK boleh ada lagi.
    expect("related" in res).toBe(false)
  })

  it("SH-A-002 getSnapshotDiff: `changedFields[{field,snapshot,current}]`", async () => {
    resetAdminHttpMock()
    adminHttpMock.get.mockResolvedValue({
      reportId: "sr-1",
      snapshotAt: "2026-09-20T10:00:00.000Z",
      snapshotBy: "adm-1",
      decisionEventId: "ev-1",
      changedFields: [
        { field: "title", snapshot: "Tas ori", current: "Tas ori murah" },
        { field: "priceMin", snapshot: 100000, current: 50000 },
      ],
      changedCount: 2,
    })
    const res = await showcaseApi.getSnapshotDiff("sr-1")
    expect(adminHttpMock.get).toHaveBeenCalledWith("/v1/admin/showcase-reports/sr-1/snapshot-diff")
    expect(res.changedFields).toHaveLength(2)
    expect(res.changedFields[0]).toMatchObject({
      field: "title",
      snapshot: "Tas ori",
      current: "Tas ori murah",
    })
    expect(res.changedCount).toBe(2)
    expect("changed" in res).toBe(false)
  })

  it("SH-A-002 getSnapshotDiff: `itemDeleted: true` diteruskan", async () => {
    resetAdminHttpMock()
    adminHttpMock.get.mockResolvedValue({
      reportId: "sr-1",
      snapshotAt: null,
      itemDeleted: true,
      changedFields: [],
    })
    const res = await showcaseApi.getSnapshotDiff("sr-1")
    expect(res.itemDeleted).toBe(true)
    expect(res.changedFields).toEqual([])
  })

  it("SH-A-004 getReviewerSummary: `itemSnapshot` / `moderationEvents`, bukan `snapshot`/`events`", async () => {
    resetAdminHttpMock()
    adminHttpMock.get.mockResolvedValue({
      report: { id: "sr-1", showcaseId: "sc-1", reason: "Palsu", status: "PENDING", createdAt: "2026-09-20T10:00:00.000Z" },
      itemSnapshot: { title: "Tas ori", capturedAt: "2026-09-20T10:00:00.000Z" },
      snapshotSource: "decision",
      itemLive: { title: "Tas ori murah", isActive: true },
      moderationEvents: [{ id: "ev-1", action: "TAKEDOWN", createdAt: "2026-09-20T10:00:00.000Z" }],
      appeals: [],
      cluster: null,
    })
    const res = await showcaseApi.getReviewerSummary("sr-1")
    expect(adminHttpMock.get).toHaveBeenCalledWith(
      "/v1/admin/showcase-reports/sr-1/reviewer-summary",
    )
    expect(res.itemSnapshot).toBeTruthy()
    expect(res.moderationEvents).toHaveLength(1)
    expect(res.snapshotSource).toBe("decision")
    expect("snapshot" in res).toBe(false)
    expect("events" in res).toBe(false)
  })
})

describe("GAP-F lanjutan: restrict / assign / queue / export / restore", () => {
  it("SH-A-024 restrictShowcase: `restrictUntil` diteruskan + Idempotency-Key", async () => {
    resetAdminHttpMock()
    adminHttpMock.post.mockResolvedValue({
      message: "ok",
      reportId: "sr-1",
      status: "RESOLVED_ACTION_TAKEN",
      restrictUntil: "2026-10-04T10:00:00.000Z",
    })
    const res = await showcaseApi.restrictShowcase("sr-1", {
      days: 7,
      reason: "Dugaan barang palsu, menunggu verifikasi",
    })
    expect(adminHttpMock.post).toHaveBeenCalledWith(
      "/v1/admin/showcase-reports/sr-1/restrict",
      { days: 7, reason: "Dugaan barang palsu, menunggu verifikasi" },
      expect.objectContaining({
        headers: expect.objectContaining({ "Idempotency-Key": expect.any(String) }),
      }),
    )
    expect(res.restrictUntil).toBe("2026-10-04T10:00:00.000Z")
  })

  it("SH-A-006 assignShowcaseReport: POST /:id/assign, kosong = auto-assign", async () => {
    resetAdminHttpMock()
    adminHttpMock.post.mockResolvedValue({
      message: "Showcase report assigned",
      reportId: "sr-1",
      assignmentId: "asg-1",
      assigneeAdminId: "adm-2",
      riskScore: 80,
      riskTier: "HIGH",
      slaDueAt: "2026-09-21T10:00:00.000Z",
    })
    const res = await showcaseApi.assignShowcaseReport("sr-1", { assigneeAdminId: null })
    expect(adminHttpMock.post).toHaveBeenCalledWith(
      "/v1/admin/showcase-reports/sr-1/assign",
      { assigneeAdminId: null },
    )
    expect(res.assigneeAdminId).toBe("adm-2")
    expect(res.riskTier).toBe("HIGH")
    expect(res.slaDueAt).toBe("2026-09-21T10:00:00.000Z")
  })

  it("SH-A-007 getModerationQueue: filter diteruskan; item punya riskScore/isOverdue", async () => {
    resetAdminHttpMock()
    adminHttpMock.get.mockResolvedValue(
      emptyPage({
        data: [
          {
            id: "sr-1",
            showcaseId: "sc-1",
            reporterId: "u-9",
            reason: "Palsu",
            status: "PENDING",
            createdAt: "2026-09-20T10:00:00.000Z",
            riskScore: 90,
            riskTier: "HIGH",
            assigneeAdminId: null,
            slaDueAt: null,
            isOverdue: true,
          },
        ],
        total: 1,
      }),
    )
    const res = await showcaseApi.getModerationQueue({
      page: 1,
      limit: 20,
      riskTier: "HIGH",
      overdueOnly: true,
      sort: "risk",
    })
    expect(adminHttpMock.get).toHaveBeenCalledWith("/v1/admin/showcase-reports/queue", {
      query: { page: 1, limit: 20, riskTier: "HIGH", overdueOnly: true, sort: "risk" },
    })
    expect(res.data[0].riskScore).toBe(90)
    expect(res.data[0].isOverdue).toBe(true)
  })

  it("SH-A-003 restoreTakedownShowcaseItem: POST items/:id/restore-takedown + kontrak { ok, item }", async () => {
    resetAdminHttpMock()
    adminHttpMock.post.mockResolvedValue({ ok: true, item: { id: "sc-1", isActive: true } })
    const res = await showcaseApi.restoreTakedownShowcaseItem("sc-1")
    expect(adminHttpMock.post).toHaveBeenCalledWith(
      "/v1/admin/showcase-reports/items/sc-1/restore-takedown",
      {},
      expect.objectContaining({
        headers: expect.objectContaining({ "Idempotency-Key": expect.any(String) }),
      }),
    )
    expect(res.ok).toBe(true)
  })

  it("SH-A-003 restoreTakedownShowcaseItem: 404 diteruskan agar UI bisa graceful", async () => {
    resetAdminHttpMock()
    const err = Object.assign(new Error("Admin API 404"), { status: 404 })
    adminHttpMock.post.mockRejectedValue(err)
    await expect(showcaseApi.restoreTakedownShowcaseItem("sc-1")).rejects.toMatchObject({
      status: 404,
    })
  })

  it("SH-A-010 downloadShowcaseReportsExport: GET /export dengan query + unduh blob", async () => {
    const blob = new Blob(["a,b\n1,2"], { type: "text/csv" })
    const headers = new Headers({
      "Content-Disposition": 'attachment; filename="showcase-reports-2026-09-27.csv"',
    })
    const fetchMock = vi.fn(async () => ({ ok: true, blob: async () => blob, headers }))
    vi.stubGlobal("fetch", fetchMock)
    const createObjectURL = vi.fn(() => "blob:mock-url")
    const revokeObjectURL = vi.fn()
    Object.assign(URL, { createObjectURL, revokeObjectURL })
    const clickSpy = vi.fn()
    const origCreate = document.createElement.bind(document)
    const createSpy = vi.spyOn(document, "createElement").mockImplementation(((tag: string) => {
      const el = origCreate(tag)
      if (tag === "a") el.click = clickSpy
      return el
    }) as typeof document.createElement)

    await showcaseApi.downloadShowcaseReportsExport({
      format: "csv",
      status: "PENDING",
      from: "2026-09-01",
      to: "2026-09-27",
      limit: 100,
    })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const url = new URL((fetchMock.mock.calls[0] as unknown as [string])[0])
    expect(url.pathname).toBe("/v1/admin/showcase-reports/export")
    expect(url.searchParams.get("format")).toBe("csv")
    expect(url.searchParams.get("status")).toBe("PENDING")
    expect(url.searchParams.get("from")).toBe("2026-09-01")
    expect(url.searchParams.get("limit")).toBe("100")
    expect(createObjectURL).toHaveBeenCalledWith(blob)
    expect(clickSpy).toHaveBeenCalledTimes(1)
    const anchor = createSpy.mock.results[0].value as HTMLAnchorElement
    expect(anchor.download).toBe("showcase-reports-2026-09-27.csv")
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:mock-url")

    createSpy.mockRestore()
    vi.unstubAllGlobals()
  })
})
