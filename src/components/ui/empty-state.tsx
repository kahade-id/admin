/**
 * Kahade Admin — <EmptyState> (§9.12).
 *
 * Konten pengganti saat data kosong: list baru, hasil pencarian nihil, belum
 * ada data tersimpan. Bukan untuk error jaringan dan bukan untuk loading.
 *
 * Aturan visual dari sumber yang dipertahankan:
 *   1. Ikon besar dengan tone `text-tertiary` (eksplisit §9.12, bukan
 *      text-secondary) di dalam bidang bertepi varian surface tanpa shadow.
 *      Ukuran bidang 64 (ikon 32); compact 48 (ikon 24).
 *   2. Judul memakai H3 (bukan H2) karena empty state duduk DI DALAM layar
 *      yang sudah punya judul sendiri.
 *   3. Aksi maksimal dua: `action` (utama) dan `secondaryAction` (kedua).
 *   4. `compact` untuk empty state di dalam kartu/section: judul body 600,
 *      padding lebih rapat.
 *
 * Ikon dikirim lewat prop `icon` atau `children` (SVG dengan currentColor).
 */
"use client"

import type { ReactNode } from "react"
import { cn } from "@/lib/cn"

export type EmptyStateProps = {
  /** Ikon (SVG/teks) — alternatif: kirim sebagai children */
  icon?: ReactNode
  children?: ReactNode
  title: string
  description?: string
  /** Tombol utama */
  action?: ReactNode
  /** Tombol kedua di bawah aksi utama */
  secondaryAction?: ReactNode
  /** Versi rapat untuk di dalam Card/Section */
  compact?: boolean
  className?: string
}

export function EmptyState({
  icon,
  children,
  title,
  description,
  action,
  secondaryAction,
  compact = false,
  className,
}: EmptyStateProps) {
  const visual = icon ?? children

  return (
    <div
      role="status"
      className={cn(
        "flex w-full flex-col items-center justify-center text-center",
        compact ? "gap-3 py-6" : "gap-4 py-12",
        className,
      )}
    >
      {visual ? (
        <div
          aria-hidden="true"
          className={cn(
            "flex items-center justify-center rounded-md border border-border bg-surface text-text-tertiary",
            compact ? "h-12 w-12 [&>svg]:h-6 [&>svg]:w-6" : "h-16 w-16 [&>svg]:h-8 [&>svg]:w-8",
          )}
        >
          {visual}
        </div>
      ) : null}

      <div className={cn("mx-auto max-w-[320px]", compact ? "space-y-1" : "space-y-2")}>
        {compact ? (
          <p className="text-body font-semibold text-text-primary">{title}</p>
        ) : (
          <h3 className="text-h3 font-semibold text-text-primary">{title}</h3>
        )}
        {description ? (
          <p className={cn(compact ? "text-caption" : "text-body", "text-text-secondary")}>
            {description}
          </p>
        ) : null}
      </div>

      {action || secondaryAction ? (
        <div
          className={cn(
            "flex w-full max-w-[320px] flex-col items-center gap-2",
            compact ? "pt-1" : "pt-2",
          )}
        >
          {action}
          {secondaryAction}
        </div>
      ) : null}
    </div>
  )
}
