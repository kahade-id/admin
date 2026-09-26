/**
 * Kahade Admin Web — RoleGate.
 *
 * Bungkus tiap halaman panel: bila role admin tidak boleh mengakses href,
 * tampilkan pesan akses ditolak (sidebar sudah memfilter menu, ini lapis kedua).
 */
"use client"

import type { ReactNode } from "react"

import { EmptyState } from "@/components/ui/empty-state"
import { useAuth } from "@/lib/auth-context"
import { canAccess } from "@/lib/rbac"
import { Spinner } from "@/components/ui/spinner"

export function RoleGate({ href, children }: { href: string; children: ReactNode }) {
  const { state, role } = useAuth()

  if (state.status === "loading") {
    return (
      <div className="flex items-center justify-center py-16">
        <Spinner size="md" />
      </div>
    )
  }

  if (!canAccess(role, href)) {
    return (
      <EmptyState
        title="Akses ditolak"
        description="Role admin Anda tidak memiliki izin untuk membuka halaman ini."
      />
    )
  }

  return <>{children}</>
}
