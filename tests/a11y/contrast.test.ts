/**
 * G516 — Kontras warna: semua pasangan teks/latar dari token desain
 * memenuhi WCAG 1.4.3 (AA, rasio ≥ 4.5:1 untuk teks normal), di mode
 * terang DAN gelap.
 *
 * Token dibaca langsung dari `src/lib/tokens.ts` (single source of truth)
 * sehingga perubahan token yang menurunkan kontras otomatis menggagalkan
 * test ini.
 */
import { describe, expect, it } from "vitest"

import { dark, light, semantic } from "@/lib/tokens"

function srgbToLinear(c: number): number {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
}

function luminance(hex: string): number {
  const h = hex.replace("#", "")
  const [r, g, b] = [0, 2, 4].map((i) => srgbToLinear(parseInt(h.slice(i, i + 2), 16) / 255))
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

function contrastRatio(fg: string, bg: string): number {
  const l1 = luminance(fg)
  const l2 = luminance(bg)
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05)
}

const AA = 4.5

describe("kontras token desain (G516)", () => {
  for (const [modeName, mode] of [
    ["light", light],
    ["dark", dark],
  ] as const) {
    describe(`mode ${modeName}`, () => {
      it("teks primer/sekunder/tersier di atas background ≥ 4.5", () => {
        for (const key of ["textPrimary", "textSecondary", "textTertiary"] as const) {
          const r = contrastRatio(mode[key], mode.background)
          expect(r, `${modeName}.${key} vs background = ${r.toFixed(2)}`).toBeGreaterThanOrEqual(AA)
        }
      })

      it("teks sekunder di atas kartu (surfaceElevated) ≥ 4.5", () => {
        const r = contrastRatio(mode.textSecondary, mode.surfaceElevated)
        expect(r, `textSecondary vs surfaceElevated = ${r.toFixed(2)}`).toBeGreaterThanOrEqual(AA)
      })

      it("label tombol primer (foreground di atas fill) ≥ 4.5", () => {
        const r = contrastRatio(mode.primaryForeground, mode.primary)
        expect(r, `primaryForeground vs primary = ${r.toFixed(2)}`).toBeGreaterThanOrEqual(AA)
      })

      it("teks badge/status di atas latar soft ≥ 4.5", () => {
        for (const tone of ["success", "danger", "warning", "info"] as const) {
          const t = semantic[tone][modeName]
          const r = contrastRatio(t.text, t.bgSoft)
          expect(r, `${tone}.text vs bgSoft = ${r.toFixed(2)}`).toBeGreaterThanOrEqual(AA)
        }
      })

      it("outline form control (borderControl) ≥ 3.0 (WCAG 1.4.11)", () => {
        const r = contrastRatio(mode.borderControl, mode.background)
        expect(r, `borderControl vs background = ${r.toFixed(2)}`).toBeGreaterThanOrEqual(3)
      })
    })
  }
})
