/**
 * H11 — Simpan draf catatan internal (Batch 139).
 *
 * Catatan panjang (sengketa/tiket/moderasi) hilang saat navigasi atau sesi
 * timeout. Hook ini autosave draf per record ke localStorage (debounce) +
 * indikator status simpan. Draf dihapus eksplisit via `clear()` setelah
 * catatan berhasil dikirim.
 *
 * Pemakaian:
 *   const draft = useDraftNote(`dispute:${id}:internal`)
 *   <TextArea value={draft.value} onChange={(e) => draft.setValue(e.target.value)} />
 *   <DraftStatus status={draft.status} />
 */
"use client"

import { useCallback, useEffect, useRef, useState } from "react"

import { cn } from "@/lib/cn"

export type DraftStatus = "idle" | "saving" | "saved"

function keyFor(key: string) {
  return `kahade.admin.draft.${key}`
}

export function useDraftNote(recordKey: string, debounceMs = 800) {
  const [value, setValueState] = useState("")
  const [status, setStatus] = useState<DraftStatus>("idle")
  const [savedAt, setSavedAt] = useState<string | null>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const key = keyFor(recordKey)

  // Muat draf yang ada saat recordKey berubah.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(keyFor(recordKey))
      if (raw) {
        setValueState(raw)
        setStatus("saved")
      } else {
        setValueState("")
        setStatus("idle")
      }
    } catch {
      setValueState("")
      setStatus("idle")
    }
    setSavedAt(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recordKey])

  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    },
    [],
  )

  const setValue = useCallback(
    (v: string) => {
      setValueState(v)
      setStatus("saving")
      if (timerRef.current) clearTimeout(timerRef.current)
      timerRef.current = setTimeout(() => {
        try {
          if (v.trim()) {
            localStorage.setItem(key, v)
          } else {
            localStorage.removeItem(key)
          }
          setSavedAt(new Date().toISOString())
          setStatus("saved")
        } catch {
          setStatus("idle")
        }
      }, debounceMs)
    },
    [key, debounceMs],
  )

  const clear = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current)
    try {
      localStorage.removeItem(key)
    } catch {
      /* abaikan */
    }
    setValueState("")
    setStatus("idle")
    setSavedAt(null)
  }, [key])

  return { value, setValue, status, savedAt, clear, hasDraft: value.trim().length > 0 }
}

/** Indikator kecil status simpan draf. */
export function DraftStatus({ status, savedAt }: { status: DraftStatus; savedAt?: string | null }) {
  if (status === "idle") return null
  return (
    <p
      role="status"
      className={cn(
        "text-caption",
        status === "saving" ? "text-text-tertiary" : "text-success-text",
      )}
    >
      {status === "saving"
        ? "Menyimpan draf…"
        : `Draf tersimpan${savedAt ? ` · ${new Date(savedAt).toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" })}` : ""}`}
    </p>
  )
}
