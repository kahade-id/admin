/**
 * H10 — Checklist bukti sebelum keputusan (Batch 139).
 *
 * Detail sengketa/retur: tandai bukti yang sudah dibuka; tampilkan item yang
 * belum diperiksa sebelum keputusan dikirim. Status "dibuka" disimpan per
 * admin per sengketa di localStorage (ringan, tanpa API baru).
 *
 * Pemakaian:
 *   const checklist = useEvidenceChecklist(disputeId, evidenceIds)
 *   // saat admin membuka bukti: checklist.markOpened(evidenceId)
 *   <EvidenceChecklist checklist={checklist} items={[{id, label}]} />
 *   // gate tombol keputusan: checklist.unopenedCount
 */
"use client"

import { useCallback, useEffect, useMemo, useState } from "react"

import { Badge } from "@/components/ui/badge"

function keyFor(disputeId: string, adminId: string) {
  return `kahade.admin.evidence.${adminId}.${disputeId}`
}

export type EvidenceChecklistState = {
  /** Tandai bukti sudah dibuka/diperiksa. */
  markOpened: (evidenceId: string) => void
  isOpened: (evidenceId: string) => boolean
  openedCount: number
  unopenedCount: number
  unopenedIds: string[]
  reset: () => void
}

export function useEvidenceChecklist(
  disputeId: string,
  adminId: string,
  evidenceIds: string[],
): EvidenceChecklistState {
  const [opened, setOpened] = useState<Set<string>>(new Set())
  const key = keyFor(disputeId, adminId)

  useEffect(() => {
    try {
      const raw = localStorage.getItem(key)
      setOpened(new Set(raw ? (JSON.parse(raw) as string[]) : []))
    } catch {
      setOpened(new Set())
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [disputeId, adminId])

  const persist = useCallback(
    (next: Set<string>) => {
      setOpened(next)
      try {
        localStorage.setItem(key, JSON.stringify([...next]))
      } catch {
        /* abaikan */
      }
    },
    [key],
  )

  const markOpened = useCallback(
    (evidenceId: string) => {
      persist(new Set([...opened, evidenceId]))
    },
    [opened, persist],
  )

  const isOpened = useCallback((evidenceId: string) => opened.has(evidenceId), [opened])

  const reset = useCallback(() => {
    try {
      localStorage.removeItem(key)
    } catch {
      /* abaikan */
    }
    setOpened(new Set())
  }, [key])

  const { openedCount, unopenedCount, unopenedIds } = useMemo(() => {
    const unopened = evidenceIds.filter((id) => !opened.has(id))
    return {
      openedCount: evidenceIds.length - unopened.length,
      unopenedCount: unopened.length,
      unopenedIds: unopened,
    }
  }, [evidenceIds, opened])

  return { markOpened, isOpened, openedCount, unopenedCount, unopenedIds, reset }
}

export function EvidenceChecklist({
  items,
  checklist,
}: {
  items: Array<{ id: string; label: string }>
  checklist: EvidenceChecklistState
}) {
  if (items.length === 0) return null
  return (
    <div className="rounded-md border border-border bg-surface p-4">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <p className="text-label font-semibold text-text-primary">Checklist bukti</p>
        {checklist.unopenedCount > 0 ? (
          <Badge tone="warning">{checklist.unopenedCount} belum diperiksa</Badge>
        ) : (
          <Badge tone="success">Semua bukti diperiksa</Badge>
        )}
      </div>
      <ul className="flex flex-col gap-1">
        {items.map((item) => {
          const done = checklist.isOpened(item.id)
          return (
            <li key={item.id} className="flex items-center gap-2 text-body">
              <span aria-hidden="true" className={done ? "text-success-text" : "text-text-tertiary"}>
                {done ? "☑" : "☐"}
              </span>
              <span className={done ? "text-text-secondary" : "font-semibold text-text-primary"}>
                {item.label}
              </span>
              {!done ? (
                <span className="text-caption text-warning-text">— belum dibuka</span>
              ) : null}
            </li>
          )
        })}
      </ul>
      {checklist.unopenedCount > 0 ? (
        <p className="mt-2 text-caption text-text-secondary">
          Buka semua bukti sebelum mengirim keputusan. Keputusan tanpa meninjau seluruh
          bukti berisiko salah.
        </p>
      ) : null}
    </div>
  )
}
