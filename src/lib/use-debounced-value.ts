/**
 * Kahade Admin — `useDebouncedValue` (shared).
 *
 * Sebelumnya setiap halaman list mendefinisikan hook debounce-nya sendiri
 * (users, orders, finance, ratings, referral, subscriptions). Satu hook
 * bersama supaya delay & perilaku konsisten: input pencarian tidak memicu
 * request tiap keystroke.
 */
"use client"

import { useEffect, useState } from "react"

export function useDebouncedValue<T>(value: T, delayMs = 400): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs)
    return () => clearTimeout(timer)
  }, [value, delayMs])
  return debounced
}
