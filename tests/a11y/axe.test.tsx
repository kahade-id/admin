/**
 * G513 — Automated axe/WCAG scan per halaman panel (vitest-axe).
 *
 * Memakai `vitest-axe` (tersedia di node_modules) + matcher
 * `toHaveNoViolations`. Setiap halaman di-render sebagai SUPER_ADMIN
 * dengan API di-mock, lalu dipindai dengan axe-core (aturan WCAG 2.1
 * default: color-contrast, label, aria-*, heading-order, dll.).
 */
import "../mocks/auth"
import "../mocks/admin-http"

import { render } from "@testing-library/react"
import { axe } from "vitest-axe"
import { toHaveNoViolations } from "vitest-axe/dist/matchers"
import type { AxeMatchers } from "vitest-axe/dist/matchers"
import { beforeEach, describe, expect, it } from "vitest"
import type { ReactElement } from "react"

// vitest-axe 0.1.0 mendaftarkan matcher untuk namespace `Vi` yang tidak
// ada di vitest 3 — daftarkan + augmentasi manual di sini.
declare module "vitest" {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  interface Assertion<T = any> extends AxeMatchers {}
  interface AsymmetricMatchersContaining extends AxeMatchers {}
}

expect.extend({ toHaveNoViolations })

import { ToastProvider } from "@/components/ui/toast"
import { adminHttpMock, resetAdminHttpMock } from "../mocks/admin-http"
import { resetAuthMock, setAuthRole } from "../mocks/auth"

import TicketsPage from "@/app/(panel)/tickets/page"
import KycPage from "@/app/(panel)/kyc/page"
import FinancePage from "@/app/(panel)/finance/page"
import CampaignsPage from "@/app/(panel)/campaigns/page"
import LoginPage from "@/app/login/page"
import { Dialog, ConfirmDialog } from "@/components/ui/dialog"
import { DataTable } from "@/components/ui/table"
import { Pagination } from "@/components/admin/pagination"

beforeEach(() => {
  resetAuthMock()
  resetAdminHttpMock()
  setAuthRole("SUPER_ADMIN")
})

async function axeOf(ui: ReactElement) {
  const { container, unmount } = render(<ToastProvider>{ui}</ToastProvider>)
  // Tunggu efek async (fetch mock) selesai sebelum memindai.
  await new Promise((r) => setTimeout(r, 300))
  const results = await axe(container)
  unmount()
  return results
}

describe("axe scan halaman panel (G513)", () => {
  it("halaman tiket — tanpa pelanggaran WCAG", async () => {
    expect(await axeOf(<TicketsPage />)).toHaveNoViolations()
  })

  it("halaman antrean KYC — tanpa pelanggaran WCAG", async () => {
    adminHttpMock.get.mockImplementation(async (path: string) =>
      path === "/v1/admin/kyc/sla-config"
        ? { configs: { KYC_PERSONAL: { slaHours: 48, useBusinessHours: false } } }
        : { data: [], total: 0, page: 1, limit: 20, totalPages: 1 },
    )
    expect(await axeOf(<KycPage />)).toHaveNoViolations()
  })

  it("halaman keuangan — tanpa pelanggaran WCAG", async () => {
    expect(await axeOf(<FinancePage />)).toHaveNoViolations()
  })

  it("halaman kampanye — tanpa pelanggaran WCAG", async () => {
    expect(await axeOf(<CampaignsPage />)).toHaveNoViolations()
  })

  it("halaman login — tanpa pelanggaran WCAG", async () => {
    const { container, unmount } = render(<LoginPage />)
    await new Promise((r) => setTimeout(r, 200))
    expect(await axe(container)).toHaveNoViolations()
    unmount()
  })
})

describe("axe scan komponen kunci", () => {
  it("<Dialog> terbuka — tanpa pelanggaran", async () => {
    const { container, unmount } = render(
      <Dialog open onClose={() => {}} title="Hapus kampanye">
        <p>Yakin ingin menghapus?</p>
      </Dialog>,
    )
    await new Promise((r) => setTimeout(r, 600))
    expect(await axe(container)).toHaveNoViolations()
    unmount()
  })

  it("<ConfirmDialog> — tanpa pelanggaran", async () => {
    const { container, unmount } = render(
      <ConfirmDialog open onClose={() => {}} onConfirm={() => {}} title="Setujui KYC" />,
    )
    await new Promise((r) => setTimeout(r, 600))
    expect(await axe(container)).toHaveNoViolations()
    unmount()
  })

  it("<DataTable> + <Pagination> — tanpa pelanggaran", async () => {
    const { container, unmount } = render(
      <div>
        <DataTable
          columns={[
            { key: "id", header: "ID" },
            { key: "nama", header: "Nama" },
          ]}
          rows={[
            { id: "1", nama: "Budi" },
            { id: "2", nama: "Sari" },
          ]}
        />
        <Pagination page={1} totalPages={5} total={100} onPageChange={() => {}} />
      </div>,
    )
    expect(await axe(container)).toHaveNoViolations()
    unmount()
  })
})
