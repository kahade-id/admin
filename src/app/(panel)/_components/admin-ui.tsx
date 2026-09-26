/**
 * Kahade Admin — helper tampilan khusus halaman area moderasi.
 *
 * Bukan fondasi umum: komponen di sini hanya dipakai halaman-halaman
 * `(panel)` area moderasi (RoleGuard, PageHeader, FilterChips, Pagination,
 * ErrorBlock, KeyValue, FieldSelect). Fondasi tetap di `src/components/ui/`.
 */
"use client"

import type { ReactNode } from "react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { EmptyState } from "@/components/ui/empty-state"
import { Spinner } from "@/components/ui/spinner"
import { useAuth } from "@/lib/auth-context"
import { canAccess } from "@/lib/rbac"
import { cn } from "@/lib/cn"

// ------------------------------------------------------------------
// RoleGuard — tolak akses langsung via URL bila role tidak boleh.
// Sidebar sudah difilter per role; ini pengaman untuk URL yang diketik
// manual. Konsisten dengan `menuForRole` di src/lib/rbac.ts.
// ------------------------------------------------------------------

export function RoleGuard({ href, children }: { href: string; children: ReactNode }) {
  const { state, role } = useAuth()

  if (state.status === "loading") {
    return (
      <div className="flex min-h-[40vh] items-center justify-center">
        <Spinner size="md" />
      </div>
    )
  }

  if (!canAccess(role, href)) {
    return (
      <Card>
        <EmptyState
          title="Akses ditolak"
          description="Role admin Anda tidak memiliki izin untuk membuka halaman ini."
        />
      </Card>
    )
  }

  return <>{children}</>
}

// ------------------------------------------------------------------
// PageHeader — judul + deskripsi + tombol aksi kanan + tombol muat ulang
// ------------------------------------------------------------------

export function PageHeader({
  title,
  description,
  actions,
  onRefresh,
  refreshing,
}: {
  title: string
  description?: string
  actions?: ReactNode
  onRefresh?: () => void
  refreshing?: boolean
}) {
  return (
    <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-h2 font-bold text-text-primary">{title}</h1>
        {description ? (
          <p className="mt-1 text-body text-text-secondary">{description}</p>
        ) : null}
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {actions}
        {onRefresh ? (
          <Button
            variant="secondary"
            size="sm"
            fullWidth={false}
            loading={refreshing}
            onClick={onRefresh}
          >
            Muat ulang
          </Button>
        ) : null}
      </div>
    </div>
  )
}

// ------------------------------------------------------------------
// FilterChips — filter status sebagai chip (pengganti SegmentedControl)
// ------------------------------------------------------------------

export type ChipOption<T extends string> = { value: T; label: string }

export function FilterChips<T extends string>({
  options,
  value,
  onChange,
}: {
  options: ChipOption<T>[]
  value: T
  onChange: (value: T) => void
}) {
  return (
    <div className="mb-4 flex flex-wrap gap-2" role="tablist" aria-label="Filter">
      {options.map((opt) => {
        const selected = opt.value === value
        return (
          <button
            key={opt.value}
            type="button"
            role="tab"
            aria-selected={selected}
            onClick={() => onChange(opt.value)}
            className={cn(
              "rounded-sm border px-3 py-1.5 text-label font-semibold transition-colors",
              selected
                ? "border-primary bg-primary text-primary-foreground"
                : "border-border bg-surface text-text-secondary hover:text-text-primary",
            )}
          >
            {opt.label}
          </button>
        )
      })}
    </div>
  )
}

// ------------------------------------------------------------------
// Pagination — bernomor, 1-based
// ------------------------------------------------------------------

export function Pagination({
  page,
  totalPages,
  total,
  onPageChange,
}: {
  page: number
  totalPages: number
  total?: number
  onPageChange: (page: number) => void
}) {
  if (totalPages <= 1) return null

  const pages: number[] = []
  const start = Math.max(1, Math.min(page - 2, totalPages - 4))
  const end = Math.min(totalPages, start + 4)
  for (let p = start; p <= end; p += 1) pages.push(p)

  return (
    <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
      <p className="text-caption text-text-secondary">
        Halaman {page} dari {totalPages}
        {typeof total === "number" ? ` · ${total.toLocaleString("id-ID")} data` : ""}
      </p>
      <nav className="flex items-center gap-1" aria-label="Paginasi">
        <Button
          variant="secondary"
          size="sm"
          fullWidth={false}
          disabled={page <= 1}
          onClick={() => onPageChange(page - 1)}
        >
          ‹
        </Button>
        {pages.map((p) => (
          <button
            key={p}
            type="button"
            aria-current={p === page ? "page" : undefined}
            onClick={() => onPageChange(p)}
            className={cn(
              "min-w-10 rounded-sm border px-3 py-2 text-label font-semibold transition-colors",
              p === page
                ? "border-primary bg-primary text-primary-foreground"
                : "border-border bg-surface text-text-secondary hover:text-text-primary",
            )}
          >
            {p}
          </button>
        ))}
        <Button
          variant="secondary"
          size="sm"
          fullWidth={false}
          disabled={page >= totalPages}
          onClick={() => onPageChange(page + 1)}
        >
          ›
        </Button>
      </nav>
    </div>
  )
}

// ------------------------------------------------------------------
// ErrorBlock — galat muat data + tombol coba lagi
// ------------------------------------------------------------------

export function ErrorBlock({
  title = "Gagal memuat data",
  message,
  onRetry,
}: {
  title?: string
  message: string
  onRetry: () => void
}) {
  return (
    <Card>
      <EmptyState
        title={title}
        description={message}
        action={
          <Button variant="secondary" fullWidth={false} onClick={onRetry}>
            Coba lagi
          </Button>
        }
      />
    </Card>
  )
}

// ------------------------------------------------------------------
// LoadingBlock — spinner tengah untuk loading awal halaman
// ------------------------------------------------------------------

export function LoadingBlock({ message = "Memuat…" }: { message?: string }) {
  return (
    <div className="flex min-h-[40vh] flex-col items-center justify-center gap-3">
      <Spinner size="md" />
      <p className="text-body text-text-secondary">{message}</p>
    </div>
  )
}

// ------------------------------------------------------------------
// KeyValue — baris label–nilai untuk halaman detail
// ------------------------------------------------------------------

export function KeyValue({
  label,
  value,
  mono = false,
}: {
  label: string
  value: ReactNode
  mono?: boolean
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-2 border-b border-border py-2.5 last:border-b-0">
      <dt className="shrink-0 text-caption font-semibold text-text-secondary">{label}</dt>
      <dd
        className={cn(
          "min-w-0 flex-1 text-right text-body text-text-primary",
          mono && "break-all font-mono text-[13px]",
        )}
      >
        {value}
      </dd>
    </div>
  )
}

// ------------------------------------------------------------------
// FieldSelect — <select> native berlabel (tidak ada komponen Select di ui)
// ------------------------------------------------------------------

export function FieldSelect({
  label,
  value,
  onChange,
  options,
  disabled,
  required,
}: {
  label?: string
  value: string
  onChange: (value: string) => void
  options: Array<{ value: string; label: string }>
  disabled?: boolean
  required?: boolean
}) {
  return (
    <label className="block w-full space-y-2">
      {label ? (
        <span className="block text-label font-semibold text-text-secondary">
          {label}
          {required ? <span className="text-danger-text"> *</span> : null}
        </span>
      ) : null}
      <select
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        className={cn(
          "w-full rounded-sm border border-border-control bg-surface px-4 text-body text-text-primary outline-none focus:border-focus min-h-12",
          disabled && "cursor-not-allowed opacity-disabled",
        )}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  )
}

// ------------------------------------------------------------------
// StatusBadge — badge status dengan pemetaan label/tone
// ------------------------------------------------------------------

export function StatusBadge({
  status,
  labels,
  tones,
}: {
  status: string
  labels: Record<string, string>
  tones: Record<string, "neutral" | "info" | "success" | "warning" | "danger" | "accent">
}) {
  return <Badge tone={tones[status] ?? "neutral"}>{labels[status] ?? status}</Badge>
}

// ------------------------------------------------------------------
// Pemetaan label/tone status per domain (dipakai halaman list + detail).
// Ditaruh di sini (bukan di page.tsx) karena Next.js hanya mengizinkan
// default export di file page.
// ------------------------------------------------------------------

export type StatusTone = "neutral" | "info" | "success" | "warning" | "danger" | "accent"

export const KYC_STATUS_LABEL: Record<string, string> = {
  PENDING: "Menunggu",
  APPROVED: "Disetujui",
  REJECTED: "Ditolak",
  REVOKED: "Dicabut",
}

export const KYC_STATUS_TONE: Record<string, StatusTone> = {
  PENDING: "warning",
  APPROVED: "success",
  REJECTED: "danger",
  REVOKED: "neutral",
}

export const BUSINESS_STATUS_LABEL: Record<string, string> = {
  PENDING: "Menunggu",
  APPROVED: "Disetujui",
  REJECTED: "Ditolak",
  REVOKED: "Dicabut",
}

export const BUSINESS_STATUS_TONE: Record<string, StatusTone> = {
  PENDING: "warning",
  APPROVED: "success",
  REJECTED: "danger",
  REVOKED: "neutral",
}

export const DISPUTE_STATUS_LABEL: Record<string, string> = {
  OPEN: "Terbuka",
  ASSIGNED: "Ditugaskan",
  UNDER_REVIEW: "Ditinjau",
  WAITING_RESPONSE: "Menunggu respons",
  ESCALATED: "Dieskalasi",
  RESOLVED: "Selesai",
}

export const DISPUTE_STATUS_TONE: Record<string, StatusTone> = {
  OPEN: "warning",
  ASSIGNED: "info",
  UNDER_REVIEW: "info",
  WAITING_RESPONSE: "warning",
  ESCALATED: "danger",
  RESOLVED: "success",
}

export const TICKET_STATUS_LABEL: Record<string, string> = {
  OPEN: "Terbuka",
  IN_PROGRESS: "Diproses",
  RESOLVED: "Selesai",
  CLOSED: "Ditutup",
}

export const TICKET_STATUS_TONE: Record<string, StatusTone> = {
  OPEN: "warning",
  IN_PROGRESS: "info",
  RESOLVED: "success",
  CLOSED: "neutral",
}

export const REPORT_STATUS_LABEL: Record<string, string> = {
  PENDING: "Menunggu",
  DISMISSED: "Diabaikan",
  RESOLVED: "Selesai",
}

export const REPORT_STATUS_TONE: Record<string, StatusTone> = {
  PENDING: "warning",
  DISMISSED: "neutral",
  RESOLVED: "success",
}

export const CHAT_STATUS_LABEL: Record<string, string> = {
  PENDING: "Menunggu",
  REVIEWED: "Ditinjau",
  DISMISSED: "Diabaikan",
  ACTIONED: "Ditindak",
}

export const CHAT_STATUS_TONE: Record<string, StatusTone> = {
  PENDING: "warning",
  REVIEWED: "info",
  DISMISSED: "neutral",
  ACTIONED: "success",
}
