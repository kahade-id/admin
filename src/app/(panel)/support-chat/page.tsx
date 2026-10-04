/**
 * Admin — konsol livechat support (POIN 5, gelombang 2).
 *
 * - Antrean: percakapan WAITING (REST + update realtime
 *   `support.queue.changed`), info user, subjek, lama menunggu, prioritas Kahade+.
 * - Ruang chat: pilih percakapan → `support.join` → riwayat + kirim/terima
 *   realtime (`support.message.new`), indikator typing user, presence user
 *   (`support.user_joined` / `support.user_left`).
 * - Aksi: Ambil (claim), Tutup percakapan, Eskalasi ke tiket (dialog subjek +
 *   pesan opsional).
 * - Toggle availability agen (siap menerima percakapan baru).
 */
"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { ConfirmDialog, Dialog } from "@/components/ui/dialog"
import { EmptyState } from "@/components/ui/empty-state"
import { Input, TextArea } from "@/components/ui/input"
import { Spinner } from "@/components/ui/spinner"
import { useToast } from "@/components/ui/toast"
import { RoleGate } from "@/components/admin/role-gate"
import { Select } from "@/components/admin/select"
import { useAuth } from "@/lib/auth-context"
import { ensureAdminSession, getAdminAccessToken } from "@/lib/api/admin-client"
import { userMessage } from "@/lib/api/response"
import { formatDateTimeWIB } from "@/lib/format"
import {
  claimSupportConversation,
  closeSupportConversation,
  escalateSupportConversation,
  getSupportAgents,
  listSupportQueue,
  setAgentAvailability,
  type SupportAgentStatus,
  type SupportConversation,
  type SupportMessage,
} from "@/lib/api/admin/support-chat"
import {
  SUPPORT_SOCKET_EVENTS,
  useSupportSocket,
  type SupportQueueChange,
} from "@/lib/realtime/support-socket"

type Tab = "waiting" | "mine"

const QUEUE_LIMIT = 30

const ESCALATE_CATEGORIES = [
  { value: "GENERAL", label: "Umum" },
  { value: "ORDER", label: "Pesanan" },
  { value: "PAYMENT", label: "Pembayaran" },
  { value: "ACCOUNT", label: "Akun" },
  { value: "KYC", label: "KYC" },
  { value: "TECHNICAL", label: "Teknis" },
  { value: "OTHER", label: "Lainnya" },
]

const STATUS_LABEL: Record<string, string> = {
  WAITING: "Menunggu",
  ASSIGNED: "Ditugaskan",
  OPEN: "Terbuka",
  CLOSED: "Ditutup",
}

const STATUS_TONE: Record<string, "neutral" | "info" | "success" | "warning" | "danger" | "accent"> = {
  WAITING: "warning",
  ASSIGNED: "info",
  OPEN: "success",
  CLOSED: "neutral",
}

function relativeTime(iso: string): string {
  const t = new Date(iso).getTime()
  if (Number.isNaN(t)) return ""
  const diffMs = Date.now() - t
  if (diffMs < 0) return "baru saja"
  const m = Math.floor(diffMs / 60_000)
  if (m < 1) return "baru saja"
  if (m < 60) return `${m} mnt lalu`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h} jam lalu`
  return formatDateTimeWIB(iso)
}

function displayName(conv: SupportConversation): string {
  const u = conv.user
  return u?.fullName || u?.username || "Pengguna"
}

function asMessage(raw: Record<string, unknown>): SupportMessage {
  return {
    id: String(raw.id ?? ""),
    conversationId: String(raw.conversationId ?? ""),
    senderType: String(raw.senderType ?? "USER"),
    senderId: raw.senderId != null ? String(raw.senderId) : null,
    senderName: raw.senderName != null ? String(raw.senderName) : null,
    content: raw.content != null ? String(raw.content) : null,
    attachments: Array.isArray(raw.attachments)
      ? raw.attachments.map((a) => String(a))
      : [],
    createdAt: String(raw.createdAt ?? new Date().toISOString()),
  }
}

export default function SupportChatConsolePage() {
  return (
    <RoleGate href="/support-chat">
      <SupportChatConsole />
    </RoleGate>
  )
}

function SupportChatConsole() {
  const toast = useToast()
  const { profile } = useAuth()

  const [token, setToken] = useState<string | null>(null)
  const [tab, setTab] = useState<Tab>("waiting")
  const [queue, setQueue] = useState<SupportConversation[]>([])
  const [queueLoading, setQueueLoading] = useState(true)
  const [queueError, setQueueError] = useState<string | null>(null)

  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [conversation, setConversation] = useState<SupportConversation | null>(null)
  const [messages, setMessages] = useState<SupportMessage[]>([])
  const [joining, setJoining] = useState(false)
  const [userTyping, setUserTyping] = useState(false)
  const [userOnline, setUserOnline] = useState<boolean | null>(null)

  const [draft, setDraft] = useState("")
  const [sending, setSending] = useState(false)

  const [agents, setAgents] = useState<SupportAgentStatus[]>([])
  const [togglingAvailability, setTogglingAvailability] = useState(false)

  const [closeOpen, setCloseOpen] = useState(false)
  const [closing, setClosing] = useState(false)
  const [claimingId, setClaimingId] = useState<string | null>(null)

  const [escalateOpen, setEscalateOpen] = useState(false)
  const [escSubject, setEscSubject] = useState("")
  const [escCategory, setEscCategory] = useState("GENERAL")
  const [escMessage, setEscMessage] = useState("")
  const [escalating, setEscalating] = useState(false)

  const selectedIdRef = useRef<string | null>(null)
  selectedIdRef.current = selectedId
  const typingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const typingHeartbeatRef = useRef(0)
  const messagesEndRef = useRef<HTMLDivElement | null>(null)

  const { status: socketStatus, onEvent, joinConversation, leaveConversation, sendMessage, sendTyping } =
    useSupportSocket(token)

  // ---- sesi & token socket -------------------------------------------
  useEffect(() => {
    let cancelled = false
    ensureAdminSession().then((ok) => {
      if (cancelled) return
      setToken(ok ? getAdminAccessToken() : null)
    })
    return () => {
      cancelled = true
    }
  }, [])

  // ---- antrean & agen -------------------------------------------------
  const loadQueue = useCallback(async () => {
    setQueueLoading(true)
    setQueueError(null)
    try {
      if (tab === "waiting") {
        const res = await listSupportQueue({ status: "WAITING", limit: QUEUE_LIMIT })
        setQueue(Array.isArray(res?.data) ? res.data : [])
      } else {
        // "Ditangani saya": ASSIGNED/OPEN yang di-claim akun ini (filter klien).
        const res = await listSupportQueue({ limit: QUEUE_LIMIT })
        const rows = Array.isArray(res?.data) ? res.data : []
        setQueue(
          rows.filter(
            (c) =>
              c.status !== "CLOSED" &&
              c.status !== "WAITING" &&
              profile != null &&
              c.assignedAgent?.id === profile.adminId,
          ),
        )
      }
    } catch (e) {
      setQueueError(userMessage(e))
    } finally {
      setQueueLoading(false)
    }
  }, [tab, profile])

  const loadQueueRef = useRef(loadQueue)
  loadQueueRef.current = loadQueue

  const loadAgents = useCallback(async () => {
    try {
      const rows = await getSupportAgents()
      setAgents(Array.isArray(rows) ? rows : [])
    } catch {
      /* status agen non-kritis; biarkan kosong */
    }
  }, [])

  useEffect(() => {
    void loadQueue()
  }, [loadQueue])

  useEffect(() => {
    void loadAgents()
  }, [loadAgents])

  const myAgent = useMemo(
    () => (profile ? agents.find((a) => a.id === profile.adminId) ?? null : null),
    [agents, profile],
  )

  // ---- event socket ---------------------------------------------------
  useEffect(() => {
    const unsubs = [
      onEvent(SUPPORT_SOCKET_EVENTS.MESSAGE_NEW, (payload) => {
        const convId = String(payload.conversationId ?? "")
        if (!convId || convId !== selectedIdRef.current) {
          // Pesan di percakapan lain: segarkan antrean (preview berubah).
          if (convId) void loadQueueRef.current()
          return
        }
        const msg = asMessage(payload)
        if (!msg.id) return
        setMessages((prev) => (prev.some((m) => m.id === msg.id) ? prev : [...prev, msg]))
        const st = payload.conversationStatus
        if (typeof st === "string" && st) {
          const status = st as SupportConversation["status"]
          setConversation((prev) => (prev ? { ...prev, status } : prev))
        }
        void loadQueueRef.current()
      }),
      onEvent(SUPPORT_SOCKET_EVENTS.TYPING, (payload) => {
        if (String(payload.conversationId ?? "") !== selectedIdRef.current) return
        if (payload.senderType !== "USER") return
        const isTyping = payload.isTyping === true
        setUserTyping(isTyping)
        if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current)
        if (isTyping) {
          // Fallback bila paket stop hilang (server mengirim expiresAt).
          typingTimeoutRef.current = setTimeout(() => setUserTyping(false), 6000)
        }
      }),
      onEvent(SUPPORT_SOCKET_EVENTS.USER_JOINED, (payload) => {
        if (String(payload.conversationId ?? "") === selectedIdRef.current) setUserOnline(true)
      }),
      onEvent(SUPPORT_SOCKET_EVENTS.USER_LEFT, (payload) => {
        if (String(payload.conversationId ?? "") === selectedIdRef.current) setUserOnline(false)
      }),
      onEvent(SUPPORT_SOCKET_EVENTS.QUEUE_CHANGED, (payload) => {
        const change = payload as unknown as SupportQueueChange
        // created | claimed | closed | message — segarkan daftar.
        if (change && typeof change.change === "string") void loadQueueRef.current()
      }),
      onEvent(SUPPORT_SOCKET_EVENTS.ASSIGNED, () => {
        void loadQueueRef.current()
      }),
      onEvent(SUPPORT_SOCKET_EVENTS.ESCALATED, () => {
        void loadQueueRef.current()
      }),
    ]
    return () => {
      unsubs.forEach((u) => u())
      if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current)
    }
  }, [onEvent])

  // ---- join / leave room percakapan -----------------------------------
  useEffect(() => {
    if (!selectedId) {
      setConversation(null)
      setMessages([])
      setUserOnline(null)
      setUserTyping(false)
      return
    }
    if (socketStatus !== "connected") return
    let cancelled = false
    setJoining(true)
    setMessages([])
    setUserOnline(null)
    setUserTyping(false)
    joinConversation(selectedId)
      .then((ack) => {
        if (cancelled) return
        if (!ack.success) {
          toast.show({
            title: "Gagal membuka percakapan",
            description: ack.message ?? "Coba lagi.",
            tone: "danger",
          })
          setSelectedId(null)
          return
        }
        setConversation(ack.conversation ?? null)
        setMessages(Array.isArray(ack.messages) ? ack.messages : [])
      })
      .catch((e: unknown) => {
        if (cancelled) return
        toast.show({ title: "Gagal membuka percakapan", description: userMessage(e), tone: "danger" })
        setSelectedId(null)
      })
      .finally(() => {
        if (!cancelled) setJoining(false)
      })
    return () => {
      cancelled = true
      leaveConversation(selectedId)
    }
  }, [selectedId, socketStatus, joinConversation, leaveConversation, toast])

  // ---- auto-scroll ----------------------------------------------------
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ block: "end" })
  }, [messages, userTyping])

  // ---- aksi ------------------------------------------------------------
  const handleSelect = useCallback((id: string) => {
    setSelectedId((prev) => (prev === id ? prev : id))
  }, [])

  const handleClaim = useCallback(
    async (id: string) => {
      setClaimingId(id)
      try {
        const updated = await claimSupportConversation(id)
        toast.show({ title: "Percakapan diambil", tone: "success" })
        if (selectedIdRef.current === id) {
          setConversation((prev) =>
            prev ? { ...prev, ...(updated as Partial<SupportConversation>) } : (updated as SupportConversation),
          )
        } else {
          setSelectedId(id)
        }
        void loadQueueRef.current()
      } catch (e) {
        toast.show({
          title: "Gagal mengambil percakapan",
          description: userMessage(e),
          tone: "danger",
        })
      } finally {
        setClaimingId(null)
      }
    },
    [toast],
  )

  const handleClose = useCallback(async () => {
    const id = selectedIdRef.current
    if (!id) return
    setClosing(true)
    try {
      await closeSupportConversation(id)
      toast.show({ title: "Percakapan ditutup", tone: "success" })
      setCloseOpen(false)
      setSelectedId(null)
      void loadQueueRef.current()
    } catch (e) {
      toast.show({ title: "Gagal menutup percakapan", description: userMessage(e), tone: "danger" })
    } finally {
      setClosing(false)
    }
  }, [toast])

  const handleEscalate = useCallback(async () => {
    const id = selectedIdRef.current
    const subject = escSubject.trim()
    if (!id || !subject) return
    setEscalating(true)
    try {
      await escalateSupportConversation(id, {
        subject,
        category: escCategory,
        message: escMessage.trim() ? escMessage.trim() : undefined,
      })
      toast.show({ title: "Tiket dibuat dari percakapan", tone: "success" })
      setEscalateOpen(false)
      setEscSubject("")
      setEscCategory("GENERAL")
      setEscMessage("")
      void loadQueueRef.current()
    } catch (e) {
      toast.show({ title: "Gagal membuat tiket", description: userMessage(e), tone: "danger" })
    } finally {
      setEscalating(false)
    }
  }, [toast, escSubject, escCategory, escMessage])

  const handleSend = useCallback(async () => {
    const id = selectedIdRef.current
    const text = draft.trim()
    if (!id || !text || sending) return
    setSending(true)
    try {
      // Pesan pertama agen = auto-claim (WAITING → ASSIGNED → OPEN).
      const saved = await sendMessage(id, text)
      setMessages((prev) => (prev.some((m) => m.id === saved.id) ? prev : [...prev, saved]))
      setDraft("")
      sendTyping(id, false)
      typingHeartbeatRef.current = 0
      void loadQueueRef.current()
    } catch (e) {
      toast.show({ title: "Gagal mengirim pesan", description: userMessage(e), tone: "danger" })
    } finally {
      setSending(false)
    }
  }, [draft, sending, sendMessage, sendTyping, toast])

  const handleDraftChange = useCallback(
    (value: string) => {
      setDraft(value)
      const id = selectedIdRef.current
      if (!id || socketStatus !== "connected") return
      const now = Date.now()
      // Heartbeat typing dibatasi ~1 per 2 detik; stop dikirim saat kirim/blur.
      if (value.trim() && now - typingHeartbeatRef.current > 2000) {
        typingHeartbeatRef.current = now
        sendTyping(id, true)
      }
      if (!value.trim()) {
        typingHeartbeatRef.current = 0
        sendTyping(id, false)
      }
    },
    [socketStatus, sendTyping],
  )

  const handleToggleAvailability = useCallback(async () => {
    if (!myAgent || togglingAvailability) return
    setTogglingAvailability(true)
    try {
      await setAgentAvailability(!myAgent.available)
      toast.show({
        title: myAgent.available ? "Status: tidak tersedia" : "Status: tersedia",
        description: myAgent.available
          ? "Percakapan baru tidak akan diarahkan ke Anda."
          : "Anda siap menerima percakapan baru.",
        tone: "success",
      })
      await loadAgents()
    } catch (e) {
      toast.show({ title: "Gagal mengubah status", description: userMessage(e), tone: "danger" })
    } finally {
      setTogglingAvailability(false)
    }
  }, [myAgent, togglingAvailability, toast, loadAgents])

  const openEscalate = useCallback(() => {
    setEscSubject(conversation?.subject ?? "")
    setEscMessage("")
    setEscCategory("GENERAL")
    setEscalateOpen(true)
  }, [conversation])

  const socketTone = socketStatus === "connected" ? "success" : socketStatus === "connecting" ? "warning" : "neutral"
  const socketLabel =
    socketStatus === "connected" ? "Terhubung" : socketStatus === "connecting" ? "Menghubungkan…" : "Terputus"

  return (
    <div className="flex flex-col gap-4">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-h2 font-bold text-text-primary">Livechat Support</h1>
          <p className="text-body-sm text-text-secondary">
            Konsol agen — antrean, chat realtime, eskalasi ke tiket.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge tone={socketTone}>{socketLabel}</Badge>
          <Button
            variant={myAgent?.available ? "secondary" : "primary"}
            size="sm"
            onClick={handleToggleAvailability}
            loading={togglingAvailability}
            disabled={!myAgent}
          >
            {myAgent?.available ? "Set tidak tersedia" : "Set tersedia"}
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[360px_1fr]">
        {/* ---- Antrean ---- */}
        <Card className="flex max-h-[calc(100vh-220px)] min-h-[420px] flex-col p-0">
          <div className="flex gap-2 border-b border-border p-3">
            <Button
              variant={tab === "waiting" ? "primary" : "ghost"}
              size="sm"
              onClick={() => setTab("waiting")}
            >
              Antrean ({tab === "waiting" ? queue.length : "…"})
            </Button>
            <Button variant={tab === "mine" ? "primary" : "ghost"} size="sm" onClick={() => setTab("mine")}>
              Ditangani saya
            </Button>
            <div className="ml-auto">
              <Button variant="ghost" size="sm" onClick={() => void loadQueue()} loading={queueLoading}>
                Muat ulang
              </Button>
            </div>
          </div>
          <div className="flex-1 overflow-y-auto p-2">
            {queueLoading ? (
              <div className="flex items-center justify-center py-16">
                <Spinner size="md" />
              </div>
            ) : queueError ? (
              <EmptyState title="Gagal memuat antrean" description={queueError} />
            ) : queue.length === 0 ? (
              <EmptyState
                title={tab === "waiting" ? "Antrean kosong" : "Tidak ada percakapan aktif"}
                description={
                  tab === "waiting"
                    ? "Tidak ada percakapan yang menunggu agen saat ini."
                    : "Anda belum menangani percakapan apapun."
                }
              />
            ) : (
              <ul className="flex flex-col gap-1">
                {queue.map((conv) => {
                  const active = conv.id === selectedId
                  return (
                    <li key={conv.id}>
                      <button
                        type="button"
                        onClick={() => handleSelect(conv.id)}
                        className={`flex w-full flex-col gap-1 rounded-sm border p-3 text-left transition-colors ${
                          active
                            ? "border-accent bg-accent-soft"
                            : "border-transparent hover:border-border hover:bg-surface"
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="truncate text-body font-semibold text-text-primary">
                            {displayName(conv)}
                          </span>
                          <span className="shrink-0 text-caption text-text-tertiary">
                            {relativeTime(conv.createdAt)}
                          </span>
                        </div>
                        {conv.subject ? (
                          <span className="truncate text-body-sm text-text-secondary">{conv.subject}</span>
                        ) : null}
                        {conv.lastMessage?.content ? (
                          <span className="truncate text-caption text-text-tertiary">
                            {conv.lastMessage.senderType === "AGENT" ? "Agen: " : ""}
                            {conv.lastMessage.content}
                          </span>
                        ) : null}
                        <div className="flex items-center gap-1.5 pt-1">
                          {conv.priority ? <Badge tone="accent">Kahade+</Badge> : null}
                          {tab === "mine" && conv.status ? (
                            <Badge tone={STATUS_TONE[conv.status] ?? "neutral"}>
                              {STATUS_LABEL[conv.status] ?? conv.status}
                            </Badge>
                          ) : null}
                          {tab === "waiting" ? (
                            <span
                              role="button"
                              tabIndex={0}
                              onClick={(e) => {
                                e.stopPropagation()
                                void handleClaim(conv.id)
                              }}
                              onKeyDown={(e) => {
                                if (e.key === "Enter" || e.key === " ") {
                                  e.preventDefault()
                                  e.stopPropagation()
                                  void handleClaim(conv.id)
                                }
                              }}
                              className="ml-auto rounded-sm bg-primary px-2.5 py-1 text-caption font-semibold text-white hover:opacity-90"
                            >
                              {claimingId === conv.id ? "Mengambil…" : "Ambil"}
                            </span>
                          ) : null}
                        </div>
                      </button>
                    </li>
                  )
                })}
              </ul>
            )}
          </div>
        </Card>

        {/* ---- Ruang chat ---- */}
        <Card className="flex max-h-[calc(100vh-220px)] min-h-[420px] flex-col p-0">
          {!selectedId ? (
            <div className="flex flex-1 items-center justify-center p-8">
              <EmptyState
                title="Pilih percakapan"
                description="Pilih percakapan dari antrean untuk mulai menangani."
              />
            </div>
          ) : joining ? (
            <div className="flex flex-1 items-center justify-center">
              <Spinner size="md" />
            </div>
          ) : (
            <>
              {/* Header percakapan */}
              <div className="flex flex-wrap items-center gap-2 border-b border-border p-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-body font-bold text-text-primary">
                      {conversation ? displayName(conversation) : "…"}
                    </span>
                    {conversation?.priority ? <Badge tone="accent">Kahade+</Badge> : null}
                    {conversation?.status ? (
                      <Badge tone={STATUS_TONE[conversation.status] ?? "neutral"}>
                        {STATUS_LABEL[conversation.status] ?? conversation.status}
                      </Badge>
                    ) : null}
                    {userOnline !== null ? (
                      <Badge tone={userOnline ? "success" : "neutral"}>
                        {userOnline ? "Pengguna online" : "Pengguna offline"}
                      </Badge>
                    ) : null}
                  </div>
                  {conversation?.subject ? (
                    <p className="truncate text-body-sm text-text-secondary">{conversation.subject}</p>
                  ) : null}
                </div>
                <div className="flex items-center gap-2">
                  {conversation?.status === "WAITING" ? (
                    <Button
                      size="sm"
                      onClick={() => conversation && void handleClaim(conversation.id)}
                      loading={claimingId === conversation?.id}
                    >
                      Ambil
                    </Button>
                  ) : null}
                  {conversation && conversation.status !== "CLOSED" ? (
                    <>
                      <Button variant="secondary" size="sm" onClick={openEscalate}>
                        Eskalasi ke tiket
                      </Button>
                      <Button variant="destructive" size="sm" onClick={() => setCloseOpen(true)}>
                        Tutup percakapan
                      </Button>
                    </>
                  ) : null}
                </div>
              </div>

              {/* Riwayat pesan */}
              <div className="flex-1 space-y-2 overflow-y-auto p-4" aria-live="polite">
                {messages.map((m) => {
                  if (m.senderType === "SYSTEM") {
                    return (
                      <div key={m.id} className="flex justify-center">
                        <span className="rounded-sm bg-surface px-3 py-1 text-caption text-text-tertiary">
                          {m.content}
                        </span>
                      </div>
                    )
                  }
                  const mine = m.senderType === "AGENT"
                  return (
                    <div key={m.id} className={`flex ${mine ? "justify-end" : "justify-start"}`}>
                      <div
                        className={`max-w-[75%] rounded-md px-3 py-2 ${
                          mine ? "bg-primary text-white" : "bg-surface text-text-primary"
                        }`}
                      >
                        {!mine && m.senderName ? (
                          <div className="mb-0.5 text-caption font-semibold opacity-80">{m.senderName}</div>
                        ) : null}
                        {m.content ? (
                          <div className="whitespace-pre-wrap break-words text-body-sm">{m.content}</div>
                        ) : null}
                        {m.attachments.length > 0 ? (
                          <div className="mt-1 text-caption opacity-80">
                            {m.attachments.length} lampiran
                          </div>
                        ) : null}
                        <div className={`mt-1 text-right text-caption ${mine ? "opacity-70" : "text-text-tertiary"}`}>
                          {formatDateTimeWIB(m.createdAt)}
                        </div>
                      </div>
                    </div>
                  )
                })}
                {userTyping ? (
                  <div className="flex justify-start">
                    <span className="rounded-md bg-surface px-3 py-2 text-caption italic text-text-tertiary">
                      Pengguna sedang mengetik…
                    </span>
                  </div>
                ) : null}
                <div ref={messagesEndRef} />
              </div>

              {/* Input pesan */}
              <div className="border-t border-border p-3">
                <div className="flex gap-2">
                  <Input
                    value={draft}
                    onChange={(e) => handleDraftChange(e.target.value)}
                    onBlur={() => {
                      const id = selectedIdRef.current
                      if (id) {
                        sendTyping(id, false)
                        typingHeartbeatRef.current = 0
                      }
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault()
                        void handleSend()
                      }
                    }}
                    placeholder={
                      conversation?.status === "CLOSED"
                        ? "Percakapan sudah ditutup"
                        : "Tulis balasan… (Enter untuk kirim)"
                    }
                    disabled={sending || conversation?.status === "CLOSED"}
                    aria-label="Tulis balasan"
                  />
                  <Button
                    onClick={() => void handleSend()}
                    loading={sending}
                    disabled={!draft.trim() || conversation?.status === "CLOSED"}
                  >
                    Kirim
                  </Button>
                </div>
                {conversation?.status === "WAITING" ? (
                  <p className="mt-1.5 text-caption text-text-tertiary">
                    Pesan pertama yang Anda kirim otomatis mengambil percakapan ini.
                  </p>
                ) : null}
              </div>
            </>
          )}
        </Card>
      </div>

      {/* Dialog tutup */}
      <ConfirmDialog
        open={closeOpen}
        onClose={() => setCloseOpen(false)}
        title="Tutup percakapan?"
        description="Percakapan akan ditutup untuk kedua belah pihak. Pengguna akan menerima pesan penutup otomatis."
        confirmLabel="Ya, tutup"
        destructive
        loading={closing}
        onConfirm={() => void handleClose()}
      />

      {/* Dialog eskalasi */}
      <Dialog
        open={escalateOpen}
        onClose={() => setEscalateOpen(false)}
        title="Eskalasi ke tiket"
        description="Percakapan (beserta transkrip otomatis) akan dibuat menjadi tiket bantuan."
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setEscalateOpen(false)} disabled={escalating}>
              Batal
            </Button>
            <Button onClick={() => void handleEscalate()} loading={escalating} disabled={!escSubject.trim()}>
              Buat tiket
            </Button>
          </div>
        }
      >
        <div className="flex flex-col gap-3">
          <Input
            label="Subjek tiket"
            value={escSubject}
            onChange={(e) => setEscSubject(e.target.value)}
            maxLength={200}
            placeholder="Ringkasan masalah pengguna"
          />
          <Select label="Kategori" value={escCategory} onChange={(e) => setEscCategory(e.target.value)} options={ESCALATE_CATEGORIES} />
          <TextArea
            label="Pesan / ringkasan (opsional)"
            value={escMessage}
            onChange={(e) => setEscMessage(e.target.value)}
            maxLength={5000}
            rows={4}
            placeholder="Catatan tambahan untuk tim yang menangani tiket"
          />
        </div>
      </Dialog>
    </div>
  )
}
