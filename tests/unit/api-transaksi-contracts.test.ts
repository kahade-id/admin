/**
 * Kontrak client API admin Tim Transaksi (ADM-101 s.d. ADM-128).
 *
 * Menegaskan bahwa client admin memanggil endpoint backend yang BENAR-BENAR
 * ADA (bukan endpoint lama yang 404), dengan payload yang dipahami backend:
 * - retur: GET /v1/admin/returns/queue (adaptor items → data) +
 *   POST /v1/admin/returns/:id/action { action, ... } + Idempotency-Key
 * - moderasi: POST .../review { status, note } (bukan { action, notes })
 * - pesan room/sengketa: unwrap envelope { messages, nextCursor, hasMore }
 * - preview resolve, chat order sengketa, room-by-order, filter/sort order,
 *   filter moderasi.
 */
import "../mocks/admin-http"

import { beforeEach, describe, expect, it } from "vitest"

import { adminHttpMock, resetAdminHttpMock } from "../mocks/admin-http"
import {
  listAdminReturns,
  adminReturnAction,
  adminEscalateReturn,
  adminApproveReturnRefund,
  adminRejectReturn,
  adminForceResolveReturn,
  adminExtendSellerDeadline,
} from "@/lib/api/admin/returns"
import {
  listModerationEvents,
  reviewModerationEvent,
  getRoomMessages,
  getRoomIdByOrder,
} from "@/lib/api/admin/chat"
import {
  getDisputeMessages,
  getDisputeChat,
  previewResolveDispute,
} from "@/lib/api/admin/disputes"
import { listAdminOrders } from "@/lib/api/admin/orders"

beforeEach(() => {
  resetAdminHttpMock()
})

describe("returns client (ADM-101/105/114)", () => {
  it("listAdminReturns memanggil GET /v1/admin/returns/queue dan mengadaptasi items → data", async () => {
    const item = { id: "r1", returnId: "RTN-1", status: "REQUESTED" }
    adminHttpMock.get.mockResolvedValueOnce({
      items: [item],
      page: 2,
      limit: 20,
      total: 1,
      totalPages: 1,
    })
    const res = await listAdminReturns({ page: 2, limit: 20, status: "REQUESTED", search: "RTN" })
    expect(adminHttpMock.get).toHaveBeenCalledWith("/v1/admin/returns/queue", {
      query: { page: 2, limit: 20, status: "REQUESTED", search: "RTN" },
    })
    // ADM-105: adaptor items → Paginated.data.
    expect(res.data).toEqual([item])
    expect(res.total).toBe(1)
    expect(res.page).toBe(2)
  })

  it("adminReturnAction POST ke /:id/action dengan Idempotency-Key", async () => {
    await adminReturnAction("r1", { action: "ESCALATE", note: "x".repeat(12) })
    expect(adminHttpMock.post).toHaveBeenCalledTimes(1)
    const [path, body, opts] = adminHttpMock.post.mock.calls[0] as [
      string,
      Record<string, unknown>,
      { headers: Record<string, string> },
    ]
    expect(path).toBe("/v1/admin/returns/r1/action")
    expect(body.action).toBe("ESCALATE")
    expect(opts.headers["Idempotency-Key"]).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    )
  })

  it("mapping aksi: ESCALATE / APPROVE / REJECT / FORCE_RESOLVE_* / EXTEND_DEADLINE", async () => {
    await adminEscalateReturn("r1")
    await adminApproveReturnRefund("r1", { refundAmountSen: 150000 })
    await adminRejectReturn("r1", { rejectReasonCode: "KLAIM_TIDAK_VALID" })
    await adminForceResolveReturn("r1", "EXCHANGE", "catatan penutupan paksa")
    await adminExtendSellerDeadline("r1")
    const bodies = adminHttpMock.post.mock.calls.map(
      (c) => (c as [string, Record<string, unknown>])[1],
    )
    expect(bodies[0].action).toBe("ESCALATE")
    expect(bodies[1]).toMatchObject({ action: "APPROVE", refundAmountSen: 150000 })
    expect(bodies[2]).toMatchObject({ action: "REJECT", rejectReasonCode: "KLAIM_TIDAK_VALID" })
    // ADM-114: tidak ada lagi endpoint /extend-deadline terpisah.
    expect(bodies[3].action).toBe("FORCE_RESOLVE_EXCHANGE")
    expect(bodies[4].action).toBe("EXTEND_DEADLINE")
    for (const call of adminHttpMock.post.mock.calls) {
      expect((call as [string, string, { headers: Record<string, string> }])[0]).toMatch(
        /^\/v1\/admin\/returns\/r1\/action$/,
      )
      expect(
        (call as [string, string, { headers: Record<string, string> }])[2].headers["Idempotency-Key"],
      ).toBeTruthy()
    }
  })
})

describe("message moderation client (ADM-102/103/115/122)", () => {
  it("reviewModerationEvent mengirim { status, note } — bukan { action, notes }", async () => {
    await reviewModerationEvent("e1", { status: "DISMISSED", note: "bukan pelanggaran" })
    const [path, body] = adminHttpMock.post.mock.calls[0] as [string, Record<string, unknown>]
    expect(path).toBe("/v1/admin/chat/moderation-events/e1/review")
    expect(body).toMatchObject({ status: "DISMISSED", note: "bukan pelanggaran" })
    expect(body).not.toHaveProperty("action")
    expect(body).not.toHaveProperty("notes")
  })

  it("getRoomMessages meng-unwrap envelope { messages, nextCursor, hasMore }", async () => {
    adminHttpMock.get.mockResolvedValueOnce({
      messages: [{ id: "m1" }],
      nextCursor: "cursor-9",
      hasMore: true,
    })
    const res = await getRoomMessages("room-1", { limit: 50 })
    expect(adminHttpMock.get).toHaveBeenCalledWith(
      "/v1/admin/chat/rooms/room-1/messages",
      { query: { limit: 50 } },
    )
    expect(res.messages).toEqual([{ id: "m1" }])
    expect(res.nextCursor).toBe("cursor-9")
    expect(res.hasMore).toBe(true)
  })

  it("getRoomIdByOrder memanggil endpoint by-order (ADM-115)", async () => {
    await getRoomIdByOrder("ORD-123")
    expect(adminHttpMock.get).toHaveBeenCalledWith("/v1/admin/chat/rooms/by-order/ORD-123")
  })

  it("listModerationEvents meneruskan filter severity/action/kind (ADM-122)", async () => {
    await listModerationEvents({ severity: "HIGH", action: "BLOCKED", kind: "SPAM" })
    expect(adminHttpMock.get).toHaveBeenCalledWith("/v1/admin/chat/moderation-events", {
      query: expect.objectContaining({ severity: "HIGH", action: "BLOCKED", kind: "SPAM" }),
    })
  })
})

describe("disputes client (ADM-109/111/127)", () => {
  it("getDisputeMessages mengembalikan envelope (bukan array) agar paginasi bisa lanjut", async () => {
    adminHttpMock.get.mockResolvedValueOnce({
      messages: [{ id: "m1" }],
      nextCursor: "c1",
      hasMore: true,
    })
    const res = await getDisputeMessages("d1", { cursor: "c0" })
    expect(adminHttpMock.get).toHaveBeenCalledWith("/v1/admin/disputes/d1/messages", {
      query: { cursor: "c0" },
    })
    expect(res.nextCursor).toBe("c1")
    expect(res.hasMore).toBe(true)
    expect(Array.isArray(res)).toBe(false)
  })

  it("getDisputeChat memanggil /:id/chat dan meng-unwrap envelope", async () => {
    adminHttpMock.get.mockResolvedValueOnce({
      messages: [{ id: "m1", isDeleted: true }],
      nextCursor: null,
      hasMore: false,
    })
    const res = await getDisputeChat("d1")
    expect(adminHttpMock.get).toHaveBeenCalledWith("/v1/admin/disputes/d1/chat", {
      query: undefined,
    })
    expect(res.messages).toHaveLength(1)
    expect(res.hasMore).toBe(false)
  })

  it("previewResolveDispute memanggil endpoint preview read-only (GET)", async () => {
    await previewResolveDispute("d1", { decision: "SPLIT", buyerPercent: 60, sellerPercent: 40 })
    expect(adminHttpMock.get).toHaveBeenCalledWith("/v1/admin/disputes/d1/resolve/preview", {
      query: { decision: "SPLIT", buyerPercent: 60, sellerPercent: 40 },
    })
    expect(adminHttpMock.post).not.toHaveBeenCalled()
  })
})

describe("orders client (ADM-117)", () => {
  it("listAdminOrders meneruskan startDate/endDate/sortBy/sortOrder", async () => {
    await listAdminOrders({
      q: "ORD-1",
      startDate: "2026-09-01",
      endDate: "2026-09-30",
      sortBy: "orderValue",
      sortOrder: "asc",
    })
    expect(adminHttpMock.get).toHaveBeenCalledWith(
      "/v1/admin/orders",
      expect.objectContaining({
        query: expect.objectContaining({
          search: "ORD-1",
          startDate: "2026-09-01",
          endDate: "2026-09-30",
          sortBy: "orderValue",
          sortOrder: "asc",
        }),
      }),
    )
  })
})
