/**
 * Domain 4 (User & KYC) — kontrak API client:
 * - BAI-074: POST :userId/suspend + POST :userId/unsuspend
 * (BAI-071 updateUser/PATCH accountType DIHAPUS — flip manual tipe akun
 * dicabut; tipe akun hanya berubah via verifikasi bisnis yang disetujui.)
 */
import "../mocks/admin-http"

import { beforeEach, describe, expect, it } from "vitest"

import {
  suspendUser,
  unsuspendUser,
} from "@/lib/api/admin/users"
import { adminHttpMock, resetAdminHttpMock } from "../mocks/admin-http"

beforeEach(() => {
  resetAdminHttpMock()
})

describe("BAI-074 — suspend/unsuspend", () => {
  it("suspend: POST …/suspend dengan { reason, durationHours }", async () => {
    await suspendUser("u-1", { reason: "Investigasi dugaan penipuan", durationHours: 24 })
    expect(adminHttpMock.post).toHaveBeenCalledWith("/v1/admin/users/u-1/suspend", {
      reason: "Investigasi dugaan penipuan",
      durationHours: 24,
    })
  })

  it("unsuspend: POST …/unsuspend", async () => {
    await unsuspendUser("u-1")
    expect(adminHttpMock.post).toHaveBeenCalledWith("/v1/admin/users/u-1/unsuspend", {})
  })
})
