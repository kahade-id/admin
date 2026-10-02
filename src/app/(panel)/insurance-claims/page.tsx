/**
 * Admin — Review klaim asuransi Kahade+.
 *
 * Daftar klaim dengan filter status (DRAFT/SUBMITTED/APPROVED/REJECTED/PAID)
 * + paginasi bernomor. Tombol "Tinjau" membuka detail klaim (pengguna, order
 * terkait, tipe, nominal, cap, catatan) beserta aksi review:
 * setujui → APPROVED, tolak → REJECTED (keduanya dari status SUBMITTED),
 * dan bayar klaim → PAID (dari status APPROVED; mengeksekusi payout nyata
 * ke wallet — wajib dialog konfirmasi ADM-210), dengan catatan opsional.
 *
 * Kontrak backend (Kahade+, tetap):
 * - GET /v1/admin/insurance-claims?page&limit&status → {data, pagination}
 * - PATCH /v1/admin/insurance-claims/:id {status: 'APPROVED'|'REJECTED'|'PAID', note?}
 */
"use client"

import { useCallback, useEffect, useState, type ReactNode } from "react"

import { Badge, type BadgeTone } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { ConfirmDialog, Dialog } from "@/components/ui/dialog"
import { EmptyState } from "@/components/ui/empty-state"
import { TextArea } from "@/components/ui/input"
import { Spinner } from "@/components/ui/spinner"
import { DataTable } from "@/components/ui/table"
import { useToast } from "@/components/ui/toast"
import { Pagination } from "@/components/admin/pagination"
import { RoleGate } from "@/components/admin/role-gate"
import { Select } from "@/components/admin/select"
import {
  listInsuranceClaims,
  updateInsuranceClaimStatus,
  type InsuranceClaim,
  type InsuranceClaimStatus,
} from "@/lib/api/admin/insurance-claims"
import { useStepUp } from "@/components/admin/step-up-gate"
import { StepUpNotSupportedError } from "@/lib/api/admin/step-up"
import { useAuth } from "@/lib/auth-context"
import { newIdempotencyKey } from "@/lib/api/admin/finance"
import { userMessage } from "@/lib/api/response"
import { formatDateTimeWIB } from "@/lib/format"
// ADM-405 / SEC-505: identitas pengguna di-mask secara default (mask-only, tanpa unmask).
import { maskEmail, maskName } from "@/lib/pii"

const PAGE_SIZE = 20

type StatusFilter = "all" | InsuranceClaimStatus

const STATUS_OPTIONS = [
  { value: "all", label: "Semua status" },
  { value: "SUBMITTED", label: "Diajukan" },
  { value: "DRAFT", label: "Draf" },
  { value: "APPROVED", label: "Disetujui" },
  { value: "REJECTED", label: "Ditolak" },
  { value: "PAID", label: "Dibayar" },
]

const STATUS_LABEL: Record<string, string> = {
  DRAFT: "Draf",
  SUBMITTED: "Diajukan",
  APPROVED: "Disetujui",
  REJECTED: "Ditolak",
  PAID: "Dibayar",
}

const STATUS_TONE: Record<string, BadgeTone> = {
  DRAFT: "neutral",
  SUBMITTED: "warning",
  APPROVED: "info",
  REJECTED: "danger",
  PAID: "success",
}

/** Aliases respons backend → nilai tampilan. */
function claimType(c: InsuranceClaim): string {
  return String(c.type ?? c.claimType ?? "—")
}

function claimAmount(c: InsuranceClaim): number | null {
  const n = c.amount ?? c.nominal
  return typeof n === "number" && Number.isFinite(n) ? n : null
}

function claimCap(c: InsuranceClaim): number | null {
  const n = c.cap ?? c.claimCap
  return typeof n === "number" && Number.isFinite(n) ? n : null
}

function claimNote(c: InsuranceClaim): string {
  return String(c.note ?? c.notes ?? "—")
}

/** SEC-505: identitas pengguna di-mask (nama/email/username tidak tampil mentah). */
function claimUser(c: InsuranceClaim): string {
  const u = c.user
  if (u?.fullName) return maskName(u.fullName)
  if (u?.username) return maskName(u.username)
  if (u?.email) return maskEmail(u.email)
  return c.userId ?? "—"
}

function claimOrder(c: InsuranceClaim): string {
  return String(c.order?.orderNumber ?? c.order?.id ?? c.orderId ?? "—")
}

function formatRupiah(n: number | null): string {
  if (n == null) return "—"
  return `Rp${Math.trunc(n).toLocaleString("id-ID")}`
}

function KeyValue({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-2 border-b border-border py-2.5 last:border-b-0">
      <dt className="shrink-0 text-caption font-semibold text-text-secondary">
        {label}
      </dt>
      <dd className="min-w-0 flex-1 text-right text-body text-text-primary">
        {value}
      </dd>
    </div>
  )
}

type Action = "APPROVED" | "REJECTED" | "PAID"

const ACTION_META: Record<
  Action,
  { label: string; description: string; variant: "primary" | "destructive" }
> = {
  APPROVED: {
    label: "Setujui klaim",
    description: "Klaim disetujui dan siap dibayar. Tindakan ini tercatat di audit log.",
    variant: "primary",
  },
  REJECTED: {
    label: "Tolak klaim",
    description: "Klaim ditolak. Pengguna akan menerima notifikasi penolakan.",
    variant: "destructive",
  },
  PAID: {
    // ADM-210: copy lama ("Tandai dibayar") menyesatkan — aksi ini yang
    // MENGEKSEKUSI pembayaran (kredit wallet atomik), bukan sekadar penanda.
    label: "Bayar klaim",
    description: "MENGEKSEKUSI pembayaran: mengkredit wallet pengguna sebesar nominal klaim.",
    variant: "primary",
  },
}

/** Aksi yang valid dari status saat ini (alur: SUBMITTED → APPROVED/REJECTED → PAID). */
function allowedActions(status: string): Action[] {
  if (status === "SUBMITTED") return ["APPROVED", "REJECTED"]
  if (status === "APPROVED") return ["PAID"]
  return []
}

export default function InsuranceClaimsPage() {
  const toast = useToast()
  // SEC-502: identitas admin login (pemisahan tugas APPROVED→PAID) + gate
  // verifikasi ulang server untuk PAID.
  const { profile } = useAuth()
  const { requestStepUp, stepUpDialog } = useStepUp()

  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [rows, setRows] = useState<InsuranceClaim[]>([])
  const [total, setTotal] = useState(0)
  const [totalPages, setTotalPages] = useState(1)
  const [page, setPage] = useState(1)

  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all")

  const [selected, setSelected] = useState<InsuranceClaim | null>(null)
  const [note, setNote] = useState("")
  const [acting, setActing] = useState<Action | null>(null)
  // ADM-210: PAID mengeksekusi payout nyata — wajib dialog konfirmasi terpisah.
  const [confirmPaid, setConfirmPaid] = useState(false)

  const load = useCallback(
    async (
      mode: "initial" | "refresh" = "initial",
      targetPage = page,
      targetStatus = statusFilter,
    ) => {
      if (mode === "initial") setLoading(true)
      else setRefreshing(true)
      setError(null)
      try {
        const res = await listInsuranceClaims({
          page: targetPage,
          limit: PAGE_SIZE,
          status: targetStatus === "all" ? undefined : targetStatus,
        })
        setRows(res.data ?? [])
        const t = res.total ?? res.data?.length ?? 0
        setTotal(t)
        setTotalPages(res.totalPages ?? Math.max(1, Math.ceil(t / PAGE_SIZE)))
      } catch (e) {
        const msg = userMessage(e)
        setError(msg)
        toast.show({
          title: "Gagal memuat klaim asuransi",
          description: msg,
          tone: "danger",
        })
      } finally {
        setLoading(false)
        setRefreshing(false)
      }
    },
    [page, statusFilter, toast],
  )

  useEffect(() => {
    void load("initial")
  }, [load])

  const handleStatusChange = (v: StatusFilter) => {
    setStatusFilter(v)
    setPage(1)
    void load("initial", 1, v)
  }

  const handlePageChange = (p: number) => {
    setPage(p)
    void load("initial", p, statusFilter)
  }

  const [reviewKey, setReviewKey] = useState<string | null>(null)
  const openReview = (claim: InsuranceClaim) => {
    setSelected(claim)
    setNote("")
    setActing(null)
    // ADM-227: satu kunci idempotency per sesi dialog; retry memakai kunci sama.
    setReviewKey(newIdempotencyKey())
  }

  const closeReview = () => {
    if (acting) return
    setSelected(null)
    setNote("")
  }

  const handleAction = async (action: Action) => {
    if (!selected || acting) return
    // SEC-502: PAID mengeksekusi payout nyata — wajib verifikasi ulang
    // server (step-up) sebelum eksekusi. Fail-closed bila backend belum
    // mendukung atau user membatalkan.
    let stepUpToken: string | undefined
    if (action === "PAID") {
      try {
        const token = await requestStepUp({
          action: "insurance-claim.pay",
          targetId: selected.id,
          title: "Verifikasi ulang",
          description:
            `Membayar klaim sebesar ${formatRupiah(claimAmount(selected))} ` +
            "bersifat final dan tidak bisa dibatalkan.",
        })
        if (token === null) return // user membatalkan verifikasi
        stepUpToken = token
      } catch (e) {
        if (e instanceof StepUpNotSupportedError) {
          toast.show({
            title: "Backend belum mendukung verifikasi ulang server — aksi diblokir",
            tone: "danger",
          })
          return
        }
        toast.show({
          title: "Verifikasi ulang gagal",
          description: userMessage(e),
          tone: "danger",
        })
        return
      }
    }
    setActing(action)
    try {
      const res = await updateInsuranceClaimStatus(
        selected.id,
        {
          status: action,
          note: note.trim() || undefined,
        },
        { idempotencyKey: reviewKey ?? undefined, stepUpToken },
      )
      // SEC-502: nominal besar — backend bisa menahan payout menunggu
      // persetujuan admin kedua. Jangan toast sukses buta.
      if (res?.pendingSecondApproval) {
        toast.show({
          title: "Menunggu persetujuan kedua",
          description:
            "Klaim disetujui untuk dibayar, tetapi payout ditahan — nominal besar sehingga dibutuhkan persetujuan admin kedua.",
          tone: "info",
        })
        setSelected(null)
        setNote("")
        setReviewKey(null)
        await load("refresh")
        return
      }
      toast.show({
        title: ACTION_META[action].label,
        description: `Klaim ${selected.id} → ${STATUS_LABEL[action]}.`,
        tone: "success",
      })
      setSelected(null)
      setNote("")
      setReviewKey(null)
      await load("refresh")
    } catch (e) {
      toast.show({
        title: `Gagal ${ACTION_META[action].label.toLowerCase()}`,
        description: userMessage(e),
        tone: "danger",
      })
    } finally {
      setActing(null)
    }
  }

  const reviewStatus = selected ? String(selected.status ?? "") : ""
  const actions = allowedActions(reviewStatus)
  // SEC-502: pemisahan tugas — admin yang menyetujui klaim tidak boleh
  // mengeksekusi PAID-nya sendiri. Defensif: backend belum tentu mengirim
  // `approvedBy`; fallback ke `reviewedBy` (pada status APPROVED, reviewer
  // = approver). Bila keduanya kosong, pemeriksaan tidak memblokir.
  const paidBlockedBySelfApproval =
    !!profile?.id &&
    !!selected &&
    (selected.approvedBy ?? selected.reviewedBy) === profile.id

  return (
    <RoleGate href="/insurance-claims">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-h2 font-bold text-text-primary">Klaim Asuransi</h1>
          <p className="mt-1 text-body text-text-secondary">
            Tinjau klaim asuransi Kahade+ — setujui, tolak, atau tandai dibayar.
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
      </div>

      {loading ? (
        <div className="flex min-h-[40vh] items-center justify-center gap-2">
          <Spinner size="md" />
          <p className="text-body text-text-secondary">Memuat klaim asuransi…</p>
        </div>
      ) : error ? (
        <Card>
          <EmptyState
            title="Gagal memuat klaim asuransi"
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
          <DataTable<InsuranceClaim>
            columns={[
              {
                key: "id",
                header: "Klaim",
                render: (c) => (
                  <div className="min-w-40">
                    <p className="font-mono text-[13px] font-semibold">{c.id}</p>
                    <p className="text-caption text-text-secondary">
                      {formatDateTimeWIB(c.createdAt)}
                    </p>
                  </div>
                ),
              },
              {
                key: "user",
                header: "Pengguna",
                render: (c) => <span>{claimUser(c)}</span>,
              },
              {
                key: "order",
                header: "Order",
                render: (c) => (
                  <span className="whitespace-nowrap">{claimOrder(c)}</span>
                ),
              },
              {
                key: "type",
                header: "Tipe",
                render: (c) => <span>{claimType(c)}</span>,
              },
              {
                key: "amount",
                header: "Nominal",
                align: "right",
                render: (c) => (
                  <span className="whitespace-nowrap font-semibold">
                    {formatRupiah(claimAmount(c))}
                  </span>
                ),
              },
              {
                key: "cap",
                header: "Cap",
                align: "right",
                render: (c) => (
                  <span className="whitespace-nowrap">
                    {formatRupiah(claimCap(c))}
                  </span>
                ),
              },
              {
                key: "status",
                header: "Status",
                render: (c) => (
                  <Badge tone={STATUS_TONE[String(c.status)] ?? "neutral"}>
                    {STATUS_LABEL[String(c.status)] ?? String(c.status ?? "—")}
                  </Badge>
                ),
              },
              {
                key: "action",
                header: "",
                align: "right",
                render: (c) => (
                  <Button
                    variant="secondary"
                    size="sm"
                    fullWidth={false}
                    onClick={() => openReview(c)}
                  >
                    Tinjau
                  </Button>
                ),
              },
            ]}
            rows={rows}
            rowKey={(c) => c.id}
            emptyText="Tidak ada klaim asuransi pada filter ini."
          />
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

      {/* Detail + aksi review */}
      <Dialog
        open={selected != null}
        onClose={closeReview}
        title="Tinjau klaim asuransi"
        description={
          selected ? `ID klaim: ${selected.id}` : undefined
        }
      >
        {selected ? (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <Badge tone={STATUS_TONE[reviewStatus] ?? "neutral"}>
                {STATUS_LABEL[reviewStatus] ?? reviewStatus}
              </Badge>
            </div>
            <dl>
              <KeyValue label="Pengguna" value={claimUser(selected)} />
              {selected.user?.email ? (
                <KeyValue label="Email" value={maskEmail(selected.user.email)} />
              ) : null}
              <KeyValue label="Order terkait" value={claimOrder(selected)} />
              <KeyValue label="Tipe klaim" value={claimType(selected)} />
              <KeyValue label="Nominal" value={formatRupiah(claimAmount(selected))} />
              <KeyValue label="Cap pertanggungan" value={formatRupiah(claimCap(selected))} />
              <KeyValue label="Diajukan" value={formatDateTimeWIB(selected.createdAt)} />
            </dl>

            <div>
              <p className="text-caption font-semibold text-text-secondary">
                Catatan review admin
              </p>
              <p className="mt-1 rounded-sm bg-surface px-4 py-3 text-body text-text-primary">
                {claimNote(selected)}
              </p>
            </div>

            {actions.length > 0 ? (
              <>
                <TextArea
                  label="Catatan review (opsional)"
                  rows={3}
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="Cth. Bukti kerusakan valid, disetujui sesuai cap…"
                  maxLength={1000}
                  disabled={acting != null}
                />
                <div className="flex flex-col gap-2">
                  {actions.map((action) => (
                    <Button
                      key={action}
                      variant={ACTION_META[action].variant}
                      loading={acting === action}
                      disabled={
                        acting != null ||
                        (action === "PAID" && paidBlockedBySelfApproval)
                      }
                      onClick={() =>
                        action === "PAID" ? setConfirmPaid(true) : handleAction(action)
                      }
                      title={
                        action === "PAID" && paidBlockedBySelfApproval
                          ? "Anda yang menyetujui klaim ini — pembayaran harus dieksekusi admin lain."
                          : ACTION_META[action].description
                      }
                    >
                      {ACTION_META[action].label}
                    </Button>
                  ))}
                  <Button
                    variant="ghost"
                    disabled={acting != null}
                    onClick={closeReview}
                  >
                    Tutup
                  </Button>
                </div>
              </>
            ) : (
              <>
                <p className="text-caption text-text-secondary">
                  Klaim pada status ini tidak memiliki aksi review
                  {reviewStatus === "DRAFT" ? " (masih draf, belum diajukan pengguna)" : ""}.
                </p>
                <Button variant="ghost" onClick={closeReview}>
                  Tutup
                </Button>
              </>
            )}
          </div>
        ) : null}
      </Dialog>

      {/* ADM-210: konfirmasi eksekusi payout klaim — nominal, cap, penerima, irreversible */}
      {selected ? (
        <ConfirmDialog
          open={confirmPaid}
          onClose={() => {
            if (acting) return
            setConfirmPaid(false)
          }}
          title="Bayar klaim — eksekusi payout?"
          description={
            `Tindakan ini MENGKREDIT wallet ${claimUser(selected)} sebesar ` +
            `${formatRupiah(claimAmount(selected))} (cap pertanggungan ${formatRupiah(claimCap(selected))}). ` +
            `Payout bersifat final dan tidak bisa dibatalkan. Pastikan nominal dan penerima sudah benar.` +
            // SEC-502: peringatan nominal besar — dibutuhkan persetujuan admin kedua.
            ((claimAmount(selected) ?? 0) > 1_000_000
              ? " Nominal di atas Rp1.000.000 — dibutuhkan persetujuan admin kedua."
              : "")
          }
          confirmLabel={`Ya, bayar ${formatRupiah(claimAmount(selected))}`}
          cancelLabel="Batal"
          loading={acting === "PAID"}
          onConfirm={() => {
            setConfirmPaid(false)
            void handleAction("PAID")
          }}
        />
      ) : null}
      {/* SEC-502: dialog verifikasi ulang server (step-up) untuk PAID. */}
      {stepUpDialog}
    </RoleGate>
  )
}
