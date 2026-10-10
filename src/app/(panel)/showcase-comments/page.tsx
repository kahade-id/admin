"use client"

/**
 * Admin — Moderasi komentar showcase (FAL-010, audit integrasi 2026-10-03).
 *
 * Tabel komentar etalase (isi, penulis, item, status hidden, waktu) +
 * filter + aksi sembunyikan/tampilkan/hapus dengan kolom alasan wajib.
 * Hapus wajib step-up (aksi `showcase-comment.delete`).
 *
 * Semua pemanggilan API defensif 404 → pesan jelas "membutuhkan backend
 * terbaru", bukan crash (tim backend membangun endpoint paralel).
 */

import { useCallback, useEffect, useState } from "react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Dialog } from "@/components/ui/dialog"
import { EmptyState } from "@/components/ui/empty-state"
import { Field, Input, TextArea } from "@/components/ui/input"
import { Spinner } from "@/components/ui/spinner"
import { DataTable } from "@/components/ui/table"
import { useToast } from "@/components/ui/toast"
import { Pagination } from "@/components/admin/pagination"
import { RoleGate } from "@/components/admin/role-gate"
import { Select } from "@/components/admin/select"
import { useStepUp } from "@/components/admin/step-up-gate"
import {
  deleteShowcaseComment,
  listShowcaseComments,
  setShowcaseCommentHidden,
  SHOWCASE_HIDE_REASONS,
  type ShowcaseComment,
  type ShowcaseCommentStatus,
} from "@/lib/api/admin/showcase-comments"
import { userMessage } from "@/lib/api/response"
import { formatDateTimeWIB } from "@/lib/format"
import type { AdminRole } from "@/lib/rbac"

const PAGE_SIZE = 20

/**
 * ADM-03 (audit etalase 2026-10-10): PATCH /v1/admin/showcase/comments/:id
 * (hide/unhide/delete) = @AdminRoles(SUPER_ADMIN, DISPUTE_ADMIN) di backend.
 * CUSTOMER_SUPPORT hanya boleh melihat daftar — tombol aksi sebelumnya tampil
 * untuknya lalu ditolak 403; DISPUTE_ADMIN sebaliknya tidak melihat tombol.
 */
const MODERATE_ROLES: AdminRole[] = ["SUPER_ADMIN", "DISPUTE_ADMIN"]

const STATUS_OPTIONS = [
  { value: "all", label: "Semua status" },
  { value: "visible", label: "Terlihat" },
  { value: "hidden", label: "Disembunyikan" },
  { value: "deleted", label: "Dihapus" },
]

type PendingAction =
  | { kind: "hide"; comment: ShowcaseComment }
  | { kind: "unhide"; comment: ShowcaseComment }
  | { kind: "delete"; comment: ShowcaseComment }

export default function ShowcaseCommentsPage() {
  const toast = useToast()
  const stepUp = useStepUp()

  const [search, setSearch] = useState("")
  const [statusFilter, setStatusFilter] = useState<ShowcaseCommentStatus>("all")
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [rows, setRows] = useState<ShowcaseComment[]>([])
  const [total, setTotal] = useState(0)
  const [totalPages, setTotalPages] = useState(1)

  const [pending, setPending] = useState<PendingAction | null>(null)
  const [reason, setReason] = useState("")
  const [acting, setActing] = useState(false)

  const load = useCallback(
    async (mode: "initial" | "refresh" = "initial", targetPage = page) => {
      if (mode === "initial") setLoading(true)
      else setRefreshing(true)
      setError(null)
      try {
        const res = await listShowcaseComments({
          page: targetPage,
          limit: PAGE_SIZE,
          search: search.trim() || undefined,
          // P1-17: backend hanya kenal `status` (all|visible|hidden|deleted).
          status: statusFilter,
        })
        setRows(res.data ?? [])
        const t = res.total ?? res.data?.length ?? 0
        setTotal(t)
        setTotalPages(res.totalPages ?? Math.max(1, Math.ceil(t / PAGE_SIZE)))
      } catch (e) {
        const msg = userMessage(e)
        setError(msg)
        if (mode === "initial") {
          toast.show({ title: "Gagal memuat komentar", description: msg, tone: "danger" })
        }
      } finally {
        setLoading(false)
        setRefreshing(false)
      }
    },
    [page, search, statusFilter, toast],
  )

  useEffect(() => {
    void load("initial")
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const applyFilter = () => {
    setPage(1)
    void load("initial", 1)
  }

  const openAction = (kind: PendingAction["kind"], comment: ShowcaseComment) => {
    setPending({ kind, comment } as PendingAction)
    setReason("")
  }

  const doAct = async () => {
    if (!pending || acting) return
    if (!reason.trim()) {
      toast.show({ title: "Alasan wajib diisi", description: "Alasan tercatat di audit.", tone: "danger" })
      return
    }
    const { kind, comment } = pending
    let stepUpToken: string | null = null
    if (kind === "delete") {
      stepUpToken = await stepUp.requestStepUp({
        action: "showcase-comment.delete",
        targetId: comment.id,
        title: "Hapus komentar",
        description: `Menghapus komentar "${(comment.content ?? "").slice(0, 80)}…". Aksi ini dicatat di audit.`,
      })
      if (!stepUpToken) return
    }
    setActing(true)
    try {
      if (kind === "hide") {
        await setShowcaseCommentHidden(comment.id, true, reason.trim())
        toast.show({ title: "Komentar disembunyikan", tone: "success" })
      } else if (kind === "unhide") {
        await setShowcaseCommentHidden(comment.id, false, reason.trim())
        toast.show({ title: "Komentar ditampilkan kembali", tone: "success" })
      } else {
        await deleteShowcaseComment(comment.id, reason.trim(), stepUpToken as string)
        toast.show({ title: "Komentar dihapus", tone: "success" })
      }
      setPending(null)
      void load("refresh")
    } catch (e) {
      toast.show({
        title: "Aksi gagal",
        description: userMessage(e),
        tone: "danger",
      })
    } finally {
      setActing(false)
    }
  }

  const actionTitle =
    pending?.kind === "hide"
      ? "Sembunyikan komentar"
      : pending?.kind === "unhide"
        ? "Tampilkan kembali komentar"
        : "Hapus komentar"

  return (
    <RoleGate href="/showcase-comments">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-h2 font-bold text-text-primary">Komentar Etalase</h1>
          <p className="mt-1 text-body text-text-secondary">
            Moderasi komentar di etalase produk (Trust & Safety).
          </p>
        </div>
        <Button
          variant="secondary"
          size="sm"
          fullWidth={false}
          loading={refreshing}
          onClick={() => void load("refresh")}
        >
          Muat ulang
        </Button>
      </div>

      <div className="mb-4 flex flex-wrap items-end gap-3">
        <Field label="Cari">
          <Input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") applyFilter()
            }}
            placeholder="Isi komentar / nama penulis…"
            className="w-64"
          />
        </Field>
        <Select
          label="Status"
          options={STATUS_OPTIONS}
          value={statusFilter}
          onChange={(e) =>
            setStatusFilter(e.target.value as ShowcaseCommentStatus)
          }
          className="w-52"
        />
        <Button variant="secondary" size="sm" fullWidth={false} onClick={applyFilter}>
          Terapkan
        </Button>
      </div>

      {loading ? (
        <div className="flex min-h-[40vh] items-center justify-center gap-2">
          <Spinner size="md" />
          <p className="text-body text-text-secondary">Memuat komentar…</p>
        </div>
      ) : error && rows.length === 0 ? (
        <Card>
          <EmptyState
            title="Gagal memuat komentar"
            description={error}
            action={
              <Button variant="secondary" fullWidth={false} onClick={() => void load("initial")}>
                Coba lagi
              </Button>
            }
          />
        </Card>
      ) : (
        <>
          <DataTable<ShowcaseComment>
            columns={[
              {
                key: "content",
                header: "Komentar",
                render: (r) => (
                  <div>
                    {/* ADM-07: baris soft-delete — backend mengirim content null. */}
                    {r.isDeleted ? (
                      <p className="italic text-text-tertiary">(komentar dihapus)</p>
                    ) : (
                      <p className="font-medium">{r.content}</p>
                    )}
                    <p className="text-caption text-text-secondary">
                      {r.authorName ?? r.authorUsername ?? (r.authorId ? `Penulis ${String(r.authorId).slice(0, 12)}` : "Penulis tidak diketahui")}
                      {r.itemTitle ? ` · ${r.itemTitle}` : r.itemId ? ` · item ${String(r.itemId).slice(0, 12)}` : ""}
                    </p>
                    <p className="text-caption text-text-tertiary">
                      {formatDateTimeWIB(r.createdAt)}
                      {r.isHidden && r.hiddenAt ? ` · disembunyikan ${formatDateTimeWIB(r.hiddenAt)}` : ""}
                      {r.isDeleted && r.deletedAt ? ` · dihapus ${formatDateTimeWIB(r.deletedAt)}` : ""}
                    </p>
                    {r.isHidden && r.hiddenReason ? (
                      <p className="text-caption italic text-text-tertiary">
                        Alasan: {r.hiddenReason}
                      </p>
                    ) : null}
                    {r.isDeleted && r.deleteReason ? (
                      <p className="text-caption italic text-text-tertiary">
                        Alasan hapus: {r.deleteReason}
                      </p>
                    ) : null}
                  </div>
                ),
              },
              {
                key: "status",
                header: "Status",
                render: (r) => (
                  // ADM-07: komentar terhapus sebelumnya berbadge "Terlihat".
                  <Badge tone={r.isDeleted ? "neutral" : r.isHidden ? "warning" : "success"}>
                    {r.isDeleted ? "Dihapus" : r.isHidden ? "Disembunyikan" : "Terlihat"}
                  </Badge>
                ),
              },
              {
                key: "action",
                header: "",
                align: "right",
                render: (r) =>
                  // ADM-07: tidak ada aksi untuk baris terhapus (backend 400/409).
                  r.isDeleted ? null : (
                  <div className="flex justify-end gap-2">
                    <RoleGate roles={MODERATE_ROLES}>
                      <button
                        type="button"
                        onClick={() => openAction(r.isHidden ? "unhide" : "hide", r)}
                        className="font-semibold text-info-text hover:underline"
                      >
                        {r.isHidden ? "Tampilkan" : "Sembunyikan"}
                      </button>
                    </RoleGate>
                    <RoleGate roles={MODERATE_ROLES}>
                      <button
                        type="button"
                        onClick={() => openAction("delete", r)}
                        className="font-semibold text-danger-text hover:underline"
                      >
                        Hapus
                      </button>
                    </RoleGate>
                  </div>
                  ),
              },
            ]}
            rows={rows}
            rowKey={(r) => r.id}
            emptyText="Tidak ada komentar pada filter ini."
          />
          <Pagination
            page={page}
            totalPages={totalPages}
            total={total}
            pageSize={PAGE_SIZE}
            onPageChange={(p) => {
              setPage(p)
              void load("initial", p)
            }}
            className="mt-4"
          />
        </>
      )}

      <Dialog
        open={pending !== null}
        onClose={() => {
          if (!acting) setPending(null)
        }}
        title={actionTitle}
        description={
          pending?.kind === "delete"
            ? "Komentar dihapus dan tidak tampil lagi. Alasan wajib diisi dan tercatat di audit; penghapusan juga memerlukan verifikasi ulang (step-up)."
            : "Alasan wajib diisi dan tercatat di audit."
        }
        footer={
          <>
            <Button variant="secondary" onClick={() => setPending(null)} disabled={acting}>
              Batal
            </Button>
            <Button
              variant={pending?.kind === "delete" ? "destructive" : "primary"}
              onClick={() => void doAct()}
              disabled={acting || !reason.trim()}
            >
              {acting ? "Memproses…" : actionTitle}
            </Button>
          </>
        }
      >
        {pending ? (
          <div className="space-y-4">
            <p className="rounded-sm bg-surface px-3 py-2 text-body text-text-primary">
              “{pending.comment.content ?? "(komentar dihapus)"}”
            </p>
            {/* P1-16: backend hanya terima SPAM|INAPPROPRIATE|HARASSMENT|OTHER
                untuk hide — pakai dropdown, bukan teks bebas. */}
            {pending.kind === "hide" ? (
              <Select
                label="Kategori alasan (wajib)"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                options={[
                  { value: "", label: "— Pilih kategori —" },
                  ...SHOWCASE_HIDE_REASONS.map((r) => ({
                    value: r,
                    label:
                      r === "SPAM"
                        ? "Spam"
                        : r === "INAPPROPRIATE"
                          ? "Tidak pantas"
                          : r === "HARASSMENT"
                            ? "Pelecehan"
                            : "Lainnya",
                  })),
                ]}
              />
            ) : (
              <TextArea
                label="Alasan (wajib)"
                rows={3}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="cth: Mengandung kata kasar / spam…"
                maxLength={500}
              />
            )}
          </div>
        ) : null}
      </Dialog>

      {stepUp.stepUpDialog}
    </RoleGate>
  )
}
