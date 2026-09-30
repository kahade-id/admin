/**
 * Helper format untuk panel admin Kahade (web).
 *
 * Khusus tim internal Indonesia — tidak ada i18n, semua label Bahasa
 * Indonesia. Murni fungsi tanpa dependensi lain.
 */

/** "26 Sep 2026, 14.30 WIB" — input kosong/invalid → "—". */
export function formatDateTimeWIB(d: Date | number | string | null | undefined): string {
  if (d == null || d === "") return "—"
  const date = d instanceof Date ? d : new Date(d)
  if (Number.isNaN(date.getTime())) return "—"
  const parts = new Intl.DateTimeFormat("id-ID", {
    timeZone: "Asia/Jakarta",
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date)
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? ""
  return `${get("day")} ${get("month")} ${get("year")}, ${get("hour")}.${get("minute")} WIB`
}

/** "1.234.567" — non-finite → "—". */
export function formatNumber(n: unknown): string {
  if (typeof n !== "number" || !Number.isFinite(n)) return "—"
  return Math.trunc(n).toLocaleString("id-ID")
}

/**
 * "Rp1.234.567" — format mata uang IDR gaya Indonesia (tanpa desimal).
 * Non-finite → "—".
 *
 * DBL-003 (audit integrasi 2026-10-01): KEBIJAKAN PECAHAN KANONIS LINTAS
 * REPO — pecahan Rupiah finite DIBULATKAN ke rupiah terdekat (Math.round),
 * selaras backend `formatIdr` dan frontend `formatRupiah`. Math.trunc lama
 * diam-diam memotong (100000.9 → Rp100.000), membuat admin menampilkan
 * nominal lebih kecil dari backend/frontend.
 */
export function formatIDR(n: unknown): string {
  if (typeof n !== "number" || !Number.isFinite(n)) return "—"
  return `Rp${Math.round(n).toLocaleString("id-ID")}`
}

/**
 * "Rp1.234" — nilai dalam SEN (1/100 rupiah) → rupiah.
 * Backend returns/refund memakai sen; string|number diterima.
 */
export function formatIdrSen(sen: string | number | null | undefined): string {
  if (sen == null) return "—"
  const n = typeof sen === "string" ? Number(sen) : sen
  if (typeof n !== "number" || !Number.isFinite(n)) return "—"
  return formatIDR(Math.round(n / 100))
}

/** Angka aman untuk statistik dasbor. */
export function num(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0
}

/**
 * Umur tiket: "45 mnt", "3 jam", "Kemarin", "2 hari" — input kosong/invalid → "—".
 *
 * DBL-009 (audit integrasi 2026-10-01): BUCKET WAKTU KANONIS LINTAS REPO —
 * <24 jam → "X jam", 24–48 jam → "Kemarin", selebihnya "X hari" (selaras
 * frontend `formatTimeAgo`). Dulu jam dipakai sampai 48 ("30 jam"), sehingga
 * umur yang sama dibaca "Kemarin" di aplikasi tapi "30 jam" di panel admin.
 */
export function formatAge(d: Date | number | string | null | undefined): string {
  const h = ageHours(d)
  if (h == null) return "—"
  if (h < 1) return `${Math.max(0, Math.floor(h * 60))} mnt`
  if (h < 24) return `${Math.floor(h)} jam`
  if (h < 48) return "Kemarin"
  return `${Math.floor(h / 24)} hari`
}

/** Umur dalam jam desimal — input kosong/invalid → null. */
export function ageHours(d: Date | number | string | null | undefined): number | null {
  if (d == null || d === "") return null
  const date = d instanceof Date ? d : new Date(d)
  if (Number.isNaN(date.getTime())) return null
  return Math.max(0, (Date.now() - date.getTime()) / 3600000)
}
