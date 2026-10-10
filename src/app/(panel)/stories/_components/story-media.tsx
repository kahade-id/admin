"use client"

/**
 * Pratinjau media Story untuk admin — gambar, video (poster + pemutar
 * HTML), atau teks berlatar warna. `StoryThumb` untuk kartu/tabel,
 * `StoryPlayer` untuk detail.
 *
 * URL media bertanda tangan & singkat umur (detail 300 dtk, snapshot
 * laporan 900 dtk). Bila `<img>`/`<video>` gagal (`onError`), tampilkan
 * tombol "Muat ulang" yang memanggil `onReload` (fetch ulang dari server),
 * bukan pesan generik. Pemanggil mengganti `key` saat URL baru datang agar
 * state gagal ter-reset.
 */

import { useState } from "react"

import type { StoryKind } from "@/lib/api/admin/stories"
import { cn } from "@/lib/cn"

import { formatStoryDuration } from "../maps"

export type StoryMediaSource = {
  kind?: StoryKind
  mediaUrl: string | null
  thumbnailUrl: string | null
  text?: string | null
  backgroundColor?: string | null
  durationMs?: number | null
}

/** Warna teks kontras untuk latar Story (hex #rgb/#rrggbb); fallback putih. */
export function textColorOn(bg: string | null | undefined): string {
  if (!bg) return "#ffffff"
  const hex = bg.replace("#", "")
  const full = hex.length === 3 ? hex.split("").map((c) => c + c).join("") : hex
  if (!/^[0-9a-fA-F]{6}$/.test(full)) return "#ffffff"
  const r = parseInt(full.slice(0, 2), 16)
  const g = parseInt(full.slice(2, 4), 16)
  const b = parseInt(full.slice(4, 6), 16)
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255
  return luminance > 0.6 ? "#111111" : "#ffffff"
}

function Placeholder({
  label,
  onReload,
  compact = false,
}: {
  label: string
  onReload?: () => void
  compact?: boolean
}) {
  return (
    <div
      className={cn(
        "flex h-full w-full flex-col items-center justify-center gap-1 p-2 text-center text-text-tertiary",
        compact ? "text-[10px] leading-tight" : "text-caption",
      )}
    >
      <span>{label}</span>
      {onReload ? (
        <button
          type="button"
          onClick={onReload}
          className={cn("font-semibold text-info-text hover:underline", compact ? "text-[10px]" : "text-body")}
        >
          Muat ulang
        </button>
      ) : null}
    </div>
  )
}

const EXPIRED = "Media gagal dimuat — tautan mungkin kedaluwarsa"

export function StoryThumb({
  story,
  className,
  onReload,
}: {
  story: StoryMediaSource
  className?: string
  onReload?: () => void
}) {
  const [failed, setFailed] = useState(false)
  const bg = story.backgroundColor ?? "#1f2937"
  return (
    <div
      className={cn(
        "relative aspect-[9/16] w-16 shrink-0 overflow-hidden rounded-sm bg-surface-elevated",
        className,
      )}
    >
      {story.kind === "text" ? (
        <div
          className="flex h-full w-full items-center justify-center p-1.5"
          style={{ backgroundColor: bg, color: textColorOn(bg) }}
        >
          <p className="line-clamp-4 text-center text-[10px] leading-tight">{story.text ?? ""}</p>
        </div>
      ) : failed ? (
        <Placeholder label="Gagal dimuat" onReload={onReload} compact />
      ) : story.kind === "video" ? (
        <>
          {story.thumbnailUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={story.thumbnailUrl}
              alt=""
              loading="lazy"
              onError={() => setFailed(true)}
              className="h-full w-full object-cover"
            />
          ) : (
            <Placeholder label="Video" compact />
          )}
          <span className="absolute bottom-1 left-1 rounded-xs bg-black/70 px-1 text-[10px] font-medium text-white">
            ▶ {formatStoryDuration(story.durationMs)}
          </span>
        </>
      ) : story.mediaUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={story.mediaUrl}
          alt=""
          loading="lazy"
          onError={() => setFailed(true)}
          className="h-full w-full object-cover"
        />
      ) : (
        <Placeholder label="Media tidak tersedia" compact />
      )}
    </div>
  )
}

export function StoryPlayer({
  story,
  className,
  onReload,
}: {
  story: StoryMediaSource
  className?: string
  /** Fetch ulang detail (URL baru) saat media gagal dimuat. */
  onReload?: () => void
}) {
  const [failed, setFailed] = useState(false)
  const bg = story.backgroundColor ?? "#1f2937"
  return (
    <div
      className={cn(
        "relative mx-auto aspect-[9/16] w-full max-w-[320px] overflow-hidden rounded-sm bg-black",
        className,
      )}
    >
      {story.kind === "text" ? (
        <div
          className="flex h-full w-full items-center justify-center p-6"
          style={{ backgroundColor: bg, color: textColorOn(bg) }}
        >
          <p className="whitespace-pre-wrap break-words text-center text-h3 font-semibold">
            {story.text ?? ""}
          </p>
        </div>
      ) : failed ? (
        <Placeholder label={EXPIRED} onReload={onReload} />
      ) : story.kind === "video" ? (
        story.mediaUrl ? (
          <video
            controls
            playsInline
            preload="metadata"
            poster={story.thumbnailUrl ?? undefined}
            src={story.mediaUrl}
            onError={() => setFailed(true)}
            className="h-full w-full object-contain"
          >
            Browser tidak mendukung pemutar video.
          </video>
        ) : (
          <Placeholder label="Video tidak tersedia (media sudah dihapus)" />
        )
      ) : story.mediaUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={story.mediaUrl}
          alt="Pratinjau Story"
          onError={() => setFailed(true)}
          className="h-full w-full object-contain"
        />
      ) : (
        <Placeholder label="Gambar tidak tersedia (media sudah dihapus)" />
      )}
    </div>
  )
}
