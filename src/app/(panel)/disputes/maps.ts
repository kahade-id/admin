/** Peta label & tone status sengketa — dipakai halaman daftar & detail. */

export const DISPUTE_STATUS_LABEL: Record<string, string> = {
  OPEN: "Terbuka",
  ASSIGNED: "Ditugaskan",
  UNDER_REVIEW: "Ditinjau",
  ESCALATED: "Dieskalasi",
  RESOLVED: "Selesai",
}

export const DISPUTE_STATUS_TONE: Record<
  string,
  "neutral" | "info" | "success" | "warning" | "danger" | "accent"
> = {
  OPEN: "warning",
  ASSIGNED: "info",
  UNDER_REVIEW: "info",
  ESCALATED: "danger",
  RESOLVED: "success",
}

/** Label kategori sengketa (enum backend DisputeCategory) — selaras frontend mobile. */
export const DISPUTE_CATEGORY_LABEL: Record<string, string> = {
  ITEM_NOT_RECEIVED: "Barang tidak diterima",
  ITEM_NOT_AS_DESCRIBED: "Tidak sesuai deskripsi",
  DAMAGED_ITEM: "Barang rusak",
  WRONG_ITEM: "Barang salah",
  SERVICE_NOT_RENDERED: "Jasa tidak dijalankan",
  PAYMENT_ISSUE: "Masalah pembayaran",
  FRAUD: "Indikasi penipuan",
  OTHER: "Lainnya",
}
