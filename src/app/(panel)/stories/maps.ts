/**
 * Peta label/tone + helper turunan untuk halaman moderasi Story.
 * Nilai enum mengikuti kontrak API (`src/lib/api/admin/stories.ts`).
 */
import type {
  StoryKind,
  StoryReportAction,
  StoryReportStatus,
} from "@/lib/api/admin/stories"

export type Tone = "neutral" | "info" | "success" | "warning" | "danger" | "accent"

export const STORY_KIND_LABEL: Record<StoryKind, string> = {
  image: "Gambar",
  video: "Video",
  text: "Teks",
}

export const REPORT_STATUS_LABEL: Record<StoryReportStatus, string> = {
  open: "Terbuka",
  in_review: "Ditinjau",
  resolved_action: "Ditindak",
  resolved_dismissed: "Diabaikan",
}

export const REPORT_STATUS_TONE: Record<StoryReportStatus, Tone> = {
  open: "warning",
  in_review: "info",
  resolved_action: "success",
  resolved_dismissed: "neutral",
}

/** Backend enum StoryReportCategory (lowercase di API). */
export const REPORT_CATEGORY_LABEL: Record<string, string> = {
  spam: "Spam",
  harassment: "Pelecehan",
  offensive: "Menyinggung",
  irrelevant: "Tidak relevan",
  other: "Lainnya",
}

export const REPORT_ACTION_LABEL: Record<StoryReportAction, string> = {
  in_review: "Tandai ditinjau",
  dismiss: "Abaikan",
  hide: "Sembunyikan Story",
  delete: "Hapus Story",
  ban: "Ban fitur Story penulis",
}

/** Status final laporan — backend menolak review lanjutan dengan 409. */
export const REPORT_FINAL_STATUSES: ReadonlySet<string> = new Set([
  "resolved_action",
  "resolved_dismissed",
])

export type StoryDerivedStatus = "active" | "hidden" | "expired" | "deleted"

export const STORY_STATUS_LABEL: Record<StoryDerivedStatus, string> = {
  active: "Aktif",
  hidden: "Disembunyikan",
  expired: "Kedaluwarsa",
  deleted: "Dihapus",
}

export const STORY_STATUS_TONE: Record<StoryDerivedStatus, Tone> = {
  active: "success",
  hidden: "warning",
  expired: "neutral",
  deleted: "danger",
}

/**
 * Status turunan dari timestamp — urutan sama dengan filter `status`
 * backend: deleted > hidden (aktif & belum lewat) > expired > active.
 */
export function deriveStoryStatus(
  s: { deletedAt: string | null; hiddenAt: string | null; hiddenUntil: string | null; expiresAt: string },
  now: number = Date.now(),
): StoryDerivedStatus {
  if (s.deletedAt) return "deleted"
  if (s.hiddenAt && (!s.hiddenUntil || Date.parse(s.hiddenUntil) > now)) return "hidden"
  if (Date.parse(s.expiresAt) <= now) return "expired"
  return "active"
}

/** Jendela pulihkan backend: 7 hari sejak `hiddenAt` (STORY_RESTORE_WINDOW_MS). */
export const STORY_RESTORE_WINDOW_MS = 7 * 24 * 60 * 60 * 1000

export function canRestoreStory(hiddenAt: string | null, now: number = Date.now()): boolean {
  if (!hiddenAt) return false
  const t = Date.parse(hiddenAt)
  return Number.isFinite(t) && now - t <= STORY_RESTORE_WINDOW_MS
}

/** Durasi video `mm:ss` dari milidetik; invalid → "—". */
export function formatStoryDuration(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms) || ms < 0) return "—"
  const total = Math.round(ms / 1000)
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`
}

/** Angka ringkas untuk tile metrik: 1.284 / 12,9rb / 4,2jt. */
export function formatCompact(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—"
  const abs = Math.abs(n)
  if (abs >= 1_000_000) return `${(n / 1_000_000).toLocaleString("id-ID", { maximumFractionDigits: 1 })}jt`
  if (abs >= 10_000) return `${(n / 1_000).toLocaleString("id-ID", { maximumFractionDigits: 1 })}rb`
  return n.toLocaleString("id-ID", { maximumFractionDigits: 2 })
}
