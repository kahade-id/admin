/**
 * G519 — Test locale ID: format tanggal (WIB), mata uang IDR, pesan error.
 *
 * Panel admin khusus tim internal Indonesia — tidak ada i18n, semua label
 * Bahasa Indonesia (`src/lib/format.ts`). Test mengunci:
 * - tanggal selalu zona Asia/Jakarta dengan label WIB
 * - angka memakai pemisah ribuan titik (id-ID), mata uang "Rp…"
 * - pesan error selalu Bahasa Indonesia, tidak pernah teknis/Inggris mentah
 */
import { describe, expect, it } from "vitest"

import {
  addDaysToDateString,
  ageHours,
  endOfMonthDateString,
  formatAge,
  formatDateTimeWIB,
  formatDateWIB,
  formatIDR,
  formatNumber,
} from "@/lib/format"
import { ApiError, userMessage } from "@/lib/api/response"

describe("formatDateTimeWIB", () => {
  it("mengonversi UTC ke WIB (+7) dengan format Indonesia", () => {
    // 07:30 UTC = 14:30 WIB
    expect(formatDateTimeWIB("2026-09-26T07:30:00.000Z")).toBe("26 Sep 2026, 14.30 WIB")
  })

  it("menerima Date dan timestamp", () => {
    const d = new Date("2026-01-05T17:00:00.000Z") // 00:00 WIB 6 Jan
    expect(formatDateTimeWIB(d)).toBe("6 Jan 2026, 00.00 WIB")
    expect(formatDateTimeWIB(d.getTime())).toBe("6 Jan 2026, 00.00 WIB")
  })

  it("nama bulan Bahasa Indonesia (Jan, Feb, Mar, …)", () => {
    expect(formatDateTimeWIB("2026-02-14T00:00:00.000Z")).toContain("Feb")
    expect(formatDateTimeWIB("2026-08-17T00:00:00.000Z")).toContain("Agu")
    expect(formatDateTimeWIB("2026-12-25T00:00:00.000Z")).toContain("Des")
  })

  it("input kosong/invalid → '—' (tidak crash)", () => {
    expect(formatDateTimeWIB(null)).toBe("—")
    expect(formatDateTimeWIB(undefined)).toBe("—")
    expect(formatDateTimeWIB("")).toBe("—")
    expect(formatDateTimeWIB("bukan-tanggal")).toBe("—")
  })

  it("tidak pernah menampilkan zona selain WIB", () => {
    const out = formatDateTimeWIB("2026-09-26T07:30:00.000Z")
    expect(out).toMatch(/WIB$/)
    expect(out).not.toMatch(/UTC|GMT/)
  })
})

describe("formatDateWIB (BAI-129)", () => {
  it("string 'YYYY-MM-DD' backend = tanggal kalender WIB, tanpa jam menyesatkan", () => {
    // Sebelum BAI-129, string ini diparse sebagai UTC midnight lalu diformat
    // dengan jam → "07.00 WIB". Sekarang: tanggal saja.
    expect(formatDateWIB("2026-09-30")).toBe("30 Sep 2026")
  })

  it("tidak digeser tanggal di zona browser mana pun (jangkar tengah hari UTC)", () => {
    expect(formatDateWIB("2026-01-01")).toBe("1 Jan 2026")
  })

  it("menerima Date dan timestamp (diformat dalam WIB)", () => {
    expect(formatDateWIB(new Date("2026-01-05T17:00:00.000Z"))).toBe("6 Jan 2026")
    expect(formatDateWIB(new Date("2026-01-05T17:00:00.000Z").getTime())).toBe(
      "6 Jan 2026",
    )
  })

  it("input kosong/invalid → '—'", () => {
    expect(formatDateWIB(null)).toBe("—")
    expect(formatDateWIB("")).toBe("—")
    expect(formatDateWIB("bukan-tanggal")).toBe("—")
  })
})

describe("addDaysToDateString & endOfMonthDateString (BAI-135)", () => {
  it("tambah hari lintas batas bulan/tahun", () => {
    expect(addDaysToDateString("2026-09-28", 6)).toBe("2026-10-04")
    expect(addDaysToDateString("2026-12-31", 1)).toBe("2027-01-01")
  })

  it("hari terakhir bulan (termasuk Februari kabisat 2024)", () => {
    expect(endOfMonthDateString("2026-09-15")).toBe("2026-09-30")
    expect(endOfMonthDateString("2024-02-10")).toBe("2024-02-29")
    expect(endOfMonthDateString("2026-02-10")).toBe("2026-02-28")
  })
})

describe("formatNumber & formatIDR", () => {
  it("pemisah ribuan titik gaya Indonesia", () => {
    expect(formatNumber(1234567)).toBe("1.234.567")
    expect(formatNumber(150000)).toBe("150.000")
  })

  it("formatIDR memakai prefix Rp tanpa desimal", () => {
    expect(formatIDR(150000)).toBe("Rp150.000")
    expect(formatIDR(1234567)).toBe("Rp1.234.567")
    expect(formatIDR(0)).toBe("Rp0")
  })

  it("desimal pecahan TIDAK dipotong diam-diam (BAI-052)", () => {
    // Backend `toIdr` bisa mengembalikan pecahan sen (mis. 12345 sen → 123.45
    // rupiah). Math.trunc diam-diam memotong Rp150.000,99 → "Rp150.000".
    // Kontrak baru: bilangan bulat tanpa desimal; pecahan tampil 2 desimal.
    expect(formatIDR(150000.99)).toBe("Rp150.000,99")
    expect(formatNumber(150000.99)).toBe("150.000")
  })

  it("non-finite → '—'", () => {
    expect(formatNumber(NaN)).toBe("—")
    expect(formatNumber(Infinity)).toBe("—")
    expect(formatNumber("150000")).toBe("—")
    expect(formatIDR(NaN)).toBe("—")
    expect(formatIDR(null)).toBe("—")
  })
})

describe("formatAge (umur antrean)", () => {
  it("di bawah 1 jam → menit", () => {
    const d = new Date(Date.now() - 45 * 60 * 1000).toISOString()
    expect(formatAge(d)).toBe("45 mnt")
  })

  it("1–48 jam → jam", () => {
    const d = new Date(Date.now() - 3 * 3600 * 1000).toISOString()
    expect(formatAge(d)).toBe("3 jam")
  })

  it("lebih dari 48 jam → hari", () => {
    const d = new Date(Date.now() - 50 * 3600 * 1000).toISOString()
    expect(formatAge(d)).toBe("2 hari")
  })

  it("invalid → '—'", () => {
    expect(formatAge(null)).toBe("—")
    expect(ageHours("xxx")).toBeNull()
  })
})

describe("userMessage — pesan error Bahasa Indonesia", () => {
  it("ApiError → message backend apa adanya", () => {
    const err = new ApiError({ message: "KTP buram, unggah ulang." })
    expect(userMessage(err)).toBe("KTP buram, unggah ulang.")
  })

  it("Error biasa → message-nya", () => {
    expect(userMessage(new Error("jaringan putus"))).toBe("jaringan putus")
  })

  it("error tak dikenal → pesan generik Bahasa Indonesia", () => {
    expect(userMessage(null)).toBe("Terjadi kesalahan tak terduga.")
    expect(userMessage("string-error")).toBe("Terjadi kesalahan tak terduga.")
    expect(userMessage({})).toBe("Terjadi kesalahan tak terduga.")
  })

  it("tidak pernah membocorkan stack trace ke UI", () => {
    const err = new Error("boom")
    err.stack = "Error: boom\n    at secret-internal.js:1:1"
    const msg = userMessage(err)
    expect(msg).not.toContain("at ")
    expect(msg).not.toContain(".js")
  })
})
