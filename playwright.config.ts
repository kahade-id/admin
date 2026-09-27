import { defineConfig, devices } from "@playwright/test"

/**
 * G511/G520/G521 — Playwright E2E + visual.
 *
 * Menjalankan Next.js dev server lokal dan menguji alur auth nyata
 * (login → refresh token → logout → session expiry) serta screenshot
 * visual per halaman. Lihat tests/e2e/README.md untuk cara menjalankan.
 */
export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: [["list"], ["html", { outputFolder: "playwright-report", open: "never" }]],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3001",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    command: "npm run dev -- --port 3001",
    url: "http://localhost:3001/login",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
})
