"use client"

/**
 * Admin — Disbursement DANA (BAI-043/044/045/050).
 *
 * Satu-satunya permukaan admin untuk aliran uang aktual era tanpa-wallet
 * (escrow order, milestone, cashback, referral, dispute release, legacy
 * payout) — tercatat di EscrowDisbursement.
 *
 * - List + detail: read-only, filter status & scope (BAI-050: scope mencakup
 *   CASHBACK & REFERRAL).
 * - Recheck (PROCESSING): query status ke DANA — tidak pernah mengirim
 *   transfer baru. BAI-048: toast PROCESSING berbunyi "sedang diproses,
 *   verifikasi via recheck", bukan "disetujui".
 * - Review (NEEDS_REVIEW): SUPER_ADMIN only — RETRY / CANCEL / FORCE_SUCCESS
 *   + alasan min 10 karakter. FORCE_SUCCESS hanya dengan bukti transfer nyata.
 * - Requeue (HELD_NO_BANK → PENDING): SUPER_ADMIN / FINANCE_ADMIN.
 */

import { useCallback, useEffect, useState } from "react"

import { Badge, type BadgeTone } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardBody, CardHeader } from "@/components/ui/card"
import { ConfirmDialog, Dialog } from "@/components/ui/dialog"
import { EmptyState } from "@/components/ui/empty-state"
import { Input, TextArea } from "@/components/ui/input"
import { Select } from "@/components/admin/select"
import { Spinner } from "@/components/ui/spinner"
import { DataTable } from "@/components/ui/table"
import { useToast } from "@/components/ui/toast"
import { Pagination } from "@/components/admin/pagination"
import { RoleGate } from "@/components/admin/role-gate"
import { useStepUp } from "@/components/admin/step-up-gate"
import { useAuth } from "@/lib/auth-context"
import {
  listDisbursements,
  getDisbursement,
  recheckDisbursement,
  reviewDisbursement,
  requeueDisbursement,
  DISBURSEMENT_STATUSES,
  DISBURSEMENT_SCOPES,
  type DisbursementDetail,
  type DisbursementListItem,
  type DisbursementReviewDecision,
  type DisbursementScope,
  type DisbursementStatus,
} from "@/lib/api/admin/disbursements"
import { newIdempotencyKey } from "@/lib/api/admin/finance"
import { StepUpNotSupportedError } from "@/lib/api/admin/step-up"
import { userMessage } from "@/lib/api/response"
import { formatDateTimeWIB, formatIDR } from "@/lib/format"

const PAGE_SIZE = 20

const STATUS_TONE: Record<DisbursementStatus, BadgeTone> = {
  PENDING: "info",
  HELD_NO_BANK: "warning",
  PROCESSING: "accent",
  SUCCESS: "success",
  FAILED: "danger",
  CANCELLED: "neutral",
  NEEDS_REVIEW: "warning",
}

const STATUS_LABEL: Record<DisbursementStatus, string> = {
  PENDING: "Menunggu",
  HELD_NO_BANK: "Tahan — tanpa rekening",
  PROCESSING: "Diproses DANA",
  SUCCESS: "Berhasil",
  FAILED: "Gagal",
  CANCELLED: "Dibatalkan",
  NEEDS_REVIEW: "Butuh review",
}

const SCOPE_LABEL: Record<DisbursementScope, string> = {
  ORDER_ESCROW: "Escrow order",
  MILESTONE: "Milestone",
  LEGACY_WALLET_PAYOUT: "Payout legacy",
  CASHBACK: "Cashback",
  REFERRAL: "Referral",
  DISPUTE_RELEASE: "Rilis sengketa",
}

const REVIEW_DECISIONS: { value: DisbursementReviewDecision; label: string }[] = [
  { value: "RETRY", label: "RETRY — antre ulang ke cron (idempoten)" },
  { value: "CANCEL", label: "CANCEL — batalkan (terminal)" },
  { value: "FORCE_SUCCESS", label: "FORCE_SUCCESS — tandai sukses manual (butuh bukti transfer)" },
]

export default function DisbursementsPage() {
  const { show } = useToast()
  const { role } = useAuth()
  const [rows, setRows] = useState<DisbursementListItem[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)
  const [statusFilter, setStatusFilter] = useState<string>("ALL")
  const [scopeFilter, setScopeFilter] = useState<string>("ALL")
  const [search, setSearch] = useState("")
  const [searchInput, setSearchInput] = useState("")

  const [detailId, setDetailId] = useState<string | null>(null)
  const [detail, setDetail] = useState<DisbursementDetail | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)

  const [acting, setActing] = useState<string | null>(null)
  const [reviewTarget, setReviewTarget] = useState<DisbursementListItem | null>(null)
  const [reviewDecision, setReviewDecision] = useState<DisbursementReviewDecision>("RETRY")
  const [reviewReason, setReviewReason] = useState("")
  const [reviewError, setReviewError] = useState<string | null>(null)
  const [requeueTarget, setRequeueTarget] = useState<DisbursementListItem | null>(null)
  // SEC-501: verifikasi ulang server sebelum aksi uang (review/requeue) —
  // backend mewajibkan @RequireStepUp, tanpa token → 403 STEP_UP_REQUIRED.
  const { requestStepUp, stepUpDialog } = useStepUp()

  const load = useCallback(async (p: number) => {
    setLoading(true)
    try {
      const res = await listDisbursements({
        page: p,
        limit: PAGE_SIZE,
        ...(statusFilter !== "ALL" ? { status: statusFilter as DisbursementStatus } : {}),
        ...(scopeFilter !== "ALL" ? { scope: scopeFilter as DisbursementScope } : {}),
        ...(search ? { search } : {}),
      })
      setRows(res.data ?? [])
      setTotal(res.total ?? 0)
      setPage(res.page ?? p)
    } catch (e) {
      show({ title: "Gagal memuat disbursement", description: userMessage(e), tone: "danger" })
    } finally {
      setLoading(false)
    }
  }, [statusFilter, scopeFilter, search, show])

  useEffect(() => { void load(1) }, [load])

  const openDetail = async (id: string) => {
    setDetailId(id)
    setDetail(null)
    setDetailLoading(true)
    try {
      setDetail(await getDisbursement(id))
    } catch (e) {
      show({ title: "Gagal memuat detail", description: userMessage(e), tone: "danger" })
      setDetailId(null)
    } finally {
      setDetailLoading(false)
    }
  }

  const handleRecheck = async (item: DisbursementListItem) => {
    if (acting) return
    setActing(item.id)
    try {
      const res = await recheckDisbursement(item.id, newIdempotencyKey())
      // BAI-048: PROCESSING = "sedang diproses, verifikasi via recheck" — bukan "disetujui".
      const msg: Record<string, { title: string; tone: "success" | "danger" | "info" }> = {
        CONFIRMED: { title: "Dikonfirmasi DANA — SUCCESS", tone: "success" },
        FAILED: { title: "DANA menyatakan gagal — FAILED", tone: "danger" },
        STILL_PROCESSING: {
          title: "Masih diproses DANA — verifikasi via recheck",
          tone: "info",
        },
        QUERY_FAILED: {
          title: "Query ke DANA gagal — status tetap PROCESSING",
          tone: "info",
        },
      }
      const m = msg[res.outcome] ?? { title: `Hasil: ${res.outcome}`, tone: "info" as const }
      show({
        title: m.title,
        description: `Provider: ${res.providerStatus ?? "—"} • Status kini: ${STATUS_LABEL[res.status] ?? res.status}`,
        tone: m.tone,
      })
      await load(page)
      if (detailId === item.id) await openDetail(item.id)
    } catch (e) {
      show({ title: "Gagal recheck ke DANA", description: userMessage(e), tone: "danger" })
    } finally {
      setActing(null)
    }
  }

  const handleReview = async () => {
    if (!reviewTarget) return
    const reason = reviewReason.trim()
    if (reason.length < 10) {
      setReviewError("Alasan keputusan minimal 10 karakter.")
      return
    }
    if (reviewDecision === "FORCE_SUCCESS" && !/dana|transfer|bukti|ref(erensi)?/i.test(reason)) {
      setReviewError("FORCE_SUCCESS wajib memuat bukti transfer nyata (mis. referensi DANA dashboard).")
      return
    }
    // SEC-501: verifikasi ulang server SEBELUM eksekusi — fail-closed.
    let stepUpToken: string | null
    try {
      stepUpToken = await requestStepUp({
        action: "disbursement.review",
        targetId: reviewTarget.id,
        title: "Verifikasi ulang",
        description: `Review disbursement ${formatIDR(reviewTarget.amountIdr)} (${reviewDecision}) — aksi uang dan bersifat final.`,
      })
    } catch (e) {
      if (e instanceof StepUpNotSupportedError) {
        setReviewError("Backend belum mendukung verifikasi ulang server — aksi diblokir.")
        return
      }
      setReviewError(userMessage(e))
      return
    }
    if (stepUpToken === null) return // user membatalkan verifikasi
    setActing(reviewTarget.id)
    try {
      const res = await reviewDisbursement(reviewTarget.id, reviewDecision, reason, newIdempotencyKey(), { stepUpToken })
      // P1-11: FORCE_SUCCESS via dual control — backend kembalikan
      // {approvalId,status,expiresAt,message}, bukan {decision,idempotencyKey}.
      if (res.approvalId) {
        show({
          title: "Menunggu persetujuan kedua",
          description: res.message ?? `Usulan ${reviewDecision} dibuat — butuh persetujuan admin kedua.`,
          tone: "info",
        })
      } else {
        show({
          title: `Review tercatat: ${res.decision}`,
          description: `${res.idempotencyKey} → ${STATUS_LABEL[res.status] ?? res.status}`,
          tone: reviewDecision === "FORCE_SUCCESS" ? "danger" : "success",
        })
      }
      setReviewTarget(null)
      setReviewReason("")
      setReviewError(null)
      await load(page)
      if (detailId === reviewTarget.id) await openDetail(reviewTarget.id)
    } catch (e) {
      setReviewError(userMessage(e))
    } finally {
      setActing(null)
    }
  }

  const handleRequeue = async () => {
    if (!requeueTarget) return
    // SEC-501: verifikasi ulang server SEBELUM eksekusi — fail-closed.
    let stepUpToken: string | null
    try {
      stepUpToken = await requestStepUp({
        action: "disbursement.requeue",
        targetId: requeueTarget.id,
        title: "Verifikasi ulang",
        description: `Cairkan ulang disbursement ${formatIDR(requeueTarget.amountIdr)} ke PENDING — memicu transfer DANA.`,
      })
    } catch (e) {
      if (e instanceof StepUpNotSupportedError) {
        show({ title: "Backend belum mendukung verifikasi ulang server — aksi diblokir", tone: "danger" })
        return
      }
      show({ title: "Verifikasi ulang gagal", description: userMessage(e), tone: "danger" })
      return
    }
    if (stepUpToken === null) return // user membatalkan verifikasi
    setActing(requeueTarget.id)
    try {
      const res = await requeueDisbursement(requeueTarget.id, newIdempotencyKey(), { stepUpToken })
      show({
        title: "Dicairkan ulang",
        description: `${res.idempotencyKey} → PENDING. Cron akan memproses setelah rekening terverifikasi.`,
        tone: "success",
      })
      setRequeueTarget(null)
      await load(page)
      if (detailId === requeueTarget.id) await openDetail(requeueTarget.id)
    } catch (e) {
      show({ title: "Gagal mencairkan ulang", description: userMessage(e), tone: "danger" })
    } finally {
      setActing(null)
    }
  }

  const applyFilters = () => {
    setSearch(searchInput.trim())
  }

  return (
    <RoleGate href="/finance/disbursements">
      <div className="mb-6">
        <h1 className="text-h2 font-bold text-text-primary">Disbursement DANA</h1>
        <p className="mt-1 text-body text-text-secondary">
          Antrean pencairan dana aktual era tanpa-wallet — escrow order, milestone,
          cashback, referral, rilis sengketa. DANA satu-satunya provider.
        </p>
      </div>

      <Card>
        <CardHeader
          title="Antrean disbursement"
          subtitle={total > 0 ? `${total.toLocaleString("id-ID")} baris` : undefined}
        />
        <CardBody>
          <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Select
              label="Status"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              options={[
                { value: "ALL", label: "Semua status" },
                ...DISBURSEMENT_STATUSES.map((s) => ({ value: s, label: STATUS_LABEL[s] })),
              ]}
            />
            <Select
              label="Scope"
              value={scopeFilter}
              onChange={(e) => setScopeFilter(e.target.value)}
              options={[
                { value: "ALL", label: "Semua scope" },
                ...DISBURSEMENT_SCOPES.map((s) => ({ value: s, label: SCOPE_LABEL[s] })),
              ]}
            />
            <Input
              label="Pencarian"
              placeholder="idempotency key / ref DANA / order ID"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") applyFilters() }}
            />
            <div className="flex items-end">
              <Button variant="primary" fullWidth={false} onClick={applyFilters} loading={loading}>
                Terapkan
              </Button>
            </div>
          </div>

          {loading ? (
            <div className="flex items-center gap-2 py-10 text-body text-text-secondary">
              <Spinner size="sm" /> Memuat disbursement…
            </div>
          ) : rows.length === 0 ? (
            <EmptyState
              title="Tidak ada disbursement"
              description="Tidak ada baris yang cocok dengan filter."
            />
          ) : (
            <>
              <DataTable<DisbursementListItem>
                rowKey={(r) => r.id}
                rows={rows}
                columns={[
                  {
                    key: "idempotencyKey",
                    header: "Kunci",
                    render: (r) => (
                      <div>
                        <p className="font-mono text-caption">{r.idempotencyKey}</p>
                        <p className="text-caption text-text-secondary">{r.orderPublicId ?? "—"}</p>
                      </div>
                    ),
                  },
                  {
                    key: "scope",
                    header: "Scope",
                    render: (r) => SCOPE_LABEL[r.scope] ?? r.scope,
                  },
                  {
                    key: "seller",
                    header: "Penerima",
                    render: (r) => r.sellerName ?? r.sellerId,
                  },
                  {
                    key: "amount",
                    header: "Nominal",
                    align: "right",
                    render: (r) => <span className="font-semibold">{formatIDR(r.amountIdr)}</span>,
                  },
                  {
                    key: "status",
                    header: "Status",
                    render: (r) => <Badge tone={STATUS_TONE[r.status] ?? "neutral"}>{STATUS_LABEL[r.status] ?? r.status}</Badge>,
                  },
                  {
                    key: "danaRef",
                    header: "Ref DANA",
                    render: (r) => (
                      <p className="font-mono text-caption text-text-secondary">
                        {r.danaReferenceNo ?? r.danaPartnerReferenceNo ?? "—"}
                      </p>
                    ),
                  },
                  {
                    key: "updatedAt",
                    header: "Diperbarui",
                    render: (r) => formatDateTimeWIB(r.updatedAt),
                  },
                  {
                    key: "aksi",
                    header: "Aksi",
                    render: (r) => (
                      <div className="flex justify-end gap-2">
                        <Button variant="secondary" size="sm" fullWidth={false} onClick={() => void openDetail(r.id)}>
                          Detail
                        </Button>
                        {r.status === "PROCESSING" ? (
                          <Button
                            variant="secondary"
                            size="sm"
                            fullWidth={false}
                            loading={acting === r.id}
                            onClick={() => void handleRecheck(r)}
                            title="Tanyakan status ke DANA (tanpa mengirim transfer baru)"
                          >
                            Cek ke DANA
                          </Button>
                        ) : null}
                        {r.status === "HELD_NO_BANK" ? (
                          <RoleGate roles={["SUPER_ADMIN", "FINANCE_ADMIN"]}>
                            <Button
                              variant="primary"
                              size="sm"
                              fullWidth={false}
                              onClick={() => setRequeueTarget(r)}
                            >
                              Cairkan ulang
                            </Button>
                          </RoleGate>
                        ) : null}
                        {r.status === "NEEDS_REVIEW" ? (
                          <RoleGate roles={["SUPER_ADMIN"]}>
                            <Button
                              variant="primary"
                              size="sm"
                              fullWidth={false}
                              onClick={() => {
                                setReviewTarget(r)
                                setReviewDecision("RETRY")
                                setReviewReason("")
                                setReviewError(null)
                              }}
                            >
                              Review
                            </Button>
                          </RoleGate>
                        ) : null}
                      </div>
                    ),
                  },
                ]}
              />
              <div className="mt-4">
                <Pagination
                  page={page}
                  total={total}
                  pageSize={PAGE_SIZE}
                  totalPages={Math.max(1, Math.ceil(total / PAGE_SIZE))}
                  onPageChange={(p) => void load(p)}
                />
              </div>
            </>
          )}
        </CardBody>
      </Card>

      {/* Detail */}
      <Dialog
        open={detailId !== null}
        onClose={() => { setDetailId(null); setDetail(null) }}
        title="Detail disbursement"
        description={detail ? `${detail.idempotencyKey}` : undefined}
      >
        {detailLoading || !detail ? (
          <div className="flex items-center gap-2 py-8 text-body text-text-secondary">
            <Spinner size="sm" /> Memuat detail…
          </div>
        ) : (
          <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <dt className="text-caption text-text-secondary">Status</dt>
              <dd><Badge tone={STATUS_TONE[detail.status] ?? "neutral"}>{STATUS_LABEL[detail.status] ?? detail.status}</Badge></dd>
            </div>
            <div>
              <dt className="text-caption text-text-secondary">Scope</dt>
              <dd className="text-body">{SCOPE_LABEL[detail.scope] ?? detail.scope}</dd>
            </div>
            <div>
              <dt className="text-caption text-text-secondary">Nominal</dt>
              <dd className="text-body font-semibold">{formatIDR(detail.amountIdr)} <span className="font-normal text-text-secondary">({detail.amountSen} sen)</span></dd>
            </div>
            <div>
              <dt className="text-caption text-text-secondary">Penerima</dt>
              <dd className="text-body">{detail.sellerName ?? detail.sellerId}</dd>
            </div>
            <div>
              <dt className="text-caption text-text-secondary">Rekening bank</dt>
              <dd className="text-body">
                {detail.bankAccount
                  ? `${detail.bankAccount.bankCode} • ${detail.bankAccount.accountNumberMasked ?? "—"}${detail.bankAccount.accountNameMasked ? ` (${detail.bankAccount.accountNameMasked})` : ""}`
                  : "Belum ada"}
              </dd>
            </div>
            <div>
              <dt className="text-caption text-text-secondary">Referensi DANA</dt>
              <dd className="font-mono text-caption">{detail.danaReferenceNo ?? "—"}</dd>
            </div>
            <div>
              <dt className="text-caption text-text-secondary">Partner ref (idempotency DANA)</dt>
              <dd className="font-mono text-caption">{detail.danaPartnerReferenceNo ?? "—"}</dd>
            </div>
            <div>
              <dt className="text-caption text-text-secondary">Upaya</dt>
              <dd className="text-body">{detail.attemptCount}x</dd>
            </div>
            {detail.heldReason ? (
              <div className="sm:col-span-2">
                <dt className="text-caption text-text-secondary">Alasan ditahan</dt>
                <dd className="text-body">{detail.heldReason}</dd>
              </div>
            ) : null}
            {detail.lastError ? (
              <div className="sm:col-span-2">
                <dt className="text-caption text-text-secondary">Error terakhir</dt>
                <dd className="text-body text-danger-text">{detail.lastError}</dd>
              </div>
            ) : null}
            <div>
              <dt className="text-caption text-text-secondary">Dicairkan</dt>
              <dd className="text-body">{detail.releasedAt ? formatDateTimeWIB(detail.releasedAt) : "—"}</dd>
            </div>
          </dl>
        )}
      </Dialog>

      {/* Review NEEDS_REVIEW — SUPER_ADMIN */}
      <Dialog
        open={reviewTarget !== null}
        onClose={() => { if (!acting) { setReviewTarget(null); setReviewError(null) } }}
        title="Review disbursement"
        description={reviewTarget ? `${reviewTarget.idempotencyKey} (${formatIDR(reviewTarget.amountIdr)})` : undefined}
        footer={
          <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
            <Button variant="ghost" fullWidth={false} disabled={!!acting} onClick={() => setReviewTarget(null)}>
              Batal
            </Button>
            <Button
              variant={reviewDecision === "FORCE_SUCCESS" ? "destructive" : "primary"}
              fullWidth={false}
              loading={!!acting}
              onClick={() => void handleReview()}
            >
              Simpan keputusan
            </Button>
          </div>
        }
      >
        <div className="flex flex-col gap-3">
          <Select
            label="Keputusan"
            value={reviewDecision}
            onChange={(e) => setReviewDecision(e.target.value as DisbursementReviewDecision)}
            options={REVIEW_DECISIONS}
          />
          <TextArea
            label="Alasan keputusan (min 10 karakter)"
            required
            rows={4}
            value={reviewReason}
            onChange={(e) => { setReviewReason(e.target.value); if (reviewError) setReviewError(null) }}
            error={reviewError ?? undefined}
            placeholder="Contoh: dicek di DANA dashboard, transfer ref 20241001XXXX sudah SUCCESS…"
          />
          {reviewDecision === "FORCE_SUCCESS" ? (
            <p className="text-caption text-warning-text">
              FORCE_SUCCESS menandai sukses TANPA konfirmasi provider — hanya sah bila
              transfer sudah diverifikasi di DANA dashboard dan buktinya tercatat di alasan.
            </p>
          ) : null}
        </div>
      </Dialog>

      {/* Requeue HELD_NO_BANK */}
      <ConfirmDialog
        open={requeueTarget !== null}
        onClose={() => { if (!acting) setRequeueTarget(null) }}
        title="Cairkan ulang disbursement?"
        description={
          requeueTarget
            ? `${requeueTarget.idempotencyKey} (${formatIDR(requeueTarget.amountIdr)}) akan dikembalikan ke PENDING. ` +
              `Cron memprosesnya via settle() yang fail-closed: inquiry bank + verifikasi nama tetap dijalankan. ` +
              `Pastikan seller sudah mendaftarkan rekening terverifikasi.`
            : undefined
        }
        confirmLabel="Ya, cairkan ulang"
        cancelLabel="Batal"
        loading={!!acting}
        onConfirm={() => void handleRequeue()}
      />

      <p className="mt-4 text-caption text-text-secondary">
        Role Anda: {role ?? "—"}. Review NEEDS_REVIEW hanya untuk SUPER_ADMIN;
        requeue HELD_NO_BANK untuk SUPER_ADMIN / FINANCE_ADMIN (ditegakkan backend).
      </p>

      {stepUpDialog}
    </RoleGate>
  )
}
