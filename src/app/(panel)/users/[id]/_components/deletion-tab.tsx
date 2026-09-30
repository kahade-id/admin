/**
 * Admin — tab "Penghapusan" detail pengguna (GAP-A G067/G071).
 *
 * - GET /v1/admin/users/:userId/deletion → permintaan aktif (bila ada) + riwayat status (read-only).
 * - POST :userId/deletion/legal-hold { reason } → tahan purge (ON_HOLD), hanya bila ada request aktif.
 * - POST :userId/deletion/release-hold → kembalikan ke REQUESTED (purgeAt sama).
 *
 * Seluruh mutasi dicatat backend ke admin audit log + riwayat status deletion.
 */
"use client"

import { useCallback, useEffect, useState } from "react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardBody, CardHeader } from "@/components/ui/card"
import { TextArea } from "@/components/ui/input"
import { DataTable } from "@/components/ui/table"
import { useToast } from "@/components/ui/toast"
import {
  getDeletionStatus,
  placeDeletionLegalHold,
  releaseDeletionLegalHold,
  type AdminDeletionStatus,
  type DeletionStatusHistoryEntry,
} from "@/lib/api/admin/users"
import { userMessage } from "@/lib/api/response"
import { formatDateTimeWIB } from "@/lib/format"

import { ErrorBlock, LoadingBlock } from "../../../_components/admin-ui"

const STATUS_LABEL: Record<string, string> = {
  // BAI-075: PENDING sengaja tidak didaftar — backend menandainya
  // "dipesan untuk kompatibilitas maju" dan tak pernah menghasilkannya.
  REQUESTED: "Dijadwalkan",
  CANCELLED: "Dibatalkan",
  PURGED: "Dihapus permanen",
  ON_HOLD: "Ditahan (legal hold)",
}

function StatusBadge({ status }: { status: string }) {
  const tone =
    status === "ON_HOLD"
      ? "warning"
      : status === "PURGED"
        ? "danger"
        : status === "CANCELLED"
          ? "neutral"
          : "info"
  return <Badge tone={tone}>{STATUS_LABEL[status] ?? status}</Badge>
}

export function DeletionTab({ userId }: { userId: string }) {
  const toast = useToast()
  const [data, setData] = useState<AdminDeletionStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [holdReason, setHoldReason] = useState("")
  const [confirming, setConfirming] = useState<"hold" | "release" | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      setData(await getDeletionStatus(userId))
    } catch (err) {
      setError(userMessage(err))
    } finally {
      setLoading(false)
    }
  }, [userId])

  useEffect(() => {
    void load()
  }, [load])

  const doHold = async () => {
    if (busy || !holdReason.trim()) return
    setBusy(true)
    try {
      await placeDeletionLegalHold(userId, holdReason.trim())
      toast.show({ title: "Legal hold dipasang", description: "Purge dilewati sampai hold dilepas.", tone: "success" })
      setHoldReason("")
      setConfirming(null)
      await load()
    } catch (err) {
      toast.show({ title: "Gagal memasang hold", description: userMessage(err), tone: "danger" })
    } finally {
      setBusy(false)
    }
  }

  const doRelease = async () => {
    if (busy) return
    setBusy(true)
    try {
      await releaseDeletionLegalHold(userId)
      toast.show({ title: "Legal hold dilepas", description: "Penghapusan aktif kembali.", tone: "success" })
      setConfirming(null)
      await load()
    } catch (err) {
      toast.show({ title: "Gagal melepas hold", description: userMessage(err), tone: "danger" })
    } finally {
      setBusy(false)
    }
  }

  if (loading && !data) return <LoadingBlock message="Memuat status penghapusan…" />
  if (error && !data)
    return <ErrorBlock title="Gagal memuat status penghapusan" message={error} onRetry={() => void load()} />

  const request = data?.request
  const history = data?.history ?? []

  return (
    <div className="flex flex-col gap-5">
      <Card>
        <CardHeader title="Status penghapusan akun" />
        <CardBody>
          {!request ? (
            <p className="text-body text-text-secondary">
              Tidak ada permintaan penghapusan aktif untuk pengguna ini.
            </p>
          ) : (
            <div className="flex flex-col gap-3">
              <div className="flex flex-wrap items-center gap-3">
                <StatusBadge status={request.status} />
                <span className="text-body text-text-secondary">
                  Kode referensi: <span className="font-mono font-semibold text-text-primary">{request.referenceCode}</span>
                </span>
              </div>
              <dl className="grid grid-cols-1 gap-2 text-body sm:grid-cols-2">
                <div>
                  <dt className="text-text-secondary">Diajukan</dt>
                  <dd>{formatDateTimeWIB(request.requestedAt)}</dd>
                </div>
                <div>
                  <dt className="text-text-secondary">Jadwal purge</dt>
                  <dd>{formatDateTimeWIB(request.purgeAt)}</dd>
                </div>
                {request.cancelledAt ? (
                  <div>
                    <dt className="text-text-secondary">Dibatalkan</dt>
                    <dd>{formatDateTimeWIB(request.cancelledAt)}</dd>
                  </div>
                ) : null}
                {request.purgedAt ? (
                  <div>
                    <dt className="text-text-secondary">Dihapus permanen</dt>
                    <dd>{formatDateTimeWIB(request.purgedAt)}</dd>
                  </div>
                ) : null}
                {request.legalHoldReason ? (
                  <div className="sm:col-span-2">
                    <dt className="text-text-secondary">Alasan legal hold</dt>
                    <dd>{request.legalHoldReason}</dd>
                  </div>
                ) : null}
              </dl>

              {request.status === "REQUESTED" ? (
                confirming === "hold" ? (
                  <div className="flex flex-col gap-2 rounded-md border border-warning/40 bg-warning/5 p-3">
                    <TextArea
                      label="Alasan legal hold (wajib, dicatat di audit)"
                      value={holdReason}
                      onChange={(e) => setHoldReason(e.target.value)}
                      rows={3}
                      disabled={busy}
                      placeholder="cth. Sengketa #12345 masih terbuka; data perlu ditahan untuk investigasi."
                    />
                    <div className="flex gap-2">
                      <Button size="sm" onClick={() => void doHold()} loading={busy} disabled={!holdReason.trim()}>
                        Pasang hold
                      </Button>
                      <Button size="sm" variant="secondary" onClick={() => setConfirming(null)} disabled={busy}>
                        Batal
                      </Button>
                    </div>
                  </div>
                ) : (
                  <Button size="sm" variant="secondary" fullWidth={false} onClick={() => setConfirming("hold")}>
                    Tahan penghapusan (legal hold)
                  </Button>
                )
              ) : null}

              {request.status === "ON_HOLD" ? (
                confirming === "release" ? (
                  <div className="flex flex-col gap-2 rounded-md border border-warning/40 bg-warning/5 p-3">
                    <p className="text-body">
                      Lepas legal hold? Permintaan kembali aktif dengan jadwal purge yang sama.
                    </p>
                    <div className="flex gap-2">
                      <Button size="sm" onClick={() => void doRelease()} loading={busy}>
                        Ya, lepas hold
                      </Button>
                      <Button size="sm" variant="secondary" onClick={() => setConfirming(null)} disabled={busy}>
                        Batal
                      </Button>
                    </div>
                  </div>
                ) : (
                  <Button size="sm" variant="secondary" fullWidth={false} onClick={() => setConfirming("release")}>
                    Lepas legal hold
                  </Button>
                )
              ) : null}
            </div>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Riwayat status" />
        <CardBody>
          <DataTable<DeletionStatusHistoryEntry>
            rows={history}
            rowKey={(h) => h.id}
            emptyText="Belum ada riwayat."
            columns={[
              {
                key: "createdAt",
                header: "Waktu",
                render: (h) => formatDateTimeWIB(h.createdAt),
              },
              {
                key: "toStatus",
                header: "Perubahan",
                render: (h) =>
                  h.fromStatus
                    ? `${STATUS_LABEL[h.fromStatus] ?? h.fromStatus} → ${STATUS_LABEL[h.toStatus] ?? h.toStatus}`
                    : (STATUS_LABEL[h.toStatus] ?? h.toStatus),
              },
              { key: "actorType", header: "Aktor" },
              { key: "reason", header: "Alasan", render: (h) => h.reason ?? "—" },
            ]}
          />
        </CardBody>
      </Card>
    </div>
  )
}
