/**
 * GAP-E G301–G312 — Unit test utilitas seleksi bulk (`src/lib/business/selection.ts`).
 *
 * Fungsi murni (tanpa React): toggle/select/deselect, pemangkasan status yang
 * berubah saat refresh, chunking batch, klasifikasi kegagalan sementara, dan
 * ringkasan teks tanpa PII.
 */
import { describe, expect, it } from "vitest"

import {
  buildBulkSummaryText,
  chunkIds,
  deselectPageIds,
  isTransientFailure,
  pruneChangedStatuses,
  pruneSnapshot,
  selectPageIds,
  snapshotStatuses,
  toggleSelection,
} from "@/lib/business/selection"

describe("toggleSelection", () => {
  it("menambah ID yang belum dipilih dan menghapus yang sudah dipilih", () => {
    const a = toggleSelection(new Set(["x"]), "y")
    expect([...a]).toEqual(["x", "y"])
    const b = toggleSelection(a, "x")
    expect([...b]).toEqual(["y"])
  })

  it("tidak memutasi Set asal (immutable)", () => {
    const orig = new Set(["x"])
    toggleSelection(orig, "y")
    expect([...orig]).toEqual(["x"])
  })
})

describe("selectPageIds / deselectPageIds", () => {
  it("menambah semua ID halaman tanpa duplikat", () => {
    const next = selectPageIds(new Set(["a"]), ["b", "c", "b"])
    expect([...next].sort()).toEqual(["a", "b", "c"])
  })

  it("menghapus hanya ID halaman ini, mempertahankan lintas halaman", () => {
    const next = deselectPageIds(new Set(["a", "b", "c"]), ["b"])
    expect([...next].sort()).toEqual(["a", "c"])
  })
})

describe("pruneChangedStatuses", () => {
  it("membatalkan item yang statusnya berubah sejak dipilih", () => {
    const selected = new Set(["keep", "drop", "away"])
    const snapshot = new Map([
      ["keep", "PENDING"],
      ["drop", "PENDING"],
      ["away", "PENDING"],
    ])
    const current = new Map([
      ["keep", "PENDING"],
      ["drop", "APPROVED"],
    ])
    const { kept, dropped } = pruneChangedStatuses(selected, snapshot, current)
    expect([...kept].sort()).toEqual(["away", "keep"])
    expect(dropped).toEqual(["drop"])
  })

  it("mempertahankan item lintas halaman yang tidak ada di hasil refresh", () => {
    const { kept, dropped } = pruneChangedStatuses(
      new Set(["p1"]),
      new Map([["p1", "PENDING"]]),
      new Map(),
    )
    expect([...kept]).toEqual(["p1"])
    expect(dropped).toEqual([])
  })
})

describe("snapshotStatuses / pruneSnapshot", () => {
  it("mencatat status saat dipilih dan membersihkan yang tidak terpilih", () => {
    const snap = snapshotStatuses(new Map(), [
      { id: "a", status: "PENDING" },
      { id: "b", status: "PENDING" },
    ])
    expect(snap.get("a")).toBe("PENDING")
    const pruned = pruneSnapshot(snap, new Set(["a"]))
    expect([...pruned.keys()]).toEqual(["a"])
  })
})

describe("chunkIds", () => {
  it("membagi menjadi batch sesuai batas backend (default 50)", () => {
    const ids = Array.from({ length: 125 }, (_, i) => `id-${i}`)
    const chunks = chunkIds(ids)
    expect(chunks).toHaveLength(3)
    expect(chunks[0]).toHaveLength(50)
    expect(chunks[2]).toHaveLength(25)
  })

  it("mengembalikan satu chunk bila di bawah batas", () => {
    expect(chunkIds(["a", "b"], 50)).toEqual([["a", "b"]])
  })
})

describe("isTransientFailure", () => {
  it("kegagalan permanen (sudah diproses / validasi) tidak di-retry", () => {
    expect(isTransientFailure("Business verification is already APPROVED")).toBe(false)
    expect(isTransientFailure("Business verification was already processed by another admin")).toBe(
      false,
    )
    expect(isTransientFailure("Business verification request not found")).toBe(false)
    expect(isTransientFailure("Rejection reason must contain non-whitespace text")).toBe(false)
  })

  it("kegagalan sementara (jaringan / 429 / 5xx) layak di-retry", () => {
    expect(isTransientFailure("fetch failed")).toBe(true)
    expect(isTransientFailure("Request failed with status 429")).toBe(true)
    expect(isTransientFailure("Internal server error")).toBe(true)
    expect(isTransientFailure("")).toBe(true)
  })
})

describe("buildBulkSummaryText", () => {
  it("ringkasan tanpa PII — hanya ID verifikasi, batch, dan hitungan", () => {
    const text = buildBulkSummaryText({
      action: "reject",
      batchIds: ["BVB-20260926-ABCD"],
      succeeded: ["BIZ-1"],
      failed: [{ id: "BIZ-2", reason: "sudah diproses admin lain" }],
    })
    expect(text).toContain("Ditolak")
    expect(text).toContain("BVB-20260926-ABCD")
    expect(text).toContain("BIZ-1")
    expect(text).toContain("BIZ-2")
    // Tidak ada nama/email/NPWP dalam ringkasan.
    expect(text).not.toMatch(/@/);
    expect(text).not.toMatch(/NPWP/i)
  })
})
