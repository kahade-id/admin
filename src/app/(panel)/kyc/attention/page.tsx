"use client"

/**
 * Admin — KYC: daftar "perlu perhatian" (GAP-E G276–G300).
 *
 * - Lewat SLA & mendekati SLA (dari backend GET /v1/admin/kyc/attention),
 * - dokumen gagal diunduh (audit marker [KYC-DOC-FAIL]),
 * - antrean re-check dokumen tua (>30 hari, tanpa NIK — hanya ID & umur).
 */

import Link from "next/link"
import { useCallback, useEffect, useState } from "react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardBody, CardHeader } from "@/components/ui/card"
import { EmptyState } from "@/components/ui/empty-state"
import { Spinner } from "@/components/ui/spinner"
import { DataTable } from "@/components/ui/table"
import { useToast } from "@/components/ui/toast"
import { RoleGate } from "@/components/admin/role-gate"
import {
  getKycAttention,
  type KycAttentionItem,
  type KycAttentionResponse,
  type KycQueueItem,
} from "@/lib/api/admin/kyc"
import { userMessage } from "@/lib/api/response"
import { formatAge, formatDateTimeWIB } from "@/lib/format"

import { KYC_STATUS_LABEL, KYC_STATUS_TONE } from "../maps"

function rowColumns(extra?: (row: KycQueueItem) => React.ReactNode) {
  return [
    {
      key: "kycId",
      header: "KYC ID",
      render: (row: KycQueueItem) => (
        <Link
          href={`/kyc/${encodeURIComponent(row.kycId)}`}
          className="font-mono font-medium text-info-text hover:underline"
        >
          {row.kycId}
        </Link>
      ),
    },
    {
      key: "user",
      header: "Pengguna",
      render: (row: KycQueueItem) => (
        <div>
          <div className="font-medium">{row.user.fullName ?? row.user.userId}</div>
          <div className="text-caption text-text-secondary">{row.user.userId}</div>
        </div>
      ),
    },
    {
      key: "status",
      header: "Status",
      render: (row: KycQueueItem) => (
        <Badge tone={KYC_STATUS_TONE[row.status] ?? "neutral"}>
          {KYC_STATUS_LABEL[row.status] ?? row.status}
        </Badge>
      ),
    },
    {
      key: "age",
      header: "Umur antrean",
      render: (row: KycQueueItem) => formatAge(row.sla?.startedAt ?? row.createdAt),
    },
    {
      key: "reviewer",
      header: "Reviewer",
      render: (row: KycQueueItem) =>
        row.assignedReviewer?.fullName ?? <span className="text-text-tertiary">Belum ditugaskan</span>,
    },
    ...(extra ? [{ key: "extra", header: "Keterangan", render: extra }] : []),
  ]
}

function Section({
  title,
  description,
  tone,
  count,
  rows,
  extra,
  emptyText,
}: {
  title: string
  description: string
  tone: "danger" | "warning" | "info"
  count: number
  rows: KycQueueItem[]
  extra?: (row: KycQueueItem) => React.ReactNode
  emptyText: string
}) {
  return (
    <Card padded={false}>
      <CardHeader
        title={title}
        action={<Badge tone={tone}>{count} item</Badge>}
      />
      <CardBody>
        <p className="mb-3 text-caption text-text-secondary">{description}</p>
        {rows.length === 0 ? (
          <p className="text-body text-text-secondary">{emptyText}</p>
        ) : (
          <DataTable columns={rowColumns(extra)} rows={rows} rowKey={(r) => r.kycId} emptyText={emptyText} />
        )}
      </CardBody>
    </Card>
  )
}

export default function KycAttentionPage() {
  const toast = useToast()
  const [data, setData] = useState<KycAttentionResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      setData(await getKycAttention())
    } catch (e) {
      const msg = userMessage(e)
      setError(msg)
      toast.show({ title: "Gagal memuat daftar perhatian", description: msg, tone: "danger" })
    } finally {
      setLoading(false)
    }
  }, [toast])

  useEffect(() => {
    void load()
  }, [load])

  return (
    <RoleGate href="/kyc">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-h2 font-bold text-text-primary">Perlu perhatian — KYC</h1>
          <p className="mt-1 text-body text-text-secondary">
            {data ? `Diperbarui ${formatDateTimeWIB(data.generatedAt)}` : "Pengajuan yang butuh penanganan prioritas."}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-4">
          <Link href="/kyc" className="font-semibold text-info-text hover:underline">
            Kembali ke antrean
          </Link>
          <Button variant="secondary" size="sm" fullWidth={false} loading={loading} onClick={load}>
            Muat ulang
          </Button>
        </div>
      </div>

      {loading ? (
        <div className="flex min-h-[40vh] items-center justify-center gap-2">
          <Spinner size="md" />
          <p className="text-body text-text-secondary">Memuat…</p>
        </div>
      ) : error || !data ? (
        <Card>
          <EmptyState
            title="Gagal memuat"
            description={error ?? "Data tidak ditemukan."}
            action={
              <Button variant="secondary" fullWidth={false} onClick={load}>
                Coba lagi
              </Button>
            }
          />
        </Card>
      ) : (
        <div className="space-y-4">
          <Section
            title="Lewat SLA"
            description="Pengajuan PENDING yang sudah melewati batas SLA. Tangani terlebih dahulu."
            tone="danger"
            count={data.sla.breached.length}
            rows={data.sla.breached}
            emptyText="Tidak ada pengajuan yang lewat SLA. Bagus!"
          />
          <Section
            title="Mendekati SLA"
            description="Sisa waktu di bawah 20% dari batas SLA. Segera tinjau sebelum lewat."
            tone="warning"
            count={data.sla.warning.length}
            rows={data.sla.warning}
            emptyText="Tidak ada pengajuan yang mendekati SLA."
          />
          <Section
            title="Dokumen gagal diunduh"
            description="Dokumen yang gagal dibuka/dekripsi saat ditinjau — diverifikasi ulang tanpa membaca ulang storage key."
            tone="warning"
            count={data.docFailures.length}
            rows={data.docFailures}
            extra={(row) => {
              const item = row as KycAttentionItem
              return (
                <span className="text-caption text-text-secondary">
                  {item.lastFailureAt ? `Terakhir gagal ${formatDateTimeWIB(item.lastFailureAt)}` : "—"}
                  {item.lastErrors ? ` — ${item.lastErrors}` : ""}
                </span>
              )
            }}
            emptyText="Tidak ada kegagalan dokumen."
          />
          <Section
            title={`Re-check dokumen tua (>${data.recheckThresholdDays} hari)`}
            description="Pengajuan PENDING lebih tua dari ambang re-check. Daftar ini hanya berisi ID & umur — tanpa NIK dan tanpa dokumen."
            tone="info"
            count={data.recheckQueue.length}
            rows={data.recheckQueue}
            extra={(row) => {
              const item = row as KycAttentionItem
              return (
                <span className="text-caption text-text-secondary">
                  {item.ageDays != null ? `${item.ageDays} hari` : "—"}
                </span>
              )
            }}
            emptyText="Tidak ada dokumen tua yang perlu re-check."
          />
        </div>
      )}
    </RoleGate>
  )
}
