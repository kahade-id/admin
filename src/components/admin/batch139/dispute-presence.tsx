/**
 * H09 — Lock ringan saat resolusi sengketa (Batch 139).
 *
 * Dua admin dapat menyiapkan keputusan untuk sengketa yang sama bersamaan.
 * Tanpa lock permanen (yang bisa macet), tampilkan SIAPA sedang menangani
 * sengketa ini — heartbeat ringan via localStorage (tanpa API baru).
 *
 * Batasan: hanya terlihat antar tab/perangkat yang memakai panel admin yang
 * sama di browser ini (localStorage). Tandai "parsial" bila butuh presence
 * lintas-perangkat via backend (WebSocket/API).
 */
"use client"

import { useEffect, useState } from "react"

import { Badge } from "@/components/ui/badge"
import { useAuth } from "@/lib/auth-context"

/** Entri dianggap aktif bila heartbeat < 2 menit. */
export const PRESENCE_TTL_MS = 2 * 60 * 1000
const HEARTBEAT_MS = 30 * 1000

export type DisputePresenceEntry = {
  adminId: string
  name: string
  ts: number
}

function keyFor(disputeId: string) {
  return `kahade.admin.presence.dispute.${disputeId}`
}

export function readDisputePresence(disputeId: string, selfId: string): DisputePresenceEntry[] {
  try {
    const raw = localStorage.getItem(keyFor(disputeId))
    if (!raw) return []
    const list = JSON.parse(raw) as DisputePresenceEntry[]
    const now = Date.now()
    return list.filter((e) => e.adminId !== selfId && now - e.ts < PRESENCE_TTL_MS)
  } catch {
    return []
  }
}

export function heartbeatDispute(disputeId: string, adminId: string, name: string) {
  try {
    const k = keyFor(disputeId)
    const raw = localStorage.getItem(k)
    const list: DisputePresenceEntry[] = raw ? (JSON.parse(raw) as DisputePresenceEntry[]) : []
    const now = Date.now()
    const fresh = list.filter((e) => now - e.ts < PRESENCE_TTL_MS && e.adminId !== adminId)
    fresh.push({ adminId, name, ts: now })
    localStorage.setItem(k, JSON.stringify(fresh))
  } catch {
    /* abaikan */
  }
}

/**
 * Banner "sedang ditangani oleh …" di detail sengketa.
 * Pasang sekali di halaman detail; otomatis heartbeat tiap 30 dtk.
 */
export function DisputePresence({ disputeId }: { disputeId: string }) {
  const { profile } = useAuth()
  const [others, setOthers] = useState<DisputePresenceEntry[]>([])
  const selfId = profile?.adminId ?? "anon"
  const selfName = profile?.fullName?.trim() || "Admin"

  useEffect(() => {
    heartbeatDispute(disputeId, selfId, selfName)
    setOthers(readDisputePresence(disputeId, selfId))
    const timer = setInterval(() => {
      heartbeatDispute(disputeId, selfId, selfName)
      setOthers(readDisputePresence(disputeId, selfId))
    }, HEARTBEAT_MS)
    return () => clearInterval(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [disputeId, selfId])

  if (others.length === 0) return null

  return (
    <div
      role="status"
      className="mb-4 flex flex-wrap items-center gap-2 rounded-md border border-info-text/30 bg-info-text/10 px-4 py-3"
    >
      <Badge tone="info">Sedang ditangani</Badge>
      <p className="text-body text-text-primary">
        {others.map((o) => o.name).join(", ")} juga membuka sengketa ini. Koordinasikan dulu
        sebelum mengirim keputusan — ini bukan lock, hanya penanda.
      </p>
    </div>
  )
}
