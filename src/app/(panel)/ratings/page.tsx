/**
 * Admin — Rating: moderasi penilaian antar pengguna.
 *
 * Tabel rating (penilai → dinilai, bintang, isi, status tampil/sembunyi,
 * tanggal) + filter status & bintang + pencarian lokal + paginasi bernomor.
 * Aksi Sembunyikan/Tampilkan via Dialog dengan alasan wajib (min 5 karakter,
 * tercatat di audit log backend).
 *
 * Port dari frontend/app/admin/(panel)/ratings.tsx → web desktop.
 */
"use client"

import { useCallback, useEffect, useMemo, useState } from "react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Dialog } from "@/components/ui/dialog"
import { EmptyState } from "@/components/ui/empty-state"
import { Input, TextArea } from "@/components/ui/input"
import { Spinner } from "@/components/ui/spinner"
import { DataTable } from "@/components/ui/table"
import { useToast } from "@/components/ui/toast"
import { Pagination } from "@/components/admin/pagination"
import { RoleGate } from "@/components/admin/role-gate"
import { Select } from "@/components/admin/select"
import {
  hideRating,
  listRatings,
  unhideRating,
  type AdminRating,
  type AdminRatingUser,
} from "@/lib/api/admin/ratings"
import { userMessage } from "@/lib/api/response"
import { formatDateTimeWIB } from "@/lib/format"
import { useDebouncedValue } from "@/lib/use-debounced-value"

const PAGE_SIZE = 20
const SEARCH_DEBOUNCE_MS = 400
const MIN_REASON_LENGTH = 5

type StatusFilter = "all" | "visible" | "hidden"

const STATUS_OPTIONS = [
  { value: "all", label: "Semua status" },
  { value: "visible", label: "Ditampilkan" },
  { value: "hidden", label: "Disembunyikan" },
]

const STAR_OPTIONS = [
  { value: "all", label: "Semua bintang" },
  { value: "5", label: "5 bintang" },
  { value: "4", label: "4 bintang" },
  { value: "3", label: "3 bintang" },
  { value: "2", label: "2 bintang" },
  { value: "1", label: "1 bintang" },
]

function personName(u: AdminRatingUser | null | undefined): string {
  return u?.fullName ?? u?.username ?? "—"
}

function Stars({ value }: { value?: number | null }) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return <span className="text-text-secondary">—</span>
  }
  const full = Math.max(0, Math.min(5, Math.round(value)))
  return (
    <span
      className="whitespace-nowrap text-warning-text"
      role="img"
      aria-label={`Rating ${value} dari 5`}
    >
      {"★".repeat(full)}
      <span className="text-text-tertiary">{"☆".repeat(5 - full)}</span>
    </span>
  )
}

export default function RatingsPage() {
  const toast = useToast()

  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [rows, setRows] = useState<AdminRating[]>([])
  const [total, setTotal] = useState(0)
  const [totalPages, setTotalPages] = useState(1)
  const [page, setPage] = useState(1)

  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all")
  const [starFilter, setStarFilter] = useState("all")
  const [search, setSearch] = useState("")
  const debouncedSearch = useDebouncedValue(search, SEARCH_DEBOUNCE_MS)

  const [target, setTarget] = useState<AdminRating | null>(null)
  const [action, setAction] = useState<"hide" | "unhide" | null>(null)
  const [reason, setReason] = useState("")
  const [reasonError, setReasonError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const load = useCallback(
    async (
      mode: "initial" | "refresh" = "initial",
      targetPage = page,
      targetStatus = statusFilter,
      targetStars = starFilter,
    ) => {
      if (mode === "initial") setLoading(true)
      else setRefreshing(true)
      setError(null)
      try {
        const res = await listRatings({
          page: targetPage,
          limit: PAGE_SIZE,
          stars: targetStars === "all" ? undefined : Number(targetStars),
          hidden:
            targetStatus === "all" ? undefined : targetStatus === "hidden",
        })
        setRows(res.data ?? [])
        const t = res.total ?? res.data?.length ?? 0
        setTotal(t)
        setTotalPages(
          res.totalPages ?? Math.max(1, Math.ceil(t / PAGE_SIZE)),
        )
      } catch (e) {
        const msg = userMessage(e)
        setError(msg)
        toast.show({
          title: "Gagal memuat rating",
          description: msg,
          tone: "danger",
        })
      } finally {
        setLoading(false)
        setRefreshing(false)
      }
    },
    [page, statusFilter, starFilter, toast],
  )

  useEffect(() => {
    void load("initial")
  }, [load])

  const handleStatusChange = (v: StatusFilter) => {
    setStatusFilter(v)
    setPage(1)
    void load("initial", 1, v, starFilter)
  }

  const handleStarChange = (v: string) => {
    setStarFilter(v)
    setPage(1)
    void load("initial", 1, statusFilter, v)
  }

  const handlePageChange = (p: number) => {
    setPage(p)
    void load("initial", p, statusFilter, starFilter)
  }

  // Backend tidak mendukung pencarian — saring lokal pada halaman yang dimuat.
  const filteredRows = useMemo(() => {
    const q = debouncedSearch.trim().toLowerCase()
    if (!q) return rows
    return rows.filter((r) => {
      const haystack = [
        personName(r.giver),
        personName(r.receiver),
        r.comment ?? "",
        r.order?.orderId ?? "",
      ]
        .join(" ")
        .toLowerCase()
      return haystack.includes(q)
    })
  }, [rows, debouncedSearch])

  const openAction = useCallback((rating: AdminRating, a: "hide" | "unhide") => {
    setTarget(rating)
    setAction(a)
    setReason("")
    setReasonError(null)
  }, [])

  const closeAction = useCallback(() => {
    if (submitting) return
    setTarget(null)
    setAction(null)
    setReason("")
    setReasonError(null)
  }, [submitting])

  const submitAction = useCallback(async () => {
    if (!target || !action || submitting) return
    const trimmed = reason.trim()
    if (trimmed.length < MIN_REASON_LENGTH) {
      setReasonError(`Alasan minimal ${MIN_REASON_LENGTH} karakter.`)
      return
    }
    setSubmitting(true)
    try {
      if (action === "hide") await hideRating(target.id, trimmed)
      else await unhideRating(target.id, trimmed)
      toast.show({
        title:
          action === "hide"
            ? "Rating disembunyikan"
            : "Rating ditampilkan kembali",
        tone: "success",
      })
      setTarget(null)
      setAction(null)
      setReason("")
      setReasonError(null)
      await load("refresh")
    } catch (e) {
      toast.show({
        title: "Gagal memproses rating",
        description: userMessage(e),
        tone: "danger",
      })
    } finally {
      setSubmitting(false)
    }
  }, [target, action, submitting, reason, toast, load])

  const isHide = action === "hide"

  return (
    <RoleGate href="/ratings">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-h2 font-bold text-text-primary">Rating</h1>
          <p className="mt-1 text-body text-text-secondary">
            Moderasi penilaian antar pengguna. Sembunyikan rating yang tidak
            pantas; tercatat di audit log.
          </p>
        </div>
        <Button
          variant="secondary"
          size="sm"
          fullWidth={false}
          loading={refreshing}
          onClick={() => load("refresh")}
        >
          Muat ulang
        </Button>
      </div>

      <div className="mb-4 flex flex-wrap items-end gap-3">
        <Select
          label="Status"
          options={STATUS_OPTIONS}
          value={statusFilter}
          onChange={(e) => handleStatusChange(e.target.value as StatusFilter)}
          className="w-52"
        />
        <Select
          label="Bintang"
          options={STAR_OPTIONS}
          value={starFilter}
          onChange={(e) => handleStarChange(e.target.value)}
          className="w-52"
        />
        <div className="min-w-64 flex-1">
          <Input
            label="Cari"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Nama penilai, dinilai, isi ulasan…"
          />
        </div>
      </div>

      {loading ? (
        <div className="flex min-h-[40vh] items-center justify-center gap-2">
          <Spinner size="md" />
          <p className="text-body text-text-secondary">Memuat rating…</p>
        </div>
      ) : error ? (
        <Card>
          <EmptyState
            title="Gagal memuat rating"
            description={error}
            action={
              <Button
                variant="secondary"
                fullWidth={false}
                onClick={() => load("initial")}
              >
                Coba lagi
              </Button>
            }
          />
        </Card>
      ) : (
        <>
          <DataTable<AdminRating>
            columns={[
              {
                key: "giver",
                header: "Penilai → Dinilai",
                render: (r) => (
                  <div className="min-w-44">
                    <p className="font-semibold">
                      {personName(r.giver)} → {personName(r.receiver)}
                    </p>
                    {r.order?.orderId ? (
                      <p className="text-caption text-text-secondary">
                        Order {r.order.orderId}
                      </p>
                    ) : null}
                  </div>
                ),
              },
              {
                key: "stars",
                header: "Bintang",
                render: (r) => <Stars value={r.stars} />,
              },
              {
                key: "comment",
                header: "Isi ulasan",
                render: (r) => (
                  <p className="max-w-md break-words text-body">
                    {r.comment?.trim() ? r.comment : "—"}
                  </p>
                ),
              },
              {
                key: "status",
                header: "Status",
                render: (r) =>
                  r.isHidden ? (
                    <Badge tone="danger">Disembunyikan</Badge>
                  ) : (
                    <Badge tone="success">Ditampilkan</Badge>
                  ),
              },
              {
                key: "createdAt",
                header: "Tanggal",
                render: (r) => (
                  <span className="whitespace-nowrap">
                    {formatDateTimeWIB(r.createdAt)}
                  </span>
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
                    onClick={() =>
                      openAction(r, r.isHidden ? "unhide" : "hide")
                    }
                  >
                    {r.isHidden ? "Tampilkan" : "Sembunyikan"}
                  </Button>
                ),
              },
            ]}
            rows={filteredRows}
            rowKey={(r) => r.id}
            emptyText={
              debouncedSearch.trim()
                ? "Tidak ada rating yang cocok dengan pencarian pada halaman ini."
                : statusFilter === "hidden"
                  ? "Tidak ada rating yang disembunyikan."
                  : "Tidak ada rating pada filter ini."
            }
          />
          {debouncedSearch.trim() ? (
            <p className="mt-2 text-caption text-text-secondary">
              Pencarian hanya berlaku pada halaman yang dimuat (backend belum
              mendukung pencarian global).
            </p>
          ) : null}
          <div className="mt-4">
            <Pagination
              page={page}
              totalPages={totalPages}
              total={total}
              pageSize={PAGE_SIZE}
              onPageChange={handlePageChange}
            />
          </div>
        </>
      )}

      <Dialog
        open={target != null && action != null}
        onClose={closeAction}
        title={isHide ? "Sembunyikan rating" : "Tampilkan rating kembali"}
        description={
          target
            ? `${personName(target.giver)} → ${personName(target.receiver)}`
            : undefined
        }
        footer={
          <div className="flex flex-col gap-2">
            <Button
              variant={isHide ? "destructive" : "primary"}
              loading={submitting}
              onClick={() => void submitAction()}
            >
              {isHide ? "Ya, sembunyikan" : "Ya, tampilkan"}
            </Button>
            <Button variant="ghost" disabled={submitting} onClick={closeAction}>
              Batal
            </Button>
          </div>
        }
      >
        <div className="flex flex-col gap-2">
          <p className="text-body text-text-secondary">
            {isHide
              ? "Rating tidak akan terlihat lagi oleh pengguna, tetapi tercatat di audit log."
              : "Rating akan terlihat kembali oleh pengguna."}{" "}
            Alasan wajib diisi.
          </p>
          <TextArea
            label="Alasan moderasi"
            required
            rows={3}
            value={reason}
            onChange={(e) => {
              setReason(e.target.value)
              if (reasonError) setReasonError(null)
            }}
            error={reasonError ?? undefined}
            placeholder="Contoh: komentar mengandung kata kasar…"
            // BAI-033 — backend RatingActionDto @MaxLength(500); batasi di
            // client agar admin tidak dapat 400 generik setelah mengetik panjang.
            maxLength={500}
          />
        </div>
      </Dialog>
    </RoleGate>
  )
}
