/**
 * Kahade Admin Web — session context.
 *
 * Menyimpan profil admin + role setelah login; menyediakan guard route:
 * tanpa token → redirect `/login`. Dipakai oleh `(panel)/layout.tsx`.
 */
"use client"

import { useRouter } from "next/navigation"
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react"

import {
  clearAdminAccessToken,
  ensureAdminSession,
  AdminAuthError,
} from "@/lib/api/admin-client"
import {
  adminLogout,
  getAdminProfile,
  type AdminProfile,
} from "@/lib/api/admin/auth"
import type { AdminRole } from "@/lib/rbac"

type AuthState =
  | { status: "loading" }
  | { status: "authed"; profile: AdminProfile }
  | { status: "guest" }

type AuthContextValue = {
  state: AuthState
  profile: AdminProfile | null
  role: AdminRole | null
  /** Muat ulang profil (mis. setelah login). */
  refresh: () => Promise<void>
  /** Logout: panggil backend lalu bersihkan token lokal. */
  logout: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ status: "loading" })

  const refresh = useCallback(async () => {
    // 03-#10: pulihkan sesi via refresh cookie HttpOnly bila token memori
    // kosong (mis. setelah reload halaman).
    const hasSession = await ensureAdminSession()
    if (!hasSession) {
      setState({ status: "guest" })
      return
    }
    try {
      const profile = await getAdminProfile()
      setState({ status: "authed", profile })
    } catch (err) {
      if (err instanceof AdminAuthError) {
        clearAdminAccessToken()
      }
      setState({ status: "guest" })
    }
  }, [])

  const logout = useCallback(async () => {
    await adminLogout()
    setState({ status: "guest" })
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const value = useMemo<AuthContextValue>(() => {
    const profile = state.status === "authed" ? state.profile : null
    return {
      state,
      profile,
      role: (profile?.role as AdminRole | undefined) ?? null,
      refresh,
      logout,
    }
  }, [state, refresh, logout])

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error("useAuth harus dipakai di dalam <AuthProvider>")
  return ctx
}

/**
 * Guard untuk halaman panel: saat belum login → redirect `/login`;
 * saat loading → render fallback.
 */
export function RequireAuth({ children }: { children: ReactNode }) {
  const router = useRouter()
  const { state } = useAuth()

  useEffect(() => {
    if (state.status === "guest") router.replace("/login")
  }, [state.status, router])

  if (state.status !== "authed") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <p className="text-text-secondary">Memuat…</p>
      </div>
    )
  }
  return <>{children}</>
}
