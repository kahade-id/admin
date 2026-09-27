"use client"

/**
 * Admin — Detail verifikasi bisnis: tinjau pengajuan + dokumen + aksi.
 *
 * - Preview dokumen ringkas minim-PII: NPWP tampil MASKED tanpa re-auth;
 *   NPWP mentah + signed URL hanya lewat dialog password admin.
 * - Setujui: dialog dengan catatan opsional.
 * - Tolak: dialog dengan alasan wajib min 10 karakter.
 * - Cabut persetujuan: dropdown alasan standar + catatan internal terpisah
 *   (hanya SUPER_ADMIN).
 * - Penugasan reviewer (tercatat di audit) + riwayat perubahan.
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
import { Select } from "@/components/admin/select"
import { useAuth } from "@/lib/auth-context"
import {
  approveBusiness,
  assignBusinessReviewer,
  getBusinessDetail,
  getBusinessDocumentUrls,
  getBusinessHistory,
  rejectBusiness,
  revokeBusiness,
  type BusinessHistoryEntry,
  type BusinessVerificationItem,
} from "@/lib/api/admin/business"
import { listAdmins, type AdminUserItem } from "@/lib/api/admin/management"
import { userMessage } from "@/lib/api/response"
import { formatDateTimeWIB } from "@/lib/format"
import { LEGAL_ENTITY_LABEL } from "@/lib/business/masking"
import { LEGALITAS_STATUS_LABEL, legalitasStatus, legalitasValidUntil } from "@/lib/business/legalitas"

import { BUSINESS_REVOKE_CUSTOM, BUSINESS_REVOKE_REASONS, BUSINESS_STATUS_LABEL, BUSINESS_STATUS_TONE } from "../maps"

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

export default function BusinessDetailPage() {
  const { id } = useParams<{ id: string }>()
  const verificationId = Array.isArray(id) ? id[0] : (id ?? "")
  const toast = useToast()
  const { role } = useAuth()
  const isSuperAdmin = role === "SUPER_ADMIN"

  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [detail, setDetail] = useState<BusinessVerificationItem | null>(null)

  const [docOpen, setDocOpen] = useState(false)
  const [password, setPassword] = useState("")
  const [passwordError, setPasswordError] = useState<string | null>(null)
  const [docLoading, setDocLoading] = useState(false)
  const [docUrls, setDocUrls] = useState<string[]>([])
  const [docNpwp, setDocNpwp] = useState<string | null>(null)
  const [docPartialErrors, setDocPartialErrors] = useState<string[]>([])

  const [approveOpen, setApproveOpen] = useState(false)
  const [approveNotes, setApproveNotes] = useState("")
  const [rejectOpen, setRejectOpen] = useState(false)
  const [rejectReason, setRejectReason] = useState("")
  const [rejectNotes, setRejectNotes] = useState("")
  const [revokeOpen, setRevokeOpen] = useState(false)
  const [revokeReason, setRevokeReason] = useState(BUSINESS_REVOKE_REASONS[0])
  const [revokeCustom, setRevokeCustom] = useState("")
  const [revokeNotes, setRevokeNotes] = useState("")
  const [acting, setActing] = useState<string | null>(null)

  const [admins, setAdmins] = useState<AdminUserItem[]>([])
  const [assigneeId, setAssigneeId] = useState("")
  const [assigning, setAssigning] = useState(false)

  const [history, setHistory] = useState<BusinessHistoryEntry[]>([])

  const load = useCallback(
    async (mode: "initial" | "refresh" = "initial") => {
      if (!verificationId) return
      if (mode === "initial") setLoading(true)
      else setRefreshing(true)
      setError(null)
      try {
        const [d, h] = await Promise.all([
          getBusinessDetail(verificationId),
          getBusinessHistory(verificationId).catch(() => [] as BusinessHistoryEntry[]),
        ])
        setDetail(d)
        setHistory(h)
      } catch (e) {
        setError(userMessage(e))
      } finally {
        setLoading(false)
        setRefreshing(false)
      }
    },
    [verificationId],
  )

  useEffect(() => {
    if (verificationId) void load("initial")
  }, [verificationId, load])

  useEffect(() => {
    // Daftar admin aktif untuk dropdown penugasan reviewer.
    listAdmins({ limit: 100 })
      .then((res) => setAdmins((res.data ?? []).filter((a) => a.isActive)))
      .catch(() => setAdmins([]))
  }, [])

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
      const res = await getBusinessDocumentUrls(verificationId, pwd)
      setDocUrls(res.documentUrls ?? [])
      setDocNpwp(res.npwpNumber ?? null)
      setDocPartialErrors(res.partialErrors ?? [])
      setDocOpen(false)
      setPassword("")
      toast.show({
        title: "Dokumen siap dibuka",
        description: "URL hanya berlaku sementara.",
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
      await approveBusiness(verificationId, approveNotes.trim() || undefined)
      setApproveOpen(false)
      setApproveNotes("")
      await load("refresh")
      toast.show({ title: "Verifikasi bisnis disetujui", tone: "success" })
    } catch (e) {
      fail("Gagal menyetujui verifikasi", e)
    } finally {
      setActing(null)
    }
  }

  const handleReject = async () => {
    if (rejectReason.trim().length < 10) return
    setActing("reject")
    try {
      await rejectBusiness(verificationId, rejectReason.trim(), rejectNotes.trim() || undefined)
      setRejectOpen(false)
      setRejectReason("")
      setRejectNotes("")
      await load("refresh")
      toast.show({ title: "Verifikasi bisnis ditolak", tone: "success" })
    } catch (e) {
      fail("Gagal menolak verifikasi", e)
    } finally {
      setActing(null)
    }
  }

  const effectiveRevokeReason =
    revokeReason === BUSINESS_REVOKE_CUSTOM ? revokeCustom.trim() : revokeReason

  const handleRevoke = async () => {
    if (effectiveRevokeReason.length < 10) return
    setActing("revoke")
    try {
      await revokeBusiness(
        verificationId,
        effectiveRevokeReason,
        revokeNotes.trim() || undefined,
      )
      setRevokeOpen(false)
      setRevokeCustom("")
      setRevokeNotes("")
      await load("refresh")
      toast.show({ title: "Persetujuan dicabut", tone: "success" })
    } catch (e) {
      fail("Gagal mencabut persetujuan", e)
    } finally {
      setActing(null)
    }
  }

  const handleAssign = async () => {
    if (!assigneeId) return
    setAssigning(true)
    try {
      await assignBusinessReviewer(verificationId, assigneeId)
      setAssigneeId("")
      await load("refresh")
      toast.show({ title: "Reviewer ditugaskan", tone: "success" })
    } catch (e) {
      fail("Gagal menugaskan reviewer", e)
    } finally {
      setAssigning(false)
    }
  }

  const status = detail?.status ?? ""
  const isPending = status === "PENDING"
  const isApproved = status === "APPROVED"

  return (
    <RoleGate href="/business">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-h2 font-bold text-text-primary">Detail Verifikasi Bisnis</h1>
          <p className="mt-1 text-body text-text-secondary">
            {detail ? `ID: ${detail.verificationId ?? detail.id}` : "Tinjau pengajuan verifikasi."}
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
          <p className="text-body text-text-secondary">Memuat detail verifikasi bisnis…</p>
        </div>
      ) : error || !detail ? (
        <Card>
          <EmptyState
            title="Gagal memuat detail verifikasi"
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
                <Badge tone={BUSINESS_STATUS_TONE[status] ?? "neutral"}>
                  {BUSINESS_STATUS_LABEL[status] ?? status}
                </Badge>
              }
            />
            <CardBody>
              <dl>
                <KeyValue label="Nama badan usaha" value={detail.businessName ?? "—"} />
                <KeyValue
                  label="Jenis badan hukum"
                  value={LEGAL_ENTITY_LABEL[detail.legalEntityType ?? ""] ?? detail.legalEntityType ?? "—"}
                />
                <KeyValue
                  label="Pemohon"
                  value={detail.user?.fullName ?? detail.user?.email ?? "—"}
                />
                <KeyValue label="ID Pengguna" value={detail.userId} mono />
                <KeyValue label="Diajukan" value={formatDateTimeWIB(detail.createdAt)} />
                <KeyValue
                  label="Ditinjau"
                  value={detail.reviewedAt ? formatDateTimeWIB(detail.reviewedAt) : "—"}
                />
                {detail.reviewer ? (
                  <KeyValue
                    label="Diputus oleh"
                    value={`${detail.reviewer.fullName} (${detail.reviewer.adminId})`}
                  />
                ) : null}
                {detail.rejectionReason ? (
                  <KeyValue label="Alasan penolakan" value={detail.rejectionReason} />
                ) : null}
                {detail.adminNotes ? (
                  <KeyValue label="Catatan internal" value={detail.adminNotes} />
                ) : null}
              </dl>
            </CardBody>
          </Card>

          <Card padded={false}>
            <CardHeader title="Legalitas & Dokumen" />
            <CardBody>
              <dl>
                <KeyValue
                  label="NPWP (preview)"
                  value={detail.npwpMasked ?? "—"}
                  mono
                />
                <KeyValue label="Nomor akta" value={detail.deedNumber || "—"} mono />
                <KeyValue label="Nomor SIUP/NIB" value={detail.siupNumber || "—"} mono />
                <KeyValue
                  label="Kelengkapan dokumen"
                  value={
                    detail.documentsComplete ? (
                      <Badge tone="success">Lengkap ({detail.docCount ?? 0} berkas)</Badge>
                    ) : (
                      <Badge tone="warning">
                        Belum lengkap ({detail.docCount ?? 0} berkas)
                      </Badge>
                    )
                  }
                />
                <KeyValue label="Upaya ke" value={detail.attemptNumber ?? 1} />
                <KeyValue
                  label="Masa berlaku hingga"
                  value={(() => {
                    const validUntil =
                      detail.legalitasValidUntil ?? legalitasValidUntil(detail.approvedAt)?.toISOString() ?? null
                    if (!validUntil || status !== "APPROVED") return "—"
                    const st = legalitasStatus(detail.approvedAt)
                    return (
                      <span className="flex flex-col items-end gap-1">
                        <span>{formatDateTimeWIB(validUntil)}</span>
                        {st === "expired" ? (
                          <Badge tone="danger">{LEGALITAS_STATUS_LABEL.expired}</Badge>
                        ) : st === "warning" ? (
                          <Badge tone="warning">{LEGALITAS_STATUS_LABEL.warning}</Badge>
                        ) : null}
                      </span>
                    )
                  })()}
                />
              </dl>
              <p className="mt-3 text-caption text-text-secondary">
                NPWP hanya tampil termasking. NPWP mentah + dokumen memerlukan password
                admin (re-auth).
              </p>
              {docUrls.length > 0 || docNpwp ? (
                <div className="mt-3 flex flex-col gap-2">
                  {docNpwp ? (
                    <p className="break-all font-mono text-[13px]">
                      NPWP: {docNpwp}
                    </p>
                  ) : null}
                  {docUrls.map((url, i) => (
                    <a
                      key={url}
                      href={url}
                      target="_blank"
                      rel="noopener"
                      className="font-semibold text-info-text hover:underline"
                    >
                      Dokumen {i + 1} — Buka di tab baru
                    </a>
                  ))}
                  {docPartialErrors.map((pe) => (
                    <p key={pe} className="text-caption text-warning-text">
                      {pe}
                    </p>
                  ))}
                </div>
              ) : (
                <Button
                  variant="secondary"
                  fullWidth={false}
                  className="mt-3"
                  onClick={() => setDocOpen(true)}
                >
                  Minta URL dokumen
                </Button>
              )}
            </CardBody>
          </Card>

          <Card padded={false}>
            <CardHeader title="Reviewer" />
            <CardBody>
              <dl>
                <KeyValue
                  label="Ditugaskan"
                  value={
                    detail.assignedReviewer
                      ? `${detail.assignedReviewer.fullName} (${detail.assignedReviewer.adminId})`
                      : "Belum ada"
                  }
                />
              </dl>
              {isPending && (
                <div className="mt-3 flex flex-wrap items-end gap-2">
                  <Select
                    label="Tugaskan reviewer"
                    aria-label="Tugaskan reviewer"
                    options={[
                      { value: "", label: "Pilih admin…" },
                      ...admins.map((a) => ({
                        value: a.id,
                        label: `${a.fullName} (${a.adminId ?? a.email})`,
                      })),
                    ]}
                    value={assigneeId}
                    onChange={(e) => setAssigneeId(e.target.value)}
                    className="min-w-56 flex-1"
                  />
                  <Button
                    variant="secondary"
                    fullWidth={false}
                    loading={assigning}
                    disabled={!assigneeId}
                    onClick={handleAssign}
                  >
                    Tugaskan
                  </Button>
                </div>
              )}
              <p className="mt-2 text-caption text-text-secondary">
                Penugasan tercatat di audit log dan tidak mengubah status pengajuan.
              </p>
            </CardBody>
          </Card>

          <Card padded={false}>
            <CardHeader title="Riwayat" />
            <CardBody>
              {history.length === 0 ? (
                <p className="py-2 text-body text-text-secondary">
                  Belum ada riwayat tercatat untuk pengajuan ini.
                </p>
              ) : (
                <ul className="max-h-64 space-y-3 overflow-y-auto">
                  {history.map((h) => (
                    <li key={h.id} className="border-b border-border pb-3 last:border-b-0">
                      <p className="text-body font-semibold text-text-primary">{h.action}</p>
                      <p className="text-caption text-text-secondary">{h.description}</p>
                      <p className="mt-1 text-caption text-text-secondary">
                        {h.admin ? `${h.admin.fullName} (${h.admin.adminId})` : "Sistem"} ·{" "}
                        {formatDateTimeWIB(h.createdAt)}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
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
                <Button
                  variant="secondary"
                  fullWidth={false}
                  disabled={!isApproved || !isSuperAdmin}
                  title={isSuperAdmin ? undefined : "Hanya SUPER_ADMIN"}
                  onClick={() => setRevokeOpen(true)}
                >
                  Cabut persetujuan
                </Button>
              </div>
              {!isPending && !isApproved ? (
                <p className="mt-3 text-caption text-text-secondary">
                  Pengajuan sudah final (status {BUSINESS_STATUS_LABEL[status] ?? status}) — tidak
                  ada aksi yang tersedia.
                </p>
              ) : null}
            </CardBody>
          </Card>
        </div>
      )}

      {/* Dialog password dokumen */}
      <Dialog
        open={docOpen}
        onClose={() => setDocOpen(false)}
        title="Buka dokumen bisnis"
        description="Masukkan password admin untuk membuka dokumen. URL hanya berlaku sementara."
        footer={
          <div className="flex flex-col gap-2">
            <Button variant="primary" loading={docLoading} onClick={handleGetDocs}>
              Buka dokumen
            </Button>
            <Button variant="ghost" disabled={docLoading} onClick={() => setDocOpen(false)}>
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
        title="Setujui verifikasi bisnis"
        description="Pengajuan akan disetujui dan badan usaha terverifikasi."
        footer={
          <div className="flex flex-col gap-2">
            <Button variant="primary" loading={acting === "approve"} onClick={handleApprove}>
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
        title="Tolak verifikasi bisnis"
        description="Berikan alasan penolakan yang jelas untuk pemohon."
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

      {/* Cabut persetujuan: alasan standar + catatan internal terpisah */}
      <Dialog
        open={revokeOpen}
        onClose={() => setRevokeOpen(false)}
        title="Cabut persetujuan bisnis"
        description="Persetujuan yang sudah diberikan akan dicabut dan badge “Business Verified” langsung hilang. Tindakan ini tercatat di audit log."
        footer={
          <div className="flex flex-col gap-2">
            <Button
              variant="destructive"
              loading={acting === "revoke"}
              disabled={effectiveRevokeReason.length < 10}
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
        <div className="space-y-4">
          <Select
            label="Alasan pencabutan (standar)"
            options={BUSINESS_REVOKE_REASONS.map((r) => ({ value: r, label: r }))}
            value={revokeReason}
            onChange={(e) => setRevokeReason(e.target.value)}
          />
          {revokeReason === BUSINESS_REVOKE_CUSTOM && (
            <TextArea
              label="Alasan manual"
              required
              rows={3}
              value={revokeCustom}
              onChange={(e) => setRevokeCustom(e.target.value)}
              placeholder="Minimal 10 karakter…"
              hint={`${revokeCustom.trim().length} / 10 karakter minimum`}
            />
          )}
          <TextArea
            label="Catatan internal (terpisah, tidak dikirim ke pemohon)"
            rows={3}
            value={revokeNotes}
            onChange={(e) => setRevokeNotes(e.target.value)}
            placeholder="Hanya untuk tim internal…"
          />
        </div>
      </Dialog>
    </RoleGate>
  )
}
