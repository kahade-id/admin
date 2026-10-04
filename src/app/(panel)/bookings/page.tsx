/**
 * Admin — Booking jasa (service slot bookings).
 *
 * POIN 2 (unifikasi transaksi escrow): daftar READ-ONLY minimal untuk
 * memantau booking jasa — kolom: booking, slot, user (pemesan), status,
 * orderId terkait. Admin di sini HANYA memantau; TIDAK ada aksi finansial
 * (batal/paksa) di halaman ini.
 *
 * Kontrak endpoint adalah ASUMSI (lihat src/lib/api/admin/bookings.ts) —
 * backend belum punya endpoint admin booking jasa saat halaman ini dibuat
 * (2026-10-04). Bila endpoint belum tersedia, halaman menampilkan pesan
 * gagal muat; bukan bug UI.
 */
"use client"

import { useCallback, useEffect, useState } from "react"

import { Badge, type BadgeTone } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { EmptyState } from "@/components/ui/empty-state"
import { Spinner } from "@/components/ui/spinner"
import { DataTable } from "@/components/ui/table"
import { Input } from "@/components/ui/input"
import { useToast } from "@/components/ui/toast"
import { Pagination } from "@/components/admin/pagination"
import { RoleGate } from "@/components/admin/role-gate"
import { Select } from "@/components/admin/select"
import { userMessage } from "@/lib/api/response"
import { formatDateTimeWIB, formatDateWIB } from "@/lib/format"
// ADM-405: nama pemesan di-mask; username bukan PII langsung sehingga tetap tampil.
import { maskName } from "@/lib/pii"
import {
  listAdminServiceBookings,
  type AdminServiceBookingItem,
  type ServiceBookingStatus,
} from "@/lib/api/admin/bookings"

const PAGE_SIZE = 20

/** Selaras enum backend `SlotBookingStatus`. */
const STATUS_LABEL: Record<string, string> = {
  BOOKED: "Dibooking",
  CANCELLED: "Dibatalkan",
  COMPLETED: "Selesai",
}

const STATUS_TONE: Record<string, BadgeTone> = {
  BOOKED: "info",
  CANCELLED: "neutral",
  COMPLETED: "success",
}

const STATUS_FILTERS: Array<{ value: ServiceBookingStatus | ""; label: string }> = [
  { value: "", label: "Semua status" },
  { value: "BOOKED", label: "Dibooking" },
  { value: "CANCELLED", label: "Dibatalkan" },
  { value: "COMPLETED", label: "Selesai" },
]

function bookingUserName(
  u: AdminServiceBookingItem["user"],
): string {
  if (!u) return "—"
  if (u.username) return String(u.username)
  const masked = maskName(u.fullName ?? null)
  return masked !== "—" ? masked : "—"
}

function slotLabel(b: AdminServiceBookingItem): string {
  const s = b.slot
  if (!s) return b.slotId
  const date = s.slotDate ? formatDateWIB(s.slotDate) : "—"
  const time =
    s.startTime && s.endTime ? `${s.startTime}–${s.endTime}` : ""
  return [date, time].filter(Boolean).join(" · ")
}

function BookingsPageContent() {
  const toast = useToast()
  const [statusFilter, setStatusFilter] = useState<"" | ServiceBookingStatus>("")
  const [searchInput, setSearchInput] = useState("")
  const [search, setSearch] = useState("")
  const [page, setPage] = useState(1)
  const [rows, setRows] = useState<AdminServiceBookingItem[]>([])
  const [total, setTotal] = useState(0)
  const [totalPages, setTotalPages] = useState(1)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(
    async (
      targetPage: number,
      targetStatus: "" | ServiceBookingStatus,
      q: string,
    ) => {
      setLoading(true)
      setError(null)
      try {
        const res = await listAdminServiceBookings({
          page: targetPage,
          limit: PAGE_SIZE,
          status: targetStatus === "" ? undefined : targetStatus,
          search: q.trim() || undefined,
        })
        setRows(res.data ?? [])
        const t = res.total ?? (res.data ?? []).length
        setTotal(t)
        setTotalPages(res.totalPages ?? Math.max(1, Math.ceil(t / PAGE_SIZE)))
        setPage(targetPage)
      } catch (e) {
        const msg = userMessage(e)
        setError(msg)
        toast.show({
          title: "Gagal memuat booking jasa",
          description: msg,
          tone: "danger",
        })
      } finally {
        setLoading(false)
      }
    },
    [toast],
  )

  useEffect(() => {
    void load(1, statusFilter, search)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load, statusFilter])

  const submitSearch = () => {
    const q = searchInput.trim()
    setSearch(q)
    setPage(1)
    void load(1, statusFilter, q)
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-h2 font-semibold text-text-primary">Booking Jasa</h1>
          <p className="mt-1 text-body text-text-secondary">
            Pantau booking slot jasa: pemesan, jadwal slot, status, dan order
            terkait. Halaman ini read-only — tidak ada aksi finansial.
          </p>
        </div>
        <Button
          variant="secondary"
          size="sm"
          fullWidth={false}
          loading={loading}
          onClick={() => load(page, statusFilter, search)}
        >
          Muat ulang
        </Button>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <Select
          label="Status"
          value={statusFilter}
          onChange={(e) => {
            const v = e.target.value as "" | ServiceBookingStatus
            setStatusFilter(v)
            setPage(1)
            void load(1, v, search)
          }}
          options={STATUS_FILTERS}
          className="w-52"
        />
        <form
          className="flex flex-1 flex-wrap items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            submitSearch()
          }}
        >
          <Input
            label="Cari booking"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="ID booking / user / order…"
            className="min-w-52 flex-1"
          />
          <Button type="submit" variant="secondary" size="md" fullWidth={false}>
            Cari
          </Button>
        </form>
      </div>

      {loading ? (
        <div className="flex min-h-[40vh] items-center justify-center gap-2">
          <Spinner size="md" />
          <p className="text-body text-text-secondary">Memuat booking jasa…</p>
        </div>
      ) : error ? (
        <Card>
          <EmptyState
            title="Gagal memuat booking jasa"
            description={`${error} — endpoint admin booking jasa (GET /v1/admin/service-bookings) adalah kontrak asumsi dan mungkin belum tersedia di backend.`}
            action={
              <Button
                variant="secondary"
                fullWidth={false}
                onClick={() => load(page, statusFilter, search)}
              >
                Coba lagi
              </Button>
            }
          />
        </Card>
      ) : (
        <>
          <DataTable<AdminServiceBookingItem>
            columns={[
              {
                key: "booking",
                header: "Booking",
                render: (r) => (
                  <div>
                    <p className="break-all font-mono text-caption">{r.id}</p>
                    <p className="text-caption text-text-secondary">
                      {formatDateTimeWIB(r.createdAt)}
                    </p>
                  </div>
                ),
              },
              {
                key: "slot",
                header: "Slot",
                render: (r) => (
                  <div>
                    <p className="font-medium">{slotLabel(r)}</p>
                    {r.slot?.capacity != null ? (
                      <p className="text-caption text-text-secondary">
                        Terisi {r.slot.bookedCount ?? 0}/{r.slot.capacity}
                      </p>
                    ) : null}
                  </div>
                ),
              },
              {
                key: "user",
                header: "Pemesan",
                render: (r) => bookingUserName(r.user),
              },
              {
                key: "status",
                header: "Status",
                render: (r) => (
                  <Badge tone={STATUS_TONE[String(r.status)] ?? "neutral"}>
                    {STATUS_LABEL[String(r.status)] ?? String(r.status)}
                  </Badge>
                ),
              },
              {
                key: "orderId",
                header: "Order terkait",
                render: (r) =>
                  r.orderId ? (
                    <span className="break-all font-mono text-caption">
                      {String(r.orderId)}
                    </span>
                  ) : (
                    <span className="text-caption text-text-secondary">—</span>
                  ),
              },
            ]}
            rows={rows}
            rowKey={(r) => r.id}
            loading={loading}
            emptyText="Tidak ada booking jasa pada filter ini."
          />
          <div className="mt-4 flex items-center justify-between">
            <p className="text-small text-text-secondary">
              Total {total} booking
            </p>
            <Pagination
              page={page}
              totalPages={totalPages}
              onPageChange={(p) => load(p, statusFilter, search)}
              disabled={loading}
            />
          </div>
        </>
      )}
    </div>
  )
}

export default function BookingsPage() {
  return (
    <RoleGate href="/bookings">
      <BookingsPageContent />
    </RoleGate>
  )
}
