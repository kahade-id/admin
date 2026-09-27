/**
 * Mock terpusat untuk `@/lib/auth-context` + router Next.js (G501).
 *
 * - `authState` dapat diubah per test: role, status (loading/authed/guest).
 * - `next/link` → `<a href>` biasa; `next/navigation` → stub router.
 *
 * Pola pakai:
 *   import "./mocks/auth"            // atau "../mocks/auth"
 *   import { setAuthRole } from "./mocks/auth"
 *   setAuthRole("KYC_ADMIN")
 */
import type { ReactNode } from "react"
import { vi } from "vitest"
import type { AdminRole } from "@/lib/rbac"
import type { AdminProfile } from "@/lib/api/admin/auth"

const { authState } = vi.hoisted(() => {
  const profile: AdminProfile = {
    id: "adm-1",
    adminId: "adm-1",
    fullName: "Admin QA",
    email: "qa@kahade.id",
    role: "SUPER_ADMIN",
    isActive: true,
    isMfaEnabled: false,
    lastLoginAt: null,
  }
  return {
    authState: {
      status: "authed" as "loading" | "authed" | "guest",
      role: "SUPER_ADMIN" as AdminRole | null,
      profile,
    },
  }
})

export function setAuthRole(role: AdminRole | null) {
  authState.role = role
  authState.status = role ? "authed" : "guest"
  if (role) authState.profile.role = role
}

export function setAuthStatus(status: "loading" | "authed" | "guest") {
  authState.status = status
}

export function resetAuthMock() {
  authState.status = "authed"
  authState.role = "SUPER_ADMIN"
  authState.profile.role = "SUPER_ADMIN"
}

vi.mock("@/lib/auth-context", () => ({
  useAuth: () => ({
    state:
      authState.status === "authed"
        ? { status: "authed" as const, profile: authState.profile }
        : { status: authState.status as "loading" | "guest" },
    profile: authState.status === "authed" ? authState.profile : null,
    role: authState.role,
    refresh: vi.fn(async () => {}),
    logout: vi.fn(async () => {}),
  }),
  AuthProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
  RequireAuth: ({ children }: { children: ReactNode }) => <>{children}</>,
}))

vi.mock("next/link", () => ({
  __esModule: true,
  default: ({
    href,
    children,
    ...rest
  }: {
    href: string
    children: ReactNode
  } & Record<string, unknown>) => (
    <a href={typeof href === "string" ? href : "#"} {...rest}>
      {children}
    </a>
  ),
}))

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
    refresh: vi.fn(),
    prefetch: vi.fn(),
  }),
  usePathname: () => "/",
  useParams: () => ({ id: "test-id-1" }),
  useSearchParams: () => new URLSearchParams(),
}))
