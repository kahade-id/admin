/**
 * POIN 2 (unifikasi transaksi escrow) — tipe transaksi order.
 *
 * KONTRAK ASUMSI (2026-10-04): backend dikerjakan paralel oleh worker lain —
 * kolom `orderKind` di model Order + filter `?kind=` di `GET /v1/admin/orders`
 * (nama param `kind` = yang disepakati; BUKAN `type`). Nilai enum berikut
 * mengikuti kosakata backend yang sudah ada (modul jastip/patungan,
 * `SlotBookingStatus`); sesuaikan bila kontrak final backend berbeda.
 *
 * Dipakai di: halaman /orders (filter server-side + badge kolom),
 * /disputes & /returns (filter client-side dari field `orderKind` respons —
 * backend belum mendukung filter server-side di kedua endpoint itu).
 */

export type OrderKind =
  | "DIRECT" // pembelian langsung (bukan jastip/patungan/booking jasa)
  | "JASTIP"
  | "PATUNGAN"
  | "SERVICE_BOOKING"
  | (string & {})

/** Label Indonesia untuk tipe transaksi; fallback ke raw enum bila tak dikenal. */
export const ORDER_KIND_LABEL: Record<string, string> = {
  DIRECT: "Langsung",
  JASTIP: "Jastip",
  PATUNGAN: "Patungan",
  SERVICE_BOOKING: "Booking Jasa",
}

export function orderKindLabel(kind: unknown): string {
  const k = typeof kind === "string" ? kind : ""
  return ORDER_KIND_LABEL[k] ?? (k || "—")
}

/** Opsi dropdown "Tipe transaksi" — dipakai seragam di orders/disputes/returns. */
export const ORDER_KIND_FILTER_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "ALL", label: "Semua tipe" },
  { value: "DIRECT", label: "Langsung" },
  { value: "JASTIP", label: "Jastip" },
  { value: "PATUNGAN", label: "Patungan" },
  { value: "SERVICE_BOOKING", label: "Booking Jasa" },
]

/**
 * Ambil `orderKind` dari satu baris respons (disputes/returns) secara defensif:
 * field top-level dulu, lalu nested di relasi `order` (backend bisa menaruhnya
 * di salah satu). "" bila tidak ada — pemanggil memperlakukannya sebagai
 * "tipe tidak diketahui".
 */
export function rowOrderKind(row: Record<string, unknown>): string {
  const direct = row.orderKind
  if (typeof direct === "string" && direct) return direct
  const order = row.order as { orderKind?: unknown } | null | undefined
  const nested = order?.orderKind
  return typeof nested === "string" ? nested : ""
}

// ---------------------------------------------------------------------------
// TX-UNIFIED-V2: 3 dimensi independen pengganti OrderKind flat.
// Backend: FulfillmentType + ParticipantMode + OrderCategory (prisma).
// ---------------------------------------------------------------------------

/** Kategori transaksi: Fisik / Digital / Jasa. */
export type OrderCategory = "FISIK" | "DIGITAL" | "JASA" | (string & {})

/** Sistem pemenuhan: Langsung (ready) / Preorder. Jasa pakai tanggal, bukan label ini. */
export type FulfillmentType = "BIASA" | "PREORDER" | (string & {})

/** Mode peserta: Sendiri (1-by-1) / Patungan (1-by-N). */
export type ParticipantMode = "SINGLE" | "GROUP" | (string & {})

export const ORDER_CATEGORY_LABEL: Record<string, string> = {
  FISIK: "Fisik",
  DIGITAL: "Digital",
  JASA: "Jasa",
}

export const FULFILLMENT_LABEL: Record<string, string> = {
  BIASA: "Langsung",
  PREORDER: "Preorder",
}

export const PARTICIPANT_MODE_LABEL: Record<string, string> = {
  SINGLE: "Sendiri",
  GROUP: "Patungan",
}

export function orderCategoryLabel(v: unknown): string {
  const k = typeof v === "string" ? v : ""
  return ORDER_CATEGORY_LABEL[k] ?? (k || "—")
}

export function fulfillmentLabel(v: unknown): string {
  const k = typeof v === "string" ? v : ""
  return FULFILLMENT_LABEL[k] ?? (k || "—")
}

export function participantModeLabel(v: unknown): string {
  const k = typeof v === "string" ? v : ""
  return PARTICIPANT_MODE_LABEL[k] ?? (k || "—")
}

export const ORDER_CATEGORY_FILTER_OPTIONS = [
  { value: "ALL", label: "Semua kategori" },
  { value: "FISIK", label: "Fisik" },
  { value: "DIGITAL", label: "Digital" },
  { value: "JASA", label: "Jasa" },
]

export const FULFILLMENT_FILTER_OPTIONS = [
  { value: "ALL", label: "Semua sistem" },
  { value: "BIASA", label: "Langsung" },
  { value: "PREORDER", label: "Preorder" },
]

export const PARTICIPANT_MODE_FILTER_OPTIONS = [
  { value: "ALL", label: "Semua peserta" },
  { value: "SINGLE", label: "Sendiri" },
  { value: "GROUP", label: "Patungan" },
]
