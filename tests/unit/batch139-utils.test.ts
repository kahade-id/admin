/**
 * Batch 139 — Test util murni reusable (H01/H07/H13/H15).
 *
 * - diffObjects / formatDiffValue (audit-diff, H07)
 * - detectEnv (env banner, H15)
 * - parsePage (use-url-filters, H01)
 * - logPiiReveal / getPiiRevealLog (masked-pii, H13)
 *
 * Semua murni / localStorage saja — tidak menyentuh backend.
 */
import { describe, expect, it, beforeEach } from "vitest"

import { diffObjects, formatDiffValue } from "@/components/admin/batch139/diff"
import { detectEnv } from "@/components/admin/batch139/env"
import { parsePage } from "@/components/admin/batch139/use-url-filters"
import {
  logPiiReveal,
  getPiiRevealLog,
  PII_REVEAL_TIMEOUT_MS,
} from "@/components/admin/batch139/masked-pii"

describe("diffObjects", () => {
  it("menandai field berubah", () => {
    const out = diffObjects({ a: 1, b: "x" }, { a: 2, b: "x" })
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({ path: "a", kind: "changed", before: 1, after: 2 })
  })

  it("menandai added dan removed", () => {
    const out = diffObjects({ a: 1 }, { b: 2 })
    const kinds = Object.fromEntries(out.map((d) => [d.path, d.kind]))
    expect(kinds).toEqual({ a: "removed", b: "added" })
  })

  it("melewati nilai yang deep-equal", () => {
    expect(diffObjects({ a: { x: [1, 2] } }, { a: { x: [1, 2] } })).toHaveLength(0)
  })

  it("me-flatten objek bertingkat dengan path dotted", () => {
    const out = diffObjects({ kyc: { status: "PENDING" } }, { kyc: { status: "VERIFIED" } })
    expect(out).toHaveLength(1)
    expect(out[0].path).toBe("kyc.status")
    expect(out[0].kind).toBe("changed")
  })

  it("aman untuk null/undefined", () => {
    expect(diffObjects(null, { a: 1 })).toHaveLength(1)
    expect(diffObjects(undefined, undefined)).toHaveLength(0)
  })
})

describe("formatDiffValue", () => {
  it("memotong string panjang", () => {
    const long = "x".repeat(200)
    const out = formatDiffValue(long)
    expect(out.length).toBeLessThan(200)
    expect(out.endsWith("…")).toBe(true)
  })

  it("meringkas array panjang", () => {
    const out = formatDiffValue([1, 2, 3, 4, 5])
    expect(out).toContain("+2 lainnya")
  })

  it("null/undefined menjadi em-dash", () => {
    expect(formatDiffValue(null)).toBe("—")
    expect(formatDiffValue(undefined)).toBe("—")
  })
})

describe("detectEnv", () => {
  it("flag production menang atas hostname", () => {
    expect(detectEnv("production", "localhost")).toBe("production")
    expect(detectEnv("prod")).toBe("production")
  })

  it("mengenali staging & development", () => {
    expect(detectEnv("staging")).toBe("staging")
    expect(detectEnv(undefined, "admin-staging.kahade.id")).toBe("staging")
    expect(detectEnv("dev")).toBe("development")
    expect(detectEnv(undefined, "localhost")).toBe("development")
    expect(detectEnv(undefined, "127.0.0.1")).toBe("development")
  })

  it("hostname produksi", () => {
    expect(detectEnv(undefined, "admin.kahade.id")).toBe("production")
  })

  it("tidak dikenal → unknown", () => {
    expect(detectEnv()).toBe("unknown")
    expect(detectEnv("")).toBe("unknown")
    expect(detectEnv(undefined, "some.internal")).toBe("unknown")
  })
})

describe("parsePage", () => {
  it("menerima angka valid", () => {
    expect(parsePage("3")).toBe(3)
  })

  it("menolak angka tidak valid → fallback", () => {
    expect(parsePage("0")).toBe(1)
    expect(parsePage("-5")).toBe(1)
    expect(parsePage("abc")).toBe(1)
    expect(parsePage(undefined)).toBe(1)
    expect(parsePage("abc", 7)).toBe(7)
  })
})

describe("logPiiReveal / getPiiRevealLog", () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it("mencatat reveal dengan timestamp", () => {
    logPiiReveal({ adminId: "a1", adminName: "Admin", field: "email", recordId: "u1" })
    const log = getPiiRevealLog()
    expect(log).toHaveLength(1)
    expect(log[0]).toMatchObject({ adminId: "a1", field: "email", recordId: "u1" })
    expect(typeof log[0].at).toBe("string")
  })

  it("entri terbaru di depan", () => {
    logPiiReveal({ adminId: "a1", adminName: "Admin", field: "email", recordId: "u1" })
    logPiiReveal({ adminId: "a1", adminName: "Admin", field: "phone", recordId: "u2" })
    const log = getPiiRevealLog()
    expect(log[0].field).toBe("phone")
  })

  it("timeout reveal 30 detik", () => {
    expect(PII_REVEAL_TIMEOUT_MS).toBe(30_000)
  })
})
