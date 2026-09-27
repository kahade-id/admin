/**
 * Mock terpusat untuk `@/lib/api/admin-client` (G501).
 *
 * Semua fungsi API admin (`src/lib/api/admin/*`) mendelegasikan ke
 * `adminHttp`; mock ini memutus akses jaringan dan mencatat setiap
 * pemanggilan (method, path, body, query) sehingga test kontrak API
 * bisa menegaskan endpoint/metode/payload yang benar.
 */
import { vi } from "vitest"

const { fns } = vi.hoisted(() => ({
  fns: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  },
}))

export const adminHttpMock = fns

export function resetAdminHttpMock() {
  fns.get.mockReset()
  fns.post.mockReset()
  fns.put.mockReset()
  fns.patch.mockReset()
  fns.delete.mockReset()
  // Default: respons paginasi kosong yang valid untuk semua halaman.
  fns.get.mockResolvedValue({ data: [], total: 0, page: 1, limit: 20, totalPages: 1 })
  fns.post.mockResolvedValue({ message: "ok" })
  fns.put.mockResolvedValue({ message: "ok" })
  fns.patch.mockResolvedValue({ message: "ok" })
  fns.delete.mockResolvedValue({ message: "ok" })
}

/** Respons paginasi kosong — bentuk `createPaginatedResponse` backend. */
export function emptyPage<T = unknown>(overrides?: Partial<Record<string, unknown>>) {
  return {
    data: [] as T[],
    total: 0,
    page: 1,
    limit: 20,
    totalPages: 1,
    ...overrides,
  }
}

vi.mock("@/lib/api/admin-client", () => ({
  adminHttp: fns,
  AdminAuthError: class AdminAuthError extends Error {
    constructor(message = "Sesi admin berakhir.") {
      super(message)
      this.name = "AdminAuthError"
    }
  },
  getAdminAccessToken: vi.fn(() => null),
  setAdminAccessToken: vi.fn(),
  clearAdminAccessToken: vi.fn(),
  ensureAdminSession: vi.fn(async () => false),
}))
