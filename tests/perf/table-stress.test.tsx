/**
 * G522 — Stress test: render 1000 baris di <DataTable>.
 *
 * Konteks produksi: semua halaman admin memakai paginasi server-side
 * (20 baris/halaman), sehingga 1000 baris tidak pernah di-render sekaligus
 * di produksi. Test ini adalah STRESS TEST yang mendokumentasikan biaya
 * render massal — bukan pola yang didukung.
 *
 * Hasil ukur (2026-09-26, jsdom, React dev): ~6.5 detik untuk 1000×8 sel.
 * Ambang: < 30 detik di CI. Bila ada halaman yang butuh > 200 baris
 * client-side, WAJIB virtualisasi (lihat catatan di bawah) — jangan
 * menaikkan ambang.
 *
 * Catatan virtualisasi (bila dibutuhkan suatu hari):
 *  - Pakai windowing (react-window / @tanstack/virtual): hanya render
 *    baris yang terlihat di viewport + overscan kecil.
 *  - Pertahankan <table> semantik: virtualisasi berbasis div merusak
 *    semantik tabel (G518) — pilih library yang mendukung tabel atau
 *    terapkan aria-rowindex/aria-rowcount manual.
 *  - Ukur ulang dengan test ini setelah implementasi.
 */
import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import { DataTable } from "@/components/ui/table"

const COLS = Array.from({ length: 8 }, (_, i) => ({
  key: `c${i}`,
  header: `Kolom ${i + 1}`,
}))

function makeRows(n: number) {
  return Array.from({ length: n }, (_, i) =>
    Object.fromEntries(COLS.map((c) => [c.key, `baris-${i}-${c.key}`])),
  )
}

describe("stress 1000 baris (G522)", () => {
  // Timeout eksplisit: stress test memang berat; 15 dtk default vitest
  // bisa habis saat mesin CI terbebani. Bukan untuk menyembunyikan
  // regresi — ambang performa nyata ditegakkan di test kedua (30 dtk).
  it(
    "1000 baris ter-render dengan benar",
    () => {
      const { unmount } = render(<DataTable columns={COLS} rows={makeRows(1000)} />)
      const cells = screen.getAllByRole("cell")
      expect(cells).toHaveLength(1000 * COLS.length)
      expect(screen.getByRole("cell", { name: "baris-999-c7" })).toBeInTheDocument()
      unmount()
    },
    60_000,
  )

  it("waktu render 1000 baris di bawah ambang 30 detik", () => {
    const rows = makeRows(1000)
    const t0 = performance.now()
    const { unmount } = render(<DataTable columns={COLS} rows={rows} />)
    const elapsed = performance.now() - t0
    unmount()
    // Ambang longgar untuk jsdom/React-dev di CI; lihat catatan virtualisasi
    // di header file bila pola ini menjadi kebutuhan produksi.
    expect(elapsed).toBeLessThan(30_000)
  })
})
