/**
 * G504 — Test antrean KYC: filter, pagination, state SLA.
 * G505 — Test bulk KYC: payload kontrak backend + sukses parsial + konflik status.
 *
 * Kontrak backend (`backend/src/modules/admin/kyc/`):
 * - GET  /v1/admin/kyc?{page,limit,status}
 * - GET  /v1/admin/kyc/:id
 * - POST /v1/admin/kyc/:id/approve            { notes? }
 * - POST /v1/admin/kyc/:id/reject             { reason, notes? }
 * - POST /v1/admin/kyc/:id/revoke             { reason? }
 * - POST /v1/admin/kyc/bulk/approve           { kycIds, notes?, expectedStatus? }
 * - POST /v1/admin/kyc/bulk/reject           { kycIds, reason, notes?, expectedStatus? }
 *   → { approved|rejected: string[], failed: [{ id, reason }] }
 * - POST /v1/admin/kyc/:id/document-urls      { password }
 *
 * State SLA adalah konvensi UI (`src/app/(panel)/kyc/page.tsx`):
 * KYC_SLA_HOURS = 48 — badge "Lewat SLA" bila PENDING lebih lama dari itu.
 */
import "../mocks/admin-http"

import { beforeEach, describe, expect, it, vi } from "vitest"

import {
  approveKyc,
  bulkApproveKyc,
  bulkRejectKyc,
  getKycDetail,
  getKycDocumentUrls,
  getKycQueue,
  rejectKyc,
  revokeKyc,
  type KycQueueItem,
} from "@/lib/api/admin/kyc"
import { ageHours } from "@/lib/format"
import { adminHttpMock, emptyPage, resetAdminHttpMock } from "../mocks/admin-http"

/** SLA tinjauan KYC (jam) — disalin dari konvensi UI halaman KYC. */
const KYC_SLA_HOURS = 48

function item(overrides: Partial<KycQueueItem> = {}): KycQueueItem {
  return {
    id: "k-1",
    kycId: "k-1",
    userId: "u-1",
    status: "PENDING",
    rejectionReason: null,
    attemptNumber: 1,
    createdAt: new Date().toISOString(),
    reviewedAt: null,
    reviewedBy: null,
    user: { userId: "u-1", email: "user@example.com", fullName: "Budi" },
    reviewer: null,
    ...overrides,
  }
}

beforeEach(() => {
  resetAdminHttpMock()
  vi.useRealTimers()
})

describe("antrean KYC — filter & pagination (G504)", () => {
  it("GET /v1/admin/kyc dengan page/limit/status", async () => {
    adminHttpMock.get.mockResolvedValue(
      emptyPage<KycQueueItem>({ data: [item()], total: 1, totalPages: 1 }),
    )
    const res = await getKycQueue({ page: 1, limit: 20, status: "PENDING" })
    expect(adminHttpMock.get).toHaveBeenCalledWith("/v1/admin/kyc", {
      query: { page: 1, limit: 20, status: "PENDING" },
    })
    expect(res.data).toHaveLength(1)
  })

  it("tanpa filter status → antrean penuh (semua status)", async () => {
    await getKycQueue({ page: 3 })
    expect(adminHttpMock.get).toHaveBeenCalledWith("/v1/admin/kyc", {
      query: { page: 3 },
    })
  })

  it("filter tiap status diteruskan apa adanya", async () => {
    for (const status of ["PENDING", "APPROVED", "REJECTED", "REVOKED"] as const) {
      adminHttpMock.get.mockClear()
      await getKycQueue({ status })
      expect(adminHttpMock.get).toHaveBeenCalledWith("/v1/admin/kyc", {
        query: { status },
      })
    }
  })

  it("detail: GET /v1/admin/kyc/:id", async () => {
    adminHttpMock.get.mockResolvedValue(item({ id: "k-9", kycId: "k-9" }))
    const res = await getKycDetail("k-9")
    expect(adminHttpMock.get).toHaveBeenCalledWith("/v1/admin/kyc/k-9")
    expect(res.kycId).toBe("k-9")
  })
})

describe("state SLA antrean KYC (G504)", () => {
  it("PENDING lebih tua dari 48 jam → lewat SLA", () => {
    const created = new Date(Date.now() - 50 * 3600 * 1000).toISOString()
    const h = ageHours(created)
    expect(h).not.toBeNull()
    expect(h! >= KYC_SLA_HOURS).toBe(true)
  })

  it("PENDING baru → belum lewat SLA", () => {
    const created = new Date(Date.now() - 5 * 3600 * 1000).toISOString()
    expect(ageHours(created)! < KYC_SLA_HOURS).toBe(true)
  })

  it("tepat di batas 48 jam → dianggap lewat (>=)", () => {
    const created = new Date(Date.now() - KYC_SLA_HOURS * 3600 * 1000 - 1000).toISOString()
    expect(ageHours(created)! >= KYC_SLA_HOURS).toBe(true)
  })

  it("input tanggal invalid → umur null (tidak crash badge)", () => {
    expect(ageHours("bukan-tanggal")).toBeNull()
    expect(ageHours(null)).toBeNull()
  })
})

describe("aksi moderasi tunggal", () => {
  it("approve: POST …/approve dengan notes opsional", async () => {
    await approveKyc("k-1", "Dokumen valid")
    expect(adminHttpMock.post).toHaveBeenCalledWith("/v1/admin/kyc/k-1/approve", {
      notes: "Dokumen valid",
    })
  })

  it("reject: POST …/reject dengan reason wajib", async () => {
    await rejectKyc("k-1", "KTP buram", "minta foto ulang")
    expect(adminHttpMock.post).toHaveBeenCalledWith("/v1/admin/kyc/k-1/reject", {
      reason: "KTP buram",
      notes: "minta foto ulang",
    })
  })

  it("revoke: POST …/revoke dengan reason opsional", async () => {
    await revokeKyc("k-1")
    expect(adminHttpMock.post).toHaveBeenCalledWith("/v1/admin/kyc/k-1/revoke", {
      reason: undefined,
    })
  })

  it("document-urls: butuh password admin (re-autentikasi)", async () => {
    await getKycDocumentUrls("k-1", "s3cr3t")
    expect(adminHttpMock.post).toHaveBeenCalledWith("/v1/admin/kyc/k-1/document-urls", {
      password: "s3cr3t",
    })
  })
})

describe("bulk KYC — kontrak payload (G505)", () => {
  it("bulk approve mengirim { kycIds } (bukan { ids })", async () => {
    await bulkApproveKyc(["k-1", "k-2"])
    expect(adminHttpMock.post).toHaveBeenCalledWith("/v1/admin/kyc/bulk/approve", {
      kycIds: ["k-1", "k-2"],
    })
  })

  it("bulk reject mengirim { kycIds, reason }", async () => {
    await bulkRejectKyc(["k-1"], "Dokumen tidak valid, minimal 10 karakter.")
    expect(adminHttpMock.post).toHaveBeenCalledWith("/v1/admin/kyc/bulk/reject", {
      kycIds: ["k-1"],
      reason: "Dokumen tidak valid, minimal 10 karakter.",
    })
  })
})

describe("bulk KYC — sukses parsial + konflik status (G505)", () => {
  it("sukses parsial: respons backend memisahkan approved vs failed", async () => {
    // Simulasi backend: 2 lolos, 1 gagal (status berubah saat diproses).
    adminHttpMock.post.mockResolvedValue({
      approved: ["k-1", "k-2"],
      failed: [{ id: "k-3", reason: "Status saat ini APPROVED, bukan PENDING" }],
    })
    const res = (await bulkApproveKyc(["k-1", "k-2", "k-3"])) as {
      approved: string[]
      failed: Array<{ id: string; reason: string }>
    }
    expect(res.approved).toEqual(["k-1", "k-2"])
    expect(res.failed).toHaveLength(1)
    expect(res.failed[0].id).toBe("k-3")
  })

  it("semua gagal → daftar failed lengkap, tidak ada yang approved", async () => {
    adminHttpMock.post.mockResolvedValue({
      approved: [],
      failed: [
        { id: "k-1", reason: "Status saat ini REJECTED, bukan PENDING" },
        { id: "k-2", reason: "Status saat ini REJECTED, bukan PENDING" },
      ],
    })
    const res = (await bulkApproveKyc(["k-1", "k-2"])) as {
      approved: string[]
      failed: Array<{ id: string; reason: string }>
    }
    expect(res.approved).toEqual([])
    expect(res.failed).toHaveLength(2)
  })

  it("konflik status per item tidak menggagalkan batch lain (reject)", async () => {
    adminHttpMock.post.mockResolvedValue({
      rejected: ["k-1"],
      failed: [{ id: "k-2", reason: "expectedStatus PENDING tidak terpenuhi" }],
    })
    const res = (await bulkRejectKyc(["k-1", "k-2"], "Dokumen kedaluwarsa.")) as {
      rejected: string[]
      failed: Array<{ id: string; reason: string }>
    }
    expect(res.rejected).toEqual(["k-1"])
    expect(res.failed[0].reason).toMatch(/expectedStatus/i)
  })
})
