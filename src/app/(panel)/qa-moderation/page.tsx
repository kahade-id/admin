"use client"

/**
 * Admin — Moderasi Q&A profil (G427).
 *
 * Route: `/qa-moderation` (didaftarkan di sidebar/MENU bersama —
 * integrasi admin 2026-09-27).
 *
 * Tab: Antrean (queue + filter + pencarian + bulk + detail), Keberatan
 * (appeal), Kandidat spam, Metrik. Backend otoritas RBAC:
 * SUPER_ADMIN + CUSTOMER_SUPPORT boleh lihat/hide/unhide; hapus permanen &
 * ekspor agregat HANYA SUPER_ADMIN.
 */

import { useCallback, useEffect, useMemo, useState } from "react"

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
import { Select } from "@/components/admin/select"
import { useAuth } from "@/lib/auth-context"
import { RoleGate } from "@/components/admin/role-gate"
import { formatDateTimeWIB } from "@/lib/format"
import { userMessage } from "@/lib/api/response"
import {
  listQaQueue,
  getQaQuestionDetail,
  getQaCommentDetail,
  hideQaTarget,
  unhideQaTarget,
  redactQaTarget,
  bulkHideQa,
  bulkUnhideQa,
  assignQaReport,
  resolveQaReport,
  listQaAppeals,
  reviewQaAppeal,
  requestQaDelete,
  listQaDeleteRequests,
  decideQaDeleteRequest,
  getQaMetrics,
  getQaSpamCandidates,
  downloadQaAuditExport,
  QA_REASON_LABEL,
  QA_REASON_OPTIONS,
  type QaQueueItem,
  type QaReportTarget,
  type QaModerationReason,
  type QaReport,
  type QaModerationEvent,
  type QaAppeal,
  type QaDeleteRequest,
  type QaMetrics,
  type QaSpamCandidate,
} from "@/lib/api/admin/qa-moderation"

const PAGE_SIZE = 20

type Tab = "queue" | "appeals" | "spam" | "metrics"

const TABS: { value: Tab; label: string }[] = [
  { value: "queue", label: "Antrean" },
  { value: "appeals", label: "Keberatan" },
  { value: "spam", label: "Kandidat spam" },
  { value: "metrics", label: "Metrik" },
]

const TARGET_LABEL: Record<QaReportTarget, string> = {
  QUESTION: "Pertanyaan",
  COMMENT: "Komentar",
}

const EVENT_LABEL: Record<string, string> = {
  HIDDEN: "Disembunyikan",
  UNHIDDEN: "Ditampilkan kembali",
  REDACTED: "PII disensor",
  DELETED: "Dihapus permanen",
  APPEAL_SUBMITTED: "Keberatan diajukan",
  APPEAL_APPROVED: "Keberatan disetujui",
  APPEAL_REJECTED: "Keberatan ditolak",
}

type QueueFilters = {
  q: string
  targetType: "" | QaReportTarget
  reasonCode: "" | QaModerationReason
  answered: "" | "answered" | "unanswered"
  reportedOnly: boolean
  hiddenOnly: boolean
  spamOnly: boolean
}

const DEFAULT_FILTERS: QueueFilters = {
  q: "",
  targetType: "",
  reasonCode: "",
  answered: "",
  reportedOnly: false,
  hiddenOnly: false,
  spamOnly: false,
}

export default function QaModerationPage() {
  const { role } = useAuth()
  const toast = useToast()

  // ADM-427: gate halaman via RoleGate (roles dari MENU rbac), bukan cek inline.
  // role tetap dipakai untuk gating aksi level super-admin di dalam section.
  const isSuperAdmin = role === "SUPER_ADMIN"

  const [tab, setTab] = useState<Tab>("queue")

  return (
    <RoleGate href="/qa-moderation">
    <div>
      <div className="mb-6">
        <h1 className="text-h2 font-bold text-text-primary">Moderasi Q&A</h1>
        <p className="mt-1 text-body text-text-secondary">
          Moderasi platform pertanyaan &amp; komentar profil. Username dimask di
          daftar; tanpa nomor HP/email.
        </p>
      </div>

      <div className="mb-4 flex flex-wrap gap-2">
        {TABS.map((t) => (
          <Button
            key={t.value}
            variant={tab === t.value ? "primary" : "secondary"}
            size="sm"
            fullWidth={false}
            onClick={() => setTab(t.value)}
          >
            {t.label}
          </Button>
        ))}
      </div>

      {tab === "queue" && <QueueSection toast={toast} isSuperAdmin={isSuperAdmin} />}
      {tab === "appeals" && <AppealsSection toast={toast} />}
      {tab === "spam" && <SpamSection toast={toast} />}
      {tab === "metrics" && <MetricsSection toast={toast} isSuperAdmin={isSuperAdmin} />}
    </div>
    </RoleGate>
  )
}

/* ================================================================== */
/* Antrean                                                             */
/* ================================================================== */

function QueueSection({
  toast,
  isSuperAdmin,
}: {
  toast: ReturnType<typeof useToast>
  isSuperAdmin: boolean
}) {
  const [filters, setFilters] = useState<QueueFilters>(DEFAULT_FILTERS)
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [rows, setRows] = useState<QaQueueItem[]>([])
  const [total, setTotal] = useState(0)
  const [totalPages, setTotalPages] = useState(1)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [detailKey, setDetailKey] = useState<{ type: QaReportTarget; id: string } | null>(null)

  // Bulk
  const [bulkReason, setBulkReason] = useState<QaModerationReason>("SPAM")
  const [bulkNote, setBulkNote] = useState("")
  const [bulkConfirm, setBulkConfirm] = useState(false)
  const [bulkBusy, setBulkBusy] = useState(false)

  const load = useCallback(
    async (targetPage = 1, f: QueueFilters = filters) => {
      setLoading(true)
      setError(null)
      try {
        const res = await listQaQueue({
          page: targetPage,
          limit: PAGE_SIZE,
          q: f.q.trim() || undefined,
          targetType: f.targetType || undefined,
          reasonCode: f.reasonCode || undefined,
          answered: f.answered || undefined,
          reportedOnly: f.reportedOnly || undefined,
          hiddenOnly: f.hiddenOnly || undefined,
          spamOnly: f.spamOnly || undefined,
        })
        setRows(res.data ?? [])
        const t = res.total ?? res.data?.length ?? 0
        setTotal(t)
        setTotalPages(res.totalPages ?? Math.max(1, Math.ceil(t / PAGE_SIZE)))
        setPage(targetPage)
        setSelected(new Set())
      } catch (e) {
        const msg = userMessage(e)
        setError(msg)
        toast.show({ title: "Gagal memuat antrean", description: msg, tone: "danger" })
      } finally {
        setLoading(false)
      }
    },
    [filters, toast],
  )

  useEffect(() => {
    void load(1)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const applyFilters = () => void load(1, filters)

  const toggleSelect = (key: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  const toggleSelectAll = () => {
    setSelected((prev) =>
      prev.size === rows.length ? new Set() : new Set(rows.map((r) => `${r.targetType}:${r.targetId}`)),
    )
  }

  const selectedItems = useMemo(() => {
    const map = new Map(rows.map((r) => [`${r.targetType}:${r.targetId}`, r]))
    return [...selected].map((k) => map.get(k)).filter((x): x is QaQueueItem => !!x)
  }, [selected, rows])

  const runBulk = async (hide: boolean) => {
    if (selectedItems.length === 0) return
    if (!bulkConfirm) {
      toast.show({
        title: "Konfirmasi diperlukan",
        description: "Centang “Saya yakin” sebelum menjalankan aksi bulk.",
        tone: "info",
      })
      return
    }
    const byType = new Map<QaReportTarget, string[]>()
    for (const item of selectedItems) {
      const arr = byType.get(item.targetType) ?? []
      arr.push(item.targetId)
      byType.set(item.targetType, arr)
    }
    setBulkBusy(true)
    try {
      let ok = 0
      let fail = 0
      for (const [type, ids] of byType) {
        const res = hide
          ? await bulkHideQa(type, ids, bulkReason, bulkNote.trim() || undefined, true)
          : await bulkUnhideQa(type, ids, bulkNote.trim() || undefined, true)
        ok += res.succeeded
        fail += res.failed
      }
      toast.show({
        title: hide ? "Bulk hide selesai" : "Bulk unhide selesai",
        description: `${ok} berhasil, ${fail} gagal.`,
        tone: fail > 0 ? "info" : "success",
      })
      setBulkConfirm(false)
      void load(page, filters)
    } catch (e) {
      const msg = userMessage(e)
      toast.show({ title: "Bulk gagal", description: msg, tone: "danger" })
    } finally {
      setBulkBusy(false)
    }
  }

  return (
    <div>
      <Card className="mb-4 p-4">
        <div className="flex flex-wrap items-end gap-3">
          <Field label="Pencarian" className="min-w-56 flex-1">
            <Input
              value={filters.q}
              onChange={(e) => setFilters((f) => ({ ...f, q: e.target.value }))}
              placeholder="Teks konten / username…"
              onKeyDown={(e) => {
                if (e.key === "Enter") applyFilters()
              }}
            />
          </Field>
          <Select
            label="Tipe"
            className="w-40"
            value={filters.targetType}
            onChange={(e) =>
              setFilters((f) => ({ ...f, targetType: e.target.value as QueueFilters["targetType"] }))
            }
            options={[
              { value: "", label: "Semua" },
              { value: "QUESTION", label: "Pertanyaan" },
              { value: "COMMENT", label: "Komentar" },
            ]}
          />
          <Select
            label="Alasan"
            className="w-44"
            value={filters.reasonCode}
            onChange={(e) =>
              setFilters((f) => ({ ...f, reasonCode: e.target.value as QueueFilters["reasonCode"] }))
            }
            options={[{ value: "", label: "Semua" }, ...QA_REASON_OPTIONS]}
          />
          <Select
            label="Jawaban"
            className="w-40"
            value={filters.answered}
            onChange={(e) =>
              setFilters((f) => ({ ...f, answered: e.target.value as QueueFilters["answered"] }))
            }
            options={[
              { value: "", label: "Semua" },
              { value: "answered", label: "Sudah dijawab" },
              { value: "unanswered", label: "Belum dijawab" },
            ]}
          />
          <Button variant="primary" size="sm" fullWidth={false} onClick={applyFilters}>
            Terapkan
          </Button>
          <Button
            variant="secondary"
            size="sm"
            fullWidth={false}
            onClick={() => {
              setFilters(DEFAULT_FILTERS)
              void load(1, DEFAULT_FILTERS)
            }}
          >
            Atur ulang
          </Button>
        </div>
        <div className="mt-3 flex flex-wrap gap-4">
          {(
            [
              ["reportedOnly", "Hanya yang dilaporkan"],
              ["hiddenOnly", "Hanya yang disembunyikan"],
              ["spamOnly", "Hanya kandidat spam"],
            ] as const
          ).map(([key, label]) => (
            <label key={key} className="flex items-center gap-2 text-body text-text-secondary">
              <input
                type="checkbox"
                checked={filters[key]}
                onChange={(e) => setFilters((f) => ({ ...f, [key]: e.target.checked }))}
              />
              {label}
            </label>
          ))}
        </div>
      </Card>

      {selectedItems.length > 0 && (
        <Card className="mb-4 border-warning/40 p-4">
          <p className="mb-2 text-body font-semibold">
            {selectedItems.length} item dipilih (maks 50/request)
          </p>
          <div className="flex flex-wrap items-end gap-3">
            <Select
              label="Alasan (untuk hide)"
              className="w-44"
              value={bulkReason}
              onChange={(e) => setBulkReason(e.target.value as QaModerationReason)}
              options={QA_REASON_OPTIONS}
            />
            <Field label="Catatan internal (opsional)" className="min-w-52 flex-1">
              <Input
                value={bulkNote}
                onChange={(e) => setBulkNote(e.target.value)}
                placeholder="Hanya terlihat admin…"
              />
            </Field>
            <label className="flex items-center gap-2 text-body">
              <input
                type="checkbox"
                checked={bulkConfirm}
                onChange={(e) => setBulkConfirm(e.target.checked)}
              />
              Saya yakin — jalankan bulk
            </label>
            <Button
              variant="primary"
              size="sm"
              fullWidth={false}
              loading={bulkBusy}
              onClick={() => runBulk(true)}
            >
              Sembunyikan
            </Button>
            <Button
              variant="secondary"
              size="sm"
              fullWidth={false}
              loading={bulkBusy}
              onClick={() => runBulk(false)}
            >
              Tampilkan kembali
            </Button>
          </div>
        </Card>
      )}

      {loading ? (
        <div className="flex min-h-[30vh] items-center justify-center gap-2">
          <Spinner size="md" />
          <p className="text-body text-text-secondary">Memuat antrean…</p>
        </div>
      ) : error ? (
        <Card>
          <EmptyState
            title="Gagal memuat antrean"
            description={error}
            action={
              <Button variant="secondary" fullWidth={false} onClick={() => load(page, filters)}>
                Coba lagi
              </Button>
            }
          />
        </Card>
      ) : (
        <>
          <div className="mb-2 flex items-center justify-between">
            <p className="text-caption text-text-secondary">
              {selected.size} dari {rows.length} dipilih di halaman ini
            </p>
            <Button variant="secondary" size="sm" fullWidth={false} onClick={toggleSelectAll}>
              {selected.size === rows.length && rows.length > 0 ? "Batalkan semua" : "Pilih semua"}
            </Button>
          </div>
          <DataTable<QaQueueItem>
            columns={[
              {
                key: "select",
                header: "",
                render: (r) => {
                  const key = `${r.targetType}:${r.targetId}`
                  return (
                    <input
                      type="checkbox"
                      checked={selected.has(key)}
                      onChange={() => toggleSelect(key)}
                      aria-label={`Pilih ${key}`}
                    />
                  )
                },
              },
              {
                key: "content",
                header: "Konten",
                render: (r) => (
                  <div>
                    <p className="line-clamp-2 max-w-md">{r.contentPreview}</p>
                    <p className="mt-1 text-caption text-text-secondary">
                      {TARGET_LABEL[r.targetType]} · oleh {r.authorUsernameMasked ?? "—"} di
                      profil {r.profileUsernameMasked ?? "—"} · {formatDateTimeWIB(r.createdAt)}
                    </p>
                  </div>
                ),
              },
              {
                key: "status",
                header: "Status",
                render: (r) => (
                  <div className="flex flex-col gap-1">
                    {r.isHidden ? (
                      <Badge tone="danger">
                        Hidden · {r.hiddenByType === "MODERATOR" ? "Moderator" : "Pemilik"}
                      </Badge>
                    ) : (
                      <Badge tone="neutral">Tampil</Badge>
                    )}
                    {r.pendingReports > 0 && (
                      <Badge tone="warning">{r.pendingReports} laporan</Badge>
                    )}
                    {r.spamSuspected && <Badge tone="warning">Kandidat spam</Badge>}
                    {r.reportReasonCode && (
                      <span className="text-caption text-text-secondary">
                        {QA_REASON_LABEL[r.reportReasonCode] ?? r.reportReasonCode}
                      </span>
                    )}
                  </div>
                ),
              },
              {
                key: "action",
                header: "",
                align: "right",
                render: (r) => (
                  <Button
                    variant="secondary"
                    size="sm"
                    fullWidth={false}
                    onClick={() => setDetailKey({ type: r.targetType, id: r.targetId })}
                  >
                    Tinjau
                  </Button>
                ),
              },
            ]}
            rows={rows}
            rowKey={(r) => `${r.targetType}:${r.targetId}`}
            emptyText="Tidak ada item pada filter ini."
          />
          <Pagination
            page={page}
            totalPages={totalPages}
            total={total}
            pageSize={PAGE_SIZE}
            onPageChange={(p) => load(p, filters)}
            className="mt-4"
          />
        </>
      )}

      {detailKey && (
        <QaDetailDialog
          targetType={detailKey.type}
          targetId={detailKey.id}
          isSuperAdmin={isSuperAdmin}
          toast={toast}
          onClose={() => {
            setDetailKey(null)
            void load(page, filters)
          }}
        />
      )}
    </div>
  )
}

/* ================================================================== */
/* Dialog detail: konteks thread + histori + laporan + aksi             */
/* ================================================================== */

type DetailPayload = {
  targetType: QaReportTarget
  question?: {
    id: string
    question: string
    answer: string | null
    is_hidden: boolean
    hidden_by_type: string | null
    hidden_reason: string | null
    moderator_note: string | null
    redacted_text: string | null
    askerUsername?: string | null
    receiverUsername?: string | null
    created_at: string
  }
  comment?: {
    id: string
    question_id: string
    content: string
    is_hidden: boolean
    hidden_by_type: string | null
    hidden_reason: string | null
    moderator_note: string | null
    redacted_text: string | null
    author_username: string | null
    created_at: string
  }
  comments?: { id: string; content: string; is_hidden: boolean; author_username: string | null; created_at: string }[]
  threadContext?: {
    questionText: string
    questionAnswer: string | null
    comments: { id: string; content: string; is_hidden: boolean; author_username: string | null; created_at: string }[]
  }
  reports?: QaReport[]
  history?: QaModerationEvent[]
  appeals?: QaAppeal[]
  deleteRequests?: QaDeleteRequest[]
}

function QaDetailDialog({
  targetType,
  targetId,
  isSuperAdmin,
  toast,
  onClose,
}: {
  targetType: QaReportTarget
  targetId: string
  isSuperAdmin: boolean
  toast: ReturnType<typeof useToast>
  onClose: () => void
}) {
  const [loading, setLoading] = useState(true)
  const [data, setData] = useState<DetailPayload | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [reason, setReason] = useState<QaModerationReason>("SPAM")
  const [note, setNote] = useState("")
  const [busy, setBusy] = useState(false)
  const [deleteReason, setDeleteReason] = useState("")
  const [assignInputs, setAssignInputs] = useState<Record<string, string>>({})

  const reload = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res =
        targetType === "QUESTION"
          ? await getQaQuestionDetail(targetId)
          : await getQaCommentDetail(targetId)
      setData(res as unknown as DetailPayload)
    } catch (e) {
      setError(userMessage(e))
    } finally {
      setLoading(false)
    }
  }, [targetType, targetId])

  useEffect(() => {
    void reload()
  }, [reload])

  const runAction = async (label: string, fn: () => Promise<unknown>) => {
    setBusy(true)
    try {
      await fn()
      toast.show({ title: label, description: "Berhasil.", tone: "success" })
      setNote("")
      await reload()
    } catch (e) {
      toast.show({ title: `${label} gagal`, description: userMessage(e), tone: "danger" })
    } finally {
      setBusy(false)
    }
  }

  const main = data?.question ?? data?.comment
  const mainText = data?.question ? data.question.question : data?.comment?.content
  const threadComments =
    data?.targetType === "QUESTION" ? data?.comments : data?.threadContext?.comments

  return (
    <Dialog
      open
      onClose={onClose}
      title={`${TARGET_LABEL[targetType]} — detail moderasi`}
      description="Konteks thread (maks 10), laporan, histori aksi, keberatan."
      className="max-w-3xl"
    >
      {loading ? (
        <div className="flex items-center justify-center gap-2 py-10">
          <Spinner size="md" />
          <p className="text-body text-text-secondary">Memuat detail…</p>
        </div>
      ) : error || !data || !main ? (
        <EmptyState title="Gagal memuat detail" description={error ?? "Data kosong"} />
      ) : (
        <div className="flex flex-col gap-4">
          <Card className="p-4">
            <p className="text-body">{mainText}</p>
            {data.question?.answer && (
              <p className="mt-2 border-l-2 border-info/40 pl-3 text-body text-text-secondary">
                Jawaban: {data.question.answer}
              </p>
            )}
            {main.redacted_text && (
              <p className="mt-2 text-caption text-text-secondary">
                Versi tersensor: {main.redacted_text}
              </p>
            )}
            <div className="mt-3 flex flex-wrap gap-2">
              {main.is_hidden ? (
                <Badge tone="danger">
                  Hidden · {main.hidden_by_type === "MODERATOR" ? "Moderator" : "Pemilik"}
                </Badge>
              ) : (
                <Badge tone="success">Tampil</Badge>
              )}
              {main.hidden_reason && <Badge tone="neutral">{main.hidden_reason}</Badge>}
              <span className="text-caption text-text-secondary">
                {formatDateTimeWIB(main.created_at)}
              </span>
            </div>
            {main.moderator_note && (
              <p className="mt-2 text-caption text-text-secondary">
                Catatan internal: {main.moderator_note}
              </p>
            )}
          </Card>

          <Card className="p-4">
            <h3 className="mb-2 font-semibold">Aksi moderator</h3>
            <div className="flex flex-wrap items-end gap-3">
              <Select
                label="Alasan"
                className="w-44"
                value={reason}
                onChange={(e) => setReason(e.target.value as QaModerationReason)}
                options={QA_REASON_OPTIONS}
              />
              <Field label="Catatan internal (opsional)" className="min-w-52 flex-1">
                <Input
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="Hanya terlihat admin…"
                />
              </Field>
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              {!main.is_hidden ? (
                <Button
                  variant="primary"
                  size="sm"
                  fullWidth={false}
                  loading={busy}
                  onClick={() =>
                    runAction("Hide", () =>
                      hideQaTarget(targetType, targetId, {
                        reasonCode: reason,
                        note: note.trim() || undefined,
                      }),
                    )
                  }
                >
                  Sembunyikan
                </Button>
              ) : (
                <Button
                  variant="primary"
                  size="sm"
                  fullWidth={false}
                  loading={busy}
                  onClick={() =>
                    runAction("Unhide", () =>
                      unhideQaTarget(targetType, targetId, note.trim() || undefined),
                    )
                  }
                >
                  Tampilkan kembali
                </Button>
              )}
              <Button
                variant="secondary"
                size="sm"
                fullWidth={false}
                loading={busy}
                onClick={() =>
                  runAction("Redaksi PII", () => redactQaTarget(targetType, targetId))
                }
              >
                Sensor PII
              </Button>
              {isSuperAdmin && (
                <Field label="Alasan hapus permanen" className="min-w-52 flex-1">
                  <Input
                    value={deleteReason}
                    onChange={(e) => setDeleteReason(e.target.value)}
                    placeholder="Wajib diisi untuk request hapus…"
                  />
                </Field>
              )}
              {isSuperAdmin && (
                <Button
                  variant="secondary"
                  size="sm"
                  fullWidth={false}
                  loading={busy}
                  onClick={() => {
                    if (!deleteReason.trim()) {
                      toast.show({
                        title: "Alasan wajib",
                        description: "Isi alasan hapus permanen dulu.",
                        tone: "info",
                      })
                      return
                    }
                    void runAction("Request hapus permanen", () =>
                      requestQaDelete(targetType, targetId, deleteReason.trim()),
                    )
                  }}
                >
                  Request hapus permanen
                </Button>
              )}
            </div>
            {!isSuperAdmin && (
              <p className="mt-2 text-caption text-text-secondary">
                Hapus permanen &amp; approval hanya untuk Super Admin.
              </p>
            )}
          </Card>

          {threadComments && threadComments.length > 0 && (
            <Card className="p-4">
              <h3 className="mb-2 font-semibold">
                Konteks thread ({threadComments.length} dari maks 10)
              </h3>
              <div className="flex flex-col gap-2">
                {threadComments.map((c) => (
                  <div key={c.id} className="rounded border border-border p-2">
                    <p className="text-body">
                      {c.content}{" "}
                      {c.is_hidden && <Badge tone="danger">hidden</Badge>}
                    </p>
                    <p className="text-caption text-text-secondary">
                      {c.author_username ?? "—"} · {formatDateTimeWIB(c.created_at)}
                    </p>
                  </div>
                ))}
              </div>
            </Card>
          )}

          <Card className="p-4">
            <h3 className="mb-2 font-semibold">Laporan ({data.reports?.length ?? 0})</h3>
            {(data.reports ?? []).length === 0 ? (
              <p className="text-caption text-text-secondary">Belum ada laporan.</p>
            ) : (
              <div className="flex flex-col gap-2">
                {(data.reports ?? []).map((r) => (
                  <div key={r.id} className="rounded border border-border p-2">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="text-body">
                        <Badge tone={r.status === "PENDING" ? "warning" : "neutral"}>
                          {r.status}
                        </Badge>{" "}
                        {QA_REASON_LABEL[r.reason_code] ?? r.reason_code}
                        {r.note && <span className="text-text-secondary"> — {r.note}</span>}
                      </p>
                      <p className="text-caption text-text-secondary">
                        {formatDateTimeWIB(r.created_at)}
                        {r.assigned_admin_name && ` · ${r.assigned_admin_name}`}
                      </p>
                    </div>
                    {["PENDING", "UNDER_REVIEW"].includes(r.status) && (
                      <div className="mt-2 flex flex-wrap items-end gap-2">
                        <Field label="Assign / handoff (ID admin)" className="w-56">
                          <Input
                            value={assignInputs[r.id] ?? ""}
                            onChange={(e) =>
                              setAssignInputs((s) => ({ ...s, [r.id]: e.target.value }))
                            }
                            placeholder="admin id…"
                          />
                        </Field>
                        <Button
                          variant="secondary"
                          size="sm"
                          fullWidth={false}
                          loading={busy}
                          onClick={() =>
                            runAction("Assign", () =>
                              assignQaReport(r.id, assignInputs[r.id]?.trim() || null),
                            )
                          }
                        >
                          Assign
                        </Button>
                        <Button
                          variant="secondary"
                          size="sm"
                          fullWidth={false}
                          loading={busy}
                          onClick={() =>
                            runAction("Resolve (ditindak)", () =>
                              resolveQaReport(r.id, "ACTION_TAKEN"),
                            )
                          }
                        >
                          Ditindak
                        </Button>
                        <Button
                          variant="secondary"
                          size="sm"
                          fullWidth={false}
                          loading={busy}
                          onClick={() =>
                            runAction("Resolve (ditolak)", () => resolveQaReport(r.id, "DISMISSED"))
                          }
                        >
                          Tolak laporan
                        </Button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </Card>

          <Card className="p-4">
            <h3 className="mb-2 font-semibold">Histori aksi ({data.history?.length ?? 0})</h3>
            {(data.history ?? []).length === 0 ? (
              <p className="text-caption text-text-secondary">Belum ada aksi moderasi.</p>
            ) : (
              <div className="flex flex-col gap-2">
                {(data.history ?? []).map((e) => (
                  <div key={e.id} className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-body">
                      <Badge tone="neutral">{EVENT_LABEL[e.action] ?? e.action}</Badge>{" "}
                      {e.actor_admin_name && (
                        <span className="text-text-secondary">oleh {e.actor_admin_name}</span>
                      )}
                      {e.reason_code && (
                        <span className="text-text-secondary">
                          {" "}
                          · {QA_REASON_LABEL[e.reason_code] ?? e.reason_code}
                        </span>
                      )}
                      {e.note && (
                        <span className="block text-caption text-text-secondary">{e.note}</span>
                      )}
                    </p>
                    <p className="text-caption text-text-secondary">
                      {formatDateTimeWIB(e.created_at)}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </Card>

          {(data.appeals?.length ?? 0) > 0 && (
            <Card className="p-4">
              <h3 className="mb-2 font-semibold">Keberatan ({data.appeals?.length})</h3>
              <div className="flex flex-col gap-2">
                {(data.appeals ?? []).map((a) => (
                  <div key={a.id} className="rounded border border-border p-2">
                    <p className="text-body">
                      <Badge tone={a.status === "PENDING" ? "warning" : "neutral"}>
                        {a.status}
                      </Badge>{" "}
                      {a.reason}
                    </p>
                    <p className="text-caption text-text-secondary">
                      {formatDateTimeWIB(a.created_at)}
                      {a.reviewer_admin_name && ` · direview ${a.reviewer_admin_name}`}
                      {a.review_note && ` — ${a.review_note}`}
                    </p>
                  </div>
                ))}
              </div>
            </Card>
          )}

          {(data.deleteRequests?.length ?? 0) > 0 && (
            <Card className="p-4">
              <h3 className="mb-2 font-semibold">
                Request hapus permanen ({data.deleteRequests?.length})
              </h3>
              <div className="flex flex-col gap-2">
                {(data.deleteRequests ?? []).map((d) => (
                  <div key={d.id} className="rounded border border-border p-2">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="text-body">
                        <Badge
                          tone={d.status === "PENDING" ? "warning" : "neutral"}
                        >
                          {d.status}
                        </Badge>{" "}
                        diajukan {d.requester_admin_name ?? "—"}
                        {d.reason && <span className="text-text-secondary"> — {d.reason}</span>}
                      </p>
                      {isSuperAdmin && d.status === "PENDING" && (
                        <div className="flex gap-2">
                          <Button
                            variant="primary"
                            size="sm"
                            fullWidth={false}
                            loading={busy}
                            onClick={() =>
                              runAction("Approve hapus permanen", () =>
                                decideQaDeleteRequest(d.id, true),
                              )
                            }
                          >
                            Approve
                          </Button>
                          <Button
                            variant="secondary"
                            size="sm"
                            fullWidth={false}
                            loading={busy}
                            onClick={() =>
                              runAction("Reject hapus permanen", () =>
                                decideQaDeleteRequest(d.id, false),
                              )
                            }
                          >
                            Reject
                          </Button>
                        </div>
                      )}
                    </div>
                    {d.approver_admin_name && (
                      <p className="text-caption text-text-secondary">
                        Diputus {d.approver_admin_name} · {d.decided_at && formatDateTimeWIB(d.decided_at)}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            </Card>
          )}
        </div>
      )}
    </Dialog>
  )
}

/* ================================================================== */
/* Keberatan (appeal)                                                  */
/* ================================================================== */

function AppealsSection({ toast }: { toast: ReturnType<typeof useToast> }) {
  const [status, setStatus] = useState("")
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)
  const [rows, setRows] = useState<QaAppeal[]>([])
  const [total, setTotal] = useState(0)
  const [totalPages, setTotalPages] = useState(1)
  const [reviewing, setReviewing] = useState<QaAppeal | null>(null)
  const [decision, setDecision] = useState<"APPROVED" | "REJECTED">("APPROVED")
  const [reviewNote, setReviewNote] = useState("")
  const [busy, setBusy] = useState(false)

  const load = useCallback(
    async (p = 1, s = status) => {
      setLoading(true)
      try {
        const res = await listQaAppeals({
          page: p,
          limit: PAGE_SIZE,
          status: s || undefined,
        })
        setRows(res.data ?? [])
        const t = res.total ?? res.data?.length ?? 0
        setTotal(t)
        setTotalPages(res.totalPages ?? Math.max(1, Math.ceil(t / PAGE_SIZE)))
        setPage(p)
      } catch (e) {
        toast.show({ title: "Gagal memuat keberatan", description: userMessage(e), tone: "danger" })
      } finally {
        setLoading(false)
      }
    },
    [status, toast],
  )

  useEffect(() => {
    void load(1)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const submitReview = async () => {
    if (!reviewing) return
    setBusy(true)
    try {
      await reviewQaAppeal(reviewing.id, decision, reviewNote.trim() || undefined)
      toast.show({ title: "Keberatan direview", description: decision, tone: "success" })
      setReviewing(null)
      setReviewNote("")
      void load(page, status)
    } catch (e) {
      toast.show({ title: "Review gagal", description: userMessage(e), tone: "danger" })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <Select
          label="Status"
          className="w-44"
          value={status}
          onChange={(e) => {
            setStatus(e.target.value)
            void load(1, e.target.value)
          }}
          options={[
            { value: "", label: "Semua" },
            { value: "PENDING", label: "Menunggu" },
            { value: "APPROVED", label: "Disetujui" },
            { value: "REJECTED", label: "Ditolak" },
          ]}
        />
      </div>
      {loading ? (
        <div className="flex min-h-[30vh] items-center justify-center">
          <Spinner size="md" />
        </div>
      ) : (
        <>
          <DataTable<QaAppeal>
            columns={[
              {
                key: "appeal",
                header: "Keberatan",
                render: (a) => (
                  <div>
                    <p className="line-clamp-2 max-w-md">{a.reason}</p>
                    <p className="mt-1 text-caption text-text-secondary">
                      {TARGET_LABEL[a.target_type]} · pengaju{" "}
                      {a.appellantUsernameMasked ?? a.appellant_username ?? "—"} ·{" "}
                      {formatDateTimeWIB(a.created_at)}
                    </p>
                  </div>
                ),
              },
              {
                key: "status",
                header: "Status",
                render: (a) => (
                  <Badge tone={a.status === "PENDING" ? "warning" : "neutral"}>{a.status}</Badge>
                ),
              },
              {
                key: "action",
                header: "",
                align: "right",
                render: (a) =>
                  a.status === "PENDING" ? (
                    <Button
                      variant="secondary"
                      size="sm"
                      fullWidth={false}
                      onClick={() => setReviewing(a)}
                    >
                      Review
                    </Button>
                  ) : (
                    <span className="text-caption text-text-secondary">
                      {a.reviewer_admin_name ?? "—"}
                    </span>
                  ),
              },
            ]}
            rows={rows}
            rowKey={(a) => a.id}
            emptyText="Tidak ada keberatan pada filter ini."
          />
          <Pagination
            page={page}
            totalPages={totalPages}
            total={total}
            pageSize={PAGE_SIZE}
            onPageChange={(p) => load(p, status)}
            className="mt-4"
          />
        </>
      )}

      <Dialog
        open={!!reviewing}
        onClose={() => setReviewing(null)}
        title="Review keberatan"
        description="Reviewer tidak boleh = moderator yang melakukan hide (ditolak backend 403)."
      >
        {reviewing && (
          <div className="flex flex-col gap-3">
            <p className="text-body">{reviewing.reason}</p>
            <Select
              label="Keputusan"
              value={decision}
              onChange={(e) => setDecision(e.target.value as "APPROVED" | "REJECTED")}
              options={[
                { value: "APPROVED", label: "Setujui — tampilkan kembali konten" },
                { value: "REJECTED", label: "Tolak — keputusan moderasi tetap" },
              ]}
            />
            <Field label="Catatan review (opsional)">
              <TextArea
                value={reviewNote}
                onChange={(e) => setReviewNote(e.target.value)}
                placeholder="Alasan keputusan…"
              />
            </Field>
            <div className="flex gap-2">
              <Button variant="primary" fullWidth={false} loading={busy} onClick={submitReview}>
                Kirim keputusan
              </Button>
              <Button variant="secondary" fullWidth={false} onClick={() => setReviewing(null)}>
                Batal
              </Button>
            </div>
          </div>
        )}
      </Dialog>
    </div>
  )
}

/* ================================================================== */
/* Kandidat spam lintas profil (G440)                                  */
/* ================================================================== */

function SpamSection({ toast }: { toast: ReturnType<typeof useToast> }) {
  const [threshold, setThreshold] = useState(3)
  const [loading, setLoading] = useState(true)
  const [candidates, setCandidates] = useState<QaSpamCandidate[]>([])

  const load = useCallback(
    async (t = threshold) => {
      setLoading(true)
      try {
        const res = await getQaSpamCandidates({ threshold: t, limit: 50 })
        setCandidates(res.candidates ?? [])
      } catch (e) {
        toast.show({
          title: "Gagal memuat kandidat spam",
          description: userMessage(e),
          tone: "danger",
        })
      } finally {
        setLoading(false)
      }
    },
    [threshold, toast],
  )

  useEffect(() => {
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div>
      <Card className="mb-4 p-4">
        <p className="text-body text-text-secondary">
          Heuristik: teks identik dari penulis yang sama di ≥ N profil berbeda dalam
          24 jam. Keputusan akhir tetap manual via antrean.
        </p>
        <div className="mt-3 flex flex-wrap items-end gap-3">
          <Select
            label="Ambang profil (N)"
            className="w-40"
            value={String(threshold)}
            onChange={(e) => {
              const t = Number(e.target.value)
              setThreshold(t)
              void load(t)
            }}
            options={["2", "3", "4", "5", "10"].map((v) => ({ value: v, label: v }))}
          />
        </div>
      </Card>
      {loading ? (
        <div className="flex min-h-[30vh] items-center justify-center">
          <Spinner size="md" />
        </div>
      ) : (
        <DataTable<QaSpamCandidate>
          columns={[
            {
              key: "sample",
              header: "Contoh teks",
              render: (c) => (
                <div>
                  <p className="line-clamp-2 max-w-md">{c.sampleText}</p>
                  <p className="mt-1 text-caption text-text-secondary">
                    {TARGET_LABEL[c.target_type]} · penulis {c.authorUsernameMasked ?? "—"}
                  </p>
                </div>
              ),
            },
            {
              key: "stats",
              header: "Sebaran",
              render: (c) => (
                <div className="flex flex-col gap-1">
                  <Badge tone="warning">{c.profile_count} profil</Badge>
                  <span className="text-caption text-text-secondary">
                    {c.item_count} item · {formatDateTimeWIB(c.first_seen)} →{" "}
                    {formatDateTimeWIB(c.last_seen)}
                  </span>
                </div>
              ),
            },
          ]}
          rows={candidates}
          rowKey={(c, i) => `${c.authorId}-${i}`}
          emptyText="Tidak ada kandidat spam pada ambang ini."
        />
      )}
    </div>
  )
}

/* ================================================================== */
/* Metrik (G445) + ekspor agregat (G448)                                */
/* ================================================================== */

function MetricsSection({
  toast,
  isSuperAdmin,
}: {
  toast: ReturnType<typeof useToast>
  isSuperAdmin: boolean
}) {
  const [loading, setLoading] = useState(true)
  const [metrics, setMetrics] = useState<QaMetrics | null>(null)
  const [exportDays, setExportDays] = useState(30)
  const [exporting, setExporting] = useState(false)

  useEffect(() => {
    void (async () => {
      setLoading(true)
      try {
        setMetrics(await getQaMetrics())
      } catch (e) {
        toast.show({ title: "Gagal memuat metrik", description: userMessage(e), tone: "danger" })
      } finally {
        setLoading(false)
      }
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const doExport = async () => {
    setExporting(true)
    try {
      await downloadQaAuditExport(exportDays)
      toast.show({ title: "Ekspor diunduh", description: "CSV agregat (tanpa teks konten).", tone: "success" })
    } catch (e) {
      toast.show({ title: "Ekspor gagal", description: userMessage(e), tone: "danger" })
    } finally {
      setExporting(false)
    }
  }

  if (loading) {
    return (
      <div className="flex min-h-[30vh] items-center justify-center">
        <Spinner size="md" />
      </div>
    )
  }

  if (!metrics) {
    return (
      <Card>
        <EmptyState title="Metrik tidak tersedia" description="Coba muat ulang halaman." />
      </Card>
    )
  }

  const cards = [
    { label: "Laporan open", value: String(metrics.openReports) },
    { label: "Dalam peninjauan", value: String(metrics.underReview) },
    {
      label: "Rata-rata penyelesaian",
      value:
        metrics.avgResolutionHours != null
          ? `${metrics.avgResolutionHours} jam`
          : "—",
    },
    { label: "Selesai (30 hari)", value: String(metrics.resolvedLast30d) },
    { label: "Hidden oleh moderator", value: String(metrics.hiddenByModerator) },
    { label: "Hidden oleh pemilik", value: String(metrics.hiddenByOwner) },
  ]

  return (
    <div>
      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-3">
        {cards.map((c) => (
          <Card key={c.label} className="p-4">
            <p className="text-caption text-text-secondary">{c.label}</p>
            <p className="text-h2 font-bold text-text-primary">{c.value}</p>
          </Card>
        ))}
      </div>

      <Card className="mb-4 p-4">
        <h3 className="mb-2 font-semibold">Distribusi alasan (laporan open)</h3>
        {metrics.reasonDistribution.length === 0 ? (
          <p className="text-caption text-text-secondary">Belum ada data.</p>
        ) : (
          <div className="flex flex-col gap-2">
            {metrics.reasonDistribution.map((d) => (
              <div key={d.reasonCode} className="flex items-center justify-between gap-3">
                <span className="text-body">
                  {QA_REASON_LABEL[d.reasonCode] ?? d.reasonCode}
                </span>
                <Badge tone="neutral">{d.count}</Badge>
              </div>
            ))}
          </div>
        )}
      </Card>

      <Card className="p-4">
        <h3 className="mb-2 font-semibold">Ekspor audit agregat (G448)</h3>
        <p className="mb-3 text-caption text-text-secondary">
          CSV: counts per reason/day. Tanpa teks konten massal. Hanya Super Admin.
        </p>
        {isSuperAdmin ? (
          <div className="flex flex-wrap items-end gap-3">
            <Select
              label="Rentang (hari)"
              className="w-40"
              value={String(exportDays)}
              onChange={(e) => setExportDays(Number(e.target.value))}
              options={["7", "30", "90", "365"].map((v) => ({ value: v, label: v }))}
            />
            <Button variant="primary" size="sm" fullWidth={false} loading={exporting} onClick={doExport}>
              Unduh CSV
            </Button>
          </div>
        ) : (
          <p className="text-caption text-text-secondary">
            Ekspor hanya tersedia untuk Super Admin.
          </p>
        )}
      </Card>
    </div>
  )
}
