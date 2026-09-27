/**
 * LKD-001 — unit test tampilan riwayat lokasi aksi pengguna
 * (`src/components/admin/action-location-view.tsx`) + client API
 * (`src/lib/api/admin/action-locations.ts`).
 *
 * - Koordinat 6 desimal & link Google Maps benar.
 * - Badge "Lokasi ditolak user" muncul saat locationDenied; tanpa link Maps.
 * - Badge "Suspicious" muncul saat suspicious.
 * - Tidak crash saat latitude/longitude null.
 * - Client memanggil endpoint & query yang benar.
 */
import "../mocks/auth"
import "../mocks/admin-http"

import { render, screen } from "@testing-library/react"
import { beforeEach, describe, expect, it } from "vitest"

import {
  ActionLocationHistory,
  actionLocationSourceLabel,
  formatCoordinates,
  googleMapsLink,
  ACTION_LOCATION_TAKE,
} from "@/components/admin/action-location-view"
import { listActionLocations } from "@/lib/api/admin/action-locations"
import type { ActionLocationItem } from "@/lib/api/admin/action-locations"
import { resetAuthMock } from "../mocks/auth"
import { adminHttpMock, resetAdminHttpMock } from "../mocks/admin-http"

beforeEach(() => {
  resetAuthMock()
  resetAdminHttpMock()
})

function item(overrides: Partial<ActionLocationItem> = {}): ActionLocationItem {
  return {
    id: "al-1",
    userId: "user-1",
    actionType: "login",
    referenceType: null,
    referenceId: null,
    latitude: -6.229746,
    longitude: 106.829518,
    accuracy: 12,
    source: "gps",
    locationDenied: false,
    ipAddress: "103.147.9.20",
    suspicious: false,
    createdAt: "2026-09-27T10:00:00.000Z",
    ...overrides,
  }
}

describe("helper lokasi", () => {
  it("googleMapsLink memakai 6 desimal format titik", () => {
    expect(googleMapsLink(-6.229746, 106.829518)).toBe(
      "https://www.google.com/maps?q=-6.229746,106.829518",
    )
  })

  it("formatCoordinates mengembalikan null bila koordinat null", () => {
    expect(formatCoordinates(null, null)).toBeNull()
    expect(formatCoordinates(-6.229746, null)).toBeNull()
    expect(formatCoordinates(-6.229746, 106.829518)).toBe(
      "-6.229746, 106.829518",
    )
  })

  it("actionLocationSourceLabel memetakan kode sumber", () => {
    expect(actionLocationSourceLabel("gps")).toBe("GPS")
    expect(actionLocationSourceLabel("network")).toBe("Jaringan")
    expect(actionLocationSourceLabel("ip")).toBe("IP")
    expect(actionLocationSourceLabel(null)).toBe("—")
  })
})

describe("<ActionLocationHistory>", () => {
  it("menampilkan koordinat 6 desimal dan link Google Maps yang benar", async () => {
    adminHttpMock.get.mockResolvedValue({ items: [item()] })
    render(<ActionLocationHistory userId="user-1" />)

    expect(await screen.findByText("-6.229746, 106.829518")).toBeInTheDocument()
    const link = screen.getByRole("link", { name: /lihat di maps/i })
    expect(link).toHaveAttribute(
      "href",
      "https://www.google.com/maps?q=-6.229746,106.829518",
    )
    expect(link).toHaveAttribute("target", "_blank")
    // Akurasi + sumber + IP tampil
    expect(screen.getByText("± 12 m")).toBeInTheDocument()
    expect(screen.getByText("GPS")).toBeInTheDocument()
    expect(screen.getByText("103.147.9.20")).toBeInTheDocument()
    // Waktu capture format id-ID/WIB
    expect(screen.getByText(/27 Sep 2026/)).toBeInTheDocument()
  })

  it("menampilkan badge 'Lokasi ditolak user' dan tanpa link Maps saat ditolak", async () => {
    adminHttpMock.get.mockResolvedValue({
      items: [
        item({
          id: "al-2",
          latitude: null,
          longitude: null,
          accuracy: null,
          source: null,
          locationDenied: true,
        }),
      ],
    })
    render(<ActionLocationHistory userId="user-1" />)

    expect(
      await screen.findByText("Lokasi ditolak user"),
    ).toBeInTheDocument()
    expect(
      screen.queryByRole("link", { name: /lihat di maps/i }),
    ).not.toBeInTheDocument()
  })

  it("menampilkan badge 'Suspicious' saat suspicious=true", async () => {
    adminHttpMock.get.mockResolvedValue({
      items: [item({ id: "al-3", suspicious: true })],
    })
    render(<ActionLocationHistory userId="user-1" />)

    expect(await screen.findByText("Suspicious")).toBeInTheDocument()
  })

  it("tidak crash saat latitude/longitude null (tanpa locationDenied)", async () => {
    adminHttpMock.get.mockResolvedValue({
      items: [item({ id: "al-4", latitude: null, longitude: null })],
    })
    const { container } = render(<ActionLocationHistory userId="user-1" />)

    await screen.findByText(/login/i)
    expect(container).toBeInTheDocument()
    expect(
      screen.queryByRole("link", { name: /lihat di maps/i }),
    ).not.toBeInTheDocument()
  })

  it("menampilkan pesan error dan tombol coba lagi saat fetch gagal", async () => {
    adminHttpMock.get.mockRejectedValueOnce(new Error("jaringan putus"))
    render(<ActionLocationHistory userId="user-1" />)

    expect(await screen.findByText("jaringan putus")).toBeInTheDocument()
    expect(
      screen.getByRole("button", { name: /coba lagi/i }),
    ).toBeInTheDocument()
  })

  it("menampilkan empty state bila tidak ada riwayat", async () => {
    adminHttpMock.get.mockResolvedValue({ items: [] })
    render(<ActionLocationHistory userId="user-1" />)

    expect(
      await screen.findByText(
        "Tidak ada riwayat lokasi aksi untuk pengguna ini.",
      ),
    ).toBeInTheDocument()
  })
})

describe("listActionLocations (client)", () => {
  it("GET /v1/admin/action-locations dengan query userId & take", async () => {
    adminHttpMock.get.mockResolvedValue({ items: [item()] })
    const out = await listActionLocations({ userId: "user-1", take: 50 })

    expect(adminHttpMock.get).toHaveBeenCalledWith(
      "/v1/admin/action-locations",
      expect.objectContaining({
        query: expect.objectContaining({ userId: "user-1", take: 50 }),
      }),
    )
    expect(out).toHaveLength(1)
    expect(out[0].actionType).toBe("login")
  })

  it("ACTION_LOCATION_TAKE = 50", () => {
    expect(ACTION_LOCATION_TAKE).toBe(50)
  })

  it("mendukung respons array murni dan { data: [...] }", async () => {
    adminHttpMock.get.mockResolvedValueOnce([item({ id: "x1" })])
    expect(await listActionLocations()).toHaveLength(1)

    adminHttpMock.get.mockResolvedValueOnce({ data: [item({ id: "x2" })] })
    const out = await listActionLocations()
    expect(out[0].id).toBe("x2")
  })
})
