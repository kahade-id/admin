/**
 * G520 — Visual regression: screenshot per halaman kunci.
 *
 * Baseline: jalankan sekali di mesin referensi untuk merekam baseline:
 *   npm run test:e2e -- tests/e2e/visual.spec.ts --update-snapshots
 * Commit hasil di tests/e2e/__screenshots__/. CI kemudian membandingkan
 * setiap run (threshold di bawah).
 *
 * CATATAN: screenshot bergantung pada font/OS — baseline idealnya dibuat
 * di environment yang sama dengan CI (Linux). Jangan campur baseline
 * macOS/Windows dengan CI Linux.
 */
import { expect, test, type Page } from "@playwright/test"

const PAGES = [
  { name: "dashboard", path: "/" },
  { name: "kyc", path: "/kyc" },
  { name: "tickets", path: "/tickets" },
  { name: "finance", path: "/finance" },
  { name: "campaigns", path: "/campaigns" },
  { name: "login", path: "/login" },
] as const

async function mockApi(page: Page) {
  await page.route("**/v1/admin/**", async (route) => {
    const url = route.request().url()
    if (url.includes("/auth/me")) {
      await route.fulfill({ json: { id: "a1", email: "ops@kahade.id", role: "SUPER_ADMIN" } })
      return
    }
    await route.fulfill({ json: { data: [], total: 0, page: 1, limit: 20, totalPages: 1 } })
  })
}

test.describe("visual regression (G520)", () => {
  for (const { name, path } of PAGES) {
    test(`screenshot ${name}`, async ({ page }) => {
      await mockApi(page)
      await page.goto(path)
      // Tunggu loading selesai: tidak ada spinner.
      await page.waitForLoadState("networkidle").catch(() => {})
      await expect(page).toHaveScreenshot(`${name}.png`, {
        maxDiffPixelRatio: 0.02,
        animations: "disabled",
      })
    })
  }

  test("dark mode: dashboard", async ({ page }) => {
    await mockApi(page)
    await page.emulateMedia({ colorScheme: "dark" })
    await page.goto("/")
    await page.waitForLoadState("networkidle").catch(() => {})
    await expect(page).toHaveScreenshot("dashboard-dark.png", {
      maxDiffPixelRatio: 0.02,
      animations: "disabled",
    })
  })
})
