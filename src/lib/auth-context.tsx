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
  useRef,
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
import { Button } from "@/components/ui/button"
import { Dialog } from "@/components/ui/dialog"

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
  /** Logout: panggil backend (retry 3x) lalu bersihkan token lokal.
   * Mengembalikan serverLogoutOk — false bila sesi server mungkin masih hidup. */
  logout: () => Promise<{ serverLogoutOk: boolean }>
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
    const result = await adminLogout()
    setState({ status: "guest" })
    return result
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  /**
   * P2 (audit integrasi 2026-10-06): idle session timeout.
   * 15 menit tanpa aktivitas (mouse/keyboard/sentuh/scroll) → dialog
   * peringatan dengan hitung mundur 60 detik → auto-logout. Aktivitas
   * apa pun me-reset timer. Mitigasi: browser idle yang terbuka tidak
   * bisa dipakai untuk approve disbursement/force-cancel tanpa batas.
   */
  const [idleWarnOpen, setIdleWarnOpen] = useState(false)
  const [idleSecondsLeft, setIdleSecondsLeft] = useState(0)
  const rearmIdleRef = useRef<() => void>(() => {})

  useEffect(() => {
    if (state.status !== "authed") {
      setIdleWarnOpen(false)
      return
    }
    const IDLE_LIMIT_MS = 15 * 60 * 1000
    const IDLE_WARN_MS = 60 * 1000
    let warnTimer: ReturnType<typeof setTimeout> | null = null
    let logoutTimer: ReturnType<typeof setTimeout> | null = null
    let countdownTimer: ReturnType<typeof setInterval> | null = null

    const clearTimers = () => {
      if (warnTimer) clearTimeout(warnTimer)
      if (logoutTimer) clearTimeout(logoutTimer)
      if (countdownTimer) clearInterval(countdownTimer)
      warnTimer = logoutTimer = countdownTimer = null
    }

    const startWarning = () => {
      const deadline = Date.now() + IDLE_WARN_MS
      setIdleWarnOpen(true)
      setIdleSecondsLeft(Math.ceil(IDLE_WARN_MS / 1000))
      countdownTimer = setInterval(() => {
        setIdleSecondsLeft(Math.max(0, Math.ceil((deadline - Date.now()) / 1000)))
      }, 1000)
      logoutTimer = setTimeout(() => {
        clearTimers()
        setIdleWarnOpen(false)
        void logout()
      }, IDLE_WARN_MS)
    }

    const arm = () => {
      clearTimers()
      setIdleWarnOpen(false)
      warnTimer = setTimeout(startWarning, IDLE_LIMIT_MS - IDLE_WARN_MS)
    }
    rearmIdleRef.current = arm

    const onActivity = () => arm()
    const events = ["mousemove", "mousedown", "keydown", "scroll", "touchstart", "wheel"] as const
    events.forEach((e) => window.addEventListener(e, onActivity, { passive: true }))
    arm()

    return () => {
      clearTimers()
      events.forEach((e) => window.removeEventListener(e, onActivity))
    }
  }, [state.status, logout])

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

  return (
    <AuthContext.Provider value={value}>
      {children}
      <Dialog
        open={idleWarnOpen}
        onClose={() => rearmIdleRef.current()}
        title="Sesi akan berakhir"
        description={`Tidak ada aktivitas selama 14 menit. Anda akan keluar otomatis dalam ${idleSecondsLeft} detik.`}
        footer={
          <Button onClick={() => rearmIdleRef.current()}>Tetap masuk</Button>
        }
      >
        <p className="text-sm text-text-secondary">
          Klik “Tetap masuk” atau lakukan aktivitas apa pun untuk melanjutkan sesi.
        </p>
      </Dialog>
    </AuthContext.Provider>
  )
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
