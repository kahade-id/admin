"use client"

/**
 * Admin — Detail Story: pratinjau media (gambar / video dengan poster /
 * teks berlatar), info ringkas, aksi moderasi (sembunyikan, pulihkan,
 * hapus, ban/cabut ban fitur Story penulis), daftar viewer, dan riwayat
 * balasan (hanya bila ada laporan terbuka — 403 ditampilkan apa adanya).
 *
 * Status ban penulis tidak ada di `GET /:id`; dibaca dari
 * `GET /admin/stories?authorUserId=&limit=1` (`featureBanned`).
 */

import Link from "next/link"
import { useParams } from "next/navigation"
import { useCallback, useState } from "react"

import { Pagination } from "@/components/admin/pagination"
import { RoleGate } from "@/components/admin/role-gate"
import { useStepUp } from "@/components/admin/step-up-gate"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardHeader } from "@/components/ui/card"
import { ConfirmDialog, Dialog } from "@/components/ui/dialog"
import { EmptyState } from "@/components/ui/empty-state"
import { Input, TextArea } from "@/components/ui/input"
import { useToast } from "@/components/ui/toast"
import {
  banStoryFeature,
  deleteAdminStory,
  getAdminStoryDetail,
  getAdminStoryReplies,
  getAdminStoryViewers,
  hideAdminStory,
  listAdminStories,
  restoreAdminStory,
  STORY_STEP_UP_ACTION,
  unbanStoryFeature,
  type AdminStoryDetail,
  type AdminStoryReplyRoom,
  type AdminStoryViewer,
} from "@/lib/api/admin/stories"
import { userMessage } from "@/lib/api/response"
import { formatDateTimeWIB, formatRelativeTime } from "@/lib/format"

import { ErrorBlock, KeyValue, PageHeader } from "../../_components/admin-ui"
import { Skeleton } from "../_components/skeleton"
import { StoryPlayer } from "../_components/story-media"
import { useAsync } from "../_components/use-async"
import {
  canRestoreStory,
  deriveStoryStatus,
  formatStoryDuration,
  STORY_KIND_LABEL,
  STORY_STATUS_LABEL,
  STORY_STATUS_TONE,
} from "../maps"

const VIEWERS_PAGE = 30

type Pending = { kind: "hide" } | { kind: "delete" } | { kind: "ban" }

export default function StoryDetailPage() {
  const { id } = useParams<{ id: string }>()
  const storyId = Array.isArray(id) ? id[0] : (id ?? "")
  const toast = useToast()
  const stepUp = useStepUp()

  const fetcher = useCallback(() => getAdminStoryDetail(storyId), [storyId])
  const { data: story, error: loadError, loading, reload, mutate } = useAsync(fetcher)
  const setStory = (next: AdminStoryDetail) => mutate(() => next)
  const notFound = (loadError as { status?: number } | null)?.status === 404

  // Status ban penulis tidak ada di detail — baca dari list (featureBanned).
  const authorUserId = story?.author?.userId ?? ""
  const banFetcher = useCallback(
    (): Promise<boolean | null> =>
      authorUserId
        ? listAdminStories({ authorUserId, limit: 1 }).then(
            (res) => res.stories[0]?.featureBanned ?? false,
          )
        : Promise.resolve(null),
    [authorUserId],
  )
  const banQuery = useAsync<boolean | null>(banFetcher)
  const [banOverride, setBanOverride] = useState<boolean | null>(null)
  /** null = belum diketahui (gagal dibaca) → tampilkan kedua tombol. */
  const featureBanned: boolean | null = banOverride ?? banQuery.data
  const [deleted, setDeleted] = useState(false)

  const [pending, setPending] = useState<Pending | null>(null)
  const [confirm, setConfirm] = useState<"restore" | "unban" | null>(null)
  const [reason, setReason] = useState("")
  const [days, setDays] = useState("")
  const [acting, setActing] = useState(false)

  const openAction = (p: Pending) => {
    setPending(p)
    setReason("")
    setDays("")
  }

  const daysNum = days.trim() === "" ? undefined : Number(days)
  const daysMax = pending?.kind === "hide" ? 30 : 3650
  const daysValid =
    daysNum === undefined || (Number.isInteger(daysNum) && daysNum >= 1 && daysNum <= daysMax)
  const canSubmit = reason.trim().length > 0 && reason.length <= 500 && daysValid

  const runAction = async () => {
    if (!story || !pending || !canSubmit || acting) return
    const trimmed = reason.trim()
    const authorId = story.author?.userId
    let token: string | undefined
    if (pending.kind === "delete") {
      const t = await stepUp.requestStepUp({
        action: STORY_STEP_UP_ACTION.delete,
        targetId: story.id,
        title: "Hapus Story",
        description: "Story dan medianya dihapus permanen. Aksi tercatat di audit.",
      })
      if (!t) return
      token = t
    } else if (pending.kind === "ban") {
      if (!authorId) return
      const t = await stepUp.requestStepUp({
        action: STORY_STEP_UP_ACTION.ban,
        targetId: authorId,
        title: "Ban fitur Story",
        description: `@${story.author?.username ?? authorId} tidak bisa membuat Story; Story aktifnya ikut disembunyikan.`,
      })
      if (!t) return
      token = t
    }
    setActing(true)
    try {
      if (pending.kind === "hide") {
        const res = await hideAdminStory(story.id, {
          reason: trimmed,
          ...(daysNum !== undefined ? { durationDays: daysNum } : {}),
        })
        setStory({
          ...story,
          hiddenAt: new Date().toISOString(),
          hiddenUntil: res.hiddenUntil,
          hiddenReason: trimmed,
        })
        toast.show({ title: "Story disembunyikan", tone: "success" })
      } else if (pending.kind === "delete") {
        await deleteAdminStory(story.id, { reason: trimmed }, { stepUpToken: token })
        setDeleted(true)
        toast.show({ title: "Story dihapus permanen", tone: "success" })
      } else if (authorId) {
        const res = await banStoryFeature(
          authorId,
          { reason: trimmed, ...(daysNum !== undefined ? { durationDays: daysNum } : {}) },
          { stepUpToken: token },
        )
        setBanOverride(true)
        if (deriveStoryStatus(story) === "active") {
          setStory({
            ...story,
            hiddenAt: new Date().toISOString(),
            hiddenUntil: res.bannedUntil,
            hiddenReason: "FEATURE_BAN",
          })
        }
        toast.show({
          title: res.bannedUntil
            ? `Ban fitur Story sampai ${formatDateTimeWIB(res.bannedUntil)}`
            : "Ban fitur Story permanen",
          tone: "success",
        })
      }
      setPending(null)
    } catch (e) {
      toast.show({ title: "Aksi gagal", description: userMessage(e), tone: "danger" })
    } finally {
      setActing(false)
    }
  }

  const runConfirm = async () => {
    if (!story || !confirm || acting) return
    setActing(true)
    try {
      if (confirm === "restore") {
        await restoreAdminStory(story.id)
        setStory({ ...story, hiddenAt: null, hiddenUntil: null, hiddenReason: null })
        toast.show({ title: "Story dipulihkan", tone: "success" })
      } else if (story.author?.userId) {
        await unbanStoryFeature(story.author.userId)
        setBanOverride(false)
        if (story.hiddenReason === "FEATURE_BAN") {
          setStory({ ...story, hiddenAt: null, hiddenUntil: null, hiddenReason: null })
        }
        toast.show({ title: "Ban fitur Story dicabut", tone: "success" })
      }
      setConfirm(null)
    } catch (e) {
      const status = (e as { status?: number } | null)?.status
      toast.show({
        title: "Aksi gagal",
        description:
          confirm === "restore" && status === 404
            ? "Tidak bisa dipulihkan: jendela 7 hari sudah lewat atau Story tidak lagi tersembunyi."
            : userMessage(e),
        tone: "danger",
      })
    } finally {
      setActing(false)
    }
  }

  const status = story ? deriveStoryStatus(story) : null
  const dialogTitle =
    pending?.kind === "hide"
      ? "Sembunyikan Story"
      : pending?.kind === "delete"
        ? "Hapus Story"
        : "Ban fitur Story penulis"

  return (
    <RoleGate href="/stories">
      <PageHeader
        title="Detail Story"
        actions={
          <Link href="/stories" className="text-body font-semibold text-info-text hover:underline">
            Kembali
          </Link>
        }
        onRefresh={deleted ? undefined : reload}
        refreshing={loading}
      />

      {deleted ? (
        <Card>
          <EmptyState
            title="Story dihapus permanen"
            description="Media dan data Story sudah tidak ada. Snapshot laporan tetap tersimpan."
            action={
              <Link href="/stories" className="text-body font-semibold text-info-text hover:underline">
                Kembali ke daftar
              </Link>
            }
          />
        </Card>
      ) : loading ? (
        <DetailSkeleton />
      ) : loadError ? (
        notFound ? (
          <Card>
            <EmptyState
              title="Story tidak ditemukan"
              description="Mungkin sudah dihapus permanen atau tautan salah."
            />
          </Card>
        ) : (
          <ErrorBlock message={userMessage(loadError)} onRetry={reload} />
        )
      ) : story ? (
        <div className="grid gap-6 lg:grid-cols-[360px_1fr]">
          <div className="space-y-3">
            {/* key = URL media: fetch ulang menghasilkan URL baru → state gagal ter-reset. */}
            <StoryPlayer key={story.mediaUrl ?? story.thumbnailUrl ?? story.id} story={story} onReload={reload} />
            <div className="flex flex-wrap items-center justify-center gap-2">
              <Badge tone={story.kind === "video" ? "info" : "neutral"}>
                {STORY_KIND_LABEL[story.kind]}
                {story.kind === "video" ? ` · ${formatStoryDuration(story.durationMs)}` : ""}
              </Badge>
              {status ? <Badge tone={STORY_STATUS_TONE[status]}>{STORY_STATUS_LABEL[status]}</Badge> : null}
              {featureBanned ? <Badge tone="danger">Penulis di-ban</Badge> : null}
            </div>
          </div>

          <div className="space-y-6">
            <Card>
              <dl>
                <KeyValue
                  label="Penulis"
                  value={
                    story.author ? (
                      <>
                        <span className="font-medium">@{story.author.username}</span>
                        {story.author.fullName ? ` · ${story.author.fullName}` : ""}
                      </>
                    ) : (
                      "—"
                    )
                  }
                />
                <KeyValue label="ID penulis" value={story.author?.userId ?? "—"} mono />
                <KeyValue label="ID Story" value={story.id} mono />
                <KeyValue label="Dibuat" value={formatDateTimeWIB(story.createdAt)} />
                <KeyValue label="Kedaluwarsa" value={formatDateTimeWIB(story.expiresAt)} />
                <KeyValue
                  label="View · Reaksi"
                  value={`${story.viewCount.toLocaleString("id-ID")} · ${story.reactionCount.toLocaleString("id-ID")}`}
                />
                <KeyValue
                  label="Audiens"
                  value={
                    story.audience.mode === "savers_except"
                      ? `Penyimpan profil, kecuali ${story.audience.excludedUserIds.length} akun`
                      : "Semua penyimpan profil"
                  }
                />
                {story.productTags.length > 0 ? (
                  <KeyValue
                    label="Tag produk"
                    value={story.productTags.map((t) => t.title).join(", ")}
                  />
                ) : null}
                {story.priceSticker ? (
                  <KeyValue
                    label="Stiker harga"
                    value={`Rp${story.priceSticker.amount.toLocaleString("id-ID")}`}
                  />
                ) : null}
                {story.hiddenAt ? (
                  <KeyValue
                    label="Disembunyikan"
                    value={
                      <>
                        {formatDateTimeWIB(story.hiddenAt)}
                        {story.hiddenUntil ? ` → ${formatDateTimeWIB(story.hiddenUntil)}` : " (tanpa batas)"}
                        {story.hiddenReason ? (
                          <span className="block text-caption text-text-secondary">
                            {story.hiddenReason === "FEATURE_BAN" ? "Karena ban fitur Story" : story.hiddenReason}
                          </span>
                        ) : null}
                      </>
                    }
                  />
                ) : null}
                {story.deletedAt ? (
                  <KeyValue label="Dihapus" value={formatDateTimeWIB(story.deletedAt)} />
                ) : null}
              </dl>
            </Card>

            <Card>
              <CardHeader title="Tindakan" divider />
              <div className="flex flex-wrap gap-2">
                {status !== "deleted" && status !== "hidden" ? (
                  <Button variant="secondary" size="sm" fullWidth={false} onClick={() => openAction({ kind: "hide" })}>
                    Sembunyikan
                  </Button>
                ) : null}
                {status === "hidden" && story.hiddenReason !== "FEATURE_BAN" ? (
                  <Button
                    variant="secondary"
                    size="sm"
                    fullWidth={false}
                    disabled={!canRestoreStory(story.hiddenAt)}
                    title={canRestoreStory(story.hiddenAt) ? undefined : "Jendela pulihkan 7 hari sudah lewat"}
                    onClick={() => setConfirm("restore")}
                  >
                    Pulihkan
                  </Button>
                ) : null}
                {status !== "deleted" ? (
                  <Button variant="destructive" size="sm" fullWidth={false} onClick={() => openAction({ kind: "delete" })}>
                    Hapus
                  </Button>
                ) : null}
                {story.author ? (
                  featureBanned === true ? (
                    <Button variant="secondary" size="sm" fullWidth={false} onClick={() => setConfirm("unban")}>
                      Cabut ban fitur Story
                    </Button>
                  ) : (
                    <>
                      <Button variant="destructive" size="sm" fullWidth={false} onClick={() => openAction({ kind: "ban" })}>
                        Ban fitur Story penulis
                      </Button>
                      {featureBanned === null ? (
                        <Button variant="ghost" size="sm" fullWidth={false} onClick={() => setConfirm("unban")}>
                          Cabut ban
                        </Button>
                      ) : null}
                    </>
                  )
                ) : null}
              </div>
            </Card>

            <ViewersCard storyId={story.id} />
            <RepliesCard storyId={story.id} />
          </div>
        </div>
      ) : null}

      <Dialog
        open={pending !== null}
        onClose={() => {
          if (!acting) setPending(null)
        }}
        title={dialogTitle}
        dirty={reason.length > 0}
        footer={
          <>
            <Button variant="secondary" fullWidth={false} onClick={() => setPending(null)} disabled={acting}>
              Batal
            </Button>
            <Button
              variant={pending?.kind === "hide" ? "primary" : "destructive"}
              fullWidth={false}
              onClick={() => void runAction()}
              disabled={!canSubmit}
              loading={acting}
            >
              {dialogTitle}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          {pending?.kind !== "delete" ? (
            <Input
              type="number"
              inputMode="numeric"
              min={1}
              max={daysMax}
              label={pending?.kind === "hide" ? "Durasi (hari, 1–30)" : "Durasi ban (hari)"}
              hint={pending?.kind === "hide" ? "Kosong = 7 hari." : "Kosong = permanen. Maks 3650."}
              error={daysValid ? undefined : `Isi angka bulat 1–${daysMax}.`}
              value={days}
              onChange={(e) => setDays(e.target.value)}
            />
          ) : null}
          <TextArea
            label="Alasan"
            required
            rows={3}
            maxLength={500}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            hint={`${reason.length}/500 · tercatat di audit`}
          />
        </div>
      </Dialog>

      <ConfirmDialog
        open={confirm !== null}
        onClose={() => {
          if (!acting) setConfirm(null)
        }}
        title={confirm === "restore" ? "Pulihkan Story?" : "Cabut ban fitur Story?"}
        description={
          confirm === "restore"
            ? "Story kembali terlihat oleh audiensnya."
            : "Penulis bisa membuat Story lagi; Story yang disembunyikan karena ban ikut dipulihkan."
        }
        confirmLabel={confirm === "restore" ? "Pulihkan" : "Cabut ban"}
        onConfirm={runConfirm}
        loading={acting}
      />

      {stepUp.stepUpDialog}
    </RoleGate>
  )
}

function DetailSkeleton() {
  return (
    <div className="grid gap-6 lg:grid-cols-[360px_1fr]" role="status" aria-label="Memuat">
      <Skeleton className="mx-auto aspect-[9/16] w-full max-w-[320px]" />
      <div className="space-y-6">
        <Skeleton className="h-64 w-full" />
        <Skeleton className="h-20 w-full" />
        <Skeleton className="h-40 w-full" />
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Viewer
// ---------------------------------------------------------------------------

function ViewersCard({ storyId }: { storyId: string }) {
  const [page, setPage] = useState(1)
  const fetcher = useCallback(
    () => getAdminStoryViewers(storyId, { page, limit: VIEWERS_PAGE }),
    [storyId, page],
  )
  const { data, error, loading } = useAsync(fetcher)
  const rows: AdminStoryViewer[] = data?.viewers ?? []
  const total = data?.total ?? 0

  return (
    <Card>
      <CardHeader title="Viewer" subtitle={loading ? undefined : `${total.toLocaleString("id-ID")} akun`} divider />
      {loading ? (
        <div className="space-y-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-5 w-full" />
          ))}
        </div>
      ) : error ? (
        <p className="text-body text-danger-text">{userMessage(error)}</p>
      ) : rows.length === 0 ? (
        <p className="text-body text-text-secondary">Belum ada yang melihat.</p>
      ) : (
        <ul className="divide-y divide-border">
          {rows.map((v, i) => (
            <li key={`${v.user?.userId ?? i}-${v.viewedAt}`} className="flex items-center justify-between gap-3 py-2">
              <span className="min-w-0 truncate text-body text-text-primary">
                @{v.user?.username ?? "—"}
                {v.reaction ? <span className="ml-2">{v.reaction}</span> : null}
              </span>
              <span className="shrink-0 text-caption text-text-tertiary">{formatRelativeTime(v.viewedAt)}</span>
            </li>
          ))}
        </ul>
      )}
      <Pagination
        page={page}
        totalPages={Math.max(1, Math.ceil(total / VIEWERS_PAGE))}
        total={total}
        pageSize={VIEWERS_PAGE}
        onPageChange={setPage}
        className="mt-3"
      />
    </Card>
  )
}

// ---------------------------------------------------------------------------
// Balasan (hanya saat ada laporan terbuka)
// ---------------------------------------------------------------------------

function RepliesCard({ storyId }: { storyId: string }) {
  const fetcher = useCallback(() => getAdminStoryReplies(storyId), [storyId])
  const { data, error, loading } = useAsync(fetcher)
  const rooms: AdminStoryReplyRoom[] | null = data?.rooms ?? null
  const status = (error as { status?: number } | null)?.status
  const notice = error
    ? status === 403
      ? "Riwayat balasan hanya tersedia selama ada laporan terbuka untuk Story ini."
      : status === 409
        ? "Riwayat balasan sedang tidak dapat dibuka (konflik status di server)."
        : userMessage(error)
    : null

  return (
    <Card>
      <CardHeader title="Balasan" divider />
      {loading ? (
        <Skeleton className="h-10 w-full" />
      ) : notice ? (
        <p className="text-body text-text-secondary">{notice}</p>
      ) : rooms && rooms.length === 0 ? (
        <p className="text-body text-text-secondary">Belum ada balasan.</p>
      ) : (
        <div className="space-y-4">
          {rooms?.map((room) => (
            <div key={room.roomId}>
              <p className="mb-1 text-caption font-semibold text-text-secondary">
                {room.subject ?? room.type}
              </p>
              <ul className="space-y-1">
                {room.messages.map((m) => (
                  <li key={m.id} className="text-body">
                    <span className="font-medium text-text-primary">
                      @{m.sender.username ?? m.sender.userId}
                    </span>{" "}
                    {m.deleted ? (
                      <span className="italic text-text-tertiary">(pesan dihapus)</span>
                    ) : m.text ? (
                      <span className="text-text-primary">{m.text}</span>
                    ) : (
                      <span className="italic text-text-tertiary">({m.messageType.toLowerCase()})</span>
                    )}
                    <span className="ml-2 text-caption text-text-tertiary">
                      {formatRelativeTime(m.createdAt)}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </Card>
  )
}
