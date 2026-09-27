/**
 * GAP-E G313 — Unit test masking NPWP (`src/lib/business/masking.ts`).
 *
 * NPWP preview minim-PII: semua digit kecuali 4 digit terakhir diganti '•',
 * format grup Indonesia dipertahankan. Tidak ada digit mentah selain 4
 * terakhir yang boleh lolos.
 */
import { describe, expect, it } from "vitest"

import { LEGAL_ENTITY_LABEL, maskNpwp } from "@/lib/business/masking"

describe("maskNpwp", () => {
  it("NPWP 15 digit: hanya 4 digit terakhir terlihat, format grup dipertahankan", () => {
    expect(maskNpwp("01.234.567.8-901.000")).toBe("••.•••.•••.•-••1.000")
  })

  it("menerima NPWP tanpa format (digit polos)", () => {
    expect(maskNpwp("012345678901000")).toBe("••.•••.•••.•-••1.000")
  })

  it("NIK 16 digit: grup per 4, 4 digit terakhir terlihat", () => {
    expect(maskNpwp("3201010101010001")).toBe("•••• •••• •••• 0001")
  })

  it("panjang lain: mask semua kecuali 4 digit terakhir", () => {
    expect(maskNpwp("123456789")).toBe("•••••6789")
  })

  it("null/undefined/kosong → null; <4 digit → full mask", () => {
    expect(maskNpwp(null)).toBeNull()
    expect(maskNpwp(undefined)).toBeNull()
    expect(maskNpwp("")).toBeNull()
    expect(maskNpwp("123")).toBe("••••")
  })

  it("tidak membocorkan digit selain 4 terakhir", () => {
    const masked = maskNpwp("01.234.567.8-901.000") ?? ""
    const digits = masked.replace(/\D/g, "")
    expect(digits).toBe("1000")
  })
})

describe("LEGAL_ENTITY_LABEL", () => {
  it("memetakan kode jenis badan hukum ke label Indonesia", () => {
    expect(LEGAL_ENTITY_LABEL["PT"]).toBe("PT")
    expect(LEGAL_ENTITY_LABEL["YAYASAN"]).toBe("Yayasan")
    expect(LEGAL_ENTITY_LABEL["LAINNYA"]).toBe("Lainnya")
  })
})
