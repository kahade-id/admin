/**
 * G506 — Test finance: detail transaksi, rekonsiliasi, idempotency.
 *
 * Kontrak backend (`backend/src/modules/admin/finance/`):
 * - GET  /v1/admin/finance/transactions?{page,limit,type,status,startDate,endDate}
 *        (startDate & endDate WAJIB — default 30 hari terakhir, maks 90 hari;
 *        pencarian `q` hanya client-side terhadap halaman yang diambil)
 * - GET  /v1/admin/finance/transactions/:txId
 * - GET  /v1/admin/finance/withdrawals/pending
 * - POST /v1/admin/finance/withdrawals/:txId/approve  { adminNote? }
 *        + header Idempotency-Key WAJIB
 * - POST /v1/admin/finance/withdrawals/:txId/reject   { adminNote }
 *        + header Idempotency-Key WAJIB
 * - GET  /v1/admin/finance/audit-trail/:userId?{from,to}
 * - POST /v1/admin/finance/reconcile/user/:userId
 */
import "../mocks/admin-http"

import { beforeEach, describe, expect, it } from "vitest"

import {
  approveWithdrawal,
  getAuditTrail,
  getTransactionDetail,
  listPendingWithdrawals,
  listTransactions,
  newIdempotencyKey,
  reconcileUser,
  rejectWithdrawal,
  type AdminTransactionItem,
} from "@/lib/api/admin/finance"
import { adminHttpMock, emptyPage, resetAdminHttpMock } from "../mocks/admin-http"

function tx(overrides: Partial<AdminTransactionItem> = {}): AdminTransactionItem {
  return {
    id: "tx-1",
    txId: "TX-2026-0001",
    type: "TOP_UP",
    status: "SUCCESS",
    amount: 150000,
    createdAt: "2026-09-20T10:00:00.000Z",
    wallet: { userId: "u-1", user: { userId: "u-1", fullName: "Budi", email: "budi@x.id" } },
    ...overrides,
  }
}

beforeEach(() => {
  resetAdminHttpMock()
})

describe("listTransactions", () => {
  it("mengirim startDate/endDate default (30 hari terakhir) bila tak diisi", async () => {
    await listTransactions({ page: 1, limit: 20 })
    const [, opts] = adminHttpMock.get.mock.calls[0] as [
      string,
      { query: Record<string, unknown> },
    ]
    expect(adminHttpMock.get.mock.calls[0][0]).toBe("/v1/admin/finance/transactions")
    const { startDate, endDate } = opts.query as { startDate: string; endDate: string }
    const days = (new Date(endDate).getTime() - new Date(startDate).getTime()) / 86400000
    expect(days).toBeGreaterThan(29)
    expect(days).toBeLessThan(31)
  })

  it("meneruskan filter type/status eksplisit", async () => {
    await listTransactions({ type: "WITHDRAW", status: "PENDING" })
    const [, opts] = adminHttpMock.get.mock.calls[0] as [
      string,
      { query: Record<string, unknown> },
    ]
    expect(opts.query.type).toBe("WITHDRAW")
    expect(opts.query.status).toBe("PENDING")
  })

  it("q diteruskan server-side sebagai query param (bukan filter client)", async () => {
    // REVISI QA 2026-09-26: backend menambah pencarian server-side
    // (txId, deskripsi, orderId, midtransOrderId, flashTransactionId,
    //  irisPayoutId, irisRef) — modul tidak lagi memfilter client-side.
    adminHttpMock.get.mockResolvedValue(
      emptyPage<AdminTransactionItem>({
        data: [tx(), tx({ id: "tx-2", txId: "TX-2026-0002" })],
        total: 2,
      }),
    )
    const res = await listTransactions({ q: "sari" })
    const [, opts] = adminHttpMock.get.mock.calls[0] as [
      string,
      { query: Record<string, unknown> },
    ]
    expect(opts.query.q).toBe("sari")
    // Respons server dikembalikan apa adanya.
    expect(res.data).toHaveLength(2)
    expect(res.total).toBe(2)
  })
})

describe("detail transaksi & antrean withdrawal", () => {
  it("getTransactionDetail: GET /v1/admin/finance/transactions/:txId", async () => {
    adminHttpMock.get.mockResolvedValue(tx({ txId: "TX-9" }))
    const res = await getTransactionDetail("TX-9")
    expect(adminHttpMock.get).toHaveBeenCalledWith("/v1/admin/finance/transactions/TX-9")
    expect(res.amount).toBe(150000)
  })

  it("listPendingWithdrawals: GET /v1/admin/finance/withdrawals/pending", async () => {
    await listPendingWithdrawals({ page: 1 })
    expect(adminHttpMock.get).toHaveBeenCalledWith(
      "/v1/admin/finance/withdrawals/pending",
      { query: { page: 1 } },
    )
  })
})

describe("aksi withdrawal — idempotency", () => {
  const UUID_V4 =
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

  it("newIdempotencyKey menghasilkan UUID v4 unik", () => {
    const a = newIdempotencyKey()
    const b = newIdempotencyKey()
    expect(a).toMatch(UUID_V4)
    expect(b).toMatch(UUID_V4)
    expect(a).not.toBe(b)
  })

  it("approveWithdrawal mengirim header Idempotency-Key", async () => {
    await approveWithdrawal("tx-1", "OK")
    const [path, body, opts] = adminHttpMock.post.mock.calls[0] as [
      string,
      Record<string, unknown>,
      { headers: Record<string, string> },
    ]
    expect(path).toBe("/v1/admin/finance/withdrawals/tx-1/approve")
    expect(body).toEqual({ adminNote: "OK" })
    expect(opts.headers["Idempotency-Key"]).toMatch(UUID_V4)
  })

  it("approveWithdrawal memakai kunci yang diberikan saat retry", async () => {
    await approveWithdrawal("tx-1", undefined, "kunci-tetap-123")
    const [, , opts] = adminHttpMock.post.mock.calls[0] as [
      string,
      unknown,
      { headers: Record<string, string> },
    ]
    expect(opts.headers["Idempotency-Key"]).toBe("kunci-tetap-123")
  })

  it("rejectWithdrawal mengirim reason sebagai adminNote + idempotency", async () => {
    await rejectWithdrawal("tx-1", "Rekening tidak valid, mohon perbarui.")
    const [path, body, opts] = adminHttpMock.post.mock.calls[0] as [
      string,
      Record<string, unknown>,
      { headers: Record<string, string> },
    ]
    expect(path).toBe("/v1/admin/finance/withdrawals/tx-1/reject")
    expect(body).toEqual({ adminNote: "Rekening tidak valid, mohon perbarui." })
    expect(opts.headers["Idempotency-Key"]).toMatch(UUID_V4)
  })
})

describe("audit trail & rekonsiliasi", () => {
  it("getAuditTrail: GET dengan query from/to", async () => {
    adminHttpMock.get.mockResolvedValue({
      userId: "u-1",
      from: "2026-08-01",
      to: "2026-09-01",
      openingTotalBalance: 0,
      closingTotalBalance: 100000,
      transactions: [],
    })
    await getAuditTrail("u-1", { from: "2026-08-01", to: "2026-09-01" })
    expect(adminHttpMock.get).toHaveBeenCalledWith("/v1/admin/finance/audit-trail/u-1", {
      query: { from: "2026-08-01", to: "2026-09-01" },
    })
  })

  it("reconcileUser: POST /v1/admin/finance/reconcile/user/:userId", async () => {
    adminHttpMock.post.mockResolvedValue({
      userId: "u-1",
      reconciledAt: new Date().toISOString(),
      clean: true,
    })
    const res = await reconcileUser("u-1")
    expect(adminHttpMock.post).toHaveBeenCalledWith(
      "/v1/admin/finance/reconcile/user/u-1",
      {},
    )
    expect(res.clean).toBe(true)
  })

  it("rekonsiliasi kotor: discrepancy dilaporkan, bukan dilempar", async () => {
    adminHttpMock.post.mockResolvedValue({
      userId: "u-1",
      reconciledAt: new Date().toISOString(),
      clean: false,
      discrepancy: {
        walletId: "w-1",
        userId: "u-1",
        actualAvailable: 90000,
        actualEscrow: 0,
        actualTotal: 90000,
        expectedTotal: 100000,
        discrepancy: -10000,
        invariantViolation: true,
      },
    })
    const res = await reconcileUser("u-1")
    expect(res.clean).toBe(false)
    expect(res.discrepancy?.discrepancy).toBe(-10000)
  })
})
