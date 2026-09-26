/**
 * Kahade Admin Web — Tailwind config (GENERATED pattern).
 *
 * Theme diambil dari single source of truth `src/lib/tokens.ts`
 * via `toTailwindTheme()`. Token mode-aware (background, surface,
 * text-*, border-*, primary, semantic) memakai CSS variables yang
 * diisi `src/app/theme.css` (:root = light, .dark = dark).
 *
 * Dimuat oleh Tailwind v4 lewat `@config` di `src/app/globals.css`.
 */
import type { Config } from "tailwindcss"
import { toTailwindTheme } from "./src/lib/tokens"

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  // Dark mode via class `.dark` (bukan prefers-color-scheme) agar
  // admin bisa switch manual; default light.
  darkMode: "class",
  theme: {
    extend: toTailwindTheme(),
  },
  plugins: [],
}

export default config
