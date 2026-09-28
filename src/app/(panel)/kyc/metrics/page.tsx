"use client"

/**
 * Admin — KYC: metrik waktu tinjauan + runbook backlog (GAP-E G276–G300).
 *
 * - Agregat p50/p95/rata-rata waktu review per status keputusan (tanpa NIK).
 * - Snapshot antrean: PENDING, lewat/mendekati SLA, umur tertua.
 * - Ekspor CSV agregat.
 * - Runbook penanganan backlog (statis, Bahasa Indonesia).
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
import { Select } from "@/components/admin/select"
import { getKycMetrics, type KycMetricsResponse, type KycReviewStats } from "@/lib/api/admin/kyc"
import { userMessage } from "@/lib/api/response"
import { formatDateTimeWIB } from "@/lib/format"

import { KYC_STATUS_LABEL } from "../maps"

const PERIOD_OPTIONS = [
  { value: "7", label: "7 hari terakhir" },
  { value: "30", label: "30 hari terakhir" },
  { value: "90", label: "90 hari terakhir" },
]

function fmtHours(v: number | null | undefined): string {
  if (v == null || Number.isNaN(v)) return "—"
  if (v < 1) return `${Math.round(v * 60)} mnt`
  return `${v.toFixed(1)} jam`
}

const RUNBOOK_STEPS: Array<{ title: string; body: string }> = [
  {
    title: "1. Dahulukan yang lewat & mendekati SLA",
    body: "Buka halaman “Perlu perhatian”. Tangani yang berstatus Lewat SLA terlebih dahulu, lalu Mendekati SLA. Gunakan filter “Lewat SLA” di antrean untuk triase harian.",
  },
  {
    title: "2. Tugaskan reviewer agar tidak menumpuk",
    body: "Setiap pengajuan PENDING sebaiknya punya reviewer yang ditugaskan. Dari detail pengajuan, pakai “Tugaskan reviewer”. Penugasan tercatat di audit log.",
  },
  {
    title: "3. Dokumen tidak lengkap? Minta tambahan, jangan ditolak langsung",
    body: "Bila dokumen buram/kurang, pakai “Minta dokumen tambahan” di detail pengajuan. SLA otomatis DIJEDA dan pengguna diberi tahu; SLA berlanjut saat dokumen pelengkap masuk.",
  },
  {
    title: "4. Bulk hanya untuk yang sudah jelas",
    body: "Bulk approve memakai konfirmasi ekstra; bulk reject wajib alasan (min 10 karakter). Maksimal 50 per aksi. Status tiap item dicek ulang — yang berubah sejak daftar dimuat dibatalkan otomatis.",
  },
  {
    title: "5. Eskalasi breach berkepanjangan",
    body: "Pengajuan yang lewat SLA >24 jam tanpa penanganan perlu dieskalasi ke supervisor. Jejak breach tercatat di kolom slaBreachedAt dan audit log.",
  },
  {
    title: "6. Jaga kebersihan antrean tua",
    body: "Periksa daftar “Re-check dokumen tua” (>30 hari) secara berkala. Daftar ini hanya berisi ID & umur — tanpa NIK dan tanpa dokumen.",
  },
]

export default function KycMetricsPage() {
  const toast = useToast()
  const [periodDays, setPeriodDays] = useState("30")
  const [data, setData] = useState<KycMetricsResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(
    async (days: string) => {
      setLoading(true)
      setError(null)
      try {
        const to = new Date()
        const from = new Date(to.getTime() - Number(days) * 24 * 3_600_000)
        setData(await getKycMetrics({ from: from.toISOString(), to: to.toISOString() }))
      } catch (e) {
        const msg = userMessage(e)
        setError(msg)
        toast.show({ title: "Gagal memuat metrik", description: msg, tone: "danger" })
      } finally {
        setLoading(false)
      }
    },
    [toast],
  )

  useEffect(() => {
    void load(periodDays)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [periodDays])

  const exportCsv = () => {
    if (!data) return
    const lines = ["Jenis,Status,Jumlah,p50 (jam),p95 (jam),Rata-rata (jam),Min (jam),Maks (jam)"]
    for (const [status, s] of Object.entries(data.reviewTimeHours)) {
      lines.push(
        [
          "Waktu review",
          KYC_STATUS_LABEL[status] ?? status,
          String(s.count),
          s.p50?.toFixed(2) ?? "",
          s.p95?.toFixed(2) ?? "",
          s.avg?.toFixed(2) ?? "",
          s.min?.toFixed(2) ?? "",
          s.max?.toFixed(2) ?? "",
        ]
          .map((c) => `"${c}"`)
          .join(","),
      )
    }
    lines.push(
      ["Antrean", "PENDING", String(data.queue.pending), "", "", "", "", ""].map((c) => `"${c}"`).join(","),
      ["Antrean", "Lewat SLA", String(data.queue.breached), "", "", "", "", ""].map((c) => `"${c}"`).join(","),
      ["Antrean", "Mendekati SLA", String(data.queue.warning), "", "", "", "", ""].map((c) => `"${c}"`).join(","),
    )
    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = `kyc-metrik-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
    toast.show({ title: "CSV metrik diunduh (agregat, tanpa NIK)", tone: "success" })
  }

  const statRows: Array<{ status: string; stats: KycReviewStats }> = data
    ? Object.entries(data.reviewTimeHours).map(([status, stats]) => ({ status, stats }))
    : []

  return (
    <RoleGate href="/kyc">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-h2 font-bold text-text-primary">Metrik & runbook — KYC</h1>
          <p className="mt-1 text-body text-text-secondary">
            {data
              ? `Periode ${formatDateTimeWIB(data.period.from)} – ${formatDateTimeWIB(data.period.to)}`
              : "Waktu tinjauan agregat dan panduan penanganan backlog."}
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-4">
          <Select
            label="Periode"
            options={PERIOD_OPTIONS}
            value={periodDays}
            onChange={(e) => setPeriodDays(e.target.value)}
          />
          <Link href="/kyc" className="font-semibold text-info-text hover:underline">
            Kembali ke antrean
          </Link>
          <Button variant="secondary" size="sm" fullWidth={false} onClick={exportCsv} disabled={!data}>
            Ekspor CSV
          </Button>
        </div>
      </div>

      {loading ? (
        <div className="flex min-h-[40vh] items-center justify-center gap-2">
          <Spinner size="md" />
          <p className="text-body text-text-secondary">Memuat metrik…</p>
        </div>
      ) : error || !data ? (
        <Card>
          <EmptyState
            title="Gagal memuat metrik"
            description={error ?? "Data tidak ditemukan."}
            action={
              <Button variant="secondary" fullWidth={false} onClick={() => load(periodDays)}>
                Coba lagi
              </Button>
            }
          />
        </Card>
      ) : (
        <div className="space-y-4">
          <div className="grid gap-4 md:grid-cols-4">
            <Card padded={false}>
              <CardBody>
                <p className="text-caption text-text-secondary">Menunggu (PENDING)</p>
                <p className="text-h2 font-bold">{data.queue.pending}</p>
              </CardBody>
            </Card>
            <Card padded={false}>
              <CardBody>
                <p className="text-caption text-text-secondary">Lewat SLA</p>
                <p className="text-h2 font-bold text-danger-text">{data.queue.breached}</p>
              </CardBody>
            </Card>
            <Card padded={false}>
              <CardBody>
                <p className="text-caption text-text-secondary">Mendekati SLA</p>
                <p className="text-h2 font-bold text-warning-text">{data.queue.warning}</p>
              </CardBody>
            </Card>
            <Card padded={false}>
              <CardBody>
                <p className="text-caption text-text-secondary">SLA tinjauan</p>
                <p className="text-h2 font-bold">
                  {data.queue.slaHours} jam{" "}
                  <span className="text-body font-normal text-text-secondary">
                    {data.queue.useBusinessHours ? "jam kerja" : "kalender"}
                  </span>
                </p>
              </CardBody>
            </Card>
          </div>

          <Card padded={false}>
            <CardHeader title="Waktu tinjauan per keputusan (jam)" />
            <CardBody>
              {statRows.length === 0 ? (
                <p className="text-body text-text-secondary">
                  Belum ada keputusan pada periode ini.
                </p>
              ) : (
                <DataTable
                  columns={[
                    {
                      key: "status",
                      header: "Keputusan",
                      render: (r: { status: string }) => (
                        <Badge tone="neutral">{KYC_STATUS_LABEL[r.status] ?? r.status}</Badge>
                      ),
                    },
                    { key: "count", header: "Jumlah", render: (r: { stats: KycReviewStats }) => String(r.stats.count) },
                    { key: "p50", header: "p50", render: (r: { stats: KycReviewStats }) => fmtHours(r.stats.p50) },
                    { key: "p95", header: "p95", render: (r: { stats: KycReviewStats }) => fmtHours(r.stats.p95) },
                    { key: "avg", header: "Rata-rata", render: (r: { stats: KycReviewStats }) => fmtHours(r.stats.avg) },
                    { key: "min", header: "Min.", render: (r: { stats: KycReviewStats }) => fmtHours(r.stats.min) },
                    { key: "max", header: "Maks", render: (r: { stats: KycReviewStats }) => fmtHours(r.stats.max) },
                  ]}
                  rows={statRows}
                  rowKey={(r) => r.status}
                  emptyText="Belum ada data."
                />
              )}
              <p className="mt-2 text-caption text-text-secondary">
                Diukur dari pengajuan (atau pengajuan ulang) hingga keputusan. Agregat saja — tanpa
                NIK, tanpa dokumen.
              </p>
            </CardBody>
          </Card>

          <Card padded={false}>
            <CardHeader title="Runbook penanganan backlog" />
            <CardBody>
              <ol className="space-y-4">
                {RUNBOOK_STEPS.map((s) => (
                  <li key={s.title}>
                    <p className="text-body font-medium">{s.title}</p>
                    <p className="mt-1 text-body text-text-secondary">{s.body}</p>
                  </li>
                ))}
              </ol>
            </CardBody>
          </Card>
        </div>
      )}
    </RoleGate>
  )
}
