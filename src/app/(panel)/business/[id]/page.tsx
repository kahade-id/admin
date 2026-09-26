"use client"

/**
 * Admin — Detail verifikasi bisnis: tinjau pengajuan + dokumen + aksi.
 *
 * - Dokumen: tombol "Minta URL dokumen" → dialog password admin →
 *   getBusinessDocumentUrls() → link "Buka di tab baru" (URL sementara,
 *   tampil sebagai link, bukan auto-open).
 * - Setujui: dialog dengan catatan opsional.
 * - Tolak: dialog dengan alasan wajib min 10 karakter.
 * - Cabut persetujuan: ConfirmDialog (hanya bila sudah disetujui).
 *
 * Port dari frontend/app/admin/(panel)/business/[id].tsx → web desktop.
 */

import { useCallback, useEffect, useState, type ReactNode } from "react"
import { useParams } from "next/navigation"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardBody, CardHeader } from "@/components/ui/card"
import { ConfirmDialog, Dialog } from "@/components/ui/dialog"
import { EmptyState } from "@/components/ui/empty-state"
import { Input, TextArea } from "@/components/ui/input"
import { Spinner } from "@/components/ui/spinner"
import { useToast } from "@/components/ui/toast"
import { RoleGate } from "@/components/admin/role-gate"
import {
  approveBusiness,
  getBusinessDetail,
  getBusinessDocumentUrls,
  rejectBusiness,
  revokeBusiness,
  type BusinessVerificationItem,
} from "@/lib/api/admin/business"
import { userMessage } from "@/lib/api/response"
import { formatDateTimeWIB } from "@/lib/format"

import { BUSINESS_STATUS_LABEL, BUSINESS_STATUS_TONE } from "../maps"

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

  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [detail, setDetail] = useState<BusinessVerificationItem | null>(null)

  const [docOpen, setDocOpen] = useState(false)
  const [password, setPassword] = useState("")
  const [passwordError, setPasswordError] = useState<string | null>(null)
  const [docLoading, setDocLoading] = useState(false)
  const [docUrls, setDocUrls] = useState<string[]>([])

  const [approveOpen, setApproveOpen] = useState(false)
  const [approveNotes, setApproveNotes] = useState("")
  const [rejectOpen, setRejectOpen] = useState(false)
  const [rejectReason, setRejectReason] = useState("")
  const [rejectNotes, setRejectNotes] = useState("")
  const [revokeOpen, setRevokeOpen] = useState(false)
  const [acting, setActing] = useState<string | null>(null)

  const load = useCallback(
    async (mode: "initial" | "refresh" = "initial") => {
      if (!verificationId) return
      if (mode === "initial") setLoading(true)
      else setRefreshing(true)
      setError(null)
      try {
        setDetail(await getBusinessDetail(verificationId))
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
      setDocUrls(res.urls ?? [])
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

  const handleRevoke = async () => {
    setActing("revoke")
    try {
      await revokeBusiness(verificationId)
      setRevokeOpen(false)
      await load("refresh")
      toast.show({ title: "Persetujuan dicabut", tone: "success" })
    } catch (e) {
      fail("Gagal mencabut persetujuan", e)
    } finally {
      setActing(null)
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
                  label="Pemohon"
                  value={detail.user?.fullName ?? detail.user?.email ?? "—"}
                />
                <KeyValue label="ID Pengguna" value={detail.userId} mono />
                <KeyValue label="Diajukan" value={formatDateTimeWIB(detail.createdAt)} />
                <KeyValue
                  label="Ditinjau"
                  value={detail.reviewedAt ? formatDateTimeWIB(detail.reviewedAt) : "—"}
                />
                {detail.rejectionReason ? (
                  <KeyValue label="Alasan penolakan" value={detail.rejectionReason} />
                ) : null}
              </dl>
            </CardBody>
          </Card>

          <Card padded={false}>
            <CardHeader title="Dokumen" />
            <CardBody>
              <p className="mb-3 text-caption text-text-secondary">
                Dokumen memerlukan password admin dan hanya berlaku sementara.
              </p>
              {docUrls.length > 0 ? (
                <div className="flex flex-col gap-2">
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
                </div>
              ) : (
                <Button variant="secondary" fullWidth={false} onClick={() => setDocOpen(true)}>
                  Minta URL dokumen
                </Button>
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
                  disabled={!isApproved}
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

      {/* Cabut persetujuan: konfirmasi final */}
      <ConfirmDialog
        open={revokeOpen}
        onClose={() => setRevokeOpen(false)}
        title="Cabut persetujuan bisnis"
        description="Persetujuan yang sudah diberikan akan dicabut. Tindakan ini tercatat di audit log."
        confirmLabel="Cabut persetujuan"
        loading={acting === "revoke"}
        destructive
        onConfirm={handleRevoke}
      />
    </RoleGate>
  )
}
