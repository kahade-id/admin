/**
 * G524 — Mock provider untuk staging harness.
 *
 * Menyediakan `adminHttp` mock yang diisi data sintetis (tanpa PII),
 * sehingga alur halaman bisa diuji end-to-end di vitest seolah melawan
 * backend staging: list → filter → aksi, termasuk error 4xx/5xx.
 *
 * Beda dengan tests/mocks/admin-http.ts (mock kosong generik): provider
 * ini STATEFUL — aksi tulis (approve/reject/reply) mengubah data sehingga
 * test bisa memverifikasi efeknya.
 */
import { vi } from "vitest"

import {
  syntheticKycQueue,
  syntheticTickets,
  type SyntheticKycRow,
  type SyntheticTicket,
} from "./synthetic"

type Paged<T> = { data: T[]; total: number; page: number; limit: number; totalPages: number }

function paged<T>(items: T[], page = 1, limit = 20): Paged<T> {
  const totalPages = Math.max(1, Math.ceil(items.length / limit))
  return {
    data: items.slice((page - 1) * limit, page * limit),
    total: items.length,
    page,
    limit,
    totalPages,
  }
}

export function createStagingProvider() {
  const kyc: SyntheticKycRow[] = syntheticKycQueue(45)
  const tickets: SyntheticTicket[] = syntheticTickets(30)
  const replies: Record<string, string[]> = {}

  const get = vi.fn(async (path: string, opts?: { query?: Record<string, unknown> }) => {
    const params = opts?.query ?? {}
    if (path === "/v1/admin/kyc") {
      const status = params?.status as string | undefined
      const rows = status ? kyc.filter((k) => k.status === status) : kyc
      return paged(rows, Number(params?.page ?? 1), Number(params?.limit ?? 20))
    }
    if (path.startsWith("/v1/admin/kyc/") && !path.includes("sla-config") && !path.includes("metrics")) {
      const id = decodeURIComponent(path.split("/").pop()!)
      const row = kyc.find((k) => k.kycId === id)
      if (!row) throw Object.assign(new Error("Not found"), { status: 404 })
      return row
    }
    if (path === "/v1/admin/support/tickets") {
      return paged(tickets, Number(params?.page ?? 1), Number(params?.limit ?? 20))
    }
    if (path === "/v1/admin/system/configs") return []
    if (path === "/v1/admin/system/configs/pending") return []
    return { data: [], total: 0, page: 1, limit: 20, totalPages: 1 }
  })

  const post = vi.fn(async (path: string, body?: Record<string, unknown>) => {
    // POST /v1/admin/kyc/:id/approve | /reject — kontrak nyata (kyc.ts)
    const decision = path.match(/^\/v1\/admin\/kyc\/([^/]+)\/(approve|reject)$/)
    if (decision) {
      const row = kyc.find((k) => k.kycId === decodeURIComponent(decision[1]))
      if (!row) throw Object.assign(new Error("Not found"), { status: 404 })
      if (row.status !== "PENDING")
        throw Object.assign(new Error("Sudah diproses"), { status: 409 })
      row.status = decision[2] === "approve" ? "APPROVED" : "REJECTED"
      return { ok: true, kycId: row.kycId, status: row.status }
    }
    // POST /v1/admin/support/tickets/:id/reply — kontrak nyata (support.ts)
    const reply = path.match(/^\/v1\/admin\/support\/tickets\/([^/]+)\/reply$/)
    if (reply) {
      const t = tickets.find((x) => x.id === decodeURIComponent(reply[1]))
      if (!t) throw Object.assign(new Error("Not found"), { status: 404 })
      ;(replies[t.id] ??= []).push(String(body?.message ?? ""))
      return { ok: true }
    }
    return { ok: true }
  })

  return {
    mock: { get, post, put: vi.fn(async () => ({ ok: true })), patch: vi.fn(async () => ({ ok: true })), del: vi.fn(async () => ({ ok: true })) },
    data: { kyc, tickets, replies },
  }
}

// ------------------------------------------------------------------
// Singleton yang bisa di-reset — dipakai vi.mock("@/lib/api/admin-client").
// Wrapper mendelegasikan ke provider AKTIF sehingga beforeEach bisa
// me-reset state tanpa me-re-register mock modul.
// ------------------------------------------------------------------

let current = createStagingProvider()

/** Buat provider baru (isolasi antar test); kembalikan data-nya. */
export function resetStagingProvider() {
  current = createStagingProvider()
  stagingAdminHttp.get.mockClear()
  stagingAdminHttp.post.mockClear()
  return current.data
}

/** Data provider aktif (untuk asersi efek tulis). */
export function stagingData() {
  return current.data
}

export const stagingAdminHttp = {
  get: vi.fn((...args: [string, ...unknown[]]) => current.mock.get(args[0], args[1] as never)),
  post: vi.fn((...args: [string, ...unknown[]]) => current.mock.post(args[0], args[1] as never)),
  put: vi.fn(async () => ({ ok: true })),
  patch: vi.fn(async () => ({ ok: true })),
  del: vi.fn(async () => ({ ok: true })),
}
