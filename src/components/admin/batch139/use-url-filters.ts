/**
 * H01 — Filter tersimpan di URL (Batch 139).
 *
 * Sinkronkan query, page, sort, dan filter aman ke URL (search params) agar
 * refresh / berbagi tautan tidak menghilangkan filter.
 *
 * Pemakaian:
 *   const { values, set, reset } = useUrlFilters({ q: "", status: "all", sort: "createdAt-desc", page: "1" })
 *   // values: dibaca dari URL (fallback ke defaults)
 *   // set({ q: "budi" }) → router.replace dengan param ter-update (scroll: false)
 *   // Nilai yang sama dengan default TIDAK ditulis ke URL (URL tetap bersih).
 *
 * Catatan:
 * - Semua nilai berupa string. Konversi angka (page) dilakukan di pemanggil.
 * - Untuk input pencarian, panggil `set` dari nilai yang SUDAH di-debounce
 *   agar tidak membanjiri history/replace per keystroke.
 * - Hanya filter "aman" yang disinkronkan — jangan masukkan token/PII mentah.
 */
"use client"

import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { useCallback, useMemo, useRef } from "react"

export type UrlFilterValues = Record<string, string>

export function useUrlFilters<T extends UrlFilterValues>(defaults: T) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const defaultsRef = useRef(defaults)
  defaultsRef.current = defaults

  const values = useMemo(() => {
    const out = { ...defaultsRef.current } as T
    for (const key of Object.keys(defaultsRef.current)) {
      const v = searchParams.get(key)
      if (v !== null) (out as Record<string, string>)[key] = v
    }
    return out
  }, [searchParams])

  const set = useCallback(
    (patch: Partial<T>) => {
      const params = new URLSearchParams(searchParams.toString())
      const defs = defaultsRef.current as Record<string, string>
      for (const [k, raw] of Object.entries(patch)) {
        const v = raw as string | undefined | null
        if (v === undefined || v === null || v === "" || v === defs[k]) {
          params.delete(k)
        } else {
          params.set(k, v)
        }
      }
      const qs = params.toString()
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false })
    },
    [router, pathname, searchParams],
  )

  const reset = useCallback(() => {
    router.replace(pathname, { scroll: false })
  }, [router, pathname])

  return { values, set, reset }
}

/** Helper: parse page string → number aman (min 1). */
export function parsePage(v: string | undefined, fallback = 1): number {
  const n = Number.parseInt(v ?? "", 10)
  return Number.isFinite(n) && n >= 1 ? n : fallback
}
