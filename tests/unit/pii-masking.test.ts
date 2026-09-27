/**
 * G506 — Test masking PII (`src/lib/pii.ts`).
 *
 * Fondasi QA: memastikan no HP / email / nama / no rekening pengguna
 * TIDAK PERNAH tampil mentah bila melewati util ini. Properti yang
 * ditegaskan:
 * - email asli tidak muncul utuh di hasil
 * - digit tengah no HP disamarkan, 4 digit akhir dipertahankan (operasional)
 * - nilai kosong/null → "—" (konsisten dengan format.ts)
 * - maskPiiInObject menyapu field PII tanpa mengubah field lain
 */
import { describe, expect, it } from "vitest"

import {
  maskAccountNumber,
  maskEmail,
  maskName,
  maskPhone,
  maskPiiInObject,
} from "@/lib/pii"

describe("maskEmail", () => {
  it("menyamarkan local-part, mempertahankan domain", () => {
    const out = maskEmail("budi.santoso@example.com")
    expect(out).toBe("bu•••@example.com")
    expect(out).not.toContain("budi.santoso")
  })

  it("local-part pendek tetap disamarkan", () => {
    expect(maskEmail("ab@x.id")).toBe("ab•••@x.id")
    expect(maskEmail("a@x.id")).toBe("a•••@x.id")
  })

  it("tanpa @ atau tanpa domain → disamarkan penuh", () => {
    expect(maskEmail("bukan-email")).toBe("•••")
    expect(maskEmail("budi@")).toBe("•••")
  })

  it("nilai kosong/null/undefined → '—'", () => {
    expect(maskEmail("")).toBe("—")
    expect(maskEmail(null)).toBe("—")
    expect(maskEmail(undefined)).toBe("—")
  })
})

describe("maskPhone", () => {
  it("menyamarkan digit tengah, 4 digit akhir terlihat", () => {
    const out = maskPhone("+6281234567890")
    expect(out).toContain("7890")
    expect(out).not.toContain("123456")
    expect(out).toBe("+62••• ••• 7890")
  })

  it("tanpa plus tetap dimask", () => {
    const out = maskPhone("081234567890")
    expect(out).toContain("7890")
    expect(out).not.toContain("123456")
  })

  it("terlalu pendek → disamarkan penuh", () => {
    expect(maskPhone("123")).toBe("•••")
  })

  it("nilai kosong/null/undefined → '—'", () => {
    expect(maskPhone("")).toBe("—")
    expect(maskPhone(null)).toBe("—")
    expect(maskPhone(undefined)).toBe("—")
  })
})

describe("maskName", () => {
  it("setiap kata disamarkan kecuali huruf pertama", () => {
    const out = maskName("Budi Santoso")
    expect(out).not.toContain("udi")
    expect(out).not.toContain("antoso")
    expect(out.startsWith("B")).toBe(true)
  })

  it("nilai kosong/null/undefined → '—'", () => {
    expect(maskName("  ")).toBe("—")
    expect(maskName(null)).toBe("—")
    expect(maskName(undefined)).toBe("—")
  })
})

describe("maskAccountNumber", () => {
  it("hanya 4 digit akhir terlihat", () => {
    const out = maskAccountNumber("1234567890")
    expect(out).toBe("••••••7890")
    expect(out).not.toContain("123456")
  })

  it("nilai kosong → '—'", () => {
    expect(maskAccountNumber(null)).toBe("—")
  })
})

describe("maskPiiInObject", () => {
  it("menyapu field PII tanpa mengubah field non-PII", () => {
    const out = maskPiiInObject({
      id: "u-1",
      email: "budi@example.com",
      phoneNumber: "+6281234567890",
      fullName: "Budi Santoso",
      status: "PENDING",
      amount: 150000,
    })
    expect(out.id).toBe("u-1")
    expect(out.status).toBe("PENDING")
    expect(out.amount).toBe(150000)
    expect(out.email).toBe("bu•••@example.com")
    expect(out.phoneNumber).toBe("+62••• ••• 7890")
    expect(out.fullName).not.toContain("udi")
  })

  it("tidak memutasi objek asli", () => {
    const src = { email: "budi@example.com" }
    const out = maskPiiInObject(src)
    expect(src.email).toBe("budi@example.com")
    expect(out.email).not.toBe("budi@example.com")
  })

  it("mengabaikan nilai non-string", () => {
    const out = maskPiiInObject({ email: null, count: 3 })
    expect(out.email).toBeNull()
    expect(out.count).toBe(3)
  })
})
