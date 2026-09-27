/**
 * G517 — Zoom / reflow: tabel lebar tidak terpotong di viewport sempit.
 *
 * WCAG 1.4.10 (Reflow): pada 320px CSS (atau zoom 400%) konten harus bisa
 * dibaca tanpa scroll dua arah. Untuk tabel data yang memang lebar,
 * scroll horizontal SATU arah di dalam region tabel adalah pola yang
 * diterima — yang dilarang adalah konten TERPOTONG tanpa cara mengakses.
 */
import { readdirSync, readFileSync, statSync } from "node:fs"
import { join } from "node:path"
import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import { DataTable, Table } from "@/components/ui/table"

const wideColumns = Array.from({ length: 12 }, (_, i) => ({
  key: `c${i}`,
  header: `Kolom ${i + 1}`,
}))
const wideRows = [
  { c0: "a", c1: "b", c2: "c", c3: "d", c4: "e", c5: "f", c6: "g", c7: "h", c8: "i", c9: "j", c10: "k", c11: "l" },
]

describe("reflow tabel (G517)", () => {
  it("wrapper tabel mengizinkan scroll horizontal (bukan overflow tersembunyi)", () => {
    const { container, unmount } = render(<DataTable columns={wideColumns} rows={wideRows} />)
    const wrapper = container.querySelector("div:has(> table)") as HTMLElement
    // overflow-x-auto (scroll), BUKAN overflow-hidden (potong).
    expect(wrapper.className).toMatch(/overflow-x-auto/)
    expect(wrapper.className).not.toMatch(/overflow-hidden/)
    unmount()
  })

  it("region scroll tabel bisa difokus keyboard (tabindex=0)", () => {
    const { container, unmount } = render(
      <Table>
        <tbody>
          <tr>
            <td>x</td>
          </tr>
        </tbody>
      </Table>,
    )
    const wrapper = container.querySelector("div:has(> table)") as HTMLElement
    expect(wrapper).toHaveAttribute("tabIndex", "0")
    wrapper.focus()
    expect(wrapper).toHaveFocus()
    unmount()
  })

  it("tabel ber-caption menjadi landmark region berlabel unik", () => {
    const { unmount } = render(
      <DataTable columns={wideColumns} rows={wideRows} caption="Antrean penarikan" />,
    )
    expect(screen.getByRole("region", { name: "Antrean penarikan" })).toBeInTheDocument()
    unmount()
  })

  it("audit statis: tidak ada lebar-minimum tetap > 320px di seluruh src", () => {
    // Pola seperti min-w-[1200px] memaksa scroll horizontal seluruh halaman
    // pada zoom 400% / ponsel kecil (WCAG 1.4.10).
    const srcDir = join(__dirname, "../../src")
    const files: string[] = []
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir)) {
        const p = join(dir, entry)
        if (statSync(p).isDirectory()) walk(p)
        else if (/\.(tsx|css)$/.test(p)) files.push(p)
      }
    }
    walk(srcDir)
    const offenders: string[] = []
    for (const file of files) {
      const src = readFileSync(file, "utf8")
      for (const m of src.matchAll(/min-w-\[(\d+)(px)?\]/g)) {
        if (parseInt(m[1], 10) > 320) offenders.push(`${file}:${m[0]}`)
      }
    }
    expect(offenders, `min-width tetap > 320px: ${offenders.join(", ")}`).toEqual([])
  })
})
