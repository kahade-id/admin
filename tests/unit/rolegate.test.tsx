/**
 * G502 — Unit test komponen <RoleGate> (`src/components/admin/role-gate.tsx`).
 *
 * Untuk tiap role (SUPER_ADMIN, DISPUTE_ADMIN, KYC_ADMIN, FINANCE_ADMIN,
 * CUSTOMER_SUPPORT): render konten bila boleh, tampilkan "Akses ditolak"
 * bila tidak. Plus state loading (spinner) dan guest.
 */
import "../mocks/auth"
import "../mocks/admin-http"

import { render, screen } from "@testing-library/react"
import { beforeEach, describe, expect, it } from "vitest"

import { RoleGate } from "@/components/admin/role-gate"
import type { AdminRole } from "@/lib/rbac"
import { resetAuthMock, setAuthRole, setAuthStatus } from "../mocks/auth"

beforeEach(() => {
  resetAuthMock()
})

function renderGate(href: string, role: AdminRole | null) {
  setAuthRole(role)
  return render(
    <RoleGate href={href}>
      <p>konten-rahasia-{href}</p>
    </RoleGate>,
  )
}

describe("<RoleGate>", () => {
  it("menampilkan spinner saat sesi masih loading", () => {
    setAuthStatus("loading")
    render(
      <RoleGate href="/kyc">
        <p>konten</p>
      </RoleGate>,
    )
    expect(screen.queryByText("konten")).not.toBeInTheDocument()
    expect(screen.queryByText("Akses ditolak")).not.toBeInTheDocument()
    // Spinner: role="status" + aria-label "Memuat" (border spinner, bukan svg)
    const spinner = screen.getByLabelText("Memuat")
    expect(spinner).toBeInTheDocument()
    expect(spinner).toHaveAttribute("role", "status")
  })

  it("SUPER_ADMIN lolos di semua halaman", () => {
    const hrefs = ["/", "/kyc", "/finance", "/disputes", "/tickets", "/campaigns", "/system"]
    for (const href of hrefs) {
      const { unmount } = renderGate(href, "SUPER_ADMIN")
      expect(screen.getByText(`konten-rahasia-${href}`)).toBeInTheDocument()
      expect(screen.queryByText("Akses ditolak")).not.toBeInTheDocument()
      unmount()
    }
  })

  it("KYC_ADMIN: boleh /kyc & /business, ditolak /finance & /tickets", () => {
    for (const href of ["/kyc", "/business"]) {
      const { unmount } = renderGate(href, "KYC_ADMIN")
      expect(screen.getByText(`konten-rahasia-${href}`)).toBeInTheDocument()
      unmount()
    }
    for (const href of ["/finance", "/tickets", "/disputes", "/campaigns"]) {
      const { unmount } = renderGate(href, "KYC_ADMIN")
      expect(screen.queryByText(`konten-rahasia-${href}`)).not.toBeInTheDocument()
      expect(screen.getByText("Akses ditolak")).toBeInTheDocument()
      unmount()
    }
  })

  it("FINANCE_ADMIN: boleh /finance, ditolak /kyc & /campaigns", () => {
    {
      const { unmount } = renderGate("/finance", "FINANCE_ADMIN")
      expect(screen.getByText("konten-rahasia-/finance")).toBeInTheDocument()
      unmount()
    }
    for (const href of ["/kyc", "/campaigns", "/tickets"]) {
      const { unmount } = renderGate(href, "FINANCE_ADMIN")
      expect(screen.getByText("Akses ditolak")).toBeInTheDocument()
      unmount()
    }
  })

  it("DISPUTE_ADMIN: boleh /disputes, ditolak /users & /finance", () => {
    {
      const { unmount } = renderGate("/disputes", "DISPUTE_ADMIN")
      expect(screen.getByText("konten-rahasia-/disputes")).toBeInTheDocument()
      unmount()
    }
    for (const href of ["/users", "/finance"]) {
      const { unmount } = renderGate(href, "DISPUTE_ADMIN")
      expect(screen.getByText("Akses ditolak")).toBeInTheDocument()
      unmount()
    }
  })

  it("CUSTOMER_SUPPORT: boleh /tickets, ditolak /finance & /system", () => {
    {
      const { unmount } = renderGate("/tickets", "CUSTOMER_SUPPORT")
      expect(screen.getByText("konten-rahasia-/tickets")).toBeInTheDocument()
      unmount()
    }
    for (const href of ["/finance", "/system", "/team", "/campaigns"]) {
      const { unmount } = renderGate(href, "CUSTOMER_SUPPORT")
      expect(screen.getByText("Akses ditolak")).toBeInTheDocument()
      unmount()
    }
  })

  it("guest (tanpa role) selalu ditolak", () => {
    const { unmount } = renderGate("/tickets", null)
    expect(screen.getByText("Akses ditolak")).toBeInTheDocument()
    unmount()
  })

  it("pesan penolakan menjelaskan cara menghubungi (copy jelas)", () => {
    renderGate("/finance", "CUSTOMER_SUPPORT")
    expect(screen.getByText("Akses ditolak")).toBeInTheDocument()
    expect(
      screen.getByText(/tidak memiliki izin untuk membuka halaman ini/i),
    ).toBeInTheDocument()
  })
})
