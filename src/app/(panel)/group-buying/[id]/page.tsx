/**
 * Admin — Detail patungan grup (batch 43, item #30).
 *
 * Menampilkan: status, progres dana (escrow), tenggat, daftar peserta
 * (status bayar per peserta, transparan), nominal cair. TANPA aksi
 * finansial — pemantauan saja.
 */
"use client"

import Link from "next/link"
import { useCallback, useEffect, useState, type ReactNode } from "react"
import { useParams } from "next/navigation"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardBody, CardHeader } from "@/components/ui/card"
import { Spinner } from "@/components/ui/spinner"
import { DataTable } from "@/components/ui/table"
import { useToast } from "@/components/ui/toast"
import { RoleGate } from "@/components/admin/role-gate"
import { userMessage } from "@/lib/api/response"
import { formatDateTimeWIB, formatIDR, formatNumber } from "@/lib/format"
import { maskName } from "@/lib/pii"
import {
  getGroupBuyDetail,
  type GroupBuyDetail,
  type GroupBuyParticipant,
} from "@/lib/api/admin/group-buying"
import {
  GroupBuyProgressBar,
  groupBuyStatusLabel,
  groupBuyStatusTone,
} from "../lib"

function KeyValue({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-2 border-b border-border py-2.5 last:border-b-0">
      <dt className="shrink-0 text-caption font-semibold text-text-secondary">{label}</dt>
      <dd className="min-w-0 flex-1 text-right text-body text-text-primary">{value}</dd>
    </div>
  )
}

function GroupBuyDetailContent() {
  const params = useParams<{ id: string }>()
  const toast = useToast()
  const id = decodeURIComponent(params.id)

  const [detail, setDetail] = useState<GroupBuyDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      setDetail(await getGroupBuyDetail(id))
    } catch (e) {
      const msg = userMessage(e)
      setError(msg)
      toast.show({ title: "Gagal memuat detail patungan", description: msg, tone: "danger" })
    } finally {
      setLoading(false)
    }
  }, [id, toast])

  useEffect(() => {
    void load()
  }, [load])

  const participants: GroupBuyParticipant[] = detail?.participants ?? []
  const paidCount = participants.filter((p) => p.hasPaid).length

  return (
    <div className="flex flex-col gap-5">
      <div>
        <Link href="/group-buying" className="text-caption text-primary hover:underline">
          ← Kembali ke daftar patungan
        </Link>
        <h1 className="mt-2 text-h2 font-semibold text-text-primary">
          {detail?.title ?? "Detail Patungan"}
        </h1>
      </div>

      {loading ? (
        <div className="flex min-h-[30vh] items-center justify-center gap-2">
          <Spinner size="md" />
          <p className="text-body text-text-secondary">Memuat…</p>
        </div>
      ) : error || !detail ? (
        <Card>
          <CardBody className="flex flex-col gap-3">
            <p role="alert" className="text-body text-danger-text">
              {error ?? "Patungan tidak ditemukan."}
            </p>
            <div className="max-w-xs">
              <Button variant="secondary" fullWidth={false} onClick={() => load()}>
                Coba lagi
              </Button>
            </div>
          </CardBody>
        </Card>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
            <Card padded={false}>
              <CardHeader title="Status & progres" />
              <CardBody className="flex flex-col gap-4">
                <div>
                  <Badge tone={groupBuyStatusTone(detail.status)} dot>
                    {groupBuyStatusLabel(detail.status)}
                  </Badge>
                </div>
                <GroupBuyProgressBar item={detail} />
                <dl>
                  <KeyValue label="Host" value={detail.hostName ?? "—"} />
                  <KeyValue
                    label="Mode pembagian"
                    value={
                      detail.splitMode === "CUSTOM"
                        ? "Nominal custom"
                        : detail.splitMode === "EQUAL"
                          ? "Bagi rata"
                          : (detail.splitMode ?? "—")
                    }
                  />
                  <KeyValue
                    label="Peserta sudah bayar"
                    value={`${formatNumber(paidCount)} / ${formatNumber(participants.length)}`}
                  />
                  <KeyValue
                    label="Sisa slot"
                    value={
                      detail.maxParticipants != null
                        ? formatNumber(
                            Math.max(0, detail.maxParticipants - detail.participantCount),
                          )
                        : "Tanpa batas"
                    }
                  />
                  <KeyValue label="Tenggat bayar" value={formatDateTimeWIB(detail.deadline)} />
                  {detail.disbursedAmount != null ? (
                    <KeyValue label="Nominal cair ke host" value={formatIDR(detail.disbursedAmount)} />
                  ) : null}
                  <KeyValue label="Dibuat" value={formatDateTimeWIB(detail.createdAt)} />
                </dl>
                <p className="text-caption text-text-secondary">
                  Pencairan ke host memerlukan masa sanggah 24 jam peserta;
                  setelah cair, pembatalan mengikuti jalur dispute normal.
                </p>
              </CardBody>
            </Card>

            <Card padded={false}>
              <CardHeader title={`Peserta (${formatNumber(participants.length)})`} />
              <CardBody>
                <DataTable<GroupBuyParticipant & Record<string, unknown>>
                  columns={[
                    {
                      key: "user",
                      header: "Peserta",
                      render: (r) => <p className="font-semibold">{maskName(r.userName)}</p>,
                    },
                    {
                      key: "amount",
                      header: "Kontribusi",
                      align: "right",
                      render: (r) => formatIDR(r.amount),
                    },
                    {
                      key: "paid",
                      header: "Status bayar",
                      render: (r) =>
                        r.hasPaid ? (
                          <Badge tone="success" dot>
                            Sudah bayar{typeof r.paidAt === "string" && r.paidAt ? ` · ${formatDateTimeWIB(r.paidAt)}` : ""}
                          </Badge>
                        ) : (
                          <Badge tone="warning" dot>Belum bayar</Badge>
                        ),
                    },
                    {
                      key: "joinedAt",
                      header: "Bergabung",
                      render: (r) => formatDateTimeWIB(r.joinedAt),
                    },
                  ]}
                  rows={participants as (GroupBuyParticipant & Record<string, unknown>)[]}
                  rowKey={(r) => r.userId}
                  loading={false}
                  emptyText="Belum ada peserta."
                />
              </CardBody>
            </Card>
          </div>
          <Card>
            <CardBody>
              <p className="text-caption text-text-secondary">
                Halaman ini pemantauan saja. Aksi finansial (cairkan / batalkan /
                refund manual) tidak tersedia di admin — dijalankan otomatis
                oleh backend sesuai aturan produk patungan.
              </p>
            </CardBody>
          </Card>
        </>
      )}
    </div>
  )
}

export default function GroupBuyDetailPage() {
  return (
    <RoleGate href="/group-buying">
      <GroupBuyDetailContent />
    </RoleGate>
  )
}
