"use client"

/**
 * Admin — Moderasi chat (Trust & Safety).
 *
 * - Kartu statistik: getModerationStats() (pasangan kunci–nilai dari backend).
 * - Daftar event moderasi (listModerationEvents) dengan filter status
 *   (PENDING/REVIEWED/DISMISSED/ACTIONED) + DataTable + paginasi bernomor.
 * - Tombol "Tinjau" per event → Dialog: detail event (getModerationEventDetail)
 *   + form review (aksi REVIEWED/DISMISSED/ACTIONED via Select + catatan
 *   opsional → reviewModerationEvent) + "Lihat pesan room" (getRoomMessages,
 *   read-only) bila event punya roomId.
 *
 * Port dari frontend/app/admin/(panel)/chat/index.tsx → web desktop.
 */

import { useCallback, useEffect, useState } from "react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Dialog } from "@/components/ui/dialog"
import { EmptyState } from "@/components/ui/empty-state"
import { TextArea } from "@/components/ui/input"
import { Spinner } from "@/components/ui/spinner"
import { DataTable } from "@/components/ui/table"
import { useToast } from "@/components/ui/toast"
import { Pagination } from "@/components/admin/pagination"
import { RoleGate } from "@/components/admin/role-gate"
import { Select } from "@/components/admin/select"
import {
  getModerationEventDetail,
  getModerationStats,
  getRoomMessages,
  listModerationEvents,
  reviewModerationEvent,
  type ModerationEvent,
} from "@/lib/api/admin/chat"
import { userMessage } from "@/lib/api/response"
import { formatDateTimeWIB } from "@/lib/format"

const PAGE_SIZE = 20
const ROOM_MESSAGE_LIMIT = 50

type Filter = "ALL" | "PENDING" | "REVIEWED" | "DISMISSED" | "ACTIONED"
type ReviewAction = "REVIEWED" | "DISMISSED" | "ACTIONED"

const FILTER_OPTIONS = [
  { value: "ALL", label: "Semua" },
  { value: "PENDING", label: "Pending" },
  { value: "REVIEWED", label: "Ditinjau" },
  { value: "DISMISSED", label: "Diabaikan" },
  { value: "ACTIONED", label: "Ditindak" },
]

const ACTION_OPTIONS = [
  { value: "REVIEWED", label: "Ditinjau" },
  { value: "DISMISSED", label: "Diabaikan" },
  { value: "ACTIONED", label: "Ditindak" },
]

const STATUS_TONE: Record<
  string,
  "neutral" | "info" | "success" | "warning" | "danger" | "accent"
> = {
  PENDING: "warning",
  REVIEWED: "info",
  DISMISSED: "neutral",
  ACTIONED: "success",
}

const KIND_LABEL: Record<string, string> = {
  CIRCUMVENTION: "Pengelakan filter",
  CONTACT_SHARING: "Berbagi kontak",
  PROFANITY: "Kata kasar",
  SPAM: "Spam",
}

const AUTO_ACTION_LABEL: Record<string, string> = {
  BLOCKED: "Diblokir",
  REDACTED: "Disensor",
  FLAGGED: "Ditandai",
}

function eventKindLabel(event: ModerationEvent): string {
  const raw = String(
    (event as unknown as Record<string, unknown>).kind ?? event.type ?? "",
  ).toUpperCase()
  return KIND_LABEL[raw] ?? AUTO_ACTION_LABEL[raw] ?? raw
}

function prettifyStatKey(key: string): string {
  return key
    .replace(/([A-Z])/g, " $1")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^./, (c) => c.toUpperCase())
}

function statValue(value: unknown): string {
  if (typeof value === "number") return value.toLocaleString("id-ID")
  if (typeof value === "string") return value
  if (typeof value === "boolean") return value ? "Ya" : "Tidak"
  return "—"
}

function messageText(message: unknown): string {
  const obj = (message ?? {}) as Record<string, unknown>
  for (const key of ["content", "text", "body", "message", "caption"]) {
    const value = obj[key]
    if (typeof value === "string" && value.trim()) return value
  }
  return "Pesan tanpa teks"
}

function messageSenderLabel(message: unknown): string {
  const obj = (message ?? {}) as Record<string, unknown>
  const sender = obj.sender ?? obj.user ?? obj.author
  if (sender && typeof sender === "object") {
    const rec = sender as Record<string, unknown>
    const name = rec.fullName ?? rec.username ?? rec.name
    if (typeof name === "string" && name.trim()) return name
  }
  const id = obj.senderId ?? obj.userId
  if (typeof id === "string" && id) return id.slice(0, 12)
  return "—"
}

function messageTime(message: unknown): string {
  const obj = (message ?? {}) as Record<string, unknown>
  const raw = obj.createdAt ?? obj.sentAt ?? obj.timestamp
  return typeof raw === "string" ? formatDateTimeWIB(raw) : ""
}

export default function ChatModerationPage() {
  const toast = useToast()

  const [filter, setFilter] = useState<Filter>("ALL")
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [rows, setRows] = useState<ModerationEvent[]>([])
  const [total, setTotal] = useState(0)
  const [totalPages, setTotalPages] = useState(1)

  const [stats, setStats] = useState<Record<string, unknown> | null>(null)
  const [statsLoading, setStatsLoading] = useState(true)
  const [statsError, setStatsError] = useState<string | null>(null)

  const [detailId, setDetailId] = useState<string | null>(null)
  const [detail, setDetail] = useState<ModerationEvent | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [detailError, setDetailError] = useState<string | null>(null)

  const [reviewAction, setReviewAction] = useState<ReviewAction>("REVIEWED")
  const [notes, setNotes] = useState("")
  const [submitting, setSubmitting] = useState(false)

  const [messagesVisible, setMessagesVisible] = useState(false)
  const [messages, setMessages] = useState<unknown[] | null>(null)
  const [messagesLoading, setMessagesLoading] = useState(false)
  const [messagesError, setMessagesError] = useState<string | null>(null)

  const load = useCallback(
    async (mode: "initial" | "refresh" = "initial", targetPage = page, targetFilter = filter) => {
      if (mode === "initial") setLoading(true)
      else setRefreshing(true)
      setError(null)
      try {
        const res = await listModerationEvents({
          page: targetPage,
          limit: PAGE_SIZE,
          status: targetFilter === "ALL" ? undefined : targetFilter,
        })
        setRows(res.data ?? [])
        const t = res.total ?? res.data?.length ?? 0
        setTotal(t)
        setTotalPages(res.totalPages ?? Math.max(1, Math.ceil(t / PAGE_SIZE)))
      } catch (e) {
        const msg = userMessage(e)
        setError(msg)
        toast.show({ title: "Gagal memuat event moderasi", description: msg, tone: "danger" })
      } finally {
        setLoading(false)
        setRefreshing(false)
      }
    },
    [page, filter, toast],
  )

  const loadStats = useCallback(async () => {
    setStatsLoading(true)
    setStatsError(null)
    try {
      setStats(await getModerationStats())
    } catch (e) {
      setStatsError(userMessage(e))
    } finally {
      setStatsLoading(false)
    }
  }, [])

  useEffect(() => {
    void load("initial")
  }, [load])

  useEffect(() => {
    void loadStats()
  }, [loadStats])

  const handleFilterChange = (f: Filter) => {
    setFilter(f)
    setPage(1)
    void load("initial", 1, f)
  }

  const handlePageChange = (p: number) => {
    setPage(p)
    void load("initial", p, filter)
  }

  const handleRefresh = () => {
    void load("refresh")
    void loadStats()
  }

  const openDetail = async (eventId: string) => {
    setDetailId(eventId)
    setDetail(null)
    setDetailError(null)
    setDetailLoading(true)
    setReviewAction("REVIEWED")
    setNotes("")
    setMessagesVisible(false)
    setMessages(null)
    setMessagesError(null)
    try {
      setDetail(await getModerationEventDetail(eventId))
    } catch (e) {
      setDetailError(userMessage(e))
    } finally {
      setDetailLoading(false)
    }
  }

  const closeDetail = () => {
    if (submitting) return
    setDetailId(null)
  }

  const loadRoomMessages = async (roomId: string) => {
    setMessagesVisible(true)
    if (messages !== null || messagesLoading) return
    setMessagesLoading(true)
    setMessagesError(null)
    try {
      setMessages(await getRoomMessages(roomId, { limit: ROOM_MESSAGE_LIMIT }))
    } catch (e) {
      setMessagesError(userMessage(e))
    } finally {
      setMessagesLoading(false)
    }
  }

  const handleSubmitReview = async () => {
    if (!detailId || submitting) return
    setSubmitting(true)
    try {
      await reviewModerationEvent(detailId, {
        action: reviewAction,
        notes: notes.trim() || undefined,
      })
      toast.show({ title: "Review terkirim", tone: "success" })
      setDetailId(null)
      handleRefresh()
    } catch (e) {
      toast.show({
        title: "Gagal mengirim review",
        description: userMessage(e),
        tone: "danger",
      })
    } finally {
      setSubmitting(false)
    }
  }

  const statCards = stats
    ? Object.entries(stats)
        .filter(([, value]) => ["number", "string", "boolean"].includes(typeof value))
        .slice(0, 6)
    : []

  const detailStatus = detail ? String(detail.status ?? "") : ""

  return (
    <RoleGate href="/chat">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-h2 font-bold text-text-primary">Moderasi Chat</h1>
          <p className="mt-1 text-body text-text-secondary">
            Pantau dan tinjau percakapan pengguna (Trust & Safety).
          </p>
        </div>
        <Button
          variant="secondary"
          size="sm"
          fullWidth={false}
          loading={refreshing}
          onClick={handleRefresh}
        >
          Muat ulang
        </Button>
      </div>

      {/* Statistik */}
      <section aria-label="Statistik moderasi" className="mb-6">
        {statsLoading ? (
          <div className="flex items-center gap-2 py-4">
            <Spinner size="sm" />
            <p className="text-body text-text-secondary">Memuat statistik moderasi…</p>
          </div>
        ) : statsError ? (
          <Card>
            <EmptyState
              compact
              title="Gagal memuat statistik"
              description={statsError}
              action={
                <Button variant="secondary" size="sm" fullWidth={false} onClick={loadStats}>
                  Coba lagi
                </Button>
              }
            />
          </Card>
        ) : statCards.length === 0 ? (
          <p className="text-caption text-text-secondary">Belum ada data statistik.</p>
        ) : (
          <div className="grid grid-cols-2 gap-3 xl:grid-cols-3">
            {statCards.map(([key, value]) => (
              <Card key={key}>
                <p className="text-caption text-text-secondary">{prettifyStatKey(key)}</p>
                <p className="mt-1 text-h3 font-bold text-text-primary">{statValue(value)}</p>
              </Card>
            ))}
          </div>
        )}
      </section>

      <div className="mb-4 flex flex-wrap items-end gap-3">
        <Select
          label="Status"
          options={FILTER_OPTIONS}
          value={filter}
          onChange={(e) => handleFilterChange(e.target.value as Filter)}
          className="w-52"
        />
      </div>

      {loading ? (
        <div className="flex min-h-[40vh] items-center justify-center gap-2">
          <Spinner size="md" />
          <p className="text-body text-text-secondary">Memuat event moderasi…</p>
        </div>
      ) : error ? (
        <Card>
          <EmptyState
            title="Gagal memuat event moderasi"
            description={error}
            action={
              <Button variant="secondary" fullWidth={false} onClick={() => load("initial")}>
                Coba lagi
              </Button>
            }
          />
        </Card>
      ) : (
        <>
          <DataTable<ModerationEvent>
            columns={[
              {
                key: "type",
                header: "Event",
                render: (r) => (
                  <div>
                    <p className="font-semibold">{eventKindLabel(r)}</p>
                    <p className="text-caption text-text-secondary">
                      {r.reason ? String(r.reason) : "Tanpa alasan tercatat"}
                    </p>
                    <p className="text-caption text-text-tertiary">
                      {r.userId
                        ? `Pengguna ${String(r.userId).slice(0, 12)}`
                        : "Pengguna tidak diketahui"}
                      {r.roomId ? " · Ruang chat" : ""} · {formatDateTimeWIB(r.createdAt)}
                    </p>
                  </div>
                ),
              },
              {
                key: "status",
                header: "Status",
                render: (r) => {
                  const s = String(r.status ?? "")
                  return <Badge tone={STATUS_TONE[s] ?? "neutral"}>{s}</Badge>
                },
              },
              {
                key: "action",
                header: "",
                align: "right",
                render: (r) => (
                  <button
                    type="button"
                    onClick={() => void openDetail(r.id)}
                    className="font-semibold text-info-text hover:underline"
                  >
                    Tinjau
                  </button>
                ),
              },
            ]}
            rows={rows}
            rowKey={(r) => r.id}
            emptyText="Tidak ada event moderasi pada filter ini."
          />
          <Pagination
            page={page}
            totalPages={totalPages}
            total={total}
            pageSize={PAGE_SIZE}
            onPageChange={handlePageChange}
            className="mt-4"
          />
        </>
      )}

      {/* Dialog detail event + review */}
      <Dialog
        open={detailId !== null}
        onClose={closeDetail}
        title="Detail moderasi"
        footer={
          detail && !detailError && !detailLoading ? (
            <Button variant="primary" loading={submitting} onClick={handleSubmitReview}>
              Kirim review
            </Button>
          ) : undefined
        }
      >
        {detailLoading ? (
          <div className="flex items-center justify-center gap-2 py-8">
            <Spinner size="sm" />
            <p className="text-body text-text-secondary">Memuat detail…</p>
          </div>
        ) : detailError ? (
          <div className="py-4 text-center">
            <p className="text-body text-danger-text">{detailError}</p>
            <Button
              variant="secondary"
              size="sm"
              fullWidth={false}
              className="mt-3"
              onClick={() => detailId && void openDetail(detailId)}
            >
              Coba lagi
            </Button>
          </div>
        ) : detail ? (
          <div className="space-y-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-body font-semibold text-text-primary">
                {eventKindLabel(detail)}
              </p>
              <Badge tone={STATUS_TONE[detailStatus] ?? "neutral"}>{detailStatus}</Badge>
            </div>
            {detail.reason ? (
              <p className="text-body text-text-secondary">{String(detail.reason)}</p>
            ) : null}

            {detail.roomId ? (
              <div className="space-y-2">
                <Button
                  variant="secondary"
                  size="sm"
                  fullWidth={false}
                  onClick={() =>
                    messagesVisible
                      ? setMessagesVisible(false)
                      : void loadRoomMessages(String(detail.roomId))
                  }
                >
                  {messagesVisible ? "Sembunyikan pesan" : "Lihat pesan room"}
                </Button>
                {messagesVisible ? (
                  messagesLoading ? (
                    <div className="flex items-center gap-2 py-3">
                      <Spinner size="sm" />
                      <p className="text-body text-text-secondary">Memuat pesan…</p>
                    </div>
                  ) : messagesError ? (
                    <div className="flex flex-wrap items-center gap-3">
                      <p className="text-body text-danger-text">{messagesError}</p>
                      <Button
                        variant="secondary"
                        size="sm"
                        fullWidth={false}
                        onClick={() => void loadRoomMessages(String(detail.roomId))}
                      >
                        Coba lagi
                      </Button>
                    </div>
                  ) : messages && messages.length > 0 ? (
                    <ul className="max-h-64 space-y-2 overflow-y-auto">
                      {messages.map((m, i) => (
                        <li key={i} className="rounded-sm border border-border bg-surface px-3 py-2">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <span className="text-caption font-semibold text-text-primary">
                              {messageSenderLabel(m)}
                            </span>
                            <span className="text-caption text-text-tertiary">
                              {messageTime(m)}
                            </span>
                          </div>
                          <p className="mt-1 text-body text-text-primary">{messageText(m)}</p>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-caption text-text-secondary">
                      Tidak ada pesan di room ini.
                    </p>
                  )
                ) : null}
              </div>
            ) : null}

            <div className="space-y-3 border-t border-border pt-4">
              <Select
                label="Aksi review"
                options={ACTION_OPTIONS}
                value={reviewAction}
                onChange={(e) => setReviewAction(e.target.value as ReviewAction)}
              />
              <TextArea
                label="Catatan"
                rows={3}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Catatan review (opsional)…"
                maxLength={500}
              />
            </div>
          </div>
        ) : null}
      </Dialog>
    </RoleGate>
  )
}
