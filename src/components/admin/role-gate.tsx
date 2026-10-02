/**
 * Kahade Admin Web — RoleGate.
 *
 * Bungkus tiap halaman panel: bila role admin tidak boleh mengakses href,
 * tampilkan pesan akses ditolak (sidebar sudah memfilter menu, ini lapis kedua).
 *
 * BAI-009 s/d BAI-012: prop `roles` opsional untuk gate per-AKSI (tombol)
 * selaras `@AdminRoles` backend — role yang tidak diizinkan tidak melihat
 * tombolnya sama sekali (disembunyikan, bukan error), karena backend akan
 * menolak dengan 403. Selama role belum diketahui, tombol tidak dirender
 * untuk menghindari kilasan tombol yang tak bisa dipakai.
 */
"use client"

import type { ReactNode } from "react"

import { EmptyState } from "@/components/ui/empty-state"
import { useAuth } from "@/lib/auth-context"
import { canAccess, type AdminRole } from "@/lib/rbac"
import { Spinner } from "@/components/ui/spinner"

export function RoleGate({
  href,
  roles,
  children,
}: {
  /** Gate level halaman — tolak dengan pesan "Akses ditolak". */
  href?: string
  /**
   * Gate per-aksi — sembunyikan children bila role tidak termasuk daftar.
   * Bila dipakai, `href` diabaikan.
   */
  roles?: AdminRole[]
  children: ReactNode
}) {
  const { state, role } = useAuth()

  if (state.status === "loading") {
    // Gate per-aksi: jangan render tombol sebelum role diketahui.
    if (roles) return null
    return (
      <div className="flex items-center justify-center py-16">
        <Spinner size="md" />
      </div>
    )
  }

  const allowed = roles
    ? role != null && roles.includes(role)
    : canAccess(role, href ?? "")

  if (!allowed) {
    // Gate per-aksi: sembunyikan tombol, bukan tampilkan error.
    if (roles) return null
    return (
      <EmptyState
        title="Akses ditolak"
        description="Role admin Anda tidak memiliki izin untuk membuka halaman ini."
      />
    )
  }

  return <>{children}</>
}
