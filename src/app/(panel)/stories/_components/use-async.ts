"use client"

/**
 * Muat data asinkron tanpa setState sinkron di dalam effect
 * (lint `react-hooks/set-state-in-effect`). Identitas `fetcher`
 * (bungkus dengan `useCallback`) + `refreshKey` adalah kunci muat:
 * berubah → memuat ulang; `loading` turunan dari apakah hasil terakhir
 * milik kunci yang sama. Tidak ada cache lintas mount — URL media Story
 * bertanda tangan singkat (300/900 dtk) sehingga setiap pembukaan memuat
 * ulang dari server.
 */

import { useCallback, useEffect, useState } from "react"

type Result<T> = {
  fn: () => Promise<T>
  key: number
  data: T | null
  error: unknown
}

export function useAsync<T>(fetcher: () => Promise<T>, refreshKey = 0) {
  const [retry, setRetry] = useState(0)
  const [result, setResult] = useState<Result<T> | null>(null)
  const key = refreshKey * 1_000_003 + retry

  useEffect(() => {
    let alive = true
    fetcher()
      .then((data) => {
        if (alive) setResult({ fn: fetcher, key, data, error: null })
      })
      .catch((error: unknown) => {
        if (alive) setResult({ fn: fetcher, key, data: null, error })
      })
    return () => {
      alive = false
    }
  }, [fetcher, key])

  const fresh = result !== null && result.fn === fetcher && result.key === key
  const reload = useCallback(() => setRetry((r) => r + 1), [])
  const mutate = useCallback((updater: (prev: T) => T) => {
    setResult((prev) =>
      prev && prev.data !== null ? { ...prev, data: updater(prev.data) } : prev,
    )
  }, [])

  return {
    data: fresh ? result.data : null,
    error: fresh ? result.error : null,
    loading: !fresh,
    reload,
    mutate,
  }
}
