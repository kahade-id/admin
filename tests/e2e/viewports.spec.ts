/**
 * G521 — Viewport: dashboard di laptop / tablet / ponsel.
 *
 * Memastikan layout tidak rusak di tiga kelas viewport:
 *  - laptop 1440×900: sidebar penuh terlihat
 *  - tablet 768×1024: konten tetap terbaca, tidak ada overlap
 *  - ponsel 390×844: tidak ada scroll horizontal halaman
 *
 * Backend di-mock; yang diuji adalah CSS/layout responsif.
 */
import { expect, test, type Page } from "@playwright/test"

const VIEWPORTS = [
  { name: "laptop", width: 1440, height: 900 },
  { name: "tablet", width: 768, height: 1024 },
  { name: "phone", width: 390, height: 844 },
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

test.describe("viewport dashboard (G521)", () => {
  for (const vp of VIEWPORTS) {
    test(`dashboard @ ${vp.name} (${vp.width}×${vp.height})`, async ({ page }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height })
      await mockApi(page)
      await page.goto("/")
      await page.waitForLoadState("networkidle").catch(() => {})

      // Heading dashboard tampil.
      await expect(page.getByRole("heading", { name: /Dasbor|Dashboard/i }).first()).toBeVisible()

      // Tidak ada scroll horizontal pada <body> (WCAG 1.4.10).
      const scrollW = await page.evaluate(() => document.documentElement.scrollWidth)
      expect(scrollW, `scrollWidth ${vp.name}`).toBeLessThanOrEqual(vp.width + 1)

      // Tabel (bila ada) tetap bisa diakses via scroll region-nya sendiri.
      const regions = page.getByRole("region")
      if ((await regions.count()) > 0) {
        await expect(regions.first()).toBeVisible()
      }

      await expect(page).toHaveScreenshot(`dashboard-${vp.name}.png`, {
        maxDiffPixelRatio: 0.03,
        animations: "disabled",
      })
    })
  }
})
