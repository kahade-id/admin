/**
 * ADM-405 — masking PII default di permukaan admin.
 * Tidak ada nilai mentah yang lolos: email/phone/name/account selalu ter-mask,
 * nilai kosong → "—", dan maskPiiInObject menyapu field bernama PII.
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
  it("mask local part, pertahankan domain", () => {
    expect(maskEmail("budi.santoso@example.com")).toBe("bu•••@example.com")
  })
  it("tanpa @ atau domain kosong → •••", () => {
    expect(maskEmail("bukan-email")).toBe("•••")
    expect(maskEmail("budi@")).toBe("•••")
  })
  it("null/undefined/kosong → —", () => {
    expect(maskEmail(null)).toBe("—")
    expect(maskEmail(undefined)).toBe("—")
    expect(maskEmail("")).toBe("—")
  })
  it("tidak membocorkan local part penuh", () => {
    const out = maskEmail("rahasia12345@mail.co.id")
    expect(out).not.toContain("rahasia12345")
    expect(out).toContain("@mail.co.id")
  })
})

describe("maskPhone", () => {
  it("tampilkan hanya 4 digit akhir + kode negara kasar", () => {
    expect(maskPhone("+6281234567890")).toBe("+62••• ••• 7890")
  })
  it("tanpa plus tetap mask", () => {
    const out = maskPhone("081234567890")
    expect(out).toContain("7890")
    expect(out).not.toContain("08123456")
  })
  it("terlalu pendek → •••; kosong → —", () => {
    expect(maskPhone("123")).toBe("•••")
    expect(maskPhone(null)).toBe("—")
  })
})

describe("maskName", () => {
  it("mask tiap kata, huruf pertama terlihat", () => {
    expect(maskName("Budi Santoso")).toBe("B••• S••••••")
  })
  it("kosong/blank → —", () => {
    expect(maskName("")).toBe("—")
    expect(maskName("   ")).toBe("—")
    expect(maskName(null)).toBe("—")
  })
})

describe("maskAccountNumber", () => {
  it("hanya 4 digit akhir terlihat", () => {
    expect(maskAccountNumber("1234567890")).toBe("••••••7890")
  })
  it("pendek/kosong", () => {
    expect(maskAccountNumber("12")).toBe("••••")
    expect(maskAccountNumber(null)).toBe("—")
  })
  it("abaikan pemisah non-digit", () => {
    expect(maskAccountNumber("1234-5678-90")).toBe("••••••7890")
  })
})

describe("maskPiiInObject", () => {
  it("menyapu field bernama PII, membiarkan lainnya", () => {
    const out = maskPiiInObject({
      email: "budi@example.com",
      phoneNumber: "+6281234567890",
      fullName: "Budi Santoso",
      accountNumber: "1122334455",
      orderId: "ORD-123",
      total: 50000,
    })
    expect(out.email).toBe("bu•••@example.com")
    expect(out.phoneNumber).toContain("7890")
    expect(out.fullName).toBe("B••• S••••••")
    expect(out.accountNumber).toBe("••••••4455")
    expect(out.orderId).toBe("ORD-123")
    expect(out.total).toBe(50000)
  })
  it("tidak membocorkan nilai mentah", () => {
    const out = maskPiiInObject({ userEmail: "rahasia.penuh@x.id", id: "1" })
    expect(out.userEmail).not.toContain("rahasia.penuh")
  })
})
