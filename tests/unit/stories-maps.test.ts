/** Helper turunan halaman moderasi Story (`src/app/(panel)/stories/maps.ts`). */
import { describe, expect, it } from "vitest"

import {
  canRestoreStory,
  deriveStoryStatus,
  formatCompact,
  formatStoryDuration,
} from "@/app/(panel)/stories/maps"

const NOW = Date.parse("2026-10-10T12:00:00.000Z")
const iso = (offsetMs: number) => new Date(NOW + offsetMs).toISOString()
const H = 3_600_000
const D = 24 * H

describe("formatStoryDuration", () => {
  it("mm:ss dari milidetik, pembulatan ke detik", () => {
    expect(formatStoryDuration(0)).toBe("00:00")
    expect(formatStoryDuration(14_499)).toBe("00:14")
    expect(formatStoryDuration(14_500)).toBe("00:15")
    expect(formatStoryDuration(90_000)).toBe("01:30")
  })
  it("null/invalid → —", () => {
    expect(formatStoryDuration(null)).toBe("—")
    expect(formatStoryDuration(-1)).toBe("—")
    expect(formatStoryDuration(Number.NaN)).toBe("—")
  })
})

describe("deriveStoryStatus (urutan sama dengan filter backend)", () => {
  const base = { deletedAt: null, hiddenAt: null, hiddenUntil: null, expiresAt: iso(2 * H) }
  it("aktif", () => {
    expect(deriveStoryStatus(base, NOW)).toBe("active")
  })
  it("dihapus menang atas yang lain", () => {
    expect(deriveStoryStatus({ ...base, deletedAt: iso(-H), hiddenAt: iso(-H) }, NOW)).toBe("deleted")
  })
  it("tersembunyi: hiddenUntil null atau masih di depan", () => {
    expect(deriveStoryStatus({ ...base, hiddenAt: iso(-H) }, NOW)).toBe("hidden")
    expect(deriveStoryStatus({ ...base, hiddenAt: iso(-H), hiddenUntil: iso(H) }, NOW)).toBe("hidden")
  })
  it("hiddenUntil lewat → kembali aktif / kedaluwarsa", () => {
    expect(deriveStoryStatus({ ...base, hiddenAt: iso(-2 * H), hiddenUntil: iso(-H) }, NOW)).toBe("active")
    expect(deriveStoryStatus({ ...base, expiresAt: iso(-1) }, NOW)).toBe("expired")
  })
})

describe("canRestoreStory (jendela 7 hari backend)", () => {
  it("dalam 7 hari → bisa; lewat → tidak; null → tidak", () => {
    expect(canRestoreStory(iso(-6 * D), NOW)).toBe(true)
    expect(canRestoreStory(iso(-8 * D), NOW)).toBe(false)
    expect(canRestoreStory(null, NOW)).toBe(false)
  })
})

describe("formatCompact", () => {
  it("ringkas id-ID", () => {
    expect(formatCompact(1284)).toBe("1.284")
    expect(formatCompact(12_900)).toBe("12,9rb")
    expect(formatCompact(4_200_000)).toBe("4,2jt")
    expect(formatCompact(null)).toBe("—")
  })
})
