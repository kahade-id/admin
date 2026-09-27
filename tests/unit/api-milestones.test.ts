/**
 * GRUP C — Test kontrak client milestone admin.
 *
 * Menegaskan client selaras dengan endpoint backend final:
 * - GET /v1/admin/milestones?status&orderId&page&limit → { page, limit, total,
 *   totalPages, milestones: [...] } (orderId/orderTitle di-flatten dari
 *   relasi `order` bersarang)
 * - GET /v1/admin/milestones/escrow-summary
 * - GET /v1/admin/milestones/reconcile/recent?limit → { scanned, violations }
 * - GET /v1/admin/milestones/reconcile/:orderDbId
 */
import "../mocks/admin-http"

import { beforeEach, describe, expect, it } from "vitest"

import {
  getMilestoneEscrowSummary,
  listMilestones,
  reconcileMilestoneOrder,
  reconcileRecentMilestones,
} from "@/lib/api/admin/milestones"
import { adminHttpMock, resetAdminHttpMock } from "../mocks/admin-http"

beforeEach(() => {
  resetAdminHttpMock()
})

describe("kontrak client milestone admin", () => {
  it("daftar: GET /v1/admin/milestones, flatten relasi order", async () => {
    adminHttpMock.get.mockResolvedValue({
      page: 1,
      limit: 20,
      total: 1,
      totalPages: 1,
      milestones: [
        {
          id: "m-1",
          seq: 1,
          title: "Tahap 1",
          amount: 150000,
          sellerAmount: 146250,
          escrowHeld: 153750,
          status: "AWAITING_ACTIVATION",
          revisionRounds: 0,
          maxRevisionRounds: 2,
          createdAt: "2026-09-26T00:00:00.000Z",
          order: { orderId: "ORD-1", title: "Jasa Desain", buyerId: "b", sellerId: "s", status: "PAID" },
        },
      ],
    })
    const res = await listMilestones({ status: "AWAITING_ACTIVATION", page: 1, limit: 20 })
    expect(adminHttpMock.get).toHaveBeenCalledWith("/v1/admin/milestones", {
      query: { status: "AWAITING_ACTIVATION", page: 1, limit: 20 },
    })
    expect(res.total).toBe(1)
    expect(res.data).toHaveLength(1)
    expect(res.data[0].orderId).toBe("ORD-1")
    expect(res.data[0].orderTitle).toBe("Jasa Desain")
    expect(res.data[0].amount).toBe(150000)
  })

  it("ringkasan escrow: GET /v1/admin/milestones/escrow-summary", async () => {
    adminHttpMock.get.mockResolvedValue({
      totalMilestones: 4,
      totalEscrowHeld: 307500,
      releasedCount: 1,
      totalReleasedSellerAmount: 146250,
      byStatus: [{ status: "RELEASED", count: 1, escrowHeld: 0 }],
    })
    const res = await getMilestoneEscrowSummary()
    expect(adminHttpMock.get).toHaveBeenCalledWith("/v1/admin/milestones/escrow-summary")
    expect(res.totalMilestones).toBe(4)
    expect(res.totalEscrowHeld).toBe(307500)
  })

  it("rekonsiliasi massal: GET /v1/admin/milestones/reconcile/recent", async () => {
    adminHttpMock.get.mockResolvedValue({
      scanned: 10,
      violations: [
        {
          orderId: "ORD-9",
          checks: [
            { name: "sum(amount)=orderValue", ok: false, expected: "300000", actual: "299999" },
          ],
        },
      ],
    })
    const res = await reconcileRecentMilestones()
    expect(adminHttpMock.get).toHaveBeenCalledWith("/v1/admin/milestones/reconcile/recent", {
      query: undefined,
    })
    expect(res.scanned).toBe(10)
    expect(res.violations[0].orderId).toBe("ORD-9")
    expect(res.violations[0].checks[0].ok).toBe(false)
  })

  it("rekonsiliasi satu order: GET /v1/admin/milestones/reconcile/:orderDbId", async () => {
    adminHttpMock.get.mockResolvedValue({
      orderId: "ORD-1",
      hasMilestones: true,
      ok: true,
      checks: [{ name: "sum(amount)=orderValue", ok: true, expected: "300000", actual: "300000" }],
    })
    const res = await reconcileMilestoneOrder("db-order-1")
    expect(adminHttpMock.get).toHaveBeenCalledWith("/v1/admin/milestones/reconcile/db-order-1")
    expect(res.ok).toBe(true)
  })
})
