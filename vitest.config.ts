import react from "@vitejs/plugin-react"
import path from "node:path"
import { defineConfig } from "vitest/config"

/**
 * Kahade Admin Web — konfigurasi Vitest (G501).
 *
 * - environment jsdom untuk komponen React
 * - alias `@` → `src/` (selaras tsconfig paths)
 * - setupFiles: matcher jest-dom + axe (vitest-axe)
 */
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
  test: {
    environment: "jsdom",
    globals: false,
    setupFiles: ["./tests/setup.ts"],
    include: ["tests/**/*.test.{ts,tsx}"],
    exclude: ["tests/e2e/**", "node_modules/**"],
    css: false,
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "json-summary"],
      reportsDirectory: "tests/coverage",
      include: ["src/**/*.{ts,tsx}"],
      exclude: [
        "src/**/*.d.ts",
        "src/app/**/page.tsx",
        "src/app/**/layout.tsx",
        "tests/**",
      ],
    },
    testTimeout: 15000,
  },
})
