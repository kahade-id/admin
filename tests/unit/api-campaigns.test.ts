/**
 * G507 — Test lifecycle kampanye: create → edit → delete → activate → pause.
 *
 * Kontrak backend (`backend/src/modules/admin/campaigns/`,
 * @AdminRoles SUPER_ADMIN):
 * - GET    /v1/admin/campaigns?{page,limit,status}
 * - POST   /v1/admin/campaigns
 * - GET    /v1/admin/campaigns/:id
 * - PUT    /v1/admin/campaigns/:id
 * - DELETE /v1/admin/campaigns/:id
 * - POST   /v1/admin/campaigns/:id/activate   → menerbitkan voucher personal
 * - POST   /v1/admin/campaigns/:id/pause
 */
import "../mocks/admin-http"

import { beforeEach, describe, expect, it } from "vitest"

import {
  activateCampaign,
  createCampaign,
  deleteCampaign,
  getCampaign,
  listCampaigns,
  pauseCampaign,
  updateCampaign,
  type AdminCampaignItem,
  type CampaignActivationResult,
} from "@/lib/api/admin/campaigns"
import { adminHttpMock, emptyPage, resetAdminHttpMock } from "../mocks/admin-http"

function campaign(overrides: Partial<CampaignActivationResult> = {}): CampaignActivationResult {
  return {
    campaignId: "cmp-1",
    name: "Promo Merdeka",
    type: "FEE_PROMO",
    status: "DRAFT",
    startsAt: "2026-08-01T00:00:00.000Z",
    endsAt: "2026-08-31T23:59:59.000Z",
    ...overrides,
  }
}

beforeEach(() => {
  resetAdminHttpMock()
})

describe("lifecycle kampanye", () => {
  it("create: POST /v1/admin/campaigns dengan payload lengkap", async () => {
    adminHttpMock.post.mockResolvedValue(campaign())
    const res = await createCampaign({
      name: "Promo Merdeka",
      type: "FEE_PROMO",
      startsAt: "2026-08-01T00:00:00.000Z",
      endsAt: "2026-08-31T23:59:59.000Z",
      promoCode: "MERDEKA17",
      discountPercent: 50,
      maxDiscount: 25000,
    })
    expect(adminHttpMock.post).toHaveBeenCalledWith("/v1/admin/campaigns", {
      name: "Promo Merdeka",
      type: "FEE_PROMO",
      startsAt: "2026-08-01T00:00:00.000Z",
      endsAt: "2026-08-31T23:59:59.000Z",
      promoCode: "MERDEKA17",
      discountPercent: 50,
      maxDiscount: 25000,
    })
    expect(res.campaignId).toBe("cmp-1")
  })

  it("list: GET dengan filter status", async () => {
    adminHttpMock.get.mockResolvedValue(emptyPage({ data: [campaign()] }))
    await listCampaigns({ status: "ACTIVE" })
    expect(adminHttpMock.get).toHaveBeenCalledWith("/v1/admin/campaigns", {
      query: { status: "ACTIVE" },
    })
  })

  it("detail: GET /v1/admin/campaigns/:id", async () => {
    adminHttpMock.get.mockResolvedValue(campaign())
    await getCampaign("cmp-1")
    expect(adminHttpMock.get).toHaveBeenCalledWith("/v1/admin/campaigns/cmp-1")
  })

  it("edit: PUT /v1/admin/campaigns/:id dengan field yang diubah", async () => {
    adminHttpMock.put.mockResolvedValue(campaign({ name: "Promo Merdeka Rev" }))
    const res = await updateCampaign("cmp-1", {
      name: "Promo Merdeka Rev",
      maxRedemptions: 1000,
    })
    expect(adminHttpMock.put).toHaveBeenCalledWith("/v1/admin/campaigns/cmp-1", {
      name: "Promo Merdeka Rev",
      maxRedemptions: 1000,
    })
    expect(res.name).toBe("Promo Merdeka Rev")
  })

  it("activate: POST …/activate → status ACTIVE + ringkasan voucher", async () => {
    adminHttpMock.post.mockResolvedValue(
      campaign({
        status: "ACTIVE",
        voucherIssuance: { issued: 120, skipped: 5, errors: 0 },
      }),
    )
    const res = await activateCampaign("cmp-1", "Promo siap diluncurkan")
    expect(adminHttpMock.post).toHaveBeenCalledWith("/v1/admin/campaigns/cmp-1/activate", {
      reason: "Promo siap diluncurkan",
    })
    expect(res.status).toBe("ACTIVE")
    expect(res.voucherIssuance?.issued).toBe(120)
  })

  it("pause: POST …/pause → status PAUSED", async () => {
    adminHttpMock.post.mockResolvedValue(campaign({ status: "PAUSED" }))
    const res = await pauseCampaign("cmp-1", "Stok promo habis")
    expect(adminHttpMock.post).toHaveBeenCalledWith("/v1/admin/campaigns/cmp-1/pause", {
      reason: "Stok promo habis",
    })
    expect(res.status).toBe("PAUSED")
  })

  it("delete: DELETE /v1/admin/campaigns/:id", async () => {
    adminHttpMock.delete.mockResolvedValue({ message: "Kampanye dihapus." })
    const res = await deleteCampaign("cmp-1")
    expect(adminHttpMock.delete).toHaveBeenCalledWith("/v1/admin/campaigns/cmp-1")
    expect(res.message).toBeTruthy()
  })

  it("urutan lifecycle penuh: create → activate → pause → delete", async () => {
    await createCampaign({
      name: "X",
      type: "CASHBACK",
      startsAt: "2026-09-01T00:00:00Z",
      endsAt: "2026-09-30T00:00:00Z",
    })
    await activateCampaign("cmp-1", "Go live")
    await pauseCampaign("cmp-1", "Jeda sementara")
    await deleteCampaign("cmp-1")

    expect(adminHttpMock.post.mock.calls.map((c) => c[0])).toEqual([
      "/v1/admin/campaigns",
      "/v1/admin/campaigns/cmp-1/activate",
      "/v1/admin/campaigns/cmp-1/pause",
    ])
    expect(adminHttpMock.delete).toHaveBeenCalledWith("/v1/admin/campaigns/cmp-1")
  })

  it("id kampanye di-encode aman di path", async () => {
    await getCampaign("cmp/1?x=2")
    expect(adminHttpMock.get).toHaveBeenCalledWith("/v1/admin/campaigns/cmp%2F1%3Fx%3D2")
  })
})
