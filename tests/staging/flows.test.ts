/**
 * G524 — Staging harness: alur realistis melawan mock provider stateful.
 *
 * Provider di-mock pada level `@/lib/api/admin-client` (seluruh fungsi API
 * admin mendelegasikan ke sana), diisi data sintetis TANPA PII. Test ini
 * memverifikasi alur baca → filter → aksi tulis → efek terlihat.
 *
 * Untuk staging backend nyata, ganti provider ini dengan baseURL staging
 * dan kredensial uji — bentuk respons yang diharapkan sama.
 */
import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/lib/api/admin-client", async () => {
  const m = await import("./mock-provider")
  return {
    adminHttp: m.stagingAdminHttp,
    AdminAuthError: class AdminAuthError extends Error {},
    getAdminAccessToken: vi.fn(() => "STAGING-TOKEN"),
    setAdminAccessToken: vi.fn(),
    clearAdminAccessToken: vi.fn(),
    ensureAdminSession: vi.fn(async () => true),
  }
})

// Impor setelah mock terdaftar.
import { approveKyc, getKycQueue, rejectKyc } from "@/lib/api/admin/kyc"
import { listTickets, replyToTicket } from "@/lib/api/admin/support"
import { resetStagingProvider, stagingAdminHttp, stagingData } from "./mock-provider"

describe("staging harness (G524)", () => {
  beforeEach(() => {
    resetStagingProvider()
  })

  it("KYC: antrean → filter PENDING → approve → status berubah", async () => {
    const q = await getKycQueue({ status: "PENDING", page: 1, limit: 20 })
    expect(q.total).toBeGreaterThan(0)
    expect(q.data.every((r) => r.status === "PENDING")).toBe(true)

    const first = q.data[0]
    await approveKyc(first.kycId, "Data valid (staging)")
    expect(stagingAdminHttp.post).toHaveBeenCalledWith(
      `/v1/admin/kyc/${encodeURIComponent(first.kycId)}/approve`,
      expect.objectContaining({ notes: "Data valid (staging)" }),
    )

    // Efek terlihat: tidak lagi PENDING.
    const q2 = await getKycQueue({ status: "PENDING", page: 1, limit: 20 })
    expect(q2.data.find((r) => r.kycId === first.kycId)).toBeUndefined()
  })

  it("KYC: approve ganda → 409 (idempotency guard)", async () => {
    const q = await getKycQueue({ status: "PENDING", page: 1, limit: 20 })
    const first = q.data[0]
    await approveKyc(first.kycId)
    await expect(approveKyc(first.kycId)).rejects.toMatchObject({ status: 409 })
  })

  it("KYC: reject → status REJECTED tercatat", async () => {
    const q = await getKycQueue({ status: "PENDING", page: 1, limit: 20 })
    const first = q.data[0]
    await rejectKyc(first.kycId, "Dokumen buram", "Perlu foto ulang")
    const row = stagingData().kyc.find((k) => k.kycId === first.kycId)
    expect(row?.status).toBe("REJECTED")
  })

  it("Tiket: list → balas → balasan tercatat", async () => {
    const list = await listTickets({ page: 1, limit: 20 })
    expect(list.total).toBeGreaterThan(0)
    const t = list.data[0]
    await replyToTicket(t.id, "Terima kasih, sedang kami proses (staging).")
    expect(stagingData().replies[t.id]).toContain(
      "Terima kasih, sedang kami proses (staging).",
    )
  })

  it("data sintetis: tidak ada PII asli", async () => {
    const q = await getKycQueue({ page: 1, limit: 50 })
    // Harness staging mengembalikan baris sintetis (SyntheticKycRow), bukan
    // KycQueueItem persis — cast agar pemeriksaan PII tetap jalan.
    for (const r of q.data as unknown as { fullName: string }[]) {
      expect(r.fullName).toMatch(/contoh|uji|fiktif|sampel|tes|dummy/i)
    }
    const list = await listTickets({ page: 1, limit: 50 })
    for (const t of list.data) {
      expect(t.requesterName ?? "").toMatch(/contoh|uji|fiktif|sampel|tes|dummy/i)
    }
  })
})
