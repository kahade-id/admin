/**
 * Kahade Admin Web — WebSocket livechat support (POIN 5, gelombang 2 admin).
 *
 * Protokol wire (backend main, `realtime.gateway.ts`):
 * - Socket.IO, namespace `/`, transport websocket-only,
 *   auth handshake `auth: { token }` (JWT admin). Socket admin otomatis
 *   join room `support:agents` (event `support.queue.changed`).
 * - Event client→server: `support.join`, `support.leave`, `support.message`,
 *   `support.typing`.
 * - Event server→client: `support.message.new`, `support.typing`,
 *   `support.user_joined`, `support.user_left`, `support.agent_joined`,
 *   `support.agent_left`, `support.assigned`, `support.escalated`,
 *   `support.queue.changed`.
 *
 * Envelope HMAC: saat `WS_HMAC_KEY` terkonfigurasi, server menandatangani
 * setiap event (`session_hmac_token` berisi kunci sesi per-koneksi).
 * Envelope = seluruh field payload asli + `_ts` (epoch ms) +
 * `_signature` = HMAC-SHA256(kunciSesi, JSON.stringify(payload+_ts)).
 * Semantik verifikasi mengikuti `lib/realtime/hmac.ts` milik frontend
 * (fail-open tanpa kunci/tanpa signature; tolak tanpa signature bila kunci
 * sudah diterima — anti downgrade; anti-replay ±5 menit).
 */
"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { io, type Socket } from "socket.io-client"

import { API_BASE_URL } from "@/lib/api/config"
import type { SupportConversation, SupportMessage } from "@/lib/api/admin/support-chat"

export const SUPPORT_SOCKET_EVENTS = {
  MESSAGE_NEW: "support.message.new",
  TYPING: "support.typing",
  QUEUE_CHANGED: "support.queue.changed",
  USER_JOINED: "support.user_joined",
  USER_LEFT: "support.user_left",
  AGENT_JOINED: "support.agent_joined",
  AGENT_LEFT: "support.agent_left",
  ASSIGNED: "support.assigned",
  ESCALATED: "support.escalated",
} as const

export type SupportSocketEventName =
  (typeof SUPPORT_SOCKET_EVENTS)[keyof typeof SUPPORT_SOCKET_EVENTS]

export type SupportSocketHandler = (payload: Record<string, unknown>) => void

export type SupportSocketStatus = "idle" | "connecting" | "connected" | "disconnected"

export type SupportJoinAck = {
  success: boolean
  message?: string
  conversation?: SupportConversation
  messages?: SupportMessage[]
  agentOnline?: boolean | null
  queuePosition?: number | null
}

export type SupportQueueChange = {
  conversationId: string
  status?: string
  /** created | claimed | closed | message */
  change?: string
}

const JOIN_ACK_TIMEOUT_MS = 8000
const SEND_ACK_TIMEOUT_MS = 10000
const SIGNED_ENVELOPE_MAX_AGE_MS = 5 * 60 * 1000

async function hmacSha256Hex(key: string, text: string): Promise<string> {
  const keyData = new TextEncoder().encode(key)
  const cryptoKey = await crypto.subtle.importKey("raw", keyData, { name: "HMAC", hash: "SHA-256" }, false, ["sign"])
  const sig = await crypto.subtle.sign("HMAC", cryptoKey, new TextEncoder().encode(text))
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
}

/**
 * Verifikasi + kupas envelope HMAC. Kembalikan payload bersih, atau null
 * bila event harus dibuang (signature tak valid / basi / downgrade).
 */
async function unwrapEvent(
  raw: unknown,
  sessionKey: string | null,
): Promise<Record<string, unknown> | null> {
  if (typeof raw !== "object" || raw === null) return null
  const envelope = raw as Record<string, unknown>
  const signature = envelope._signature
  const ts = envelope._ts

  if (typeof signature !== "string" || !signature) {
    // Kunci sesi sudah diterima tapi event tidak bertanda → tolak (anti-downgrade).
    if (sessionKey) return null
    const { _ts: _t, _signature: _s, ...rest } = envelope
    void _t
    void _s
    return rest
  }
  // Event bertanda tapi kunci belum diterima: grace fallback (kompatibilitas).
  if (!sessionKey) {
    const { _ts: _t, _signature: _s, ...rest } = envelope
    void _t
    void _s
    return rest
  }
  // Anti-replay: tolak envelope basi.
  if (typeof ts !== "number" || !Number.isFinite(ts)) return null
  if (Math.abs(Date.now() - ts) > SIGNED_ENVELOPE_MAX_AGE_MS) return null

  const { _signature: _sig, _ts: _t, ...unsigned } = envelope
  void _sig
  void _t
  // Bentuk ulang persis seperti saat ditandatangani server: seluruh field
  // KECUALI `_signature`, `_ts` tetap di akhir (urutan kunci dipertahankan).
  const canonical = JSON.stringify({ ...unsigned, _ts: ts })
  const expected = await hmacSha256Hex(sessionKey, canonical)
  if (expected !== signature) return null
  return unsigned
}

export function useSupportSocket(token: string | null) {
  const [status, setStatus] = useState<SupportSocketStatus>("idle")
  const socketRef = useRef<Socket | null>(null)
  const sessionKeyRef = useRef<string | null>(null)
  const handlersRef = useRef<Map<SupportSocketEventName, Set<SupportSocketHandler>>>(new Map())

  useEffect(() => {
    if (!token) {
      setStatus("idle")
      return
    }
    setStatus("connecting")
    const socket = io(API_BASE_URL, {
      transports: ["websocket"],
      auth: { token },
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 30_000,
      randomizationFactor: 0.5,
      timeout: 10_000,
    })
    socketRef.current = socket

    // Kunci sesi HMAC — diterima mentah (bukan via envelope bertanda).
    socket.on("session_hmac_token", (data: unknown) => {
      const t = (data as { token?: unknown } | null)?.token
      if (typeof t === "string" && t) sessionKeyRef.current = t
    })

    socket.on("connect", () => setStatus("connected"))
    socket.on("disconnect", () => setStatus("disconnected"))
    socket.io.on("reconnect", () => setStatus("connected"))

    const dispatch = (event: SupportSocketEventName) => async (raw: unknown) => {
      const handlers = handlersRef.current.get(event)
      if (!handlers || handlers.size === 0) return
      const payload = await unwrapEvent(raw, sessionKeyRef.current)
      if (!payload) return
      handlers.forEach((h) => {
        try {
          h(payload)
        } catch {
          /* handler tidak boleh memutus dispatch */
        }
      })
    }

    const events = Object.values(SUPPORT_SOCKET_EVENTS)
    const bound = new Map<SupportSocketEventName, (raw: unknown) => void>()
    for (const event of events) {
      const fn = dispatch(event)
      bound.set(event, fn)
      socket.on(event, fn)
    }

    return () => {
      for (const [event, fn] of bound) socket.off(event, fn)
      socket.removeAllListeners("session_hmac_token")
      socket.disconnect()
      socketRef.current = null
      sessionKeyRef.current = null
    }
  }, [token])

  /** Daftarkan handler event socket; kembalikan fungsi unsubscribe. */
  const onEvent = useCallback((event: SupportSocketEventName, handler: SupportSocketHandler) => {
    let set = handlersRef.current.get(event)
    if (!set) {
      set = new Set()
      handlersRef.current.set(event, set)
    }
    set.add(handler)
    return () => {
      set?.delete(handler)
    }
  }, [])

  /** Join room percakapan — ack membawa conversation + 30 pesan terakhir. */
  const joinConversation = useCallback(
    async (conversationId: string): Promise<SupportJoinAck> => {
      const socket = socketRef.current
      if (!socket || !socket.connected) throw new Error("Socket belum terhubung")
      const ack = await socket
        .timeout(JOIN_ACK_TIMEOUT_MS)
        .emitWithAck("support.join", { conversationId })
      return (ack ?? { success: false, message: "Tidak ada respons server" }) as SupportJoinAck
    },
    [],
  )

  const leaveConversation = useCallback((conversationId: string) => {
    socketRef.current?.emit("support.leave", { conversationId })
  }, [])

  /**
   * Kirim pesan agen. ACK membawa pesan tersimpan; broadcast
   * `support.message.new` juga dikirim server ke room (termasuk socket
   * pengirim) — pemanggil wajib dedupe via id pesan.
   * Pesan pertama agen = auto-claim (WAITING → ASSIGNED → OPEN).
   */
  const sendMessage = useCallback(
    async (conversationId: string, content: string): Promise<SupportMessage> => {
      const socket = socketRef.current
      if (!socket || !socket.connected) throw new Error("Socket belum terhubung")
      const ack = (await socket
        .timeout(SEND_ACK_TIMEOUT_MS)
        .emitWithAck("support.message", { conversationId, content })) as
        | { success: boolean; message?: string; data?: SupportMessage }
        | undefined
      if (!ack || ack.success !== true) {
        throw new Error(ack?.message ?? "Gagal mengirim pesan")
      }
      if (!ack.data) throw new Error("Respons server tidak lengkap")
      return ack.data
    },
    [],
  )

  const sendTyping = useCallback((conversationId: string, isTyping: boolean) => {
    socketRef.current?.emit("support.typing", { conversationId, isTyping })
  }, [])

  return { status, onEvent, joinConversation, leaveConversation, sendMessage, sendTyping }
}
