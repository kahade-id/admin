"use client"

/**
 * H12 — Catatan internal per record: disimpan lokal per admin karena backend
 * belum punya API catatan internal (dispute/ticket).
 *
 * JELAS parsial: hanya draf lokal di perangkat ini, tidak terkirim ke server,
 * dan tidak tersinkron antar admin/perangkat. JANGAN dipakai untuk keputusan
 * yang harus teraudit — itu tetap lewat aksi server resmi.
 */

import { useCallback, useEffect, useState } from "react"

export type InternalNote = {
  id: string
  text: string
  at: string
  author: string
}

function keyFor(recordKey: string, adminId: string) {
  return `kahade.admin.internalNotes.${adminId}.${recordKey}`
}

function loadRaw(recordKey: string, adminId: string): InternalNote[] {
  try {
    const raw = localStorage.getItem(keyFor(recordKey, adminId))
    return raw ? (JSON.parse(raw) as InternalNote[]) : []
  } catch {
    return []
  }
}

/**
 * Daftar catatan internal lokal untuk satu record.
 * @param recordKey mis. `dispute:<id>` atau `ticket:<id>`.
 */
export function useInternalNotes(recordKey: string, adminId: string) {
  const [notes, setNotes] = useState<InternalNote[]>([])

  useEffect(() => {
    setNotes(loadRaw(recordKey, adminId))
  }, [recordKey, adminId])

  const addNote = useCallback(
    (text: string, author: string) => {
      const note: InternalNote = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        text,
        at: new Date().toISOString(),
        author,
      }
      setNotes((prev) => {
        const next = [note, ...prev]
        try {
          localStorage.setItem(keyFor(recordKey, adminId), JSON.stringify(next))
        } catch {
          /* abaikan */
        }
        return next
      })
    },
    [recordKey, adminId],
  )

  const removeNote = useCallback(
    (id: string) => {
      setNotes((prev) => {
        const next = prev.filter((n) => n.id !== id)
        try {
          localStorage.setItem(keyFor(recordKey, adminId), JSON.stringify(next))
        } catch {
          /* abaikan */
        }
        return next
      })
    },
    [recordKey, adminId],
  )

  return { notes, addNote, removeNote }
}
