/**
 * G502 — Unit test RBAC murni (`src/lib/rbac.ts`).
 *
 * Memastikan matriks izin sesuai kontrak yang didokumentasikan di rbac.ts
 * (diselaraskan dengan `@AdminRoles` backend per controller, batch 6):
 * - SUPER_ADMIN: semua route
 * - KYC_ADMIN: /kyc, /business — bukan /finance, /disputes, /campaigns
 * - FINANCE_ADMIN: /finance, /vouchers, /referral, /subscriptions, /analytics,
 *   /insurance-claims — bukan /kyc, /tickets
 * - DISPUTE_ADMIN: /disputes, /orders, /chat — bukan /users, /finance
 * - CUSTOMER_SUPPORT: /users, /tickets, /reports, /reports/showcase, /chat,
 *   /ratings, /insurance-claims — bukan /finance, /campaigns, /system, /team
 * - role null/undefined: tidak ada akses
 */
import { describe, expect, it } from "vitest"

import { canAccess, menuForRole, MENU, roleLabel, type AdminRole } from "@/lib/rbac"

const ALL_ROLES: AdminRole[] = [
  "SUPER_ADMIN",
  "DISPUTE_ADMIN",
  "KYC_ADMIN",
  "FINANCE_ADMIN",
  "CUSTOMER_SUPPORT",
]

describe("menuForRole", () => {
  it("SUPER_ADMIN melihat seluruh menu", () => {
    expect(menuForRole("SUPER_ADMIN")).toHaveLength(MENU.length)
  })

  it("role null/undefined tidak melihat menu apa pun", () => {
    expect(menuForRole(null)).toEqual([])
    expect(menuForRole(undefined)).toEqual([])
  })

  it("KYC_ADMIN hanya melihat Antrean KYC + Verifikasi Bisnis", () => {
    const hrefs = menuForRole("KYC_ADMIN").map((m) => m.href)
    expect(hrefs).toEqual(expect.arrayContaining(["/kyc", "/business"]))
    expect(hrefs).not.toContain("/finance")
    expect(hrefs).not.toContain("/disputes")
    expect(hrefs).not.toContain("/campaigns")
  })

  it("FINANCE_ADMIN melihat menu keuangan, bukan KYC/tiket", () => {
    const hrefs = menuForRole("FINANCE_ADMIN").map((m) => m.href)
    expect(hrefs).toEqual(
      expect.arrayContaining([
        "/finance",
        "/vouchers",
        "/referral",
        "/subscriptions",
        "/analytics",
        "/insurance-claims",
      ]),
    )
    expect(hrefs).not.toContain("/kyc")
    expect(hrefs).not.toContain("/tickets")
    expect(hrefs).not.toContain("/disputes")
  })

  it("DISPUTE_ADMIN melihat Sengketa/Pesanan/Chat, bukan Pengguna/Keuangan", () => {
    const hrefs = menuForRole("DISPUTE_ADMIN").map((m) => m.href)
    expect(hrefs).toEqual(expect.arrayContaining(["/disputes", "/orders", "/chat"]))
    expect(hrefs).not.toContain("/users")
    expect(hrefs).not.toContain("/finance")
    expect(hrefs).not.toContain("/kyc")
  })

  it("CUSTOMER_SUPPORT melihat tiket/laporan/ulasan, bukan area sensitif", () => {
    const hrefs = menuForRole("CUSTOMER_SUPPORT").map((m) => m.href)
    expect(hrefs).toEqual(
      expect.arrayContaining([
        "/users",
        "/tickets",
        "/reports",
        "/reports/showcase",
        "/chat",
        "/ratings",
        "/insurance-claims",
      ]),
    )
    expect(hrefs).not.toContain("/finance")
    expect(hrefs).not.toContain("/campaigns")
    expect(hrefs).not.toContain("/system")
    expect(hrefs).not.toContain("/team")
    expect(hrefs).not.toContain("/")
  })
})

describe("canAccess", () => {
  it("SUPER_ADMIN boleh mengakses semua route menu", () => {
    for (const item of MENU) {
      expect(canAccess("SUPER_ADMIN", item.href)).toBe(true)
    }
  })

  it("menolak role null/undefined dan route tak dikenal", () => {
    expect(canAccess(null, "/kyc")).toBe(false)
    expect(canAccess(undefined, "/kyc")).toBe(false)
    expect(canAccess("KYC_ADMIN", "/route-tidak-ada")).toBe(false)
  })

  it("matriks izin per role sesuai kontrak backend", () => {
    const cases: Array<[AdminRole, string, boolean]> = [
      ["KYC_ADMIN", "/kyc", true],
      ["KYC_ADMIN", "/business", true],
      ["KYC_ADMIN", "/finance", false],
      ["KYC_ADMIN", "/tickets", false],
      ["FINANCE_ADMIN", "/finance", true],
      ["FINANCE_ADMIN", "/vouchers", true],
      ["FINANCE_ADMIN", "/campaigns", false],
      ["FINANCE_ADMIN", "/kyc", false],
      ["DISPUTE_ADMIN", "/disputes", true],
      ["DISPUTE_ADMIN", "/orders", true],
      ["DISPUTE_ADMIN", "/chat", true],
      ["DISPUTE_ADMIN", "/users", false],
      ["DISPUTE_ADMIN", "/finance", false],
      ["CUSTOMER_SUPPORT", "/tickets", true],
      ["CUSTOMER_SUPPORT", "/reports/showcase", true],
      ["CUSTOMER_SUPPORT", "/insurance-claims", true],
      ["CUSTOMER_SUPPORT", "/badges", false],
      ["CUSTOMER_SUPPORT", "/system", false],
    ]
    for (const [role, href, expected] of cases) {
      expect(canAccess(role, href), `${role} → ${href}`).toBe(expected)
    }
  })

  it("menu dan canAccess konsisten: menuForRole(role) ⟺ canAccess(role, href)", () => {
    for (const role of ALL_ROLES) {
      const menuHrefs = new Set(menuForRole(role).map((m) => m.href))
      for (const item of MENU) {
        expect(canAccess(role, item.href), `${role} ${item.href}`).toBe(
          menuHrefs.has(item.href),
        )
      }
    }
  })
})

describe("roleLabel", () => {
  it("menerjemahkan semua role ke Bahasa Indonesia", () => {
    expect(roleLabel("SUPER_ADMIN")).toBe("Super Admin")
    expect(roleLabel("DISPUTE_ADMIN")).toBe("Admin Sengketa")
    expect(roleLabel("KYC_ADMIN")).toBe("Admin KYC")
    expect(roleLabel("FINANCE_ADMIN")).toBe("Admin Keuangan")
    expect(roleLabel("CUSTOMER_SUPPORT")).toBe("Customer Support")
  })

  it("mengembalikan input apa adanya untuk role tak dikenal", () => {
    expect(roleLabel("ROBOT")).toBe("ROBOT")
  })
})
