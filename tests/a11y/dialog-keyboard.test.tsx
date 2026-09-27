/**
 * G515 — Keyboard untuk dialog: fokus saat dibuka, trap fokus Tab nyata,
 * Escape menutup, dan fokus kembali ke pemicu saat ditutup.
 *
 * WCAG: 2.1.1 (Keyboard), 2.1.2 (No Keyboard Trap — trap di DALAM modal
 * justru yang benar: fokus tidak boleh kabur ke latar), 2.4.3 (Focus Order).
 */
import { fireEvent, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { useState } from "react"
import { describe, expect, it } from "vitest"

import { ConfirmDialog, Dialog } from "@/components/ui/dialog"

function OpenDialog() {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Buka dialog
      </button>
      <Dialog open={open} onClose={() => setOpen(false)} title="Dialog uji">
        <button type="button">Aksi dalam</button>
      </Dialog>
    </>
  )
}

describe("keyboard dialog (G515)", () => {
  it("fokus dipindah ke panel saat dialog dibuka", async () => {
    const { unmount } = render(<OpenDialog />)
    await userEvent.click(screen.getByRole("button", { name: "Buka dialog" }))
    // Tunggu animasi masuk + efek autofocus.
    await new Promise((r) => setTimeout(r, 700))
    expect(screen.getByRole("dialog")).toHaveFocus()
    unmount()
  })

  it("Escape menutup dialog", async () => {
    const { unmount } = render(<OpenDialog />)
    await userEvent.click(screen.getByRole("button", { name: "Buka dialog" }))
    await new Promise((r) => setTimeout(r, 700))
    await userEvent.keyboard("{Escape}")
    await new Promise((r) => setTimeout(r, 400))
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
    unmount()
  })

  it("fokus dikembalikan ke pemicu setelah dialog ditutup", async () => {
    const { unmount } = render(<OpenDialog />)
    const trigger = screen.getByRole("button", { name: "Buka dialog" })
    await userEvent.click(trigger)
    await new Promise((r) => setTimeout(r, 700))
    await userEvent.keyboard("{Escape}")
    // Tunggu animasi keluar 200ms + unmount.
    await new Promise((r) => setTimeout(r, 500))
    expect(trigger).toHaveFocus()
    unmount()
  })

  it("Tab terjebak di dalam dialog (focus trap nyata)", async () => {
    const { unmount } = render(
      <Dialog open onClose={() => {}} title="Dialog uji">
        <button type="button">Pertama</button>
        <button type="button">Kedua</button>
      </Dialog>,
    )
    await new Promise((r) => setTimeout(r, 700))

    // Urutan fokus di panel: [tutup ×] → [Pertama] → [Kedua] → wrap.
    const closeBtn = screen.getByRole("button", { name: "Tutup dialog" })
    const pertama = screen.getByRole("button", { name: "Pertama" })
    const kedua = screen.getByRole("button", { name: "Kedua" })

    closeBtn.focus()
    // Shift+Tab dari elemen pertama → bungkus ke elemen terakhir.
    fireEvent.keyDown(document, { key: "Tab", shiftKey: true })
    expect(kedua).toHaveFocus()

    // Tab dari elemen terakhir → bungkus ke elemen pertama.
    fireEvent.keyDown(document, { key: "Tab" })
    expect(closeBtn).toHaveFocus()

    // Tab di tengah urutan TIDAK dihalangi (handler diam — di browser nyata
    // Tab bawaan memindahkan fokus; di jsdom tidak ada perilaku Tab bawaan).
    pertama.focus()
    fireEvent.keyDown(document, { key: "Tab" })
    expect(pertama).toHaveFocus()
    unmount()
  })

  it("panel dialog memakai role=dialog + aria-modal (WCAG 4.1.2)", async () => {
    const { unmount } = render(
      <ConfirmDialog open onClose={() => {}} onConfirm={() => {}} title="Setujui KYC" />,
    )
    await new Promise((r) => setTimeout(r, 700))
    const dialog = screen.getByRole("dialog", { name: "Setujui KYC" })
    expect(dialog).toHaveAttribute("aria-modal", "true")
    unmount()
  })
})
