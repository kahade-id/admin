/**
 * G514 — Audit nama aksesibel semua tombol ikon (icon-only buttons).
 *
 * WCAG 4.1.2 (Name, Role, Value): setiap tombol yang hanya berisi ikon
 * WAJIB punya nama aksesibel (aria-label) — jika tidak, screen reader
 * hanya mengumumkan "button" tanpa makna.
 *
 * Audit dilakukan dua lapis:
 * 1. Runtime: tombol tutup <Dialog>, tutup toast, dan tombol navigasi
 *    <Pagination> — semuanya punya nama aksesibel.
 * 2. Statis: seluruh sumber TSX dipindai — <button> tanpa aria-label
 *    WAJIB punya teks konten (bukan ikon saja).
 */
import "../mocks/auth"
import "../mocks/admin-http"

import { fireEvent, render, screen } from "@testing-library/react"
import { beforeEach, describe, expect, it } from "vitest"
import { readdirSync, readFileSync, statSync } from "node:fs"
import { join } from "node:path"

import { ToastProvider, useToast } from "@/components/ui/toast"
import { Dialog } from "@/components/ui/dialog"
import { Pagination } from "@/components/admin/pagination"
import { resetAuthMock, setAuthRole } from "../mocks/auth"
import { resetAdminHttpMock } from "../mocks/admin-http"

beforeEach(() => {
  resetAuthMock()
  resetAdminHttpMock()
  setAuthRole("SUPER_ADMIN")
})

function ToastWithButton() {
  const { show } = useToast()
  return (
    <button type="button" onClick={() => show({ title: "Info" })}>
      tampilkan
    </button>
  )
}

describe("nama aksesibel tombol ikon (G514)", () => {
  it("<Dialog>: tombol tutup punya nama aksesibel 'Tutup dialog'", async () => {
    const { unmount } = render(
      <Dialog open onClose={() => {}} title="Judul">
        isi
      </Dialog>,
    )
    await new Promise((r) => setTimeout(r, 600))
    expect(screen.getByRole("button", { name: "Tutup dialog" })).toBeInTheDocument()
    unmount()
  })

  it("toast: tombol tutup punya nama aksesibel", async () => {
    const { unmount } = render(
      <ToastProvider>
        <ToastWithButton />
      </ToastProvider>,
    )
    fireEvent.click(screen.getByRole("button", { name: "tampilkan" }))
    expect(await screen.findByRole("button", { name: "Tutup notifikasi" })).toBeInTheDocument()
    unmount()
  })

  it("<Pagination>: tombol navigasi & nomor halaman punya nama aksesibel", () => {
    const { unmount } = render(
      <Pagination page={3} totalPages={10} total={200} onPageChange={() => {}} />,
    )
    expect(screen.getByRole("button", { name: /Sebelumnya/i })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /Berikutnya/i })).toBeInTheDocument()
    // Nomor halaman = nama aksesibel "Halaman N".
    expect(screen.getByRole("button", { name: "Halaman 3" })).toHaveAttribute(
      "aria-current",
      "page",
    )
    unmount()
  })

  it("audit statis: tidak ada <button> ikon-saja tanpa aria-label di seluruh src", () => {
    const srcDir = join(__dirname, "../../src")
    const files: string[] = []
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir)) {
        const p = join(dir, entry)
        if (statSync(p).isDirectory()) walk(p)
        else if (p.endsWith(".tsx")) files.push(p)
      }
    }
    walk(srcDir)

    const offenders: string[] = []
    for (const file of files) {
      const src = readFileSync(file, "utf8")
      // Blok JSX multiline: cari <button ...> ... </button> tanpa aria-label/aria-labelledby.
      const blocks = src.match(/<button[\s\S]*?<\/button>/g) ?? []
      for (const block of blocks) {
        const openTag = block.match(/<button[\s\S]*?>/)?.[0] ?? ""
        const hasLabel =
          openTag.includes("aria-label") || openTag.includes("aria-labelledby")
        if (hasLabel) continue
        // Komponen wrapper (base <Button>): label datang dari props
        // `children` / `{...rest}` di call-site — bukan pelanggaran.
        if (openTag.includes("...rest") || openTag.includes("...props")) continue
        const inner = block.slice(openTag.length, block.length - "</button>".length)
        // Hapus ikon SVG dan whitespace; sisa teks = nama aksesibel.
        const text = inner
          .replace(/<svg[\s\S]*?<\/svg>/g, "")
          .replace(/<[^>]+>/g, "")
          .replace(/\{[^}]*\}/g, "")
          .trim()
        // `{children}` yang di-strip regex = label dari props → lewati.
        if (/\{children\}/.test(inner)) continue
        if (text.length === 0) {
          const line = src.slice(0, src.indexOf(block)).split("\n").length
          offenders.push(`${file.replace(srcDir, "src")}:${line}`)
        }
      }
    }
    expect(offenders, `button ikon-saja tanpa nama aksesibel: ${offenders.join(", ")}`).toEqual(
      [],
    )
  })
})
