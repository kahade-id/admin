/**
 * ADM-03/07/09 (audit etalase 2026-10-10) — kontrak moderasi komentar etalase.
 *
 * Kontrak backend (`backend/src/modules/admin/showcase-comments/`):
 * - GET   /v1/admin/showcase/comments?{status,search,page,limit}
 *         item: {id, content|null, isHidden, isDeleted, deletedAt, deleteReason,
 *                author:{...}, showcase:{id,title}}
 * - PATCH /v1/admin/showcase/comments/:id {action, reason?}
 *         + Idempotency-Key WAJIB; action=delete + X-Step-Up-Token WAJIB
 *         (aksi `showcase-comment.delete`, ditegakkan server).
 * - 404 SHOWCASE_COMMENT_NOT_FOUND = komentar tidak ada (bukan "backend lama").
 */
import "../mocks/admin-http"

import { beforeEach, describe, expect, it } from "vitest"

import {
  deleteShowcaseComment,
  listShowcaseComments,
  moderateShowcaseComment,
  setShowcaseCommentHidden,
} from "@/lib/api/admin/showcase-comments"
import { adminHttpMock, emptyPage, resetAdminHttpMock } from "../mocks/admin-http"

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: "c1",
    showcaseId: "s1",
    parentId: null,
    content: "Masih ada?",
    isHidden: false,
    hiddenReason: null,
    hiddenAt: null,
    hiddenBy: null,
    isDeleted: false,
    deletedAt: null,
    deletedBy: null,
    deleteReason: null,
    createdAt: "2026-10-10T08:00:00.000Z",
    updatedAt: "2026-10-10T08:00:00.000Z",
    author: { userId: "USR-1", username: "budi", fullName: "Budi", avatarUrl: null },
    showcase: { id: "s1", title: "Sepatu Lari Ukuran 42" },
    ...overrides,
  }
}

function http404(code?: string) {
  const e = new Error("not found") as Error & { status?: number; code?: string }
  e.status = 404
  if (code) e.code = code
  return e
}

beforeEach(() => {
  resetAdminHttpMock()
})

describe("listShowcaseComments — kontrak & normalisasi", () => {
  it("GET /v1/admin/showcase/comments dengan status + search", async () => {
    adminHttpMock.get.mockResolvedValue(emptyPage({ data: [row()] }))
    await listShowcaseComments({ status: "hidden", search: "  spam ", page: 2, limit: 20 })
    expect(adminHttpMock.get).toHaveBeenCalledWith("/v1/admin/showcase/comments", {
      query: { page: 2, limit: 20, search: "spam", status: "hidden" },
    })
  })

  it("ADM-07: judul etalase dari relasi (bukan id mentah) + itemId fallback", async () => {
    adminHttpMock.get.mockResolvedValue(emptyPage({ data: [row()] }))
    const res = await listShowcaseComments()
    expect(res.data[0].itemTitle).toBe("Sepatu Lari Ukuran 42")
    expect(res.data[0].itemId).toBe("s1")
    expect(res.data[0].authorName).toBe("Budi")
    expect(res.data[0].isDeleted).toBe(false)
  })

  it("ADM-07: baris soft-delete → isDeleted true walau backend lama hanya kirim deletedAt", async () => {
    adminHttpMock.get.mockResolvedValue(
      emptyPage({
        data: [
          row({ id: "c2", content: null, isDeleted: true, deletedAt: "2026-10-10T09:00:00.000Z", deleteReason: "Spam" }),
          row({ id: "c3", content: null, isDeleted: undefined, deletedAt: "2026-10-10T09:00:00.000Z" }),
          row({ id: "c4", showcase: null }),
        ],
      }),
    )
    const res = await listShowcaseComments()
    expect(res.data[0]).toMatchObject({ id: "c2", isDeleted: true, content: null, deleteReason: "Spam" })
    expect(res.data[1]).toMatchObject({ id: "c3", isDeleted: true })
    // Tanpa relasi showcase: judul kosong, id dari showcaseId (bukan crash).
    expect(res.data[2].itemTitle).toBeNull()
    expect(res.data[2].itemId).toBe("s1")
  })
})

describe("moderateShowcaseComment — PATCH + Idempotency-Key + step-up", () => {
  it("hide: PATCH {action, reason} + Idempotency-Key UUID v4, TANPA token step-up", async () => {
    await setShowcaseCommentHidden("c1", true, "SPAM")
    expect(adminHttpMock.patch).toHaveBeenCalledTimes(1)
    const [path, body, opts] = adminHttpMock.patch.mock.calls[0] as [string, unknown, { headers: Record<string, string> }]
    expect(path).toBe("/v1/admin/showcase/comments/c1")
    expect(body).toEqual({ action: "hide", reason: "SPAM" })
    expect(opts.headers["Idempotency-Key"]).toMatch(UUID_V4)
    expect(opts.headers["X-Step-Up-Token"]).toBeUndefined()
  })

  it("unhide: reason bebas diteruskan (trim), kunci idempotensi baru tiap panggilan", async () => {
    await setShowcaseCommentHidden("c1", false, "  salah moderasi ")
    await setShowcaseCommentHidden("c1", false, "  salah moderasi ")
    const calls = adminHttpMock.patch.mock.calls as Array<[string, { action: string; reason?: string }, { headers: Record<string, string> }]>
    expect(calls[0][1]).toEqual({ action: "unhide", reason: "salah moderasi" })
    expect(calls[0][2].headers["Idempotency-Key"]).not.toBe(calls[1][2].headers["Idempotency-Key"])
  })

  it("ADM-09: delete membawa X-Step-Up-Token (ditegakkan server untuk aksi showcase-comment.delete)", async () => {
    await deleteShowcaseComment("c1", "Kasar", "tok-123")
    const [path, body, opts] = adminHttpMock.patch.mock.calls[0] as [string, unknown, { headers: Record<string, string> }]
    expect(path).toBe("/v1/admin/showcase/comments/c1")
    expect(body).toEqual({ action: "delete", reason: "Kasar" })
    expect(opts.headers["X-Step-Up-Token"]).toBe("tok-123")
    expect(opts.headers["Idempotency-Key"]).toMatch(UUID_V4)
  })

  it("id di-encode di path", async () => {
    await moderateShowcaseComment("a/b c", "hide", "OTHER")
    expect((adminHttpMock.patch.mock.calls[0] as [string])[0]).toBe("/v1/admin/showcase/comments/a%2Fb%20c")
  })

  it("404 SHOWCASE_COMMENT_NOT_FOUND → pesan 'komentar tidak ditemukan', bukan 'backend belum mendukung'", async () => {
    adminHttpMock.patch.mockRejectedValue(http404("SHOWCASE_COMMENT_NOT_FOUND"))
    await expect(moderateShowcaseComment("c9", "hide", "SPAM")).rejects.toThrow(/Komentar tidak ditemukan/)
  })

  it("404 tanpa kode (rute belum ada) → pesan 'membutuhkan backend terbaru'", async () => {
    adminHttpMock.patch.mockRejectedValue(http404())
    await expect(moderateShowcaseComment("c9", "hide", "SPAM")).rejects.toThrow(/membutuhkan backend terbaru/)
  })

  it("error lain (403 STEP_UP_REQUIRED) diteruskan apa adanya dengan kodenya", async () => {
    const e = new Error("Step-up re-authentication required") as Error & { status?: number; code?: string }
    e.status = 403
    e.code = "STEP_UP_REQUIRED"
    adminHttpMock.patch.mockRejectedValue(e)
    await expect(deleteShowcaseComment("c1", "x", "tok")).rejects.toMatchObject({ status: 403, code: "STEP_UP_REQUIRED" })
  })
})
