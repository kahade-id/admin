"use client"

/**
 * Admin — Karier: detail pelamar (Fase F4).
 *
 * Data lengkap, CV dibuka via signed URL 15 menit (TIDAK di-embed langsung —
 * selalu window.open ke tab baru), ubah status (dropdown + validasi transisi
 * + catatan opsional), riwayat status (timeline), catatan internal, tombol
 * hapus manual (konfirmasi; untuk permintaan hapus manual / UU PDP).
 */

import Link from "next/link"
import { useParams, useRouter } from "next/navigation"
import { useCallback, useEffect, useMemo, useState } from "react"

import { Button } from "@/components/ui/button"
import { Card, CardBody, CardHeader } from "@/components/ui/card"
import { ConfirmDialog } from "@/components/ui/dialog"
import { EmptyState } from "@/components/ui/empty-state"
import { Field, TextArea } from "@/components/ui/input"
import { Spinner } from "@/components/ui/spinner"
import { useToast } from "@/components/ui/toast"
import { RoleGate } from "@/components/admin/role-gate"
import {
  APPLICATION_STATUS_TRANSITIONS,
  deleteApplication,
  getApplication,
  isReopenTransition,
  updateApplicationStatus,
  type JobApplicationDetail,
  type JobApplicationStatus,
} from "@/lib/api/admin/karier"
import { ApiError, userMessage } from "@/lib/api/response"
import { formatDateTimeWIB } from "@/lib/format"
import {
  FieldSelect,
  JOB_APPLICATION_STATUS_LABEL,
  JOB_APPLICATION_STATUS_TONE,
  KeyValue,
  PageHeader,
  StatusBadge,
} from "@/app/(panel)/_components/admin-ui"

export default function DetailPelamarPage() {
  const params = useParams<{ applicationId?: string }>()
  const router = useRouter()
  const toast = useToast()
  const applicationId = typeof params?.applicationId === "string" ? params.applicationId : ""

  const [detail, setDetail] = useState<JobApplicationDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [targetStatus, setTargetStatus] = useState<JobApplicationStatus | "">("")
  const [note, setNote] = useState("")
  const [statusBusy, setStatusBusy] = useState(false)

  const [deleteOpen, setDeleteOpen] = useState(false)
  const [deleteBusy, setDeleteBusy] = useState(false)

  const load = useCallback(async () => {
    if (!applicationId) return
    setLoading(true)
    setError(null)
    try {
      const res = await getApplication(applicationId)
      setDetail(res)
      setTargetStatus("")
      setNote("")
    } catch (e) {
      setError(userMessage(e))
    } finally {
      setLoading(false)
    }
  }, [applicationId])

  useEffect(() => {
    void load()
  }, [load])

  const transitions = useMemo(
    () => (detail ? APPLICATION_STATUS_TRANSITIONS[detail.status] : []),
    [detail],
  )

  const reopen = detail && targetStatus ? isReopenTransition(detail.status, targetStatus) : false

  const canSubmitStatus =
    targetStatus !== "" && !statusBusy && (!reopen || note.trim().length > 0)

  const submitStatus = async () => {
    if (!detail || !targetStatus) return
    if (reopen && !note.trim()) {
      toast.show({
        title: "Catatan wajib diisi",
        description: "Membuka ulang lamaran terminal (Diterima/Ditolak) wajib disertai catatan.",
        tone: "info",
      })
      return
    }
    setStatusBusy(true)
    try {
      const updated = await updateApplicationStatus(detail.id, {
        status: targetStatus,
        note: note.trim() || undefined,
      })
      setDetail(updated)
      setTargetStatus("")
      setNote("")
      toast.show({
        title: `Status diubah ke ${JOB_APPLICATION_STATUS_LABEL[targetStatus]}`,
        tone: "success",
      })
    } catch (e) {
      const msg =
        e instanceof ApiError && e.backendCode === "INVALID_STATUS_TRANSITION"
          ? "Transisi status tidak diizinkan oleh backend."
          : userMessage(e)
      toast.show({ title: "Gagal mengubah status", description: msg, tone: "danger" })
    } finally {
      setStatusBusy(false)
    }
  }

  const confirmDelete = async () => {
    if (!detail) return
    setDeleteBusy(true)
    try {
      await deleteApplication(detail.id)
      toast.show({ title: "Lamaran dihapus permanen", tone: "success" })
      setDeleteOpen(false)
      router.push(detail.postingId ? `/karier/${detail.postingId}/pelamar` : "/karier/pelamar")
    } catch (e) {
      toast.show({ title: "Gagal menghapus lamaran", description: userMessage(e), tone: "danger" })
    } finally {
      setDeleteBusy(false)
    }
  }

  const openCv = () => {
    if (!detail?.cvDownloadUrl) {
      toast.show({ title: "Tautan CV tidak tersedia", description: "Muat ulang halaman untuk mendapatkan tautan baru.", tone: "info" })
      return
    }
    // §3.4: JANGAN serve/embel file langsung — selalu via signed URL kedaluwarsa.
    window.open(detail.cvDownloadUrl, "_blank", "noopener,noreferrer")
  }

  return (
    <RoleGate href="/karier">
      <PageHeader
        title={detail ? `Pelamar — ${detail.fullName}` : "Detail Pelamar"}
        description={detail?.posting ? `Lowongan: ${detail.posting.title}` : undefined}
        actions={
          <Link href={detail?.postingId ? `/karier/${detail.postingId}/pelamar` : "/karier/pelamar"}>
            <Button variant="secondary" size="sm">
              ← Kembali ke daftar
            </Button>
          </Link>
        }
      />

      {loading ? (
        <div className="flex justify-center py-12">
          <Spinner size="md" />
        </div>
      ) : error || !detail ? (
        <EmptyState
          title="Gagal memuat detail pelamar"
          description={error ?? "Data tidak ditemukan."}
          action={<Button variant="secondary" onClick={() => void load()}>Coba lagi</Button>}
        />
      ) : (
        <div className="grid gap-4 lg:grid-cols-3">
          <div className="space-y-4 lg:col-span-2">
            <Card>
              <CardHeader
                title="Data Pelamar"
                action={
                  <StatusBadge
                    status={detail.status}
                    labels={JOB_APPLICATION_STATUS_LABEL}
                    tones={JOB_APPLICATION_STATUS_TONE}
                  />
                }
              />
              <CardBody>
                <dl>
                  <KeyValue label="Nama lengkap" value={detail.fullName} />
                  <KeyValue label="Email" value={<span className="break-all">{detail.email}</span>} />
                  <KeyValue label="Nomor HP" value={detail.phone} mono />
                  {detail.portfolioUrl && (
                    <KeyValue
                      label="Portofolio"
                      value={
                        <a href={detail.portfolioUrl} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2">
                          {detail.portfolioUrl}
                        </a>
                      }
                    />
                  )}
                  <KeyValue label="Catatan pelamar" value={detail.coverNote || "—"} />
                  <KeyValue label="Melamar" value={formatDateTimeWIB(detail.createdAt)} />
                  <KeyValue label="Diperbarui" value={formatDateTimeWIB(detail.updatedAt)} />
                </dl>
              </CardBody>
            </Card>

            <Card>
              <CardHeader title="CV" />
              <CardBody>
                <p className="mb-3 text-body text-text-secondary">
                  CV hanya dibuka lewat tautan bertanda-tangan yang kedaluwarsa 15 menit.
                  Tautan tidak disematkan langsung di halaman ini.
                </p>
                <div className="flex flex-wrap items-center gap-2">
                  <Button variant="primary" onClick={openCv}>
                    Buka CV (PDF)
                  </Button>
                  <Button variant="secondary" size="sm" loading={loading} onClick={() => void load()}>
                    Muat ulang tautan
                  </Button>
                </div>
              </CardBody>
            </Card>

            <Card>
              <CardHeader title="Riwayat Status" />
              <CardBody>
                {detail.history.length === 0 ? (
                  <p className="text-body text-text-secondary">Belum ada riwayat.</p>
                ) : (
                  <ol className="space-y-0">
                    {detail.history.map((h) => (
                      <li key={h.id} className="relative flex gap-3 pb-5 last:pb-0">
                        <div className="flex flex-col items-center">
                          <span className="mt-1 h-2.5 w-2.5 rounded-full bg-text-tertiary" aria-hidden />
                          <span className="w-px flex-1 bg-border" aria-hidden />
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="text-body text-text-primary">
                            {h.fromStatus ? (
                              <>
                                <StatusBadge
                                  status={h.fromStatus}
                                  labels={JOB_APPLICATION_STATUS_LABEL}
                                  tones={JOB_APPLICATION_STATUS_TONE}
                                />{" "}
                                →{" "}
                              </>
                            ) : (
                              "Lamaran dibuat → "
                            )}
                            <StatusBadge
                              status={h.toStatus}
                              labels={JOB_APPLICATION_STATUS_LABEL}
                              tones={JOB_APPLICATION_STATUS_TONE}
                            />
                          </p>
                          {h.note && <p className="mt-1 text-body text-text-secondary">{h.note}</p>}
                          <p className="mt-1 text-caption text-text-tertiary">
                            {formatDateTimeWIB(h.createdAt)}
                            {h.changedBy ? ` · oleh ${h.changedBy}` : " · sistem"}
                          </p>
                        </div>
                      </li>
                    ))}
                  </ol>
                )}
              </CardBody>
            </Card>
          </div>

          <div className="space-y-4">
            <Card>
              <CardHeader title="Ubah Status" />
              <CardBody>
                {transitions.length === 0 ? (
                  <p className="text-body text-text-secondary">Tidak ada transisi tersedia.</p>
                ) : (
                  <div className="space-y-4">
                    <FieldSelect
                      label="Status baru"
                      value={targetStatus}
                      onChange={(v) => setTargetStatus(v as JobApplicationStatus | "")}
                      options={[
                        { value: "", label: "Pilih status…" },
                        ...transitions.map((s) => ({
                          value: s,
                          label: JOB_APPLICATION_STATUS_LABEL[s],
                        })),
                      ]}
                    />
                    <Field
                      label="Catatan"
                      hint={
                        reopen
                          ? "Wajib — membuka ulang lamaran terminal."
                          : "Opsional — tercatat di riwayat status."
                      }
                      required={reopen}
                    >
                      <TextArea
                        value={note}
                        onChange={(e) => setNote(e.target.value)}
                        rows={3}
                        placeholder="Alasan perubahan status…"
                      />
                    </Field>
                    <Button
                      variant="primary"
                      loading={statusBusy}
                      disabled={!canSubmitStatus}
                      onClick={() => void submitStatus()}
                    >
                      Simpan Status
                    </Button>
                  </div>
                )}
              </CardBody>
            </Card>

            <Card>
              <CardHeader title="Catatan Internal" />
              <CardBody>
                <p className="text-body text-text-secondary">
                  {detail.internalNote || "Belum ada catatan internal."}
                </p>
                <p className="mt-2 text-caption text-text-tertiary">
                  Hanya terlihat admin — tidak pernah tampil ke pelamar.
                </p>
              </CardBody>
            </Card>

            <Card>
              <CardHeader title="Hapus Manual" />
              <CardBody>
                <p className="mb-3 text-body text-text-secondary">
                  Hapus permanen lamaran + file CV (untuk permintaan hapus manual / hak
                  penghapusan UU PDP).
                </p>
                <Button variant="ghost" onClick={() => setDeleteOpen(true)}>
                  Hapus Lamaran…
                </Button>
              </CardBody>
            </Card>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        title="Hapus lamaran permanen?"
        description={
          detail
            ? `Lamaran ${detail.fullName} (${detail.email}) beserta file CV akan dihapus permanen. Tindakan ini tidak bisa dibatalkan.`
            : undefined
        }
        confirmLabel="Ya, hapus permanen"
        destructive
        loading={deleteBusy}
        onConfirm={() => void confirmDelete()}
      />
    </RoleGate>
  )
}
