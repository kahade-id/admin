/**
 * Helper format untuk panel admin Kahade (web).
 *
 * Khusus tim internal Indonesia — tidak ada i18n, semua label Bahasa
 * Indonesia. Murni fungsi tanpa dependensi lain.
 */

/** "26 Sep 2026, 14:30 WIB" — input kosong/invalid → "—".
 *
 * FAL-021 (audit integrasi 2026-10-03): samakan ke format FE (titik-dua,
 * bukan titik) — "14.30" → "14:30".
 */
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
  return `${get("day")} ${get("month")} ${get("year")}, ${get("hour")}:${get("minute")} WIB`
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

/**
 * "1.234.567" — non-finite → "—".
 *
 * BAD-021 (audit integrasi 2026-10-03): `Math.trunc` → `Math.round`
 * (round-half-up), selaras kebijakan pecahan kanonis DBL-003/004.
 * CATATAN: temuan menyebut `formatIDR`, tetapi satu-satunya `Math.trunc`
 * di file ini ada di fungsi ini — `formatIDR` sudah memakai pembulatan
 * 2 desimal (BAI-052) dan TIDAK diubah.
 */
export function formatNumber(n: unknown): string {
  if (typeof n !== "number" || !Number.isFinite(n)) return "—"
  return Math.round(n).toLocaleString("id-ID")
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

/**
 * Waktu relatif: "Baru saja" → "5 menit lalu" → "2 jam lalu" → "Kemarin" →
 * tanggal eksplisit. Invalid → "—".
 *
 * FAL-022 (audit integrasi 2026-10-03): selaras konvensi FE
 * `formatTimeAgo` (DBL-009 bucket kanonis lintas repo) — <24 jam →
 * "X jam lalu", 24–48 jam → "Kemarin" (delta jam, bukan hari kalender),
 * selebihnya tanggal eksplisit. Beda dari `formatAge`: fungsi ini memakai
 * sufiks "lalu"/"Kemarin" seperti FE; fallback tanggal memakai WIB
 * (konvensi admin). `now` bisa disuntik untuk test; delta negatif dijepit
 * ke 0 → "Baru saja".
 */
export function formatRelativeTime(
  d: Date | number | string | null | undefined,
  now: Date | number = Date.now(),
): string {
  if (d == null || d === "") return "—"
  const date = d instanceof Date ? d : new Date(d)
  if (Number.isNaN(date.getTime())) return "—"
  const base = typeof now === "number" ? now : now.getTime()
  const deltaSec = Math.max(0, Math.floor((base - date.getTime()) / 1000))
  if (deltaSec < 60) return "Baru saja"
  const minutes = Math.floor(deltaSec / 60)
  if (minutes < 60) return `${minutes} menit lalu`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} jam lalu`
  // DBL-009: "Kemarin" = 24–48 jam lalu (delta jam) — selaras FE.
  if (hours < 48) return "Kemarin"
  return formatDateWIB(date)
}

/**
 * Label per tipe untuk pesan tanpa teks yang bisa ditampilkan
 * (FAL-004, audit integrasi 2026-10-03) — memakai data yang SUDAH dikirim
 * backend, bukan menebak isi:
 * - IMAGE → "Gambar", VIDEO → "Video"
 * - FILE → "Dokumen: {fileName}", VOICE → "Pesan suara ({durationSeconds} dtk)"
 * - LOCATION → "Lokasi: {label}"
 * - PRODUCT_CARD/ORDER_CARD → ringkasan dari `cardSnapshot`/`card`
 *   (title, harga, orderCode)
 * - POLL → "Polling: {question}"
 * - TEXT/SYSTEM tanpa teks → "Isi disembunyikan — DM privat"
 *   (backend tidak mengirim isi untuk DM privat; media tanpa caption memang
 *   tidak punya teks — bukan isi yang disembunyikan).
 */
export function messageFallbackLabel(message: unknown): string {
  const obj = (message ?? {}) as Record<string, unknown>
  const t = String(obj.messageType ?? obj.type ?? "TEXT").toUpperCase()
  const str = (v: unknown): string =>
    typeof v === "string" && v.trim() ? v : ""
  switch (t) {
    case "IMAGE":
      return "Gambar"
    case "VIDEO":
      return "Video"
    case "FILE": {
      const name = str(obj.fileName) || str(obj.file_name) || str(obj.name)
      return name ? `Dokumen: ${name}` : "Dokumen"
    }
    case "VOICE": {
      const dur = obj.durationSeconds ?? obj.duration_seconds
      return typeof dur === "number" && Number.isFinite(dur)
        ? `Pesan suara (${dur} dtk)`
        : "Pesan suara"
    }
    case "LOCATION": {
      const label = str(obj.label) || str(obj.address)
      return label ? `Lokasi: ${label}` : "Lokasi"
    }
    case "PRODUCT_CARD":
    case "ORDER_CARD": {
      const snap = (obj.cardSnapshot ?? obj.card_snapshot ?? obj.card ?? {}) as Record<
        string,
        unknown
      >
      const title = str(snap.title)
      const code = str(snap.orderCode) || str(snap.order_code)
      const priceRaw = snap.price ?? snap.amount
      const price =
        typeof priceRaw === "number" && Number.isFinite(priceRaw)
          ? ` · ${formatIDR(priceRaw)}`
          : ""
      const bits = [title || (t === "PRODUCT_CARD" ? "Kartu produk" : "Kartu order")]
      if (code) bits.push(code)
      return `${bits.join(" · ")}${price}`
    }
    case "POLL": {
      const poll = (obj.poll ?? {}) as Record<string, unknown>
      const q = str(obj.question) || str(poll.question)
      return q ? `Polling: ${q}` : "Polling"
    }
    case "SYSTEM":
      return "Pesan sistem"
    default:
      return "Isi disembunyikan — DM privat"
  }
}
