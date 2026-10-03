/**
 * F4 — Test API client karier + peta transisi status (§2 spec karir).
 *
 * Kontrak backend (`AdminCareersController`, /v1/admin/careers):
 * - GET    /v1/admin/careers/postings?page=&limit=&active=   → { items, total }
 * - POST   /v1/admin/careers/postings                        → posting
 * - PATCH  /v1/admin/careers/postings/:id                   → posting (termasuk toggle isActive)
 * - DELETE /v1/admin/careers/postings/:id                   → 409 DELETE_BLOCKED_HAS_APPLICATIONS bila ada pelamar
 * - GET    /v1/admin/careers/applications?postingId=&status=&q=&page=&limit= → { items, total }
 * - GET    /v1/admin/careers/applications/:id               → detail + cvDownloadUrl + history[]
 * - PATCH  /v1/admin/careers/applications/:id/status         { status, note? }
 * - DELETE /v1/admin/careers/applications/:id
 *
 * Transisi yang diizinkan (§2 spec):
 *   BARU → DIREVIEW | DITOLAK; DIREVIEW → WAWANCARA | DITOLAK;
 *   WAWANCARA → DITERIMA | DITOLAK; terminal (DITERIMA/DITOLAK) → DIREVIEW (reopen + catatan).
 */
import "../mocks/admin-http"

import { beforeEach, describe, expect, it } from "vitest"

import {
  APPLICATION_STATUS_TRANSITIONS,
  createPosting,
  deleteApplication,
  deletePosting,
  getApplication,
  isReopenTransition,
  listApplications,
  listPostings,
  updateApplicationStatus,
  updatePosting,
  type JobApplicationStatus,
  type JobPostingInput,
} from "@/lib/api/admin/karier"
import { adminHttpMock, resetAdminHttpMock } from "../mocks/admin-http"

const INPUT: JobPostingInput = {
  title: "Co-Founder / COO",
  location: "Remote",
  type: "Penuh waktu",
  equity: "15% saham",
  summary: "Memimpin operasional Kahade.",
  description: "Tanggung jawab…",
  requirements: ["Berpengalaman 3+ tahun"],
  isActive: true,
  sortOrder: 0,
}

beforeEach(() => {
  resetAdminHttpMock()
})

describe("karier — lowongan", () => {
  it("listPostings memanggil endpoint dengan query page/limit/active", async () => {
    await listPostings({ page: 2, limit: 20, active: true })
    expect(adminHttpMock.get).toHaveBeenCalledWith("/v1/admin/careers/postings", {
      query: { page: 2, limit: 20, active: true },
    })
  })

  it("createPosting POST ke /v1/admin/careers/postings", async () => {
    await createPosting(INPUT)
    expect(adminHttpMock.post).toHaveBeenCalledWith("/v1/admin/careers/postings", INPUT)
  })

  it("updatePosting PATCH ke /v1/admin/careers/postings/:id (dipakai toggle aktif)", async () => {
    await updatePosting("p-1", { isActive: false })
    expect(adminHttpMock.patch).toHaveBeenCalledWith(
      "/v1/admin/careers/postings/p-1",
      { isActive: false },
    )
  })

  it("deletePosting DELETE ke /v1/admin/careers/postings/:id", async () => {
    await deletePosting("p-1")
    expect(adminHttpMock.delete).toHaveBeenCalledWith("/v1/admin/careers/postings/p-1")
  })
})

describe("karier — pelamar", () => {
  it("listApplications memanggil endpoint dengan filter lengkap", async () => {
    await listApplications({ postingId: "p-1", status: "BARU", q: "budi", page: 1, limit: 20 })
    expect(adminHttpMock.get).toHaveBeenCalledWith("/v1/admin/careers/applications", {
      query: { page: 1, limit: 20, postingId: "p-1", status: "BARU", q: "budi" },
    })
  })

  it("listApplications mengabaikan filter kosong", async () => {
    await listApplications({ status: "" })
    expect(adminHttpMock.get).toHaveBeenCalledWith("/v1/admin/careers/applications", {
      query: { page: undefined, limit: undefined },
    })
  })

  it("getApplication GET detail by id", async () => {
    await getApplication("a-1")
    expect(adminHttpMock.get).toHaveBeenCalledWith("/v1/admin/careers/applications/a-1")
  })

  it("updateApplicationStatus PATCH status + note", async () => {
    await updateApplicationStatus("a-1", { status: "DIREVIEW", note: "CV bagus" })
    expect(adminHttpMock.patch).toHaveBeenCalledWith(
      "/v1/admin/careers/applications/a-1/status",
      { status: "DIREVIEW", note: "CV bagus" },
    )
  })

  it("deleteApplication DELETE by id", async () => {
    await deleteApplication("a-1")
    expect(adminHttpMock.delete).toHaveBeenCalledWith("/v1/admin/careers/applications/a-1")
  })
})

describe("karier — peta transisi status", () => {
  const ALL: JobApplicationStatus[] = ["BARU", "DIREVIEW", "WAWANCARA", "DITERIMA", "DITOLAK"]

  it("setiap status punya daftar transisi yang didefinisikan", () => {
    for (const s of ALL) {
      expect(APPLICATION_STATUS_TRANSITIONS[s], s).toBeDefined()
    }
  })

  it("alur maju sesuai pipeline spec", () => {
    expect(APPLICATION_STATUS_TRANSITIONS.BARU).toEqual(["DIREVIEW", "DITOLAK"])
    expect(APPLICATION_STATUS_TRANSITIONS.DIREVIEW).toEqual(["WAWANCARA", "DITOLAK"])
    expect(APPLICATION_STATUS_TRANSITIONS.WAWANCARA).toEqual(["DITERIMA", "DITOLAK"])
  })

  it("status terminal hanya bisa dibuka ulang ke DIREVIEW", () => {
    expect(APPLICATION_STATUS_TRANSITIONS.DITERIMA).toEqual(["DIREVIEW"])
    expect(APPLICATION_STATUS_TRANSITIONS.DITOLAK).toEqual(["DIREVIEW"])
    for (const s of ["DITERIMA", "DITOLAK"] as const) {
      expect(isReopenTransition(s, "DIREVIEW")).toBe(true)
    }
    expect(isReopenTransition("BARU", "DIREVIEW")).toBe(false)
  })

  it("transisi tidak pernah melompat mundur selain reopen", () => {
    // BARU tidak bisa langsung ke WAWANCARA/DITERIMA; DIREVIEW tidak bisa ke BARU.
    expect(APPLICATION_STATUS_TRANSITIONS.BARU).not.toContain("WAWANCARA")
    expect(APPLICATION_STATUS_TRANSITIONS.DIREVIEW).not.toContain("BARU")
  })
})
