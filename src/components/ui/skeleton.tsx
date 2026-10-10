/**
 * Kahade Admin — <Skeleton> + <TableSkeleton> (§3 loading).
 *
 * Shimmer untuk state loading: ganti blok spinner tengah / area putih
 * kosong saat data dimuat. `animate-pulse` + `bg-surface` (token, mode-aware)
 * — bukan warna hardcode.
 *
 * <TableSkeleton>: tiruan baris tabel (header tetap di-render pemanggil via
 * <DataTable loading>, atau pakai komponen ini standalone di dalam wrapper
 * tabel). Setiap baris shimmer diberi aria-hidden; satu teks sr-only
 * "Memuat…" menjaga screen reader tetap dapat status loading.
 */
"use client"

import { cn } from "@/lib/cn"

// ------------------------------------------------------------------
// Skeleton — balok shimmer generik
// ------------------------------------------------------------------

export type SkeletonProps = {
  className?: string
  /** Label sr-only bila shimmer perlu diumumkan (default: disembunyikan) */
  label?: string
}

export function Skeleton({ className, label }: SkeletonProps) {
  return (
    <div
      aria-hidden={label ? undefined : true}
      role={label ? "status" : undefined}
      aria-label={label}
      className={cn("animate-pulse rounded-xs bg-surface", className)}
    />
  )
}

// ------------------------------------------------------------------
// TableSkeleton — N baris shimmer menyerupai baris tabel
// ------------------------------------------------------------------

export type TableSkeletonProps = {
  /** Jumlah baris shimmer */
  rows?: number
  /** Jumlah kolom (lebar bar shimmer bervariasi per kolom) */
  columns?: number
  className?: string
  /** Teks sr-only untuk screen reader (default "Memuat…") */
  loadingLabel?: string
}

export function TableSkeleton({
  rows = 8,
  columns = 5,
  className,
  loadingLabel = "Memuat…",
}: TableSkeletonProps) {
  return (
    <div
      role="status"
      aria-label={loadingLabel}
      className={cn(
        "w-full overflow-hidden rounded-md border border-border bg-background",
        className,
      )}
    >
      {/* Header tiruan */}
      <div aria-hidden="true" className="border-b border-border bg-surface px-4 py-3">
        <div className="flex gap-4">
          {Array.from({ length: columns }, (_, c) => (
            <div
              key={c}
              className="h-3 animate-pulse rounded-xs bg-border"
              style={{ width: `${64 + ((c * 37) % 48)}px` }}
            />
          ))}
        </div>
      </div>
      {/* Baris shimmer */}
      <div aria-hidden="true">
        {Array.from({ length: rows }, (_, r) => (
          <div
            key={r}
            className="flex items-center gap-4 border-b border-border px-4 py-3 last:border-b-0"
          >
            {Array.from({ length: columns }, (_, c) => (
              <div
                key={c}
                className="h-3.5 animate-pulse rounded-xs bg-surface"
                style={{ width: `${56 + ((r * 53 + c * 29) % 96)}px` }}
              />
            ))}
          </div>
        ))}
      </div>
      <span className="sr-only">{loadingLabel}</span>
    </div>
  )
}
