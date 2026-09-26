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

/** Angka aman untuk statistik dasbor. */
export function num(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0
}

/** Umur tiket: "45 mnt", "3 jam", "2 hari" — input kosong/invalid → "—". */
export function formatAge(d: Date | number | string | null | undefined): string {
  const h = ageHours(d)
  if (h == null) return "—"
  if (h < 1) return `${Math.max(0, Math.floor(h * 60))} mnt`
  if (h < 48) return `${Math.floor(h)} jam`
  return `${Math.floor(h / 24)} hari`
}

/** Umur dalam jam desimal — input kosong/invalid → null. */
export function ageHours(d: Date | number | string | null | undefined): number | null {
  if (d == null || d === "") return null
  const date = d instanceof Date ? d : new Date(d)
  if (Number.isNaN(date.getTime())) return null
  return Math.max(0, (Date.now() - date.getTime()) / 3600000)
}
