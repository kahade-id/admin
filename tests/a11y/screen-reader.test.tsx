/**
 * G518 — Screen reader: semantik tabel, caption, scope header, label
 * pagination, dan status alert memakai aria-live.
 *
 * WCAG: 1.3.1 (Info and Relationships), 4.1.3 (Status Messages).
 */
import "../mocks/auth"
import "../mocks/admin-http"

import { fireEvent, render, screen } from "@testing-library/react"
import { beforeEach, describe, expect, it } from "vitest"

import { DataTable } from "@/components/ui/table"
import { Pagination } from "@/components/admin/pagination"
import { ToastProvider, useToast } from "@/components/ui/toast"
import { resetAuthMock, setAuthRole } from "../mocks/auth"
import { resetAdminHttpMock } from "../mocks/admin-http"

beforeEach(() => {
  resetAuthMock()
  resetAdminHttpMock()
  setAuthRole("SUPER_ADMIN")
})

const columns = [
  { key: "id", header: "ID" },
  { key: "nama", header: "Nama" },
]
const rows = [
  { id: "1", nama: "Budi" },
  { id: "2", nama: "Sari" },
]

describe("semantik screen reader (G518)", () => {
  it("<DataTable> memakai elemen table asli dengan header <th>", () => {
    const { unmount } = render(<DataTable columns={columns} rows={rows} />)
    const table = screen.getByRole("table")
    expect(table.tagName).toBe("TABLE")
    const headers = screen.getAllByRole("columnheader")
    expect(headers.map((h) => h.textContent)).toEqual(["ID", "Nama"])
    // sel data terhubung ke header via struktur tabel asli
    expect(screen.getAllByRole("cell")).toHaveLength(4)
    unmount()
  })

  it("<DataTable caption>: caption dibaca screen reader", () => {
    const { unmount } = render(
      <DataTable columns={columns} rows={rows} caption="Daftar pengguna terverifikasi" />,
    )
    const table = screen.getByRole("table")
    const caption = table.querySelector("caption")
    expect(caption?.textContent).toBe("Daftar pengguna terverifikasi")
    unmount()
  })

  it("<Pagination>: nav berlabel + aria-current di halaman aktif", () => {
    const { unmount } = render(
      <Pagination page={2} totalPages={5} total={100} onPageChange={() => {}} />,
    )
    expect(screen.getByRole("navigation", { name: /paginasi|pagination/i })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Halaman 2" })).toHaveAttribute(
      "aria-current",
      "page",
    )
    unmount()
  })

  it("toast memakai aria-live (status alert) — diumumkan screen reader", async () => {
    function Show() {
      const { show } = useToast()
      return (
        <button type="button" onClick={() => show({ title: "KYC disetujui" })}>
          tampilkan
        </button>
      )
    }
    const { unmount } = render(
      <ToastProvider>
        <Show />
      </ToastProvider>,
    )
    fireEvent.click(screen.getByRole("button", { name: "tampilkan" }))
    // role=status (aria-live polite implisit) — diumumkan tanpa memindah fokus.
    expect(await screen.findByRole("status")).toHaveTextContent("KYC disetujui")
    unmount()
  })

  it("status kosong tabel diumumkan sebagai teks (bukan tabel kosong bisu)", async () => {
    const { unmount } = render(
      <DataTable columns={columns} rows={[]} emptyText="Belum ada pengajuan KYC" />,
    )
    expect(screen.getByRole("table")).toHaveTextContent("Belum ada pengajuan KYC")
    unmount()
  })
})
