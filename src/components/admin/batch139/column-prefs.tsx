/**
 * H02 — Tampilan kolom dapat dikustomisasi (Batch 139).
 *
 * Tabel user/order/dispute/finance/tiket: admin dapat memilih kolom yang
 * tampil + mengubah urutannya. Preferensi disimpan per admin per tabel di
 * localStorage (tidak butuh API backend).
 *
 * Pemakaian:
 *   const cols = useColumnPrefs<Row>("users", [
 *     { key: "name", header: "Nama", render: (r) => r.name },
 *     ...
 *   ])
 *   <DataTable columns={cols.visible} ... />
 *   <Button onClick={cols.openCustomizer}>Kustomisasi kolom</Button>
 *   <ColumnCustomizer prefs={cols} />
 */
"use client"

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react"

import { Button } from "@/components/ui/button"
import { Dialog } from "@/components/ui/dialog"
import { useAuth } from "@/lib/auth-context"
import { cn } from "@/lib/cn"

export type PrefsColumnDef<T> = {
  key: string
  header: string
  render: (row: T) => ReactNode
  /** Kolom yang disembunyikan secara default saat pertama kali dibuka. */
  defaultVisible?: boolean
}

type PrefsState = {
  /** Urutan key kolom. Key baru yang belum dikenal ditambahkan di akhir. */
  order: string[]
  /** Key kolom yang disembunyikan. */
  hidden: string[]
}

function storageKey(adminId: string, tableKey: string) {
  return `kahade.admin.colprefs.${adminId}.${tableKey}`
}

function loadPrefs(key: string): PrefsState | null {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<PrefsState>
    if (!Array.isArray(parsed.order) || !Array.isArray(parsed.hidden)) return null
    return {
      order: parsed.order.filter((x) => typeof x === "string"),
      hidden: parsed.hidden.filter((x) => typeof x === "string"),
    }
  } catch {
    return null
  }
}

export type ColumnPrefs<T> = {
  /** Definisi kolom yang tampil, sesuai urutan preferensi. */
  visible: PrefsColumnDef<T>[]
  all: PrefsColumnDef<T>[]
  hiddenKeys: string[]
  order: string[]
  toggle: (key: string) => void
  move: (key: string, dir: -1 | 1) => void
  reset: () => void
  customizerOpen: boolean
  setCustomizerOpen: (open: boolean) => void
}

export function useColumnPrefs<T>(tableKey: string, defs: PrefsColumnDef<T>[]): ColumnPrefs<T> {
  const { profile } = useAuth()
  const adminId = profile?.adminId ?? "anon"
  const [state, setState] = useState<PrefsState | null>(null)
  const [customizerOpen, setCustomizerOpen] = useState(false)

  useEffect(() => {
    setState(loadPrefs(storageKey(adminId, tableKey)))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [adminId, tableKey])

  const persist = useCallback(
    (next: PrefsState) => {
      setState(next)
      try {
        localStorage.setItem(storageKey(adminId, tableKey), JSON.stringify(next))
      } catch {
        /* penyimpanan penuh/privat — preferensi sesi ini tetap dipakai */
      }
    },
    [adminId, tableKey],
  )

  const order = useMemo(() => {
    const known = defs.map((d) => d.key)
    const saved = state?.order.filter((k) => known.includes(k)) ?? []
    const missing = known.filter((k) => !saved.includes(k))
    return [...saved, ...missing]
  }, [defs, state])

  const hiddenKeys = useMemo(() => {
    if (!state) return defs.filter((d) => d.defaultVisible === false).map((d) => d.key)
    return state.hidden
  }, [defs, state])

  const visible = useMemo(
    () =>
      order
        .map((k) => defs.find((d) => d.key === k))
        .filter((d): d is PrefsColumnDef<T> => !!d && !hiddenKeys.includes(d.key)),
    [order, defs, hiddenKeys],
  )

  const toggle = useCallback(
    (key: string) => {
      const hidden = hiddenKeys.includes(key)
        ? hiddenKeys.filter((k) => k !== key)
        : [...hiddenKeys, key]
      persist({ order, hidden })
    },
    [hiddenKeys, order, persist],
  )

  const move = useCallback(
    (key: string, dir: -1 | 1) => {
      const idx = order.indexOf(key)
      const nextIdx = idx + dir
      if (idx < 0 || nextIdx < 0 || nextIdx >= order.length) return
      const next = [...order]
      const [item] = next.splice(idx, 1)
      next.splice(nextIdx, 0, item)
      persist({ order: next, hidden: hiddenKeys })
    },
    [order, hiddenKeys, persist],
  )

  const reset = useCallback(() => {
    try {
      localStorage.removeItem(storageKey(adminId, tableKey))
    } catch {
      /* abaikan */
    }
    setState(null)
  }, [adminId, tableKey])

  return {
    visible,
    all: defs,
    hiddenKeys,
    order,
    toggle,
    move,
    reset,
    customizerOpen,
    setCustomizerOpen,
  }
}

/** Dialog pilih + urutkan kolom. */
export function ColumnCustomizer<T>({ prefs }: { prefs: ColumnPrefs<T> }) {
  return (
    <Dialog
      open={prefs.customizerOpen}
      onClose={() => prefs.setCustomizerOpen(false)}
      title="Kustomisasi kolom"
      description="Pilih kolom yang tampil dan atur urutannya. Preferensi tersimpan khusus untuk akun admin ini."
    >
      <ul className="flex max-h-96 flex-col gap-1 overflow-y-auto">
        {prefs.order.map((key, idx) => {
          const def = prefs.all.find((d) => d.key === key)
          if (!def) return null
          const hidden = prefs.hiddenKeys.includes(key)
          return (
            <li
              key={key}
              className={cn(
                "flex items-center gap-2 rounded-sm border border-border px-3 py-2",
                hidden && "opacity-60",
              )}
            >
              <input
                type="checkbox"
                checked={!hidden}
                onChange={() => prefs.toggle(key)}
                aria-label={`Tampilkan kolom ${def.header}`}
                className="h-4 w-4 accent-[var(--color-primary)]"
              />
              <span className="flex-1 text-body text-text-primary">{def.header}</span>
              <button
                type="button"
                disabled={idx === 0}
                onClick={() => prefs.move(key, -1)}
                aria-label={`Pindahkan ${def.header} ke atas`}
                className="rounded-sm px-2 py-1 text-body text-text-secondary hover:bg-surface disabled:opacity-30"
              >
                ↑
              </button>
              <button
                type="button"
                disabled={idx === prefs.order.length - 1}
                onClick={() => prefs.move(key, 1)}
                aria-label={`Pindahkan ${def.header} ke bawah`}
                className="rounded-sm px-2 py-1 text-body text-text-secondary hover:bg-surface disabled:opacity-30"
              >
                ↓
              </button>
            </li>
          )
        })}
      </ul>
      <div className="mt-4 flex justify-between gap-2">
        <Button variant="ghost" size="sm" fullWidth={false} onClick={prefs.reset}>
          Kembalikan default
        </Button>
        <Button size="sm" fullWidth={false} onClick={() => prefs.setCustomizerOpen(false)}>
          Selesai
        </Button>
      </div>
    </Dialog>
  )
}
