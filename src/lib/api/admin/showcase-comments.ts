/**
 * Kahade admin — moderasi komentar showcase (FAL-010).
 *
 * Kontrak backend AKTUAL (audit integrasi 2026-10-06):
 * - GET  /v1/admin/showcase/comments?{status,search,page,limit}
 *   → {data,total,page,limit,totalPages,status}; status = all|visible|hidden|deleted
 *   item: {id,content,isHidden,hiddenReason,author:{...},showcase:{id},...}
 * - PATCH /v1/admin/showcase/comments/:id  {action:'hide'|'unhide'|'delete', reason?}
 *   → wajib header `Idempotency-Key` (@Idempotency).
 *   reason untuk hide: SPAM|INAPPROPRIATE|HARASSMENT|OTHER.
 *   action=delete: wajib `X-Step-Up-Token` (aksi `showcase-comment.delete`,
 *   targetId = id komentar) — ditegakkan server (403 STEP_UP_REQUIRED) sejak
 *   ADM-09 (audit etalase 2026-10-10); sebelumnya hanya UI yang meminta.
 *   Item list: `showcase: {id, title}`, `isDeleted`, `deletedAt`, `deleteReason`.
 *
 * P1-13 s.d. P1-18 (audit integrasi 2026-10-06): kontrak lama ({hidden},
 * {deleted:true}, query hidden/itemId, baca flat authorName) → 422/blank.
 */
import { adminHttp } from "@/lib/api/admin-client"
import type { Paginated } from "@/lib/api/admin/kyc"
import { stepUpHeaders } from "@/lib/api/admin/step-up"
import { errorCode } from "@/lib/api/response"

function newIdempotencyKey(): string {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = Math.floor(Math.random() * 16)
    const v = c === "x" ? r : (r & 0x3) | 0x8
    return v.toString(16)
  })
}

function isNotFoundError(e: unknown): boolean {
  return (
    typeof e === "object" && e !== null && (e as { status?: number }).status === 404
  )
}

export type ShowcaseCommentAuthor = {
  userId?: string
  username?: string | null
  fullName?: string | null
  avatarUrl?: string | null
  [key: string]: unknown
}

export type ShowcaseComment = {
  id: string
  content: string | null
  showcaseId?: string | null
  parentId?: string | null
  isHidden: boolean
  hiddenReason?: string | null
  hiddenAt?: string | null
  hiddenBy?: string | null
  isDeleted?: boolean
  deletedAt?: string | null
  deletedBy?: string | null
  deleteReason?: string | null
  createdAt: string
  updatedAt?: string
  /** Relasi author (backend kirim nested, bukan flat). P1-18. */
  author?: ShowcaseCommentAuthor | null
  /** Relasi showcase (backend kirim {id, title}). P1-18 / ADM-07. */
  showcase?: { id?: string; title?: string | null; [key: string]: unknown } | null
  // Alias lama (deprecated) — dipertahankan agar pemanggil lama tidak crash,
  // diisi dari relasi bila ada.
  authorName?: string | null
  authorUsername?: string | null
  /** Judul etalase dari relasi (ADM-07) — sebelumnya diisi id mentah. */
  itemTitle?: string | null
  /** Id etalase (relasi/showcaseId) untuk fallback tampilan. */
  itemId?: string | null
  [key: string]: unknown
}

export type ShowcaseCommentStatus = "all" | "visible" | "hidden" | "deleted"

export type ShowcaseCommentFilters = {
  page?: number
  limit?: number
  /** Cari isi komentar / nama penulis. */
  search?: string
  /** P1-17: backend hanya kenal `status` (bukan `hidden`/`itemId`). */
  status?: ShowcaseCommentStatus
}

/** Kategori alasan moderasi yang diterima backend untuk hide. P1-16. */
export const SHOWCASE_HIDE_REASONS = [
  "SPAM",
  "INAPPROPRIATE",
  "HARASSMENT",
  "OTHER",
] as const
export type ShowcaseHideReason = (typeof SHOWCASE_HIDE_REASONS)[number]

export type ModerateCommentAction = "hide" | "unhide" | "delete"

function notSupported(fn: string, method: string, path: string): Error {
  return new Error(
    `Moderasi komentar showcase belum tersedia — membutuhkan backend terbaru (${method} ${path}, fungsi ${fn}).`,
  )
}

function normalizeComment(raw: unknown): ShowcaseComment {
  const c = (raw ?? {}) as Record<string, unknown>
  const author = (c.author ?? null) as ShowcaseCommentAuthor | null
  const showcase = (c.showcase ?? null) as { id?: string; title?: string | null } | null
  return {
    ...(c as object),
    id: String(c.id ?? ""),
    content: typeof c.content === "string" ? c.content : null,
    isHidden: c.isHidden === true,
    // ADM-07: baris terhapus (soft-delete) — backend kirim isDeleted + deletedAt.
    isDeleted: c.isDeleted === true || (c.deletedAt != null && c.deletedAt !== ""),
    createdAt: String(c.createdAt ?? ""),
    author,
    showcase,
    // Alias lama dari relasi — P1-18.
    authorName:
      (c.authorName as string | null) ??
      author?.fullName ??
      author?.username ??
      null,
    authorUsername: (c.authorUsername as string | null) ?? author?.username ?? null,
    itemTitle:
      (c.itemTitle as string | null) ?? (typeof showcase?.title === "string" ? showcase.title : null),
    itemId:
      (c.itemId as string | null) ??
      showcase?.id ??
      (typeof c.showcaseId === "string" ? c.showcaseId : null),
  } as ShowcaseComment
}

export async function listShowcaseComments(
  params?: ShowcaseCommentFilters,
): Promise<Paginated<ShowcaseComment>> {
  try {
    const raw = await adminHttp.get<unknown>("/v1/admin/showcase/comments", {
      query: {
        page: params?.page,
        limit: params?.limit,
        search: params?.search?.trim() || undefined,
        status: params?.status ?? "all",
      } as Record<string, string | number | undefined>,
    })
    const r = (raw ?? {}) as Record<string, unknown>
    const data = Array.isArray(r.data)
      ? (r.data as unknown[]).map(normalizeComment)
      : []
    return {
      data,
      total: typeof r.total === "number" ? r.total : data.length,
      page: typeof r.page === "number" ? r.page : (params?.page ?? 1),
      limit: typeof r.limit === "number" ? r.limit : (params?.limit ?? 20),
      totalPages: typeof r.totalPages === "number" ? r.totalPages : 1,
    } as Paginated<ShowcaseComment>
  } catch (e) {
    if (isNotFoundError(e)) {
      throw notSupported(
        "listShowcaseComments",
        "GET",
        "/v1/admin/showcase/comments",
      )
    }
    throw e
  }
}

/**
 * Moderasi komentar: hide / unhide / delete.
 * P1-13/14: backend wajib {action}, bukan {hidden}/{deleted:true}.
 * P1-15: endpoint @Idempotency() — Idempotency-Key wajib.
 * P1-16: reason untuk hide harus SPAM|INAPPROPRIATE|HARASSMENT|OTHER.
 */
export async function moderateShowcaseComment(
  id: string,
  action: ModerateCommentAction,
  reason: string | undefined,
  opts?: { stepUpToken?: string; idempotencyKey?: string },
): Promise<ShowcaseComment> {
  try {
    const res = await adminHttp.patch<unknown>(
      `/v1/admin/showcase/comments/${encodeURIComponent(id)}`,
      { action, reason: reason?.trim() || undefined },
      {
        headers: {
          "Idempotency-Key": opts?.idempotencyKey ?? newIdempotencyKey(),
          ...(opts?.stepUpToken ? stepUpHeaders(opts.stepUpToken) : {}),
        },
      },
    )
    // Backend kembalikan objek hasil moderasi — normalisasi seperti list.
    const r = (res ?? {}) as Record<string, unknown>
    const inner =
      (r.data as Record<string, unknown> | undefined) ??
      (r.comment as Record<string, unknown> | undefined) ??
      r
    return normalizeComment(inner)
  } catch (e) {
    if (isNotFoundError(e)) {
      // 404 KOMENTAR (SHOWCASE_COMMENT_NOT_FOUND) ≠ 404 rute belum ada —
      // sebelumnya keduanya dibaca "backend belum mendukung" (menyesatkan).
      if (errorCode(e) === "SHOWCASE_COMMENT_NOT_FOUND") {
        const notFound = e as Error
        notFound.message = "Komentar tidak ditemukan — mungkin sudah dihapus. Muat ulang daftar."
        throw notFound
      }
      throw notSupported(
        "moderateShowcaseComment",
        "PATCH",
        "/v1/admin/showcase/comments/:id",
      )
    }
    throw e
  }
}

/**
 * Sembunyikan komentar. `reason` kategori: SPAM|INAPPROPRIATE|HARASSMENT|OTHER.
 * (Kompatibilitas — delegasi ke moderateShowcaseComment.)
 */
export async function setShowcaseCommentHidden(
  id: string,
  hidden: boolean,
  reason: string,
): Promise<ShowcaseComment> {
  return moderateShowcaseComment(id, hidden ? "hide" : "unhide", reason)
}

/**
 * Hapus komentar (soft-delete). `stepUpToken` dari step-up gate
 * (aksi `showcase-comment.delete`) — jangan panggil tanpa token.
 * (Kompatibilitas — delegasi ke moderateShowcaseComment.)
 */
export async function deleteShowcaseComment(
  id: string,
  reason: string,
  stepUpToken: string,
): Promise<ShowcaseComment> {
  return moderateShowcaseComment(id, "delete", reason, { stepUpToken })
}
