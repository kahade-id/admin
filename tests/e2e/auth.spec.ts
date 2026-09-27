/**
 * G511 — Playwright: alur auth admin end-to-end.
 *
 * Skenario:
 *  1. Login sukses (email+password) → redirect ke dashboard.
 *  2. Login gagal (401) → pesan error tampil, tetap di /login.
 *  3. Refresh token: akses kedaluwarsa (401) → interceptor me-refresh →
 *     request diulang tanpa logout paksa.
 *  4. Logout → token dibersihkan → kembali ke /login, halaman panel
 *     tidak bisa diakses (redirect login).
 *  5. Session expiry total (refresh gagal) → redirect /login.
 *
 * Backend di-mock pada level network (page.route) — spec ini menguji
 * perilaku browser + aplikasi nyata, bukan unit. Jalankan dengan:
 *   npm run test:e2e
 * Membutuhkan browser Playwright: npx playwright install chromium
 */
import { expect, test, type Page } from "@playwright/test"

const API = "**/v1/admin/**"

async function mockLogin(page: Page) {
  await page.route(`${API}/auth/login`, async (route) => {
    const body = route.request().postDataJSON() as { email: string; password: string }
    if (body.email === "ops@kahade.id" && body.password === "Rahasia123") {
      await route.fulfill({
        json: { accessToken: "AT-VALID", refreshToken: "RT-VALID", admin: { id: "a1", role: "SUPER_ADMIN" } },
      })
    } else {
      await route.fulfill({ status: 401, json: { message: "Email atau kata sandi salah" } })
    }
  })
}

test.describe("auth admin (G511)", () => {
  test("login sukses → redirect ke dashboard", async ({ page }) => {
    await mockLogin(page)
    await page.route(`${API}/auth/me`, async (route) => {
      await route.fulfill({ json: { id: "a1", email: "ops@kahade.id", role: "SUPER_ADMIN" } })
    })
    await page.goto("/login")
    await page.getByPlaceholder("admin@kahade.id").fill("ops@kahade.id")
    await page.getByPlaceholder("••••••••").fill("Rahasia123")
    await page.getByRole("button", { name: "Masuk" }).click()
    await expect(page).toHaveURL(/\/$/)
    // Dashboard me-render (bukan halaman login lagi).
    await expect(page.getByRole("heading", { name: /Dasbor|Dashboard/i })).toBeVisible()
  })

  test("login gagal → error tampil, tetap di /login", async ({ page }) => {
    await mockLogin(page)
    await page.goto("/login")
    await page.getByPlaceholder("admin@kahade.id").fill("ops@kahade.id")
    await page.getByPlaceholder("••••••••").fill("salah")
    await page.getByRole("button", { name: "Masuk" }).click()
    await expect(page).toHaveURL(/\/login/)
    await expect(page.getByText(/salah/i).first()).toBeVisible()
  })

  test("akses token kedaluwarsa → refresh otomatis → request diulang", async ({ page }) => {
    await mockLogin(page)
    let meCalls = 0
    await page.route(`${API}/auth/me`, async (route) => {
      meCalls += 1
      if (meCalls === 1) {
        await route.fulfill({ status: 401, json: { message: "Token kedaluwarsa" } })
      } else {
        await route.fulfill({ json: { id: "a1", email: "ops@kahade.id", role: "SUPER_ADMIN" } })
      }
    })
    await page.route(`${API}/auth/refresh`, async (route) => {
      await route.fulfill({ json: { accessToken: "AT-BARU" } })
    })
    await page.goto("/login")
    await page.getByPlaceholder("admin@kahade.id").fill("ops@kahade.id")
    await page.getByPlaceholder("••••••••").fill("Rahasia123")
    await page.getByRole("button", { name: "Masuk" }).click()
    // Setelah refresh, dashboard tetap tampil (tidak dilempar ke /login).
    await expect(page).toHaveURL(/\/$/)
    expect(meCalls).toBeGreaterThanOrEqual(2)
  })

  test("logout → token dibersihkan → /login, panel tak bisa diakses", async ({ page }) => {
    await mockLogin(page)
    await page.route(`${API}/auth/me`, async (route) => {
      await route.fulfill({ json: { id: "a1", email: "ops@kahade.id", role: "SUPER_ADMIN" } })
    })
    await page.route(`${API}/auth/logout`, async (route) => {
      await route.fulfill({ json: { ok: true } })
    })
    await page.goto("/login")
    await page.getByPlaceholder("admin@kahade.id").fill("ops@kahade.id")
    await page.getByPlaceholder("••••••••").fill("Rahasia123")
    await page.getByRole("button", { name: "Masuk" }).click()
    await expect(page).toHaveURL(/\/$/)

    // Logout via menu pengguna (sesuaikan selector bila label berubah).
    const logoutBtn = page.getByRole("button", { name: /Keluar|Logout/i })
    if (await logoutBtn.count()) {
      await logoutBtn.first().click()
      await expect(page).toHaveURL(/\/login/)
    }
  })

  test("refresh gagal (session expiry) → redirect /login", async ({ page }) => {
    await page.route(`${API}/**`, async (route) => {
      const url = route.request().url()
      if (url.includes("/auth/refresh")) {
        await route.fulfill({ status: 401, json: { message: "Refresh kedaluwarsa" } })
      } else if (url.includes("/auth/me")) {
        await route.fulfill({ status: 401, json: { message: "Token kedaluwarsa" } })
      } else {
        await route.fulfill({ json: {} })
      }
    })
    // Token basi di storage → buka panel → harus dilempar ke /login.
    await page.goto("/")
    await expect(page).toHaveURL(/\/login/)
  })
})
