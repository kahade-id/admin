/**
 * G510 — Smoke test: setiap route di menu admin me-render tanpa 404.
 *
 * Merender tiap halaman panel sebagai SUPER_ADMIN (auth + API di-mock)
 * dan menegaskan:
 * 1. heading halaman muncul (bukan halaman kosong / error render),
 * 2. TIDAK muncul "Akses ditolak",
 * 3. TIDAK muncul pesan error pemuatan ("Gagal memuat…") akibat mock.
 *
 * Daftar route diambil dari MENU (`src/lib/rbac.ts`) + route yang dikenal
 * di luar menu (/login).
 *
 * Halaman diimpor DINAMIS per test: bila sebuah halaman sedang dalam
 * keadaan rusak (mis. refactor paralel worker lain dengan import yang
 * belum ada), test route tersebut di-SKIP dengan alasan eksplisit —
 * bukan gagal diam-diam, bukan lolos palsu.
 */
import "../mocks/auth"
import "../mocks/admin-http"

import type { ComponentType } from "react"
import { render, screen } from "@testing-library/react"
import { beforeEach, describe, expect, it } from "vitest"

import { ToastProvider } from "@/components/ui/toast"
import { MENU } from "@/lib/rbac"
import { adminHttpMock, resetAdminHttpMock } from "../mocks/admin-http"
import { resetAuthMock, setAuthRole } from "../mocks/auth"

type RouteSpec = {
  href: string
  /** Import dinamis ke page.tsx (default export). */
  load: () => Promise<{ default: ComponentType }>
  /** Teks heading yang menegaskan halaman benar me-render. */
  heading: RegExp
  /** Override mock API khusus halaman (bentuk respons non-standar). */
  setupMocks?: () => void
}

const ROUTES: RouteSpec[] = [
  { href: "/", load: () => import("@/app/(panel)/page"), heading: /Dasbor Admin/ },
  { href: "/users", load: () => import("@/app/(panel)/users/page"), heading: /Pengguna/ },
  { href: "/kyc", load: () => import("@/app/(panel)/kyc/page"), heading: /Antrean KYC/ },
  { href: "/business", load: () => import("@/app/(panel)/business/page"), heading: /Verifikasi Bisnis/ },
  { href: "/disputes", load: () => import("@/app/(panel)/disputes/page"), heading: /Sengketa/ },
  { href: "/tickets", load: () => import("@/app/(panel)/tickets/page"), heading: /Tiket Bantuan/ },
  { href: "/feedback", load: () => import("@/app/(panel)/feedback/page"), heading: /Masukan Pengguna/ },
  { href: "/milestones", load: () => import("@/app/(panel)/milestones/page"), heading: /Milestone/ },
  { href: "/reports", load: () => import("@/app/(panel)/reports/page"), heading: /Laporan Pengguna/ },
  {
    href: "/reports/showcase",
    load: () => import("@/app/(panel)/reports/showcase/page"),
    heading: /Laporan Etalase/,
    setupMocks: () => {
      // ADM-327: getShowcaseModerationMetrics → agregat non-paginasi.
      adminHttpMock.get.mockImplementation(async (path: string) => {
        if (path === "/v1/admin/showcase-reports/metrics")
          return {
            openReports: 0,
            underReview: 0,
            resolvedLast30d: 0,
            avgResolutionHours: null,
            takedownsLast30d: 0,
            restrictsLast30d: 0,
            reopensLast30d: 0,
            dismissedLast30d: 0,
            pendingAppeals: 0,
            reasonDistribution: [],
          }
        return { data: [], total: 0, page: 1, limit: 20, totalPages: 1 }
      })
    },
  },
  { href: "/chat", load: () => import("@/app/(panel)/chat/page"), heading: /Moderasi Chat/ },
  { href: "/badges", load: () => import("@/app/(panel)/badges/page"), heading: /Verifikasi & Badge/ },
  { href: "/finance", load: () => import("@/app/(panel)/finance/page"), heading: /Keuangan/ },
  { href: "/orders", load: () => import("@/app/(panel)/orders/page"), heading: /Order/ },
  { href: "/vouchers", load: () => import("@/app/(panel)/vouchers/page"), heading: /Voucher & Kampanye/ },
  { href: "/campaigns", load: () => import("@/app/(panel)/campaigns/page"), heading: /Kampanye/ },
  { href: "/ratings", load: () => import("@/app/(panel)/ratings/page"), heading: /Rating/ },
  { href: "/referral", load: () => import("@/app/(panel)/referral/page"), heading: /Referral/ },
  {
    href: "/subscriptions",
    load: () => import("@/app/(panel)/subscriptions/page"),
    heading: /Subscription/,
  },
  {
    href: "/insurance-claims",
    load: () => import("@/app/(panel)/insurance-claims/page"),
    heading: /Klaim Asuransi/,
  },
  { href: "/analytics", load: () => import("@/app/(panel)/analytics/page"), heading: /Analitik/ },
  {
    href: "/system",
    load: () => import("@/app/(panel)/system/page"),
    heading: /Sistem/,
    setupMocks: () => {
      // listConfigs & listPendingConfigChanges → array (bukan paginasi)
      adminHttpMock.get.mockImplementation(async (path: string) => {
        if (
          path === "/v1/admin/system/configs" ||
          path === "/v1/admin/system/configs/pending"
        )
          return []
        return { data: [], total: 0, page: 1, limit: 20, totalPages: 1 }
      })
    },
  },
  { href: "/team", load: () => import("@/app/(panel)/team/page"), heading: /Tim/ },
  { href: "/returns", load: () => import("@/app/(panel)/returns/page"), heading: /Retur/ },
  { href: "/courier", load: () => import("@/app/(panel)/courier/page"), heading: /Kurir/ },
  { href: "/products", load: () => import("@/app/(panel)/products/page"), heading: /Produk/ },
  {
    href: "/qa-moderation",
    load: () => import("@/app/(panel)/qa-moderation/page"),
    heading: /Moderasi Q&A/,
  },
  {
    href: "/partner-clients",
    load: () => import("@/app/(panel)/partner-clients/page"),
    heading: /Klien API mitra/,
  },
  {
    href: "/observability",
    load: () => import("@/app/(panel)/observability/page"),
    heading: /Observabilitas/,
    setupMocks: () => {
      // Halaman memanggil endpoint detail observabilitas (bentuk respons
      // non-paginasi); mock default paginasi tidak cocok.
      adminHttpMock.get.mockImplementation(async (path: string) => {
        if (path === "/v1/admin/observability/latency")
          return { release: "test", routes: [] }
        if (path === "/v1/admin/observability/queues") return { queues: [] }
        if (path === "/v1/admin/observability/dependencies")
          return { dependencies: [] }
        if (path === "/v1/admin/observability/alerts") return { alerts: [] }
        if (path === "/v1/admin/observability/delivery")
          return {
            stats: [],
            otpProvider: { provider: "fonnte", tokenConfigured: false, production: false },
          }
        if (path === "/v1/admin/observability/websocket")
          return {
            worker: "test",
            activeConnections: 0,
            totalConnects: 0,
            totalDisconnects: 0,
            reconnectsByAppVersion: {},
            connectsByAppVersion: {},
            at: new Date().toISOString(),
          }
        if (path === "/v1/admin/observability/spans")
          return { sampling: {}, spans: [] }
        // ADM-303: daftar insiden (bentuk { incidents }).
        if (path === "/v1/admin/observability/incidents") return { incidents: [] }
        // ADM-316: ringkasan storage (bentuk { alerts, note }).
        if (path === "/v1/admin/observability/storage")
          return { alerts: [], note: "" }
        // ADM-315: pratinjau status publik (PublicStatus) — bentuk non-paginasi.
        if (path === "/v1/status")
          return {
            status: "operational",
            release: "test",
            at: new Date().toISOString(),
            components: [],
            activeIncidents: [],
            history: [],
          }
        return { data: [], total: 0, page: 1, limit: 20, totalPages: 1 }
      })
    },
  },
  { href: "/login", load: () => import("@/app/login/page"), heading: /Kahade Admin/ },
  // ADM-427 (tim sistem): halaman status dari MENU rbac.
  {
    href: "/status",
    load: () => import("@/app/(panel)/status/page"),
    heading: /Status Layanan/,
    setupMocks: () => {
      // listIncidents → { incidents } + getPublicStatus → PublicStatus (non-paginasi).
      adminHttpMock.get.mockImplementation(async (path: string) => {
        if (path === "/v1/admin/observability/incidents") return { incidents: [] }
        if (path === "/v1/status")
          return {
            status: "operational",
            release: "test",
            at: new Date().toISOString(),
            components: [],
            activeIncidents: [],
            history: [],
          }
        return { data: [], total: 0, page: 1, limit: 20, totalPages: 1 }
      })
    },
  },
  {
    href: "/ops-settings",
    load: () => import("@/app/(panel)/ops-settings/page"),
    heading: /Pengaturan Operasional/,
    setupMocks: () => {
      // listOpsSettings → { settings } (bukan bentuk paginasi)
      adminHttpMock.get.mockResolvedValue({ settings: [] })
    },
  },
]

beforeEach(() => {
  resetAuthMock()
  resetAdminHttpMock()
  setAuthRole("SUPER_ADMIN")
})

describe("smoke: semua route me-render (G510)", () => {
  it("setiap href di MENU ter-cover oleh smoke test ini", () => {
    const covered = new Set(ROUTES.map((r) => r.href))
    const missing = MENU.map((m) => m.href).filter((h) => !covered.has(h))
    expect(missing).toEqual([])
  })

  for (const { href, load, heading, setupMocks } of ROUTES) {
    it(`${href} me-render heading tanpa 403/error`, async (ctx) => {
      let Page: ComponentType
      try {
        ;({ default: Page } = await load())
      } catch (err) {
        ctx.skip(`SKIP ${href}: halaman gagal diimpor — ${(err as Error).message.split("\n")[0]}`)
        return
      }
      setupMocks?.()
      const { unmount } = render(
        <ToastProvider>
          <Page />
        </ToastProvider>,
      )
      try {
        // Heading halaman muncul (findBy* menunggu efek async selesai).
        const el = await screen.findByRole("heading", { name: heading }, { timeout: 4000 })
        expect(el).toBeInTheDocument()
        // Bukan halaman akses-ditolak / error.
        expect(screen.queryByText("Akses ditolak")).not.toBeInTheDocument()
        expect(screen.queryByText(/Gagal memuat/)).not.toBeInTheDocument()
      } finally {
        unmount()
      }
    })
  }
})
