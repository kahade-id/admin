/**
 * Kahade admin — moderasi komentar showcase (FAL-010, audit integrasi 2026-10-03).
 *
 * Kontrak backend (asumsi — tim backend membangun paralel; SEMUA fungsi
 * defensif 404 dengan pesan jelas "membutuhkan backend terbaru"):
 * - GET   /v1/admin/showcase/comments?{page,limit,search,hidden,itemId}
 *   → Paginated<ShowcaseComment>
 * - PATCH /v1/admin/showcase/comments/:id  { hidden: boolean, reason: string }
 *   → sembunyikan / tampilkan kembali komentar. `reason` wajib (audit).
 * - PATCH /v1/admin/showcase/comments/:id  { deleted: true, reason: string }
 *   → hapus komentar (soft/hard sesuai kebijakan backend). Wajib header
 *   `X-Step-Up-Token` (aksi step-up `showcase-comment.delete`) + `Idempotency-Key`.
 *
 * Bila backend menyelaraskan kontrak berbeda (mis. endpoint DELETE terpisah
 * atau body lain), sesuaikan fungsi ini — halaman hanya memakai signature
 * di bawah, bukan bentuk request mentah.
 */
import { adminHttp } from "@/lib/api/admin-client"
import type { Paginated } from "@/lib/api/admin/kyc"
import { stepUpHeaders } from "@/lib/api/admin/step-up"

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

export type ShowcaseComment = {
  id: string
  content: string
  authorId?: string | null
  authorName?: string | null
  authorUsername?: string | null
  itemId?: string | null
  itemTitle?: string | null
  isHidden: boolean
  hiddenReason?: string | null
  hiddenAt?: string | null
  createdAt: string
  [key: string]: unknown
}

export type ShowcaseCommentFilters = {
  page?: number
  limit?: number
  /** Cari isi komentar / nama penulis. */
  search?: string
  /** "hidden" | "visible" — filter status. */
  hidden?: "hidden" | "visible"
  /** Filter per item etalase. */
  itemId?: string
}

function notSupported(fn: string, method: string, path: string): Error {
  return new Error(
    `Moderasi komentar showcase belum tersedia — membutuhkan backend terbaru (${method} ${path}, fungsi ${fn}).`,
  )
}

export async function listShowcaseComments(
  params?: ShowcaseCommentFilters,
): Promise<Paginated<ShowcaseComment>> {
  try {
    return await adminHttp.get<Paginated<ShowcaseComment>>(
      "/v1/admin/showcase/comments",
      { query: params as Record<string, string | number | boolean | undefined> },
    )
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
 * Sembunyikan (`hidden=true`) atau tampilkan kembali (`hidden=false`)
 * komentar. `reason` wajib — tercatat di audit.
 */
export async function setShowcaseCommentHidden(
  id: string,
  hidden: boolean,
  reason: string,
): Promise<ShowcaseComment> {
  try {
    return await adminHttp.patch<ShowcaseComment>(
      `/v1/admin/showcase/comments/${encodeURIComponent(id)}`,
      { hidden, reason },
    )
  } catch (e) {
    if (isNotFoundError(e)) {
      throw notSupported(
        "setShowcaseCommentHidden",
        "PATCH",
        "/v1/admin/showcase/comments/:id",
      )
    }
    throw e
  }
}

/**
 * Hapus komentar. `reason` wajib. `stepUpToken` dari step-up gate
 * (aksi `showcase-comment.delete`) — jangan panggil tanpa token.
 */
export async function deleteShowcaseComment(
  id: string,
  reason: string,
  stepUpToken: string,
): Promise<ShowcaseComment> {
  try {
    return await adminHttp.patch<ShowcaseComment>(
      `/v1/admin/showcase/comments/${encodeURIComponent(id)}`,
      { deleted: true, reason },
      {
        headers: {
          "Idempotency-Key": newIdempotencyKey(),
          ...stepUpHeaders(stepUpToken),
        },
      },
    )
  } catch (e) {
    if (isNotFoundError(e)) {
      throw notSupported(
        "deleteShowcaseComment",
        "PATCH",
        "/v1/admin/showcase/comments/:id",
      )
    }
    throw e
  }
}
