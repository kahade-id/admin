/**
 * G505 — Test bulk verifikasi bisnis: sukses parsial + konflik status.
 *
 * Kontrak backend (`backend/src/modules/admin/business-verification/`):
 * - POST /v1/admin/business-verifications/bulk/approve { verificationIds, notes? }
 * - POST /v1/admin/business-verifications/bulk/reject  { verificationIds, reason, notes? }
 *   → { batchId, approved?/rejected?: string[], failed: [{ id, reason }] }
 *   Maks 50/batch (ditegakkan backend).
 */
import "../mocks/admin-http"

import { beforeEach, describe, expect, it } from "vitest"

import {
  approveBusiness,
  bulkApproveBusiness,
  bulkRejectBusiness,
  getBusinessDetail,
  getBusinessQueue,
  rejectBusiness,
  type BusinessVerificationItem,
} from "@/lib/api/admin/business"
import { adminHttpMock, emptyPage, resetAdminHttpMock } from "../mocks/admin-http"

function biz(overrides: Partial<BusinessVerificationItem> = {}): BusinessVerificationItem {
  return {
    id: "bv-1",
    verificationId: "bv-1",
    userId: "u-1",
    status: "PENDING",
    businessName: "PT Maju Jaya",
    rejectionReason: null,
    createdAt: "2026-09-20T10:00:00.000Z",
    reviewedAt: null,
    ...overrides,
  }
}

beforeEach(() => {
  resetAdminHttpMock()
})

describe("antrean verifikasi bisnis", () => {
  it("GET /v1/admin/business-verifications dengan filter status", async () => {
    adminHttpMock.get.mockResolvedValue(emptyPage({ data: [biz()] }))
    await getBusinessQueue({ status: "PENDING", page: 1 })
    expect(adminHttpMock.get).toHaveBeenCalledWith(
      "/v1/admin/business-verifications",
      { query: { status: "PENDING", page: 1 } },
    )
  })

  it("detail: GET /v1/admin/business-verifications/:id", async () => {
    adminHttpMock.get.mockResolvedValue(biz())
    await getBusinessDetail("bv-1")
    expect(adminHttpMock.get).toHaveBeenCalledWith("/v1/admin/business-verifications/bv-1")
  })

  it("approve/reject tunggal memakai verificationId di path", async () => {
    await approveBusiness("bv-1", "Legalitas valid")
    expect(adminHttpMock.post).toHaveBeenCalledWith(
      "/v1/admin/business-verifications/bv-1/approve",
      { notes: "Legalitas valid" },
    )
    await rejectBusiness("bv-1", "NIB tidak terdaftar di OSS.")
    expect(adminHttpMock.post).toHaveBeenCalledWith(
      "/v1/admin/business-verifications/bv-1/reject",
      { reason: "NIB tidak terdaftar di OSS.", notes: undefined },
    )
  })
})

describe("bulk verifikasi bisnis (G505)", () => {
  it("bulk approve mengirim { verificationIds }", async () => {
    adminHttpMock.post.mockResolvedValue({ batchId: "b-1", approved: ["bv-1"], failed: [] })
    await bulkApproveBusiness(["bv-1", "bv-2"])
    expect(adminHttpMock.post).toHaveBeenCalledWith(
      "/v1/admin/business-verifications/bulk/approve",
      { verificationIds: ["bv-1", "bv-2"], notes: undefined },
    )
  })

  it("bulk reject mengirim { verificationIds, reason }", async () => {
    await bulkRejectBusiness(["bv-1"], "Dokumen tidak lengkap, minimal 10 karakter.")
    expect(adminHttpMock.post).toHaveBeenCalledWith(
      "/v1/admin/business-verifications/bulk/reject",
      {
        verificationIds: ["bv-1"],
        reason: "Dokumen tidak lengkap, minimal 10 karakter.",
        notes: undefined,
      },
    )
  })

  it("sukses parsial: approved vs failed terpisah per item", async () => {
    adminHttpMock.post.mockResolvedValue({
      batchId: "b-2",
      approved: ["bv-1"],
      failed: [{ id: "bv-2", reason: "Status saat ini APPROVED" }],
    })
    const res = await bulkApproveBusiness(["bv-1", "bv-2"])
    expect(res.approved).toEqual(["bv-1"])
    expect(res.failed).toHaveLength(1)
    expect(res.failed[0]).toMatchObject({ id: "bv-2" })
  })

  it("konflik status: item yang berubah sejak daftar dimuat masuk failed", async () => {
    adminHttpMock.post.mockResolvedValue({
      batchId: "b-3",
      rejected: [],
      failed: [
        { id: "bv-1", reason: "Status berubah: sudah APPROVED oleh admin lain" },
        { id: "bv-2", reason: "Status berubah: sudah APPROVED oleh admin lain" },
      ],
    })
    const res = await bulkRejectBusiness(["bv-1", "bv-2"], "Alasan penolakan massal.")
    expect(res.rejected ?? []).toEqual([])
    expect(res.failed).toHaveLength(2)
  })
})
