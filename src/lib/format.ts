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
