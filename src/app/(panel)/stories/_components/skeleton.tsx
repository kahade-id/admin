"use client"

/** Shimmer sederhana (bukan layar kosong) untuk halaman Story. */

import { cn } from "@/lib/cn"

export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden="true" className={cn("animate-pulse rounded-sm bg-surface-elevated", className)} />
}

export function CardListSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div className="space-y-3" role="status" aria-label="Memuat">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex gap-4 rounded-sm border border-border bg-surface p-4">
          <Skeleton className="aspect-[9/16] w-16" />
          <div className="flex-1 space-y-2 py-1">
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-3 w-64" />
            <Skeleton className="h-3 w-24" />
          </div>
        </div>
      ))}
    </div>
  )
}

export function TableSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div className="space-y-2" role="status" aria-label="Memuat">
      {Array.from({ length: rows }).map((_, i) => (
        <Skeleton key={i} className="h-12 w-full" />
      ))}
    </div>
  )
}
