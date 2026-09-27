/**
 * GAP-E G322 — Unit test alarm masa berlaku legalitas (`src/lib/business/legalitas.ts`).
 *
 * Masa berlaku = approvedAt + LEGALITY_VALIDITY_DAYS. Status: ok | warning
 * (sisa <= 90 hari) | expired | na (belum disetujui / tanggal invalid).
 */
import { describe, expect, it } from "vitest"

import {
  LEGALITY_VALIDITY_DAYS,
  LEGALITY_WARNING_DAYS,
  legalitasStatus,
  legalitasValidUntil,
} from "@/lib/business/legalitas"

const DAY = 24 * 60 * 60 * 1000

describe("legalitasValidUntil", () => {
  it("approvedAt + masa berlaku", () => {
    const approved = new Date("2023-01-01T00:00:00Z")
    const until = legalitasValidUntil(approved)
    expect(until?.getTime()).toBe(approved.getTime() + LEGALITY_VALIDITY_DAYS * DAY)
  })

  it("null / kosong / invalid → null", () => {
    expect(legalitasValidUntil(null)).toBeNull()
    expect(legalitasValidUntil("")).toBeNull()
    expect(legalitasValidUntil("bukan-tanggal")).toBeNull()
  })
})

describe("legalitasStatus", () => {
  it("expired bila masa berlaku sudah lewat", () => {
    const approved = new Date(Date.now() - (LEGALITY_VALIDITY_DAYS + 1) * DAY).toISOString()
    expect(legalitasStatus(approved)).toBe("expired")
  })

  it("warning bila sisa <= 90 hari", () => {
    const approved = new Date(
      Date.now() - (LEGALITY_VALIDITY_DAYS - LEGALITY_WARNING_DAYS + 1) * DAY,
    ).toISOString()
    expect(legalitasStatus(approved)).toBe("warning")
  })

  it("ok bila masih jauh dari kedaluwarsa", () => {
    const approved = new Date(Date.now() - 30 * DAY).toISOString()
    expect(legalitasStatus(approved)).toBe("ok")
  })

  it("na bila belum disetujui", () => {
    expect(legalitasStatus(null)).toBe("na")
    expect(legalitasStatus(undefined)).toBe("na")
  })
})
