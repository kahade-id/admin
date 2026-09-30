/**
 * Domain 4 (User & KYC) — kontrak API client baru:
 * - BAI-071: PATCH /v1/admin/users/:userId (updateUser, whitelist accountType)
 * - BAI-074: POST :userId/suspend + POST :userId/unsuspend
 */
import "../mocks/admin-http"

import { beforeEach, describe, expect, it } from "vitest"

import {
  suspendUser,
  unsuspendUser,
  updateUser,
} from "@/lib/api/admin/users"
import { adminHttpMock, resetAdminHttpMock } from "../mocks/admin-http"

beforeEach(() => {
  resetAdminHttpMock()
})

describe("BAI-071 — updateUser (PATCH :userId)", () => {
  it("PATCH ke /v1/admin/users/:id dengan { accountType }", async () => {
    await updateUser("u-1", { accountType: "BUSINESS" })
    expect(adminHttpMock.patch).toHaveBeenCalledWith("/v1/admin/users/u-1", {
      accountType: "BUSINESS",
    })
  })

  it("meng-encode userId di path", async () => {
    await updateUser("u/1", { accountType: "PERSONAL" })
    expect(adminHttpMock.patch).toHaveBeenCalledWith(
      "/v1/admin/users/u%2F1",
      expect.anything(),
    )
  })
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
