import { describe, expect, it } from "vitest"

import { queueAgeHours, slaStatus } from "@/lib/business/sla"

describe("slaStatus", () => {
  it("ok di bawah 80% SLA", () => {
    expect(slaStatus(10, 48)).toBe("ok")
  })

  it("warning pada >= 80% SLA", () => {
    // Hindari tepat 38.4: 48*0.8 = 38.400000000000006 dalam floating point.
    expect(slaStatus(39, 48)).toBe("warning")
    expect(slaStatus(47.9, 48)).toBe("warning")
  })

  // DBL-010 (audit integrasi 2026-10-01): breached INKLUSIF (>=) — selaras
  // backend `sla.util.ts` (`elapsed >= budgetMs`).
  it("breached tepat di batas SLA (inklusif)", () => {
    expect(slaStatus(48, 48)).toBe("breached")
    expect(slaStatus(50, 48)).toBe("breached")
  })

  it("unknown untuk input tidak valid", () => {
    expect(slaStatus(null, 48)).toBe("unknown")
    expect(slaStatus(10, 0)).toBe("unknown")
    expect(slaStatus(10, -5)).toBe("unknown")
  })

  it("queueAgeHours memakai createdAt bila slaStartedAt kosong", () => {
    const created = new Date(Date.now() - 5 * 3600 * 1000).toISOString()
    const age = queueAgeHours(null, created)
    expect(age).not.toBeNull()
    expect(age!).toBeGreaterThan(4.9)
    expect(age!).toBeLessThan(5.1)
    expect(queueAgeHours(null, null)).toBeNull()
  })
})
