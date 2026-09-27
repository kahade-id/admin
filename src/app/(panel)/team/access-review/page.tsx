/**
 * Admin — Review Akses Periodik (E5a, grup E).
 *
 * Daftar admin + tanggal sertifikasi ulang hak akses terakhir, badge
 * overdue, dan tombol "Tandai direview" per baris. Overdue dihitung
 * backend bila `isOverdue` diisi; UI memakai fallback 90 hari sejak
 * sertifikasi terakhir (atau sejak akun dibuat bila belum pernah).
 */
"use client"

import { useCallback, useEffect, useState } from "react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardBody } from "@/components/ui/card"
import { DataTable } from "@/components/ui/table"
import { useToast } from "@/components/ui/toast"
import { RoleGate } from "@/components/admin/role-gate"
import {
  certifyAccessReview,
  listAccessReview,
  type AccessReviewItem,
} from "@/lib/api/admin/management"
import { roleLabel } from "@/lib/rbac"
import { userMessage } from "@/lib/api/response"
import { formatDateTimeWIB } from "@/lib/format"

import { ErrorBlock, LoadingBlock, PageHeader } from "../../_components/admin-ui"

const OVERDUE_DAYS = 90

function daysSince(iso: string | null): number | null {
  if (!iso) return null
  const ms = Date.now() - new Date(iso).getTime()
  if (Number.isNaN(ms)) return null
  return Math.floor(ms / 86_400_000)
}

function isOverdue(item: AccessReviewItem): boolean {
  if (typeof item.isOverdue === "boolean") return item.isOverdue
  const d = daysSince(item.lastCertifiedAt)
  return d == null || d > OVERDUE_DAYS
}

function AccessReviewContent() {
  const toast = useToast()
  const [rows, setRows] = useState<AccessReviewItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [certifying, setCertifying] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      setRows(await listAccessReview())
    } catch (e) {
      setError(userMessage(e))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  async function handleCertify(item: AccessReviewItem) {
    setCertifying(item.adminId)
    try {
      await certifyAccessReview(item.adminId)
      toast.show({
        title: "Akses ditandai direview.",
        description: `${item.fullName} — hak akses per ${new Date().toLocaleDateString("id-ID")}.`,
        tone: "success",
      })
      await load()
    } catch (e) {
      toast.show({ title: "Gagal menandai review", description: userMessage(e), tone: "danger" })
    } finally {
      setCertifying(null)
    }
  }

  const overdueCount = rows.filter(isOverdue).length

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Review Akses Periodik"
        description="Sertifikasi ulang hak akses setiap admin. Tandai direview setelah memverifikasi peran & kebutuhan akses masih sesuai."
        onRefresh={load}
        refreshing={loading}
      />

      {overdueCount > 0 ? (
        <div role="alert" className="rounded-md border border-warning bg-warning/10 px-4 py-3">
          <p className="font-semibold text-warning-text">
            {overdueCount} akun admin melewati jadwal sertifikasi ulang
          </p>
          <p className="mt-1 text-body text-text-primary">
            Review hak aksesnya segera — batas sertifikasi {OVERDUE_DAYS} hari.
          </p>
        </div>
      ) : null}

      <Card padded={false}>
        <CardBody>
          {loading ? (
            <LoadingBlock message="Memuat daftar review akses…" />
          ) : error ? (
            <ErrorBlock title="Gagal memuat review akses" message={error} onRetry={load} />
          ) : (
            <DataTable<AccessReviewItem & Record<string, unknown>>
              columns={[
                {
                  key: "fullName",
                  header: "Admin",
                  render: (r) => (
                    <div>
                      <p className="font-semibold">{r.fullName}</p>
                      <p className="text-caption text-text-secondary">{r.email}</p>
                    </div>
                  ),
                },
                {
                  key: "role",
                  header: "Peran",
                  render: (r) => roleLabel(r.role),
                },
                {
                  key: "lastCertifiedAt",
                  header: "Terakhir direview",
                  render: (r) =>
                    r.lastCertifiedAt ? (
                      <span>
                        {formatDateTimeWIB(r.lastCertifiedAt)}
                        {r.certifiedBy ? (
                          <span className="block text-caption text-text-tertiary">
                            oleh {r.certifiedBy}
                          </span>
                        ) : null}
                      </span>
                    ) : (
                      <span className="text-text-tertiary">Belum pernah</span>
                    ),
                },
                {
                  key: "status",
                  header: "Status",
                  render: (r) =>
                    isOverdue(r) ? (
                      <Badge tone="danger" dot>
                        Overdue
                      </Badge>
                    ) : (
                      <Badge tone="success" dot>
                        Terjadwal
                      </Badge>
                    ),
                },
                {
                  key: "action",
                  header: "",
                  align: "right",
                  render: (r) => (
                    <Button
                      variant="secondary"
                      size="sm"
                      fullWidth={false}
                      loading={certifying === r.adminId}
                      onClick={() => handleCertify(r)}
                    >
                      Tandai direview
                    </Button>
                  ),
                },
              ]}
              rows={rows.map((r) => ({ ...r }))}
              rowKey={(r) => r.adminId}
              emptyText="Belum ada akun admin."
            />
          )}
        </CardBody>
      </Card>

      <p className="text-caption text-text-tertiary">
        Kebijakan: sertifikasi ulang hak akses tiap {OVERDUE_DAYS} hari. Riwayat sertifikasi
        tercatat di log aktivitas admin.
      </p>
    </div>
  )
}

export default function AccessReviewPage() {
  return (
    <RoleGate href="/team">
      <AccessReviewContent />
    </RoleGate>
  )
}
