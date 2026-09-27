/**
 * G503 — Integration test alur tiket (mock API layer).
 *
 * Alur: list → detail → ubah status → balas. Memastikan setiap langkah
 * memanggil endpoint/metode/payload yang benar sesuai kontrak backend
 * (`backend/src/modules/admin/support/`):
 * - GET    /v1/admin/support/tickets?{page,limit,status,priority}
 * - GET    /v1/admin/support/tickets/:id
 * - PATCH  /v1/admin/support/tickets/:id/status   { status }
 * - POST   /v1/admin/support/tickets/:id/reply    { message }
 */
import "../mocks/admin-http"

import { beforeEach, describe, expect, it } from "vitest"

import {
  getTicketDetail,
  listTickets,
  replyToTicket,
  updateTicketStatus,
  type SupportTicket,
} from "@/lib/api/admin/support"
import { adminHttpMock, emptyPage, resetAdminHttpMock } from "../mocks/admin-http"

const TICKET: SupportTicket = {
  id: "t-1",
  userId: "u-1",
  subject: "Dana belum cair",
  message: "Pesanan sudah dikonfirmasi tapi saldo belum masuk.",
  status: "OPEN",
  createdAt: "2026-09-20T10:00:00.000Z",
}

beforeEach(() => {
  resetAdminHttpMock()
})

describe("alur tiket (list → detail → status → balas)", () => {
  it("list: GET /v1/admin/support/tickets dengan filter status + paginasi", async () => {
    adminHttpMock.get.mockResolvedValue(emptyPage<SupportTicket>({ data: [TICKET], total: 1 }))
    const res = await listTickets({ page: 2, limit: 20, status: "OPEN" })

    expect(adminHttpMock.get).toHaveBeenCalledWith("/v1/admin/support/tickets", {
      query: { page: 2, limit: 20, status: "OPEN" },
    })
    expect(res.data).toHaveLength(1)
    expect(res.total).toBe(1)
  })

  it("list: antrean prioritas mengirim flag priority", async () => {
    await listTickets({ priority: true })
    expect(adminHttpMock.get).toHaveBeenCalledWith("/v1/admin/support/tickets", {
      query: { priority: true },
    })
  })

  it("detail: GET /v1/admin/support/tickets/:id (id di-encode)", async () => {
    adminHttpMock.get.mockResolvedValue({ ...TICKET, replies: [] })
    const res = await getTicketDetail("t-1")

    expect(adminHttpMock.get).toHaveBeenCalledWith("/v1/admin/support/tickets/t-1")
    expect(res.subject).toBe("Dana belum cair")
  })

  it("detail: id dengan karakter khusus di-encode aman", async () => {
    await getTicketDetail("tiket/aneh?id=1")
    expect(adminHttpMock.get).toHaveBeenCalledWith(
      "/v1/admin/support/tickets/tiket%2Faneh%3Fid%3D1",
    )
  })

  it("ubah status: PATCH …/status dengan body { status }", async () => {
    await updateTicketStatus("t-1", "IN_PROGRESS")
    expect(adminHttpMock.patch).toHaveBeenCalledWith(
      "/v1/admin/support/tickets/t-1/status",
      { status: "IN_PROGRESS" },
    )
  })

  it("balas: POST …/reply dengan body { message }", async () => {
    await replyToTicket("t-1", "Dana sudah dicairkan, silakan cek wallet.")
    expect(adminHttpMock.post).toHaveBeenCalledWith("/v1/admin/support/tickets/t-1/reply", {
      message: "Dana sudah dicairkan, silakan cek wallet.",
    })
  })

  it("alur penuh berurutan: list → detail → status → balas", async () => {
    adminHttpMock.get
      .mockResolvedValueOnce(emptyPage<SupportTicket>({ data: [TICKET] }))
      .mockResolvedValueOnce(TICKET)

    const list = await listTickets({ status: "OPEN" })
    const detail = await getTicketDetail(list.data[0].id)
    await updateTicketStatus(detail.id, "IN_PROGRESS")
    await replyToTicket(detail.id, "Kami tindak lanjuti.")

    const calls = [
      adminHttpMock.get.mock.calls[0][0],
      adminHttpMock.get.mock.calls[1][0],
      adminHttpMock.patch.mock.calls[0][0],
      adminHttpMock.post.mock.calls[0][0],
    ]
    expect(calls).toEqual([
      "/v1/admin/support/tickets",
      "/v1/admin/support/tickets/t-1",
      "/v1/admin/support/tickets/t-1/status",
      "/v1/admin/support/tickets/t-1/reply",
    ])
  })

  it("error API diteruskan ke pemanggil (tidak ditelan)", async () => {
    adminHttpMock.get.mockRejectedValue(new Error("jaringan putus"))
    await expect(listTickets()).rejects.toThrow("jaringan putus")
  })
})
