/**
 * Kontrak API moderasi Story (`backend/src/modules/admin/stories/`).
 *
 * - Paginasi memakai kunci domain (`stories`, `reports`, `viewers`), bukan
 *   `data[]` — jangan dibungkus `Paginated<T>`.
 * - Mutasi destruktif mengirim `X-Step-Up-Token` bila token diberikan;
 *   hide/restore/unban tidak.
 * - DELETE story membawa body `{ reason }` (backend `AdminStoryReasonDto`).
 */
import "../mocks/admin-http"

import { beforeEach, describe, expect, it } from "vitest"

import {
  banStoryFeature,
  deleteAdminStory,
  getAdminStoryReplies,
  getAdminStoryViewers,
  hideAdminStory,
  listAdminStories,
  listStoryReports,
  restoreAdminStory,
  reviewStoryReport,
  unbanStoryFeature,
} from "@/lib/api/admin/stories"
import { adminHttpMock, resetAdminHttpMock } from "../mocks/admin-http"

beforeEach(() => {
  resetAdminHttpMock()
})

describe("kontrak API moderasi Story", () => {
  it("list: GET /v1/admin/stories dengan filter domain", async () => {
    adminHttpMock.get.mockResolvedValue({ stories: [], total: 0, page: 1, limit: 20 })
    const res = await listAdminStories({ status: "hidden", kind: "video", authorUserId: "u1" })
    expect(adminHttpMock.get).toHaveBeenCalledWith("/v1/admin/stories", {
      query: { status: "hidden", kind: "video", authorUserId: "u1" },
    })
    expect(res.stories).toEqual([])
  })

  it("laporan: GET /reports dengan status lowercase", async () => {
    adminHttpMock.get.mockResolvedValue({ reports: [], total: 0, page: 1, limit: 20 })
    await listStoryReports({ status: "open", page: 2, limit: 20 })
    expect(adminHttpMock.get).toHaveBeenCalledWith("/v1/admin/stories/reports", {
      query: { status: "open", page: 2, limit: 20 },
    })
  })

  it("review: PATCH /reports/:id + step-up header bila ada token", async () => {
    adminHttpMock.patch.mockResolvedValue({
      reportId: "r1",
      storyId: "s1",
      status: "resolved_action",
      reviewedAt: "2026-10-10T00:00:00.000Z",
    })
    await reviewStoryReport(
      "r/1",
      { action: "ban", internalNote: "spam berulang", durationDays: 30 },
      { stepUpToken: "tok" },
    )
    expect(adminHttpMock.patch).toHaveBeenCalledWith(
      "/v1/admin/stories/reports/r%2F1",
      { action: "ban", internalNote: "spam berulang", durationDays: 30 },
      { headers: { "X-Step-Up-Token": "tok" } },
    )
  })

  it("review tanpa token: tidak mengirim header step-up", async () => {
    await reviewStoryReport("r1", { action: "dismiss", internalNote: "tidak melanggar" })
    expect(adminHttpMock.patch).toHaveBeenCalledWith(
      "/v1/admin/stories/reports/r1",
      { action: "dismiss", internalNote: "tidak melanggar" },
      {},
    )
  })

  it("hapus: DELETE /:id dengan body { reason } + step-up", async () => {
    adminHttpMock.delete.mockResolvedValue({ deleted: true })
    await deleteAdminStory("s1", { reason: "konten dilarang" }, { stepUpToken: "tok" })
    expect(adminHttpMock.delete).toHaveBeenCalledWith("/v1/admin/stories/s1", {
      body: { reason: "konten dilarang" },
      headers: { "X-Step-Up-Token": "tok" },
    })
  })

  it("sembunyikan & pulihkan: POST /:id/hide dan /:id/restore", async () => {
    await hideAdminStory("s1", { reason: "tinjau", durationDays: 3 })
    expect(adminHttpMock.post).toHaveBeenCalledWith(
      "/v1/admin/stories/s1/hide",
      { reason: "tinjau", durationDays: 3 },
    )
    await restoreAdminStory("s1")
    expect(adminHttpMock.post).toHaveBeenCalledWith("/v1/admin/stories/s1/restore", {})
  })

  it("ban fitur: POST /users/:userId/ban (permanen tanpa durationDays) & DELETE cabut", async () => {
    await banStoryFeature("USR1", { reason: "pelanggaran berat" }, { stepUpToken: "tok" })
    expect(adminHttpMock.post).toHaveBeenCalledWith(
      "/v1/admin/stories/users/USR1/ban",
      { reason: "pelanggaran berat" },
      { headers: { "X-Step-Up-Token": "tok" } },
    )
    await unbanStoryFeature("USR1")
    expect(adminHttpMock.delete).toHaveBeenCalledWith("/v1/admin/stories/users/USR1/ban")
  })

  it("viewer & balasan: GET /:id/viewers?page,limit dan /:id/replies", async () => {
    adminHttpMock.get.mockResolvedValue({ viewers: [], total: 0, page: 1, limit: 30 })
    await getAdminStoryViewers("s1", { page: 1, limit: 30 })
    expect(adminHttpMock.get).toHaveBeenCalledWith("/v1/admin/stories/s1/viewers", {
      query: { page: 1, limit: 30 },
    })
    adminHttpMock.get.mockResolvedValue({ rooms: [] })
    await getAdminStoryReplies("s1")
    expect(adminHttpMock.get).toHaveBeenCalledWith("/v1/admin/stories/s1/replies")
  })
})
