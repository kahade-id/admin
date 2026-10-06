/**
 * Admin — Keuangan > tab "Jejak Audit" (read-only).
 *
 * Deferred audit Wallet #5: API `GET /v1/admin/finance/audit-trail/:userId`
 * sudah ada (`getAuditTrail`), tapi belum ada UI-nya. Panel ini read-only —
 * tidak ada tombol aksi/mutasi; hanya memuat dan menampilkan jejak transaksi
 * satu user beserta saldo berjalan per baris untuk keperluan rekonsiliasi.
 */
"use client"

import { useCallback, useState } from "react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardBody, CardHeader } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Spinner } from "@/components/ui/spinner"
import { DataTable } from "@/components/ui/table"
import { useToast } from "@/components/ui/toast"

import {
  getAuditTrail,
  type AuditTrail,
  type AuditTrailRow,
} from "@/lib/api/admin/finance"
import { userMessage } from "@/lib/api/response"
import { formatDateTimeWIB, formatIDR, formatNumber, wibDayRangeToIso } from "@/lib/format"
import { txLabel } from "@/lib/tx-labels"

/** Rentang maksimum yang diizinkan backend (hari). */
const MAX_RANGE_DAYS = 365
const DEFAULT_RANGE_DAYS = 30

/** "YYYY-MM-DD" lokal dari Date. */
function dateInputOf(d: Date): string {
  const mm = String(d.getMonth() + 1).padStart(2, "0")
  const dd = String(d.getDate()).padStart(2, "0")
  return `${d.getFullYear()}-${mm}-${dd}`
}

function defaultDateInputs(): { start: string; end: string } {
  const end = new Date()
  const start = new Date()
  start.setDate(start.getDate() - DEFAULT_RANGE_DAYS)
  return { start: dateInputOf(start), end: dateInputOf(end) }
}

/** Input "YYYY-MM-DD" → ISO 8601 (awal/akhir hari WIB — P2-F4, bukan zona perangkat). */
function rangeToIso(start: string, end: string): { start: string; end: string } {
  return wibDayRangeToIso(start, end)
}

function daysBetween(a: string, b: string): number {
  return Math.round((new Date(b).getTime() - new Date(a).getTime()) / 86_400_000)
}

export function AuditTrailPanel() {
  const toast = useToast()
  const [userId, setUserId] = useState("")
  const [dateInputs, setDateInputs] = useState(defaultDateInputs)
  const [formError, setFormError] = useState<string | null>(null)
  const [trail, setTrail] = useState<AuditTrail | null>(null)
  const [loading, setLoading] = useState(false)

  const handleLoad = useCallback(async () => {
    const id = userId.trim()
    if (!id) {
      setFormError("Isi ID user terlebih dahulu.")
      return
    }
    const { start, end } = dateInputs
    if (!start || !end) {
      setFormError("Isi tanggal mulai dan tanggal selesai.")
      return
    }
    if (start > end) {
      setFormError("Tanggal mulai tidak boleh setelah tanggal selesai.")
      return
    }
    if (daysBetween(start, end) > MAX_RANGE_DAYS) {
      setFormError(`Rentang tanggal maksimal ${MAX_RANGE_DAYS} hari.`)
      return
    }
    setFormError(null)
    setLoading(true)
    try {
      const range = rangeToIso(start, end)
      const res = await getAuditTrail(id, { from: range.start, to: range.end })
      setTrail(res)
    } catch (e) {
      setTrail(null)
      toast.show({
        title: "Gagal memuat jejak audit",
        description: userMessage(e),
        tone: "danger",
      })
    } finally {
      setLoading(false)
    }
  }, [userId, dateInputs, toast])

  return (
    <section aria-label="Jejak audit">
      <Card>
        <CardHeader
          title="Jejak audit"
          subtitle="Read-only — riwayat transaksi satu user dengan saldo berjalan per baris."
        />
        <CardBody>
          <div className="mb-4 grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
            <Input
              label="ID user"
              placeholder="cth. usr_…"
              value={userId}
              onChange={(e) => setUserId(e.target.value)}
              error={formError ?? undefined}
            />
            <Input
              label="Dari"
              type="date"
              value={dateInputs.start}
              max={dateInputs.end || undefined}
              onChange={(e) =>
                setDateInputs((p) => ({ ...p, start: e.target.value }))
              }
            />
            <Input
              label="Sampai"
              type="date"
              value={dateInputs.end}
              min={dateInputs.start || undefined}
              onChange={(e) =>
                setDateInputs((p) => ({ ...p, end: e.target.value }))
              }
            />
            <div className="flex items-end">
              <Button
                variant="primary"
                fullWidth={false}
                loading={loading}
                onClick={() => void handleLoad()}
              >
                Muat jejak audit
              </Button>
            </div>
          </div>

          {loading && !trail ? (
            <div className="flex items-center gap-2 py-6 text-body text-text-secondary">
              <Spinner size="sm" />
              Memuat jejak audit…
            </div>
          ) : null}

          {trail ? (
            <>
              <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
                <div className="rounded-lg border border-border p-3">
                  <p className="text-caption text-text-secondary">Saldo awal</p>
                  <p className="mt-1 font-semibold text-text-primary">
                    {formatIDR(trail.openingTotalBalance)}
                  </p>
                </div>
                <div className="rounded-lg border border-border p-3">
                  <p className="text-caption text-text-secondary">Saldo akhir</p>
                  <p className="mt-1 font-semibold text-text-primary">
                    {formatIDR(trail.closingTotalBalance)}
                  </p>
                </div>
                <div className="rounded-lg border border-border p-3">
                  <p className="text-caption text-text-secondary">Transaksi</p>
                  <p className="mt-1 font-semibold text-text-primary">
                    {formatNumber(trail.transactions.length)}
                  </p>
                </div>
              </div>

              <DataTable<AuditTrailRow>
                columns={[
                  {
                    key: "createdAt",
                    header: "Waktu",
                    render: (r) => formatDateTimeWIB(r.createdAt),
                  },
                  {
                    key: "type",
                    header: "Tipe",
                    render: (r) => (
                      <div>
                        {/* ADM-230: label Indonesia, bukan raw enum */}
                        <p className="font-semibold" title={String(r.type)}>{txLabel(String(r.type))}</p>
                        <p className="text-caption text-text-secondary">
                          {r.txId}
                        </p>
                      </div>
                    ),
                  },
                  {
                    key: "description",
                    header: "Deskripsi",
                    render: (r) => (
                      <span className="block max-w-xs truncate">
                        {r.description ?? "—"}
                      </span>
                    ),
                  },
                  {
                    key: "amount",
                    header: "Nominal",
                    align: "right",
                    render: (r) => (
                      <span className="font-semibold">
                        {r.totalBalanceDelta >= 0 ? "+" : "−"}
                        {formatIDR(Math.abs(r.amount))}
                      </span>
                    ),
                  },
                  {
                    key: "runningTotalBalance",
                    header: "Saldo berjalan",
                    align: "right",
                    render: (r) => formatIDR(r.runningTotalBalance),
                  },
                  {
                    key: "status",
                    header: "Status",
                    render: (r) => (
                      <Badge
                        tone={String(r.status) === "SUCCESS" ? "success" : "neutral"}
                      >
                        {String(r.status)}
                      </Badge>
                    ),
                  },
                ]}
                rows={trail.transactions}
                rowKey={(r) => r.txId}
                loading={loading}
                emptyText="Tidak ada transaksi pada rentang ini."
              />
            </>
          ) : null}
        </CardBody>
      </Card>
    </section>
  )
}
