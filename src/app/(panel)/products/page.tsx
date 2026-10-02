"use client"

/**
 * Admin — Produk & stok (GAP-D G251–G275).
 * Moderasi katalog (PENDING/FLAGGED), mutasi stok manual, riwayat mutasi.
 */

import { useCallback, useEffect, useState } from "react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { EmptyState } from "@/components/ui/empty-state"
import { Spinner } from "@/components/ui/spinner"
import { DataTable } from "@/components/ui/table"
import { useToast } from "@/components/ui/toast"
import { Pagination } from "@/components/admin/pagination"
import { RoleGate } from "@/components/admin/role-gate"
import { Select } from "@/components/admin/select"
import { Input } from "@/components/ui/input"
import {
  listAdminProducts,
  moderateProduct,
  adminAdjustStock,
  listAdminStockMovements,
  ADMIN_PRODUCT_MODERATION_LABEL,
  ADMIN_PRODUCT_TYPE_LABEL,
  ADMIN_PRODUCT_TYPE_OPTIONS,
  type AdminProductItem,
  type AdminStockMovement,
} from "@/lib/api/admin/inventory"
import { userMessage } from "@/lib/api/response"
import { formatDateTimeWIB, formatIdrSen } from "@/lib/format"

const PAGE_SIZE = 20

type Tab = "products" | "movements"

function ProductsTab() {
  const toast = useToast()
  const [moderation, setModeration] = useState("PENDING")
  // Batch 43, item #1: filter tipe produk (jasa/fisik/digital/lainnya).
  const [productType, setProductType] = useState("ALL")
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [rows, setRows] = useState<AdminProductItem[]>([])
  const [totalPages, setTotalPages] = useState(1)

  const load = useCallback(
    async (p = page, m = moderation, t = productType) => {
      setLoading(true)
      setError(null)
      try {
        const res = await listAdminProducts({
          page: p,
          limit: PAGE_SIZE,
          moderationStatus: m === "ALL" ? undefined : m,
          productType: t === "ALL" ? undefined : t,
        })
        setRows(res.data ?? [])
        setTotalPages(res.totalPages ?? 1)
      } catch (e) {
        setError(userMessage(e))
      } finally {
        setLoading(false)
      }
    },
    [page, moderation, productType],
  )

  useEffect(() => { void load() }, [load])

  async function moderate(p: AdminProductItem, decision: "APPROVED" | "REJECTED" | "FLAGGED") {
    const note = decision === "APPROVED" ? undefined : window.prompt(`Catatan ${decision === "REJECTED" ? "penolakan" : "penandaan"}:`, "")
    if (decision !== "APPROVED" && !note) return
    try {
      await moderateProduct(p.id, { decision, note: note ?? undefined })
      toast.show({ title: "Keputusan moderasi tersimpan", tone: "success" })
      await load()
    } catch (e) {
      toast.show({ title: "Gagal moderasi", description: userMessage(e), tone: "danger" })
    }
  }

  async function adjust(p: AdminProductItem) {
    const raw = window.prompt(`Tambah/kurangi stok tersedia untuk ${p.name} (mis. 10 atau -5):`, "0")
    if (raw === null) return
    const delta = Number(raw)
    if (!Number.isInteger(delta)) {
      toast.show({ title: "Delta harus bilangan bulat", tone: "danger" })
      return
    }
    const reason = window.prompt("Alasan penyesuaian stok (wajib):", "")
    if (!reason) return
    try {
      await adminAdjustStock({ sku: p.sku, delta, reason })
      toast.show({ title: "Stok disesuaikan", tone: "success" })
      await load()
    } catch (e) {
      toast.show({ title: "Gagal menyesuaikan stok", description: userMessage(e), tone: "danger" })
    }
  }

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <Select label="Moderasi" value={moderation}
          options={[
            { value: "ALL", label: "Semua" },
            ...Object.entries(ADMIN_PRODUCT_MODERATION_LABEL).map(([value, label]) => ({ value, label })),
          ]}
          onChange={(e) => { setModeration(e.target.value); setPage(1); void load(1, e.target.value) }} className="w-52" />
        <Select label="Tipe produk" value={productType}
          options={[
            { value: "ALL", label: "Semua tipe" },
            ...ADMIN_PRODUCT_TYPE_OPTIONS,
          ]}
          onChange={(e) => { setProductType(e.target.value); setPage(1); void load(1, moderation, e.target.value) }} className="w-52" />
      </div>
      {loading ? (
        <div className="flex min-h-[30vh] items-center justify-center gap-2"><Spinner size="md" /><p className="text-body text-text-secondary">Memuat…</p></div>
      ) : error ? (
        <Card><EmptyState title="Gagal memuat" description={error} action={<Button variant="secondary" fullWidth={false} onClick={() => load()}>Coba lagi</Button>} /></Card>
      ) : (
        <>
          <DataTable<AdminProductItem>
            columns={[
              { key: "name", header: "Produk", render: (r) => (
                <div><div className="font-semibold">{r.name}</div>
                <div className="text-small text-text-secondary">SKU {r.sku} · {r.category}</div></div>) },
              { key: "productType", header: "Tipe", render: (r) => (
                <Badge tone={r.productType ? "info" : "neutral"}>
                  {r.productType ? (ADMIN_PRODUCT_TYPE_LABEL[String(r.productType)] ?? String(r.productType)) : "—"}
                </Badge>
              ) },
              { key: "moderationStatus", header: "Moderasi", render: (r) => <Badge>{ADMIN_PRODUCT_MODERATION_LABEL[String(r.moderationStatus)] ?? String(r.moderationStatus)}</Badge> },
              { key: "price", header: "Harga", render: (r) => <span>{formatIdrSen(r.priceSen)}</span> },
              { key: "stock", header: "Tersedia / Cadang", render: (r) => <span>{r.quantityAvailable} / {r.quantityReserved}</span> },
              { key: "biz", header: "Verif. bisnis", render: (r) => <span>{r.requiresBusinessVerification ? "Ya" : "Tidak"}</span> },
              { key: "actions", header: "Aksi", render: (r) => (
                <div className="flex flex-wrap gap-1">
                  {["PENDING", "FLAGGED"].includes(String(r.moderationStatus)) ? (
                    <>
                      <Button size="sm" variant="secondary" fullWidth={false} onClick={() => moderate(r, "APPROVED")}>Setujui</Button>
                      <Button size="sm" variant="secondary" fullWidth={false} onClick={() => moderate(r, "REJECTED")}>Tolak</Button>
                    </>
                  ) : null}
                  <Button size="sm" variant="secondary" fullWidth={false} onClick={() => moderate(r, "FLAGGED")}>Tandai</Button>
                  {/* BAI-012: POST /v1/admin/inventory/adjust SUPER_ADMIN-only
                      (backend @AdminRoles) — sembunyikan dari CUSTOMER_SUPPORT
                      agar tidak 403. */}
                  <RoleGate roles={["SUPER_ADMIN"]}>
                    <Button size="sm" variant="secondary" fullWidth={false} onClick={() => adjust(r)}>Sesuaikan stok</Button>
                  </RoleGate>
                </div>) },
            ]}
            rows={rows}
            emptyText="Tidak ada produk."
          />
          <div className="mt-4 flex justify-end"><Pagination page={page} totalPages={totalPages} onPageChange={(p: number) => { setPage(p); void load(p) }} /></div>
        </>
      )}
    </div>
  )
}

function MovementsTab() {
  const toast = useToast()
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)
  const [rows, setRows] = useState<AdminStockMovement[]>([])
  const [totalPages, setTotalPages] = useState(1)

  const load = useCallback(async (p = page) => {
    setLoading(true)
    try {
      const res = await listAdminStockMovements({ page: p, limit: PAGE_SIZE })
      setRows(res.data ?? [])
      setTotalPages(res.totalPages ?? 1)
    } catch (e) {
      toast.show({ title: "Gagal memuat riwayat stok", description: userMessage(e), tone: "danger" })
    } finally {
      setLoading(false)
    }
  }, [page, toast])

  useEffect(() => { void load() }, [load])

  return (
    <div>
      {loading ? (
        <div className="flex min-h-[30vh] items-center justify-center gap-2"><Spinner size="md" /><p className="text-body text-text-secondary">Memuat…</p></div>
      ) : (
        <>
          <DataTable<AdminStockMovement>
            columns={[
              { key: "createdAt", header: "Waktu", render: (r) => <span>{formatDateTimeWIB(String(r.createdAt))}</span> },
              { key: "productId", header: "Produk", render: (r) => <span className="font-mono text-small">{String(r.productId).slice(0, 12)}…</span> },
              { key: "type", header: "Tipe", render: (r) => <Badge>{String(r.type)}</Badge> },
              { key: "source", header: "Sumber", render: (r) => <span>{String(r.source)} ({String(r.actorRole)})</span> },
              { key: "qty", header: "Δ", render: (r) => <span className={Number(r.quantityChange) < 0 ? "text-text-danger" : ""}>{r.quantityChange}</span> },
              { key: "after", header: "Tersedia →", render: (r) => <span>{r.beforeAvailable} → {r.afterAvailable}</span> },
              { key: "reason", header: "Alasan", render: (r) => <span className="text-small">{String(r.reason ?? "—")}</span> },
            ]}
            rows={rows}
            emptyText="Belum ada mutasi stok."
          />
          <div className="mt-4 flex justify-end"><Pagination page={page} totalPages={totalPages} onPageChange={(p: number) => { setPage(p); void load(p) }} /></div>
        </>
      )}
    </div>
  )
}

export default function ProductsAdminPage() {
  const [tab, setTab] = useState<Tab>("products")
  return (
    <RoleGate href="/products">
      <div className="mb-6">
        <h1 className="text-h2 font-bold text-text-primary">Produk & Stok</h1>
        <p className="mt-1 text-body text-text-secondary">
          Moderasi katalog seller, penyesuaian stok manual, dan riwayat mutasi stok.
        </p>
      </div>
      <div className="mb-4 flex gap-2">
        {([["products", "Produk"], ["movements", "Riwayat stok"]] as [Tab, string][]).map(([v, label]) => (
          <Button key={v} variant={tab === v ? "primary" : "secondary"} size="sm" fullWidth={false} onClick={() => setTab(v)}>
            {label}
          </Button>
        ))}
      </div>
      <Card>
        {tab === "products" ? <ProductsTab /> : <MovementsTab />}
      </Card>
    </RoleGate>
  )
}
