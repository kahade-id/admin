"use client"

/**
 * Keyboard shortcuts untuk halaman daftar admin (sengketa, tiket).
 *
 * - "/" : fokus ke kolom pencarian
 * - "j"/"k" : pindah baris aktif (bawah/atas)
 * - "Enter" : buka baris aktif (halaman detail)
 *
 * Diabaikan saat fokus sedang di input/textarea/select/contenteditable atau
 * saat ada dialog/modal terbuka. Pemanggil me-reset baris aktif lewat
 * `setActiveIndex(0)` setiap halaman/filter/pencarian berganti.
 */

import { useCallback, useEffect, useRef, useState, type RefObject } from "react"

export function useListShortcuts<T>(opts: {
  rows: T[]
  searchInputRef: RefObject<HTMLInputElement | null>
  onOpen: (row: T) => void
}): { activeIndex: number; setActiveIndex: (i: number) => void } {
  const { rows, searchInputRef, onOpen } = opts
  const [activeIndex, setActiveIndex] = useState(0)

  const rowsRef = useRef<T[]>(rows)
  const onOpenRef = useRef(onOpen)
  const activeRef = useRef(0)

  useEffect(() => {
    rowsRef.current = rows
  }, [rows])
  useEffect(() => {
    onOpenRef.current = onOpen
  }, [onOpen])

  const setActive = useCallback((i: number) => {
    activeRef.current = i
    setActiveIndex(i)
  }, [])

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null
      // Abaikan bila admin sedang mengetik di form.
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT" ||
          target.isContentEditable)
      ) {
        return
      }
      // Abaikan bila dialog/modal terbuka (punya trap fokus sendiri).
      if (document.querySelector('[role="dialog"]')) return

      if (e.key === "/") {
        e.preventDefault()
        searchInputRef.current?.focus()
        searchInputRef.current?.select()
        return
      }
      const list = rowsRef.current
      if (list.length === 0) return
      if (e.key === "j" || e.key === "k") {
        e.preventDefault()
        const next =
          e.key === "j"
            ? Math.min(list.length - 1, activeRef.current + 1)
            : Math.max(0, activeRef.current - 1)
        activeRef.current = next
        setActiveIndex(next)
        return
      }
      if (e.key === "Enter") {
        const idx = Math.min(activeRef.current, list.length - 1)
        const row = list[idx]
        if (row) {
          e.preventDefault()
          onOpenRef.current(row)
        }
      }
    }
    document.addEventListener("keydown", handler)
    return () => document.removeEventListener("keydown", handler)
  }, [searchInputRef])

  return { activeIndex, setActiveIndex: setActive }
}
