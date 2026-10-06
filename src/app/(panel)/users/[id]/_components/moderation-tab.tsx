/**
 * Admin — tab "Moderasi" detail pengguna (E5a, grup E).
 *
 * 1. Banner konflik tugas: peringatan bila admin membuka review kasus yang
 *    terkait akunnya sendiri. BATAS (didokumentasikan): heuristik sederhana
 *    berbasis kecocokan email profil admin vs email pengguna — tidak
 *    mendeteksi akun ganda/alias. Guard nyata butuh cross-check backend
 *    (penugasan kasus vs userId yang ditautkan ke akun admin).
 * 2. Timeline gabungan event sistem vs admin (ikon/warna berbeda), filter
 *    event/aktor/rentang waktu. Catatan internal hanya untuk role selain
 *    CUSTOMER_SUPPORT (backend juga memfilternya; ini lapis pertahanan UI).
 * 3. Handoff kasus: form catatan ke petugas + riwayat + beban kasus per petugas.
 */
"use client"

import { useCallback, useEffect, useState } from "react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardBody, CardHeader } from "@/components/ui/card"
import { Input, TextArea } from "@/components/ui/input"
import { DataTable } from "@/components/ui/table"
import { useToast } from "@/components/ui/toast"
import { Select } from "@/components/admin/select"
import { Pagination } from "@/components/admin/pagination"
import { useAuth } from "@/lib/auth-context"
import {
  createHandoff,
  getHandoffWorkload,
  listAdmins,
  listHandoffs,
  type AdminUserItem,
  type Handoff,
  type HandoffWorkload,
} from "@/lib/api/admin/management"
import {
  listUserModerationTimeline,
  type ListUserModerationEventsQuery,
  type UserModerationEvent,
  type UserModerationEventKind,
} from "@/lib/api/admin/users"
import { userMessage } from "@/lib/api/response"
import { formatDateTimeWIB } from "@/lib/format"

import { ErrorBlock, LoadingBlock } from "../../../_components/admin-ui"

const PAGE_SIZE = 20

/* ------------------------------------------------------------------ */
/* 1. Deteksi konflik tugas                                             */
/* ------------------------------------------------------------------ */

/**
 * BATAS: hanya membandingkan email profil admin vs email pengguna yang
 * direview. Tidak mendeteksi: akun pengguna ganda milik admin yang sama,
 * alias email, atau kasus (dispute/tiket) yang ditugaskan ke admin namun
 * melibatkan akun lain. Untuk guard kuat, backend perlu endpoint yang
 * membandingkan penugasan kasus dengan `linkedUserId` akun admin.
 */
export function isSelfReviewConflict(
  adminEmail: string | null | undefined,
  userEmail: string | null | undefined,
): boolean {
  if (!adminEmail || !userEmail) return false
  return adminEmail.trim().toLowerCase() === userEmail.trim().toLowerCase()
}

function SelfReviewConflictBanner({ userEmail }: { userEmail: string | null }) {
  const { profile } = useAuth()
  if (!isSelfReviewConflict(profile?.email, userEmail)) return null
  return (
    <div
      role="alert"
      className="rounded-md border border-warning bg-warning/10 px-4 py-3"
    >
      <p className="font-semibold text-warning-text">
        Peringatan konflik tugas
      </p>
      <p className="mt-1 text-body text-text-primary">
        Akun yang Anda review ini terhubung dengan akun admin Anda sendiri.
        Hindari mengambil tindakan moderasi pada kasus ini — serahkan
        (handoff) ke petugas lain untuk menjaga independensi.
      </p>
      <p className="mt-1 text-caption text-text-tertiary">
        Deteksi sederhana berbasis email; lihat catatan batas di kode.
      </p>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* 2. Timeline moderasi                                                 */
/* ------------------------------------------------------------------ */

/**
 * Role yang boleh melihat catatan internal. CUSTOMER_SUPPORT ("CS biasa")
 * disembunyikan — asumsi kebijakan G376–G400; selaraskan bila backend
 * menetapkan daftar berbeda.
 */
const INTERNAL_NOTE_ROLES = new Set([
  "SUPER_ADMIN",
  "DISPUTE_ADMIN",
  "KYC_ADMIN",
  "FINANCE_ADMIN",
])

const KIND_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "all", label: "Semua event" },
  { value: "system", label: "Sistem" },
  { value: "admin", label: "Admin" },
]

/** ADM-018: filter jenis event sesuai enum yang didukung backend. */
const EVENT_TYPE_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "all", label: "Semua jenis" },
  { value: "ban", label: "Blokir" },
  { value: "unban", label: "Buka blokir" },
  { value: "kyc_decision", label: "Keputusan KYC" },
  { value: "report_resolved", label: "Laporan diselesaikan" },
  { value: "flag_raised", label: "Flag dinaikkan" },
  { value: "flag_cleared", label: "Flag dibersihkan" },
  { value: "admin_action", label: "Aksi admin lain" },
]

function prettyEventType(t: string): string {
  return t.replace(/_/g, " ").toLowerCase()
}

function KindBadge({ kind }: { kind: UserModerationEventKind }) {
  return kind === "system" ? (
    <Badge tone="info" dot>
      Sistem
    </Badge>
  ) : (
    <Badge tone="warning" dot>
      Admin
    </Badge>
  )
}

function ModerationTimeline({ userId }: { userId: string }) {
  const { role } = useAuth()
  const toast = useToast()
  const [events, setEvents] = useState<UserModerationEvent[]>([])
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [kind, setKind] = useState<string>("all")
  const [eventType, setEventType] = useState<string>("all")
  const [actor, setActor] = useState("")
  const [from, setFrom] = useState("")
  const [to, setTo] = useState("")

  const canSeeInternalNote = role != null && INTERNAL_NOTE_ROLES.has(role)

  const load = useCallback(
    async (targetPage: number, filters: ListUserModerationEventsQuery) => {
      setLoading(true)
      setError(null)
      try {
        const res = await listUserModerationTimeline(userId, {
          ...filters,
          page: targetPage,
          limit: PAGE_SIZE,
        })
        setEvents(res.data ?? [])
        const t = res.total ?? 0
        setTotal(t)
        setTotalPages(res.totalPages ?? Math.max(1, Math.ceil(t / PAGE_SIZE)))
        setPage(targetPage)
      } catch (e) {
        setError(userMessage(e))
      } finally {
        setLoading(false)
      }
    },
    [userId],
  )

  const currentFilters = useCallback(
    (): ListUserModerationEventsQuery => ({
      kind: kind === "all" ? undefined : (kind as UserModerationEventKind),
      event: eventType === "all" ? undefined : eventType,
      actor: actor.trim() || undefined,
      from: from || undefined,
      to: to || undefined,
    }),
    [kind, eventType, actor, from, to],
  )

  useEffect(() => {
    void load(1, currentFilters())
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId])

  function applyFilters() {
    void load(1, currentFilters())
  }

  function resetFilters() {
    setKind("all")
    setEventType("all")
    setActor("")
    setFrom("")
    setTo("")
    void load(1, {})
  }

  return (
    <Card padded={false}>
      <CardHeader title="Timeline moderasi" />
      <CardBody>
        <div className="mb-4 grid gap-3 md:grid-cols-2 lg:grid-cols-6">
          <Select
            label="Sumber event"
            options={KIND_OPTIONS}
            value={kind}
            onChange={(e) => setKind(e.target.value)}
          />
          <Select
            label="Jenis event"
            options={EVENT_TYPE_OPTIONS}
            value={eventType}
            onChange={(e) => setEventType(e.target.value)}
          />
          <Input
            label="Aktor"
            // BAI-067: backend hanya menerima ID admin internal, bukan nama.
            placeholder="ID admin"
            value={actor}
            onChange={(e) => setActor(e.target.value)}
          />
          <Input
            label="Dari"
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
          />
          <Input
            label="Sampai"
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
          />
          <div className="flex items-end gap-2">
            <Button variant="secondary" size="md" fullWidth={false} onClick={applyFilters}>
              Terapkan
            </Button>
            <Button variant="ghost" size="md" fullWidth={false} onClick={resetFilters}>
              Reset
            </Button>
          </div>
        </div>

        {loading ? (
          <LoadingBlock message="Memuat timeline moderasi…" />
        ) : error ? (
          <ErrorBlock
            title="Gagal memuat timeline"
            message={error}
            onRetry={() => load(page, currentFilters())}
          />
        ) : events.length === 0 ? (
          <p className="py-6 text-center text-body text-text-secondary">
            Belum ada event moderasi untuk pengguna ini.
          </p>
        ) : (
          <ol className="flex flex-col gap-0">
            {events.map((ev) => (
              <li key={ev.id} className="flex gap-3 pb-5 last:pb-0">
                <div className="flex flex-col items-center">
                  <span
                    aria-hidden
                    className={
                      ev.source === "system"
                        ? "mt-1.5 h-2.5 w-2.5 rounded-full bg-info"
                        : "mt-1.5 h-2.5 w-2.5 rounded-full bg-warning"
                    }
                  />
                  <span aria-hidden className="w-px flex-1 bg-border" />
                </div>
                <div className="min-w-0 flex-1 pb-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <KindBadge kind={ev.source} />
                    <span className="font-semibold text-text-primary">
                      {ev.title || prettyEventType(ev.type)}
                    </span>
                    <span className="text-caption text-text-tertiary">
                      {formatDateTimeWIB(ev.createdAt)}
                    </span>
                  </div>
                  {ev.actor?.name ? (
                    <p className="mt-0.5 text-caption text-text-secondary">
                      oleh {ev.actor.name}
                      {ev.actor.role ? ` (${ev.actor.role})` : ""}
                    </p>
                  ) : null}
                  {ev.description ? (
                    <p className="mt-1 text-body text-text-primary">{ev.description}</p>
                  ) : null}
                  {ev.internalNote && canSeeInternalNote ? (
                    <p className="mt-1.5 rounded-sm bg-surface-elevated px-2.5 py-1.5 text-body text-text-secondary">
                      <span className="font-semibold">Catatan internal:</span>{" "}
                      {ev.internalNote}
                    </p>
                  ) : null}
                </div>
              </li>
            ))}
          </ol>
        )}

        {!loading && !error && events.length > 0 ? (
          <div className="mt-4">
            <Pagination
              page={page}
              totalPages={totalPages}
              total={total}
              pageSize={PAGE_SIZE}
              onPageChange={(p) => load(p, currentFilters())}
            />
          </div>
        ) : null}
        {!canSeeInternalNote ? (
          <p className="mt-3 text-caption text-text-tertiary">
            Catatan internal disembunyikan untuk role Customer Support.
          </p>
        ) : null}
      </CardBody>
    </Card>
  )
}

/* ------------------------------------------------------------------ */
/* 3. Handoff kasus                                                     */
/* ------------------------------------------------------------------ */

function HandoffSection({ userId }: { userId: string }) {
  const toast = useToast()
  const { profile } = useAuth()
  const [admins, setAdmins] = useState<AdminUserItem[]>([])
  const [toAdminId, setToAdminId] = useState("")
  const [note, setNote] = useState("")
  const [noteError, setNoteError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [history, setHistory] = useState<Handoff[]>([])
  const [workload, setWorkload] = useState<HandoffWorkload[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const loadAll = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [a, h, w] = await Promise.all([
        listAdmins({ limit: 100 }),
        listHandoffs({ caseType: "user", caseId: userId, limit: 50 }),
        getHandoffWorkload(),
      ])
      setAdmins((a.data ?? []).filter((x) => x.isActive))
      setHistory(h.data ?? [])
      setWorkload(w)
    } catch (e) {
      setError(userMessage(e))
    } finally {
      setLoading(false)
    }
  }, [userId])

  useEffect(() => {
    void loadAll()
  }, [loadAll])

  async function handleSubmit() {
    const n = note.trim()
    if (!toAdminId) {
      setNoteError("Pilih petugas tujuan handoff.")
      return
    }
    if (n.length < 5) {
      setNoteError("Catatan handoff minimal 5 karakter.")
      return
    }
    setNoteError(null)
    setSubmitting(true)
    try {
      const fromAdminId = profile?.id
      if (!fromAdminId) {
        setNoteError("Sesi admin tidak valid — muat ulang halaman.")
        return
      }
      await createHandoff({
        caseType: "user",
        caseId: userId,
        fromAdminId,
        toAdminId,
        note: n,
      })
      toast.show({ title: "Handoff dicatat.", tone: "success" })
      setNote("")
      setToAdminId("")
      await loadAll()
    } catch (e) {
      toast.show({ title: "Handoff gagal", description: userMessage(e), tone: "danger" })
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Card padded={false}>
      <CardHeader title="Handoff kasus" />
      <CardBody>
        {loading ? (
          <LoadingBlock message="Memuat data handoff…" />
        ) : error ? (
          <ErrorBlock title="Gagal memuat handoff" message={error} onRetry={loadAll} />
        ) : (
          <div className="flex flex-col gap-5">
            <div className="grid gap-3 md:grid-cols-[1fr_2fr]">
              <Select
                label="Serahkan ke petugas"
                options={[
                  { value: "", label: "— Pilih petugas —" },
                  ...admins.map((a) => ({
                    value: a.id,
                    label: `${a.fullName} (${a.email})`,
                  })),
                ]}
                value={toAdminId}
                onChange={(e) => setToAdminId(e.target.value)}
              />
              <TextArea
                label="Catatan handoff"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Ringkasan status kasus + hal yang perlu dilanjutkan…"
                rows={2}
              />
            </div>
            {noteError ? (
              <p role="alert" className="-mt-3 text-caption text-danger-text">
                {noteError}
              </p>
            ) : null}
            <div>
              <Button loading={submitting} fullWidth={false} onClick={handleSubmit}>
                Catat handoff
              </Button>
            </div>

            <div>
              <p className="mb-2 text-label font-semibold text-text-secondary">
                Beban kasus per petugas
              </p>
              <DataTable<HandoffWorkload & Record<string, unknown>>
                columns={[
                  {
                    key: "fullName",
                    header: "Petugas",
                    render: (w) => <span className="font-medium">{w.fullName}</span>,
                  },
                  {
                    key: "openCount",
                    header: "Kasus terbuka",
                    align: "right",
                    render: (w) => String(w.openCount),
                  },
                ]}
                rows={workload.map((w) => ({ ...w }))}
                rowKey={(w) => w.adminId}
                emptyText="Data beban kasus belum tersedia."
              />
            </div>

            <div>
              <p className="mb-2 text-label font-semibold text-text-secondary">
                Riwayat handoff kasus ini
              </p>
              <DataTable<Handoff & Record<string, unknown>>
                columns={[
                  {
                    key: "createdAt",
                    header: "Waktu",
                    render: (h) => formatDateTimeWIB(h.createdAt),
                  },
                  {
                    key: "route",
                    header: "Rute",
                    render: (h) => (
                      <span>
                        {h.fromAdminName ?? "—"} →{" "}
                        <span className="font-medium">
                          {h.toAdminName ?? h.toAdminId}
                        </span>
                      </span>
                    ),
                  },
                  {
                    key: "note",
                    header: "Catatan",
                    render: (h) => h.note?.trim() || "—",
                  },
                ]}
                rows={history.map((h) => ({ ...h }))}
                rowKey={(h) => h.id}
                emptyText="Belum ada handoff untuk kasus ini."
              />
            </div>
          </div>
        )}
      </CardBody>
    </Card>
  )
}

/* ------------------------------------------------------------------ */
/* Tab                                                                  */
/* ------------------------------------------------------------------ */

export function ModerationTab({
  userId,
  userEmail,
}: {
  userId: string
  userEmail: string | null
}) {
  return (
    <div className="flex flex-col gap-5">
      <SelfReviewConflictBanner userEmail={userEmail} />
      <ModerationTimeline userId={userId} />
      <HandoffSection userId={userId} />
    </div>
  )
}
