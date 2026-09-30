"use client"

/**
 * Admin — Detail KYC: tinjau pengajuan + dokumen + aksi approve/reject/revoke.
 *
 * - Dokumen: tombol "Minta URL dokumen" → dialog password admin →
 *   getKycDocumentUrls() → link "Buka di tab baru" (URL berlaku 5 menit,
 *   tampil sebagai link, bukan auto-open).
 * - Setujui: dialog dengan catatan opsional.
 * - Tolak: dialog dengan alasan wajib min 10 karakter.
 * - Cabut persetujuan: dialog dengan alasan wajib min 10 karakter
 *   (hanya bila sudah disetujui).
 *
 * Port dari frontend/app/admin/(panel)/kyc/[id].tsx → web desktop.
 */

import { useCallback, useEffect, useState, type ReactNode } from "react"
import { useParams } from "next/navigation"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardBody, CardHeader } from "@/components/ui/card"
import { Dialog } from "@/components/ui/dialog"
import { EmptyState } from "@/components/ui/empty-state"
import { Input, TextArea } from "@/components/ui/input"
import { Spinner } from "@/components/ui/spinner"
import { useToast } from "@/components/ui/toast"
import { RoleGate } from "@/components/admin/role-gate"
import { useAuth } from "@/lib/auth-context"
import {
  approveKyc,
  assignKycReviewer,
  getKycDetail,
  getKycDocumentUrls,
  listKycReviewers,
  rejectKyc,
  releaseKycReviewer,
  requestKycDocuments,
  resumeKycSla,
  revokeKyc,
  type KycDetail,
  type KycDocumentUrls,
  type KycReviewer,
} from "@/lib/api/admin/kyc"
import { userMessage } from "@/lib/api/response"
import { formatDateTimeWIB } from "@/lib/format"

import { KYC_STATUS_LABEL, KYC_STATUS_TONE } from "../maps"

function formatDuration(ms: number | null | undefined): string {
  if (ms == null || Number.isNaN(ms)) return "—"
  const abs = Math.abs(ms)
  const hours = Math.floor(abs / 3_600_000)
  if (hours < 1) return `${Math.max(0, Math.floor(abs / 60_000))} mnt`
  const days = Math.floor(hours / 24)
  if (days < 1) return `${hours} jam`
  return `${days} hari ${hours % 24} jam`
}

function SlaStatusBadge({ detail }: { detail: KycDetail }) {
  const sla = detail.sla
  if (!sla) return <Badge tone="neutral">—</Badge>
  if (sla.paused) return <Badge tone="neutral">Dijeda</Badge>
  if (sla.status === "BREACHED") return <Badge tone="danger">Lewat SLA</Badge>
  if (sla.status === "MENDEKATI") return <Badge tone="warning">Mendekati SLA</Badge>
  return <Badge tone="success">Aman</Badge>
}

function KeyValue({ label, value, mono = false }: { label: string; value: ReactNode; mono?: boolean }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-2 border-b border-border py-2.5 last:border-b-0">
      <dt className="shrink-0 text-caption font-semibold text-text-secondary">{label}</dt>
      <dd
        className={
          mono
            ? "min-w-0 flex-1 break-all text-right font-mono text-[13px] text-text-primary"
            : "min-w-0 flex-1 text-right text-body text-text-primary"
        }
      >
        {value}
      </dd>
    </div>
  )
}

export default function KycDetailPage() {
  const { id } = useParams<{ id: string }>()
  const kycId = Array.isArray(id) ? id[0] : (id ?? "")
  const toast = useToast()
  const { role } = useAuth()
  // ADM-003: revoke KYC hanya SUPER_ADMIN di backend.
  const isSuperAdmin = role === "SUPER_ADMIN"

  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [detail, setDetail] = useState<KycDetail | null>(null)

  const [docOpen, setDocOpen] = useState(false)
  const [password, setPassword] = useState("")
  const [passwordError, setPasswordError] = useState<string | null>(null)
  const [docLoading, setDocLoading] = useState(false)
  const [docUrls, setDocUrls] = useState<KycDocumentUrls | null>(null)

  const [approveOpen, setApproveOpen] = useState(false)
  const [approveNotes, setApproveNotes] = useState("")
  const [rejectOpen, setRejectOpen] = useState(false)
  const [rejectReason, setRejectReason] = useState("")
  const [rejectNotes, setRejectNotes] = useState("")
  const [revokeOpen, setRevokeOpen] = useState(false)
  // BAI-062: alasan cabut wajib (min 10, max 500 — selaras RevokeKycDto).
  const [revokeReason, setRevokeReason] = useState("")
  const [acting, setActing] = useState<string | null>(null)

  // GAP-E: penugasan reviewer + jeda/lanjut SLA.
  const [assignOpen, setAssignOpen] = useState(false)
  const [reviewers, setReviewers] = useState<KycReviewer[]>([])
  const [reviewersLoading, setReviewersLoading] = useState(false)
  const [assignTarget, setAssignTarget] = useState("")
  const [requestDocsOpen, setRequestDocsOpen] = useState(false)
  const [requestDocsMessage, setRequestDocsMessage] = useState("")
  const [requestDocsNotes, setRequestDocsNotes] = useState("")

  const load = useCallback(
    async (mode: "initial" | "refresh" = "initial") => {
      if (mode === "initial") setLoading(true)
      else setRefreshing(true)
      setError(null)
      try {
        setDetail(await getKycDetail(kycId))
      } catch (e) {
        setError(userMessage(e))
      } finally {
        setLoading(false)
        setRefreshing(false)
      }
    },
    [kycId],
  )

  useEffect(() => {
    if (kycId) void load("initial")
  }, [kycId, load])

  const fail = (title: string, e: unknown) => {
    const msg = userMessage(e)
    toast.show({ title, description: msg, tone: "danger" })
  }

  const handleGetDocs = async () => {
    const pwd = password.trim()
    if (!pwd) {
      setPasswordError("Password admin wajib diisi.")
      return
    }
    setDocLoading(true)
    setPasswordError(null)
    try {
      const urls = await getKycDocumentUrls(kycId, pwd)
      setDocUrls(urls)
      setDocOpen(false)
      setPassword("")
      toast.show({
        title: "Dokumen siap dibuka",
        description: "URL berlaku 5 menit.",
        tone: "info",
      })
    } catch (e) {
      setPasswordError(userMessage(e))
    } finally {
      setDocLoading(false)
    }
  }

  const handleApprove = async () => {
    setActing("approve")
    try {
      await approveKyc(kycId, approveNotes.trim() || undefined)
      setApproveOpen(false)
      setApproveNotes("")
      await load("refresh")
      toast.show({ title: "KYC disetujui", tone: "success" })
    } catch (e) {
      fail("Gagal menyetujui KYC", e)
    } finally {
      setActing(null)
    }
  }

  const handleReject = async () => {
    if (rejectReason.trim().length < 10) return
    setActing("reject")
    try {
      await rejectKyc(kycId, rejectReason.trim(), rejectNotes.trim() || undefined)
      setRejectOpen(false)
      setRejectReason("")
      setRejectNotes("")
      await load("refresh")
      toast.show({ title: "KYC ditolak", tone: "success" })
    } catch (e) {
      fail("Gagal menolak KYC", e)
    } finally {
      setActing(null)
    }
  }

  const handleRevoke = async () => {
    const reason = revokeReason.trim()
    if (reason.length < 10) return
    setActing("revoke")
    try {
      await revokeKyc(kycId, reason)
      setRevokeOpen(false)
      setRevokeReason("")
      await load("refresh")
      toast.show({ title: "Persetujuan KYC dicabut", tone: "success" })
    } catch (e) {
      fail("Gagal mencabut KYC", e)
    } finally {
      setActing(null)
    }
  }

  // --- GAP-E: penugasan reviewer ---
  // ADM-004: pakai endpoint /v1/admin/kyc/reviewers yang boleh dibaca
  // KYC_ADMIN (sebelumnya listAdmins → 403 untuk KYC_ADMIN).
  const openAssign = async () => {
    setAssignOpen(true)
    setAssignTarget("")
    setReviewersLoading(true)
    try {
      const res = await listKycReviewers()
      setReviewers(res.data ?? [])
    } catch (e) {
      fail("Gagal memuat daftar reviewer", e)
    } finally {
      setReviewersLoading(false)
    }
  }

  const handleAssign = async () => {
    if (!assignTarget) return
    setActing("assign")
    try {
      await assignKycReviewer(kycId, assignTarget)
      setAssignOpen(false)
      setAssignTarget("")
      await load("refresh")
      toast.show({ title: "Reviewer ditugaskan", tone: "success" })
    } catch (e) {
      fail("Gagal menugaskan reviewer", e)
    } finally {
      setActing(null)
    }
  }

  const handleRelease = async () => {
    setActing("release")
    try {
      await releaseKycReviewer(kycId)
      await load("refresh")
      toast.show({ title: "Penugasan reviewer dilepas", tone: "success" })
    } catch (e) {
      fail("Gagal melepas penugasan", e)
    } finally {
      setActing(null)
    }
  }

  // --- GAP-E: minta dokumen tambahan (SLA dijeda) / lanjutkan SLA ---
  const handleRequestDocs = async () => {
    if (requestDocsMessage.trim().length < 10) return
    setActing("request-docs")
    try {
      await requestKycDocuments(kycId, requestDocsMessage.trim(), requestDocsNotes.trim() || undefined)
      setRequestDocsOpen(false)
      setRequestDocsMessage("")
      setRequestDocsNotes("")
      await load("refresh")
      toast.show({
        title: "Permintaan dokumen terkirim",
        description: "SLA tinjauan dijeda sampai pengguna melengkapi dokumen.",
        tone: "success",
      })
    } catch (e) {
      fail("Gagal meminta dokumen", e)
    } finally {
      setActing(null)
    }
  }

  const handleResumeSla = async () => {
    setActing("resume-sla")
    try {
      await resumeKycSla(kycId)
      await load("refresh")
      toast.show({ title: "SLA dilanjutkan", tone: "success" })
    } catch (e) {
      fail("Gagal melanjutkan SLA", e)
    } finally {
      setActing(null)
    }
  }

  const status = detail?.status ?? ""
  const isPending = status === "PENDING"
  const isApproved = status === "APPROVED"

  return (
    <RoleGate href="/kyc">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-h2 font-bold text-text-primary">Detail KYC</h1>
          <p className="mt-1 text-body text-text-secondary">
            {detail ? `ID: ${detail.kycId}` : "Tinjau pengajuan verifikasi identitas."}
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

      {loading ? (
        <div className="flex min-h-[40vh] items-center justify-center gap-2">
          <Spinner size="md" />
          <p className="text-body text-text-secondary">Memuat detail KYC…</p>
        </div>
      ) : error || !detail ? (
        <Card>
          <EmptyState
            title="Gagal memuat detail KYC"
            description={error ?? "Data tidak ditemukan."}
            action={
              <Button variant="secondary" fullWidth={false} onClick={() => load("initial")}>
                Coba lagi
              </Button>
            }
          />
        </Card>
      ) : (
        <div className="grid gap-4 xl:grid-cols-2">
          <Card padded={false}>
            <CardHeader
              title="Pengajuan"
              action={
                <Badge tone={KYC_STATUS_TONE[status] ?? "neutral"}>
                  {KYC_STATUS_LABEL[status] ?? status}
                </Badge>
              }
            />
            <CardBody>
              <dl>
                <KeyValue label="Nama" value={detail.user?.fullName ?? "—"} />
                <KeyValue label="Email" value={detail.user?.email ?? "—"} />
                <KeyValue label="ID Pengguna" value={detail.userId} mono />
                {/* BAI-072: jenis dokumen (KTP|PASSPORT) dari getKycDetail. */}
                <KeyValue label="Jenis dokumen" value={detail.documentType ?? "—"} />
                <KeyValue label="Percobaan ke" value={String(detail.attemptNumber ?? "—")} />
                <KeyValue label="Diajukan" value={formatDateTimeWIB(detail.createdAt)} />
                <KeyValue
                  label="Ditinjau"
                  value={
                    detail.reviewedAt
                      ? `${formatDateTimeWIB(detail.reviewedAt)}${
                          detail.reviewer ? ` oleh ${detail.reviewer.fullName}` : ""
                        }`
                      : "—"
                  }
                />
                {detail.rejectionReason ? (
                  <KeyValue label="Alasan penolakan" value={detail.rejectionReason} />
                ) : null}
                {detail.adminNotes ? (
                  <KeyValue label="Catatan admin" value={detail.adminNotes} />
                ) : null}
                {detail.submittedIp ? (
                  <KeyValue label="IP pengajuan" value={detail.submittedIp} mono />
                ) : null}
              </dl>
            </CardBody>
          </Card>

          <Card padded={false}>
            <CardHeader title="Dokumen" />
            <CardBody>
              <p className="mb-3 text-caption text-text-secondary">
                Dokumen memerlukan password admin dan hanya berlaku 5 menit.
              </p>
              {docUrls ? (
                <div className="flex flex-col gap-2">
                  {docUrls.ktpUrl ? (
                    <a
                      href={docUrls.ktpUrl}
                      target="_blank"
                      rel="noopener"
                      className="font-semibold text-info-text hover:underline"
                    >
                      KTP — Buka di tab baru
                    </a>
                  ) : null}
                  {docUrls.selfieUrl ? (
                    <a
                      href={docUrls.selfieUrl}
                      target="_blank"
                      rel="noopener"
                      className="font-semibold text-info-text hover:underline"
                    >
                      Selfie — Buka di tab baru
                    </a>
                  ) : null}
                  {/* BAI-063: video liveness + jenis dokumen dari document-urls. */}
                  {docUrls.documentType ? (
                    <p className="text-caption text-text-secondary">
                      Jenis dokumen: {docUrls.documentType}
                    </p>
                  ) : null}
                  {docUrls.livenessUrl ? (
                    <a
                      href={docUrls.livenessUrl}
                      target="_blank"
                      rel="noopener"
                      className="font-semibold text-info-text hover:underline"
                    >
                      Video liveness — Buka di tab baru
                    </a>
                  ) : null}
                  {!docUrls.ktpUrl && !docUrls.selfieUrl && !docUrls.livenessUrl ? (
                    <p className="text-body text-text-secondary">Tidak ada dokumen tersedia.</p>
                  ) : null}
                  {docUrls.partialErrors?.length ? (
                    <p className="text-caption text-danger-text">
                      Sebagian dokumen gagal dimuat: {docUrls.partialErrors.join("; ")}
                    </p>
                  ) : null}
                </div>
              ) : (
                <Button variant="secondary" fullWidth={false} onClick={() => setDocOpen(true)}>
                  Minta URL dokumen
                </Button>
              )}
            </CardBody>
          </Card>

          <Card padded={false}>
            <CardHeader title="SLA tinjauan" action={<SlaStatusBadge detail={detail} />} />
            <CardBody>
              <dl>
                <KeyValue
                  label="Batas SLA"
                  value={
                    detail.sla
                      ? `${detail.sla.slaHours} jam ${detail.sla.useBusinessHours ? "jam kerja (Senin–Jumat 09:00–17:00 WIB)" : "kalender"}`
                      : "—"
                  }
                />
                <KeyValue label="Mulai berjalan" value={detail.sla?.startedAt ? formatDateTimeWIB(detail.sla.startedAt) : "—"} />
                <KeyValue label="Waktu berjalan" value={formatDuration(detail.sla?.elapsedMs)} />
                <KeyValue
                  label="Sisa waktu"
                  value={
                    detail.sla?.paused
                      ? "Dijeda — tidak berkurang"
                      : formatDuration(detail.sla?.remainingMs)
                  }
                />
                {detail.sla?.breachedAt ? (
                  <KeyValue label="Dinyatakan lewat" value={formatDateTimeWIB(detail.sla.breachedAt)} />
                ) : null}
              </dl>
              {detail.sla?.paused && isPending ? (
                <Button
                  variant="secondary"
                  fullWidth={false}
                  loading={acting === "resume-sla"}
                  onClick={handleResumeSla}
                  className="mt-3"
                >
                  Lanjutkan SLA
                </Button>
              ) : null}
            </CardBody>
          </Card>

          <Card padded={false}>
            <CardHeader title="Reviewer" />
            <CardBody>
              <dl>
                <KeyValue
                  label="Ditugaskan"
                  value={detail.assignedReviewer?.fullName ?? "Belum ditugaskan"}
                />
              </dl>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button variant="secondary" fullWidth={false} disabled={!isPending} onClick={openAssign}>
                  Tugaskan reviewer
                </Button>
                {detail.assignedReviewer ? (
                  <Button
                    variant="ghost"
                    fullWidth={false}
                    loading={acting === "release"}
                    onClick={handleRelease}
                  >
                    Lepas penugasan
                  </Button>
                ) : null}
              </div>
              <p className="mt-2 text-caption text-text-secondary">
                Penugasan tidak mengubah status pengajuan dan tercatat di audit log.
              </p>
            </CardBody>
          </Card>

          <Card padded={false} className="xl:col-span-2">
            <CardHeader title="Aksi" />
            <CardBody>
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="primary"
                  fullWidth={false}
                  disabled={!isPending}
                  onClick={() => setApproveOpen(true)}
                >
                  Setujui
                </Button>
                <Button
                  variant="destructive"
                  fullWidth={false}
                  disabled={!isPending}
                  onClick={() => setRejectOpen(true)}
                >
                  Tolak
                </Button>
                {/* ADM-003: revoke KYC = SUPER_ADMIN-only di backend — sembunyikan dari KYC_ADMIN */}
                {isSuperAdmin ? (
                  <Button
                    variant="secondary"
                    fullWidth={false}
                    disabled={!isApproved}
                    onClick={() => setRevokeOpen(true)}
                  >
                    Cabut persetujuan
                  </Button>
                ) : null}
                <Button
                  variant="secondary"
                  fullWidth={false}
                  disabled={!isPending || !!detail.sla?.paused}
                  onClick={() => setRequestDocsOpen(true)}
                >
                  Minta dokumen tambahan
                </Button>
              </div>
              {detail.sla?.paused ? (
                <p className="mt-3 text-caption text-text-secondary">
                  SLA sedang dijeda karena menunggu dokumen tambahan dari pengguna. Dokumen
                  pelengkap dari pengguna akan melanjutkan SLA secara otomatis.
                </p>
              ) : null}
              {!isPending && !isApproved ? (
                <p className="mt-3 text-caption text-text-secondary">
                  Pengajuan sudah final (status {KYC_STATUS_LABEL[status] ?? status}) — tidak ada
                  aksi yang tersedia.
                </p>
              ) : null}
            </CardBody>
          </Card>

          <Card padded={false} className="xl:col-span-2">
            <CardHeader title="Riwayat penugasan & catatan reviewer" />
            <CardBody>
              {(!detail.assignmentHistory || detail.assignmentHistory.length === 0) &&
              (!detail.reviewerNotes || detail.reviewerNotes.length === 0) ? (
                <p className="text-body text-text-secondary">Belum ada riwayat penugasan atau catatan reviewer.</p>
              ) : (
                <div className="space-y-4">
                  {detail.assignmentHistory && detail.assignmentHistory.length > 0 ? (
                    <div>
                      <p className="mb-2 text-body font-medium">Penugasan</p>
                      <ul className="space-y-2">
                        {detail.assignmentHistory.map((h) => (
                          <li key={h.id} className="text-caption">
                            <span className="font-medium">{h.admin.fullName ?? h.admin.adminId}</span>
                            {" "}ditugaskan oleh {h.assignedBy.fullName ?? h.assignedBy.adminId}
                            {" "}pada {formatDateTimeWIB(h.assignedAt)}
                            {h.releasedAt ? ` — dilepas ${formatDateTimeWIB(h.releasedAt)}` : ""}
                            {h.active ? <Badge tone="info" dot={false} className="ml-2">aktif</Badge> : null}
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                  {detail.reviewerNotes && detail.reviewerNotes.length > 0 ? (
                    <div>
                      <p className="mb-2 text-body font-medium">Catatan reviewer (NIK/nomor telepon di-mask)</p>
                      <ul className="space-y-2">
                        {detail.reviewerNotes.map((n) => (
                          <li key={n.id} className="text-caption">
                            <span className="font-medium">{n.action}</span>
                            {n.admin ? ` oleh ${n.admin.fullName ?? n.admin.adminId}` : ""}
                            {" "}— {formatDateTimeWIB(n.createdAt)}
                            <p className="mt-0.5 text-body text-text-secondary">{n.description}</p>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                </div>
              )}
            </CardBody>
          </Card>
        </div>
      )}

      {/* Dialog password dokumen */}
      <Dialog
        open={docOpen}
        // ADM-010: bersihkan password mentah dari state saat dialog ditutup.
        onClose={() => {
          setDocOpen(false)
          setPassword("")
          setPasswordError(null)
        }}
        title="Buka dokumen KYC"
        description="Masukkan password admin untuk membuka dokumen. URL hanya berlaku 5 menit."
        footer={
          <div className="flex flex-col gap-2">
            <Button variant="primary" loading={docLoading} onClick={handleGetDocs}>
              Buka dokumen
            </Button>
            <Button
              variant="ghost"
              disabled={docLoading}
              onClick={() => {
                setDocOpen(false)
                setPassword("")
                setPasswordError(null)
              }}
            >
              Batal
            </Button>
          </div>
        }
      >
        <Input
          label="Password admin"
          type="password"
          value={password}
          onChange={(e) => {
            setPassword(e.target.value)
            if (passwordError) setPasswordError(null)
          }}
          error={passwordError ?? undefined}
          placeholder="••••••••"
        />
      </Dialog>

      {/* Setujui: catatan opsional */}
      <Dialog
        open={approveOpen}
        onClose={() => setApproveOpen(false)}
        title="Setujui KYC"
        description="Pengajuan akan disetujui dan pengguna mendapat akses penuh."
        footer={
          <div className="flex flex-col gap-2">
            <Button
              variant="primary"
              loading={acting === "approve"}
              onClick={handleApprove}
            >
              Setujui
            </Button>
            <Button
              variant="ghost"
              disabled={acting === "approve"}
              onClick={() => setApproveOpen(false)}
            >
              Batal
            </Button>
          </div>
        }
      >
        <TextArea
          label="Catatan internal (opsional)"
          rows={3}
          value={approveNotes}
          onChange={(e) => setApproveNotes(e.target.value)}
          placeholder="Catatan untuk tim internal…"
        />
      </Dialog>

      {/* Tolak: alasan wajib min 10 karakter */}
      <Dialog
        open={rejectOpen}
        onClose={() => setRejectOpen(false)}
        title="Tolak KYC"
        description="Berikan alasan penolakan yang jelas untuk pengguna."
        footer={
          <div className="flex flex-col gap-2">
            <Button
              variant="destructive"
              loading={acting === "reject"}
              disabled={rejectReason.trim().length < 10}
              onClick={handleReject}
            >
              Tolak pengajuan
            </Button>
            <Button
              variant="ghost"
              disabled={acting === "reject"}
              onClick={() => setRejectOpen(false)}
            >
              Batal
            </Button>
          </div>
        }
      >
        <div className="space-y-4">
          <TextArea
            label="Alasan penolakan"
            required
            rows={4}
            value={rejectReason}
            onChange={(e) => setRejectReason(e.target.value)}
            placeholder="Minimal 10 karakter…"
            hint={`${rejectReason.trim().length} / 10 karakter minimum`}
          />
          <TextArea
            label="Catatan internal (opsional)"
            rows={3}
            value={rejectNotes}
            onChange={(e) => setRejectNotes(e.target.value)}
            placeholder="Catatan untuk tim internal…"
          />
        </div>
      </Dialog>

      {/* Cabut persetujuan: alasan wajib min 10 karakter (BAI-062) */}
      <Dialog
        open={revokeOpen}
        onClose={() => setRevokeOpen(false)}
        title="Cabut persetujuan KYC"
        description="Persetujuan yang sudah diberikan akan dicabut dan pengguna kehilangan akses verifikasi. Tindakan ini tercatat di audit log."
        footer={
          <div className="flex flex-col gap-2">
            <Button
              variant="destructive"
              loading={acting === "revoke"}
              disabled={revokeReason.trim().length < 10}
              onClick={handleRevoke}
            >
              Cabut persetujuan
            </Button>
            <Button
              variant="ghost"
              disabled={acting === "revoke"}
              onClick={() => setRevokeOpen(false)}
            >
              Batal
            </Button>
          </div>
        }
      >
        <TextArea
          label="Alasan pencabutan"
          required
          rows={4}
          value={revokeReason}
          onChange={(e) => setRevokeReason(e.target.value)}
          placeholder="Minimal 10 karakter…"
          maxLength={500}
          hint={`${revokeReason.trim().length} / 10 karakter minimum (maks 500)`}
        />
      </Dialog>

      {/* GAP-E: tugaskan reviewer */}
      <Dialog
        open={assignOpen}
        onClose={() => setAssignOpen(false)}
        title="Tugaskan reviewer"
        description="Reviewer yang ditugaskan bertanggung jawab meninjau pengajuan ini. Penugasan tercatat di audit log."
        footer={
          <div className="flex flex-col gap-2">
            <Button variant="primary" loading={acting === "assign"} disabled={!assignTarget} onClick={handleAssign}>
              Tugaskan
            </Button>
            <Button variant="ghost" disabled={acting === "assign"} onClick={() => setAssignOpen(false)}>
              Batal
            </Button>
          </div>
        }
      >
        {reviewersLoading ? (
          <div className="flex justify-center py-6"><Spinner size="md" /></div>
        ) : reviewers.length === 0 ? (
          <p className="text-body text-text-secondary">Tidak ada admin KYC aktif yang bisa ditugaskan.</p>
        ) : (
          <div className="space-y-2">
            {reviewers.map((r) => (
              <label key={r.id} className="flex cursor-pointer items-center gap-3 rounded-md border border-border p-3 hover:bg-surface-elevated">
                <input
                  type="radio"
                  name="kyc-reviewer"
                  checked={assignTarget === (r.adminId ?? r.id)}
                  onChange={() => setAssignTarget(r.adminId ?? r.id)}
                />
                <span>
                  <span className="block text-body font-medium">{r.fullName}</span>
                  <span className="block text-caption text-text-secondary">
                    {r.adminId ?? r.id} · {r.role === "SUPER_ADMIN" ? "Super Admin" : "Admin KYC"}
                  </span>
                </span>
              </label>
            ))}
          </div>
        )}
      </Dialog>

      {/* GAP-E: minta dokumen tambahan — SLA dijeda */}
      <Dialog
        open={requestDocsOpen}
        onClose={() => setRequestDocsOpen(false)}
        title="Minta dokumen tambahan"
        description="Pengguna menerima pemberitahuan berisi pesan di bawah. SLA tinjauan DIJEDA sampai pengguna melengkapi dokumen."
        footer={
          <div className="flex flex-col gap-2">
            <Button
              variant="primary"
              loading={acting === "request-docs"}
              disabled={requestDocsMessage.trim().length < 10}
              onClick={handleRequestDocs}
            >
              Kirim permintaan
            </Button>
            <Button variant="ghost" disabled={acting === "request-docs"} onClick={() => setRequestDocsOpen(false)}>
              Batal
            </Button>
          </div>
        }
      >
        <div className="space-y-4">
          <TextArea
            label="Pesan untuk pengguna"
            required
            rows={4}
            value={requestDocsMessage}
            onChange={(e) => setRequestDocsMessage(e.target.value)}
            placeholder="Contoh: Foto KTP buram dan tidak terbaca. Mohon kirim ulang foto KTP yang jelas melalui menu verifikasi."
            hint={`${requestDocsMessage.trim().length} / 10 karakter minimum`}
          />
          <TextArea
            label="Catatan internal (opsional)"
            rows={3}
            value={requestDocsNotes}
            onChange={(e) => setRequestDocsNotes(e.target.value)}
            placeholder="Catatan untuk tim internal…"
          />
        </div>
      </Dialog>
    </RoleGate>
  )
}
