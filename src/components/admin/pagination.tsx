/**
 * Kahade Admin Web — Pagination bernomor (dipakai semua halaman tabel).
 */
"use client"

import { Button } from "@/components/ui/button"
import { cn } from "@/lib/cn"

export type PaginationProps = {
  /** Halaman aktif, 1-based */
  page: number
  /** Total halaman (≥1) */
  totalPages: number
  /** Total item — untuk label "Menampilkan x–y dari z" */
  total?: number
  /** Ukuran halaman */
  pageSize?: number
  onPageChange: (page: number) => void
  disabled?: boolean
  className?: string
  /**
   * G518: label landmark nav. WAJIB unik bila >1 paginasi di satu halaman
   * (axe landmark-unique). Default "Paginasi".
   */
  ariaLabel?: string
}

/** Daftar nomor halaman dengan ellipsis (maks 7 slot). */
function pageNumbers(page: number, totalPages: number): Array<number | "…"> {
  if (totalPages <= 7) return Array.from({ length: totalPages }, (_, i) => i + 1)
  const pages = new Set<number>([1, 2, page - 1, page, page + 1, totalPages - 1, totalPages])
  const sorted = [...pages].filter((p) => p >= 1 && p <= totalPages).sort((a, b) => a - b)
  const out: Array<number | "…"> = []
  let prev = 0
  for (const p of sorted) {
    if (p - prev > 1) out.push("…")
    out.push(p)
    prev = p
  }
  return out
}

export function Pagination({
  page,
  totalPages,
  total,
  pageSize = 20,
  onPageChange,
  disabled = false,
  className,
  ariaLabel = "Paginasi",
}: PaginationProps) {
  const safe = Math.max(1, totalPages)
  const from = total != null ? (page - 1) * pageSize + 1 : null
  const to = total != null ? Math.min(page * pageSize, total) : null

  // G518: landmark <nav> berlabel agar screen reader mengenali blok paginasi.
  return (
    <nav aria-label={ariaLabel} className={cn("flex flex-wrap items-center justify-between gap-3", className)}>
      <p className="text-caption text-text-secondary">
        {total != null && total > 0
          ? `Menampilkan ${from}–${to} dari ${total.toLocaleString("id-ID")} data`
          : "Tidak ada data"}
      </p>
      <div className="flex items-center gap-1">
        <Button
          variant="secondary"
          size="sm"
          disabled={disabled || page <= 1}
          onClick={() => onPageChange(page - 1)}
          aria-label="Halaman sebelumnya"
        >
          ‹
        </Button>
        {pageNumbers(page, safe).map((p, i) =>
          p === "…" ? (
            <span key={`e${i}`} className="px-1 text-caption text-text-tertiary">
              …
            </span>
          ) : (
            <Button
              key={p}
              variant={p === page ? "primary" : "ghost"}
              size="sm"
              disabled={disabled}
              onClick={() => onPageChange(p)}
              aria-label={`Halaman ${p}`}
              aria-current={p === page ? "page" : undefined}
            >
              {p}
            </Button>
          ),
        )}
        <Button
          variant="secondary"
          size="sm"
          disabled={disabled || page >= safe}
          onClick={() => onPageChange(page + 1)}
          aria-label="Halaman berikutnya"
        >
          ›
        </Button>
      </div>
    </nav>
  )
}
