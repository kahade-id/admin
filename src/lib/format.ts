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

/**
 * "26 Sep 2026" — tanggal saja dalam WIB, input kosong/invalid → "—".
 *
 * BAI-129: backend analitik kini mengirim bucket sebagai string kalender
 * "YYYY-MM-DD" (tanggal WIB, bukan timestamp). String itu DIPARSE SEBAGAI
 * TANGGAL WIB — bukan `new Date("2026-09-30")` (UTC midnight) yang bila
 * diformat dengan jam tampil sebagai "07.00 WIB" menyesatkan.
 */
export function formatDateWIB(d: Date | number | string | null | undefined): string {
  if (d == null || d === "") return "—"
  let date: Date
  if (typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d)) {
    // Tanggal kalender WIB: jangkar ke tengah hari UTC (= 19.00 WIB hari yang
    // sama) agar aman di zona waktu browser mana pun.
    const [y, m, day] = d.split("-").map(Number)
    date = new Date(Date.UTC(y, m - 1, day, 12, 0, 0))
  } else {
    date = d instanceof Date ? d : new Date(d)
  }
  if (Number.isNaN(date.getTime())) return "—"
  return new Intl.DateTimeFormat("id-ID", {
    timeZone: "Asia/Jakarta",
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(date)
}

/**
 * Tambah `days` hari ke string kalender "YYYY-MM-DD" (aritmetika WIB-aman),
 * mengembalikan "YYYY-MM-DD".
 */
export function addDaysToDateString(isoDate: string, days: number): string {
  const [y, m, day] = isoDate.split("-").map(Number)
  const d = new Date(Date.UTC(y, m - 1, day, 12, 0, 0) + days * 86_400_000)
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`
}

/** Hari terakhir bulan dari string kalender "YYYY-MM-DD" → "YYYY-MM-DD". */
export function endOfMonthDateString(isoDate: string): string {
  const [y, m] = isoDate.split("-").map(Number)
  // Hari 0 bulan berikutnya = hari terakhir bulan ini (UTC-aman).
  const d = new Date(Date.UTC(y, m, 0, 12, 0, 0))
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`
}

/** "1.234.567" — non-finite → "—". */
export function formatNumber(n: unknown): string {
  if (typeof n !== "number" || !Number.isFinite(n)) return "—"
  return Math.trunc(n).toLocaleString("id-ID")
}

/**
 * "Rp1.234.567" — format mata uang IDR gaya Indonesia.
 *
 * BAI-052: backend `toIdr` bisa mengembalikan pecahan (mis. 12345 sen →
 * 123.45 rupiah). Versi lama memakai `Math.trunc` sehingga "Rp123" —
 * memotong fraksi sen secara diam-diam. Kini: bilangan bulat tetap tanpa
 * desimal; pecahan ditampilkan 2 desimal (Rp123,45).
 * Non-finite → "—".
 *
 * DBL-003 (audit integrasi 2026-10-01) sempat mengusulkan pecahan Rupiah
 * DIBULATKAN ke rupiah terdekat (Math.round) sebagai kebijakan kanonis
 * lintas repo — MERGE 2026-10-01: koordinator MEMUTUSKAN kontrak audit yang
 * benar dipertahankan, yaitu pecahan sen TAMPIL 2 desimal (BAI-052), BUKAN
 * Math.round yang menghilangkan fraksi sen (Rp150.000,99 → Rp150.001).
 */
export function formatIDR(n: unknown): string {
  if (typeof n !== "number" || !Number.isFinite(n)) return "—"
  if (Number.isInteger(n)) return `Rp${n.toLocaleString("id-ID")}`
  const rounded = Math.round(n * 100) / 100
  return `Rp${rounded.toLocaleString("id-ID", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
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
