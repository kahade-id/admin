/**
 * Kahade Admin Web — layout panel.
 *
 * - Guard: tanpa sesi admin → redirect `/login` (via <RequireAuth>)
 * - Sidebar: menu difilter per RBAC role
 * - Header: info admin (nama + role) + tombol logout
 */
"use client"

import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import type { ReactNode } from "react"

import { Button } from "@/components/ui/button"
import { ToastProvider, useToast } from "@/components/ui/toast"
import { AuthProvider, RequireAuth, useAuth } from "@/lib/auth-context"
import { menuForRole, roleLabel } from "@/lib/rbac"
import { Breadcrumb } from "@/components/admin/breadcrumb"
import { EnvBanner } from "@/components/admin/batch139/env-banner"
import { cn } from "@/lib/cn"

function Sidebar() {
  const pathname = usePathname()
  const { role } = useAuth()
  const menu = menuForRole(role)

  return (
    <aside className="flex w-64 shrink-0 flex-col border-r border-border bg-surface">
      <div className="flex h-16 items-center border-b border-border px-5">
        <Link href="/" className="text-h3 font-bold text-text-primary">
          Kahade Admin
        </Link>
      </div>
      <nav className="flex-1 overflow-y-auto p-3" aria-label="Navigasi admin">
        <ul className="flex flex-col gap-1">
          {menu.map((item) => {
            const active =
              item.href === "/" ? pathname === "/" : pathname.startsWith(item.href)
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  className={cn(
                    "block rounded-sm px-3 py-2 text-body transition-colors",
                    active
                      ? "bg-primary font-semibold text-primary-foreground"
                      : "text-text-secondary hover:bg-surface-elevated hover:text-text-primary",
                  )}
                >
                  {item.label}
                </Link>
              </li>
            )
          })}
        </ul>
      </nav>
      <p className="border-t border-border px-5 py-3 text-caption text-text-tertiary">
        admin.kahade.id
      </p>
    </aside>
  )
}

function Header() {
  const router = useRouter()
  const toast = useToast()
  const { profile, role, logout } = useAuth()

  async function handleLogout() {
    const { serverLogoutOk } = await logout()
    if (!serverLogoutOk) {
      // AUT-004: sesi server mungkin masih hidup — jangan biarkan admin
      // mengira sudah keluar sepenuhnya.
      toast.show({
        title: "Logout tidak tuntas",
        description:
          "Sesi di server mungkin masih aktif karena jaringan bermasalah. Token perangkat ini sudah dihapus.",
        tone: "danger",
      })
    }
    router.replace("/login")
  }

  return (
    <header className="flex h-16 shrink-0 items-center justify-between border-b border-border bg-surface px-6">
      <div className="min-w-0">
        <p className="truncate text-body font-semibold text-text-primary">
          {profile?.fullName ?? "Admin"}
        </p>
        <p className="text-caption text-text-secondary">
          {role ? roleLabel(role) : ""} · {profile?.email ?? ""}
        </p>
      </div>
      <div className="flex items-center gap-2">
        <Link href="/profile" className="text-body text-text-secondary hover:text-text-primary">
          Profil
        </Link>
        <Button variant="ghost" size="sm" fullWidth={false} onClick={handleLogout}>
          Keluar
        </Button>
      </div>
    </header>
  )
}

function PanelShell({ children }: { children: ReactNode }) {
  return (
    <RequireAuth>
      <div className="flex min-h-screen flex-col bg-background">
        {/* H15: banner environment selalu terlihat di paling atas panel. */}
        <EnvBanner />
        <div className="flex min-h-0 flex-1">
          <Sidebar />
          <div className="flex min-w-0 flex-1 flex-col">
            <Header />
            {/* ADM-416: breadcrumb otomatis dari pathname aktif. */}
            <Breadcrumb />
            <main className="flex-1 overflow-y-auto p-6">{children}</main>
          </div>
        </div>
      </div>
    </RequireAuth>
  )
}

export default function PanelLayout({ children }: { children: ReactNode }) {
  return (
    <AuthProvider>
      <ToastProvider>
        <PanelShell>{children}</PanelShell>
      </ToastProvider>
    </AuthProvider>
  )
}
