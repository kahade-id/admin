/**
 * Admin — Detail trip jastip (batch 43, item #29).
 *
 * Menampilkan: info trip, katalog, dan rincian pesanan dengan transparansi
 * harga (barang + fee jastip + ongkir terpisah). Pemantauan saja — tanpa
 * aksi finansial.
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
  getJastipTripDetail,
  type JastipOrderItem,
  type JastipTripDetail,
} from "@/lib/api/admin/jastip"
import { jastipTripStatusLabel, jastipTripStatusTone } from "../lib"

function KeyValue({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-2 border-b border-border py-2.5 last:border-b-0">
      <dt className="shrink-0 text-caption font-semibold text-text-secondary">{label}</dt>
      <dd className="min-w-0 flex-1 text-right text-body text-text-primary">{value}</dd>
    </div>
  )
}

function JastipDetailContent() {
  const params = useParams<{ id: string }>()
  const toast = useToast()
  const id = params.id

  const [detail, setDetail] = useState<JastipTripDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      setDetail(await getJastipTripDetail(id))
    } catch (e) {
      const msg = userMessage(e)
      setError(msg)
      toast.show({ title: "Gagal memuat detail trip", description: msg, tone: "danger" })
    } finally {
      setLoading(false)
    }
  }, [id, toast])

  useEffect(() => {
    void load()
  }, [load])

  const catalog = detail?.catalog ?? []
  const orders: JastipOrderItem[] = detail?.orders ?? []

  return (
    <div className="flex flex-col gap-5">
      <div>
        <Link href="/jastip" className="text-caption text-primary hover:underline">
          ← Kembali ke daftar jastip
        </Link>
        <h1 className="mt-2 text-h2 font-semibold text-text-primary">
          {detail?.title ?? "Detail Trip Jastip"}
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
              {error ?? "Trip tidak ditemukan."}
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
              <CardHeader title="Informasi trip" />
              <CardBody>
                <dl>
                  <KeyValue
                    label="Status"
                    value={
                      <Badge tone={jastipTripStatusTone(detail.status)} dot>
                        {jastipTripStatusLabel(detail.status)}
                      </Badge>
                    }
                  />
                  <KeyValue label="Destinasi" value={detail.destination ?? "—"} />
                  <KeyValue label="Host" value={detail.hostName ?? "—"} />
                  <KeyValue
                    label="Slot / pesanan"
                    value={
                      detail.slotCount != null
                        ? `${formatNumber(detail.orderCount ?? 0)} / ${formatNumber(detail.slotCount)}`
                        : formatNumber(detail.orderCount ?? 0)
                    }
                  />
                  <KeyValue label="Tenggat order" value={formatDateTimeWIB(detail.orderDeadline)} />
                  <KeyValue label="Dibuat" value={formatDateTimeWIB(detail.createdAt)} />
                </dl>
                <p className="mt-4 text-caption text-text-secondary">
                  Harga dikunci saat host konfirmasi (barang + fee jastip +
                  ongkir terpisah transparan); host gagal mendapat barang →
                  refund otomatis via backend.
                </p>
              </CardBody>
            </Card>

            <Card padded={false}>
              <CardHeader title={`Katalog (${formatNumber(catalog.length)})`} />
              <CardBody>
                {catalog.length === 0 ? (
                  <p className="text-body text-text-secondary">
                    Katalog tidak dikirim backend — pembeli dapat request bebas.
                  </p>
                ) : (
                  <ul className="flex flex-col gap-2">
                    {catalog.map((c) => (
                      <li
                        key={c.id}
                        className="flex items-center justify-between gap-2 rounded-sm bg-surface px-4 py-2.5"
                      >
                        <span className="text-body text-text-primary">{c.name}</span>
                        <span className="text-body font-semibold text-text-primary">
                          {c.price != null ? formatIDR(c.price) : "—"}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </CardBody>
            </Card>
          </div>

          <Card padded={false}>
            <CardHeader title={`Pesanan (${formatNumber(orders.length)})`} />
            <CardBody>
              <DataTable<JastipOrderItem & Record<string, unknown>>
                columns={[
                  {
                    key: "item",
                    header: "Barang",
                    render: (r) => (
                      <div>
                        <p className="font-semibold">{r.itemName}</p>
                        <p className="text-caption text-text-secondary">
                          Pembeli: {maskName(r.buyerName)}
                        </p>
                      </div>
                    ),
                  },
                  {
                    key: "itemPrice",
                    header: "Harga barang",
                    align: "right",
                    render: (r) => (r.itemPrice != null ? formatIDR(r.itemPrice) : "—"),
                  },
                  {
                    key: "jastipFee",
                    header: "Fee jastip",
                    align: "right",
                    render: (r) => (r.jastipFee != null ? formatIDR(r.jastipFee) : "—"),
                  },
                  {
                    key: "shippingCost",
                    header: "Ongkir",
                    align: "right",
                    render: (r) => (r.shippingCost != null ? formatIDR(r.shippingCost) : "—"),
                  },
                  {
                    key: "status",
                    header: "Status",
                    render: (r) =>
                      r.status ? <Badge>{String(r.status)}</Badge> : <span>—</span>,
                  },
                  {
                    key: "createdAt",
                    header: "Dipesan",
                    render: (r) => formatDateTimeWIB(r.createdAt),
                  },
                ]}
                rows={orders as (JastipOrderItem & Record<string, unknown>)[]}
                rowKey={(r) => r.id}
                loading={false}
                emptyText="Belum ada pesanan."
              />
            </CardBody>
          </Card>
        </>
      )}
    </div>
  )
}

export default function JastipDetailPage() {
  return (
    <RoleGate href="/jastip">
      <JastipDetailContent />
    </RoleGate>
  )
}
