/**
 * G509 — Test Feedback terpisah dari support ticket.
 *
 * Dua domain berbeda dengan kontrak berbeda:
 * - Support ticket: /v1/admin/support/tickets/* (paginasi offset {data,total,page,…},
 *   status OPEN/IN_PROGRESS/RESOLVED/CLOSED, reply tanpa assign)
 * - Feedback: /v1/admin/feedback/* (paginasi CURSOR {data,nextCursor,hasMore},
 *   status NEW/IN_REVIEW/ACTIONED/CLOSED, alur assign→note→tags→reply→escalate→close,
 *   kontak termasking + SLA rules)
 *
 * Test memastikan keduanya tidak tertukar endpoint-nya dan feedback
 * mendukung alur kerja penuhnya sendiri.
 */
import "../mocks/admin-http"

import { beforeEach, describe, expect, it } from "vitest"

import {
  addFeedbackNote,
  assignFeedback,
  closeFeedback,
  escalateFeedback,
  getFeedbackContact,
  getFeedbackDetail,
  getFeedbackSummary,
  listFeedback,
  listSlaRules,
  replyToFeedback,
  unassignFeedback,
  updateFeedbackStatus,
  updateFeedbackTags,
  type FeedbackItem,
} from "@/lib/api/admin/feedback"
import { listTickets } from "@/lib/api/admin/support"
import { adminHttpMock, resetAdminHttpMock } from "../mocks/admin-http"

function feedbackItem(overrides: Partial<FeedbackItem> = {}): FeedbackItem {
  return {
    id: "fb-1",
    category: "BUG",
    message: "Aplikasi crash saat buka etalase",
    platform: "android",
    status: "NEW",
    tags: [],
    riskFlag: "NONE",
    createdAt: "2026-09-20T10:00:00.000Z",
    ...overrides,
  }
}

beforeEach(() => {
  resetAdminHttpMock()
})

describe("feedback ≠ support ticket", () => {
  it("list feedback memakai endpoint & paginasi cursor sendiri", async () => {
    adminHttpMock.get.mockResolvedValue({
      data: [feedbackItem()],
      nextCursor: "cur-2",
      hasMore: true,
    })
    const res = await listFeedback({ limit: 20, status: "NEW" })

    expect(adminHttpMock.get).toHaveBeenCalledWith("/v1/admin/feedback", {
      query: expect.objectContaining({ limit: 20, status: "NEW" }),
    })
    // Bentuk cursor, BUKAN offset {total,page,totalPages}
    expect(res.nextCursor).toBe("cur-2")
    expect(res.hasMore).toBe(true)
    expect(res).not.toHaveProperty("totalPages")
  })

  it("support ticket tidak memakai endpoint feedback (dan sebaliknya)", async () => {
    await listFeedback()
    await listTickets()
    const paths = adminHttpMock.get.mock.calls.map((c) => String(c[0]))
    expect(paths).toContain("/v1/admin/feedback")
    expect(paths).toContain("/v1/admin/support/tickets")
    expect(paths.some((p) => p.includes("support") && p.includes("feedback"))).toBe(false)
  })
})

describe("alur kerja feedback", () => {
  it("detail: GET /v1/admin/feedback/:id", async () => {
    adminHttpMock.get.mockResolvedValue({
      ...feedbackItem(),
      account: { isGuest: false },
      notes: [],
      replies: [],
      audit: [],
    })
    await getFeedbackDetail("fb-1")
    expect(adminHttpMock.get).toHaveBeenCalledWith("/v1/admin/feedback/fb-1")
  })

  it("ubah status: PATCH …/status { status }", async () => {
    await updateFeedbackStatus("fb-1", "IN_REVIEW")
    expect(adminHttpMock.patch).toHaveBeenCalledWith("/v1/admin/feedback/fb-1/status", {
      status: "IN_REVIEW",
    })
  })

  it("assign & unassign", async () => {
    await assignFeedback("fb-1", "adm-7")
    expect(adminHttpMock.post).toHaveBeenCalledWith("/v1/admin/feedback/fb-1/assign", {
      adminId: "adm-7",
    })
    await unassignFeedback("fb-1")
    expect(adminHttpMock.post).toHaveBeenCalledWith("/v1/admin/feedback/fb-1/unassign")
  })

  it("catatan internal & tags", async () => {
    await addFeedbackNote("fb-1", "Reproduksi di Android 14.")
    expect(adminHttpMock.post).toHaveBeenCalledWith("/v1/admin/feedback/fb-1/notes", {
      note: "Reproduksi di Android 14.",
    })
    await updateFeedbackTags("fb-1", ["crash", "etalase"], "HIGH")
    expect(adminHttpMock.post).toHaveBeenCalledWith("/v1/admin/feedback/fb-1/tags", {
      tags: ["crash", "etalase"],
      impactLabel: "HIGH",
    })
  })

  it("balas ke pelapor", async () => {
    await replyToFeedback("fb-1", "Terima kasih, sudah kami perbaiki di v2.1.")
    expect(adminHttpMock.post).toHaveBeenCalledWith("/v1/admin/feedback/fb-1/reply", {
      body: "Terima kasih, sudah kami perbaiki di v2.1.",
    })
  })

  it("eskalasi risiko keamanan", async () => {
    await escalateFeedback("fb-1", "SECURITY_RISK", "Ada indikasi eksfiltrasi token.")
    expect(adminHttpMock.post).toHaveBeenCalledWith("/v1/admin/feedback/fb-1/escalate", {
      risk: "SECURITY_RISK",
      note: "Ada indikasi eksfiltrasi token.",
    })
  })

  it("tutup dengan reason code", async () => {
    await closeFeedback("fb-1", "RESOLVED")
    expect(adminHttpMock.post).toHaveBeenCalledWith("/v1/admin/feedback/fb-1/close", {
      reason: "RESOLVED",
    })
  })

  it("kontak: backend mengembalikan versi termasking + flag izin", async () => {
    adminHttpMock.post.mockResolvedValue({
      contact: null,
      maskedContact: "+62••• ••• 7890",
      consent: true,
      visibleToRole: false,
    })
    const res = await getFeedbackContact("fb-1")
    expect(adminHttpMock.post).toHaveBeenCalledWith("/v1/admin/feedback/fb-1/contact")
    // Role tanpa izin TIDAK mendapat kontak asli
    expect(res.contact).toBeNull()
    expect(res.maskedContact).toBeTruthy()
    expect(res.visibleToRole).toBe(false)
  })

  it("ringkasan agregat: GET /v1/admin/feedback/summary", async () => {
    // Bentuk backend nyata: envelope { success, data } + distribusi array.
    adminHttpMock.get.mockResolvedValue({
      success: true,
      data: {
        total: 42,
        avgRating: 4.2,
        byStatus: [{ status: "NEW", count: 10 }],
        byCategory: [{ category: "BUG", count: 20 }],
        byPlatform: [{ platform: "android", count: 30 }],
        trend: { windowDays: 30, daily: [], byPlatform: [], byAppVersion: [] },
      },
    })
    const res = await getFeedbackSummary()
    expect(adminHttpMock.get).toHaveBeenCalledWith("/v1/admin/feedback/summary")
    expect(res.total).toBe(42)
    expect(res.avgRating).toBe(4.2)
    expect(res.byStatus).toEqual({ NEW: 10 })
    expect(res.byCategory).toEqual({ BUG: 20 })
    expect(res.byPlatform).toEqual({ android: 30 })
    expect(res.trend?.windowDays).toBe(30)
  })

  it("SLA rules: GET /v1/admin/feedback/sla-rules", async () => {
    adminHttpMock.get.mockResolvedValue({
      items: [{ id: "r-1", name: "Bug kritis", slaHours: 24, isActive: true }],
    })
    await listSlaRules()
    expect(adminHttpMock.get).toHaveBeenCalledWith("/v1/admin/feedback/sla-rules")
  })
})
