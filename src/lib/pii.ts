/**
 * Kahade Admin Web — util masking PII (G506).
 *
 * Fondasi agar no HP / email pengguna tidak tampil mentah di panel admin.
 * Fungsi murni (tanpa dependensi) sehingga mudah di-test dan dipakai di
 * komponen mana pun. Konvensi:
 * - email:  "budi.santoso@example.com" → "bu•••@example.com"
 * - phone:  "+6281234567890"           → "+62••• ••• 7890" (4 digit akhir)
 * - name:   "Budi Santoso"             → "B••• S••••••"
 * - account:"1234567890"              → "••••••7890" (4 digit akhir)
 *
 * Nilai kosong/null/undefined → "—" (konsisten dengan format.ts).
 */
export function maskEmail(email: string | null | undefined): string {
  if (!email || typeof email !== "string") return "—"
  const at = email.indexOf("@")
  if (at <= 0) return "•••"
  const local = email.slice(0, at)
  const domain = email.slice(at + 1)
  if (!domain) return "•••"
  const head = local.slice(0, 2)
  return `${head}•••@${domain}`
}

export function maskPhone(phone: string | null | undefined): string {
  if (!phone || typeof phone !== "string") return "—"
  const trimmed = phone.trim()
  const digits = trimmed.replace(/\D/g, "")
  if (digits.length < 4) return "•••"
  const last4 = digits.slice(-4)
  const plus = trimmed.startsWith("+") ? "+" : ""
  // Pertahankan kode negara kasar (2 digit pertama) bila cukup panjang.
  const cc = digits.length > 6 ? digits.slice(0, 2) : ""
  return `${plus}${cc}••• ••• ${last4}`
}

export function maskName(name: string | null | undefined): string {
  if (!name || typeof name !== "string" || !name.trim()) return "—"
  return name
    .trim()
    .split(/\s+/)
    .map((w) => (w.length <= 1 ? "•" : `${w[0]}${"•".repeat(Math.min(w.length - 1, 6))}`))
    .join(" ")
}

export function maskAccountNumber(acc: string | null | undefined): string {
  if (!acc || typeof acc !== "string") return "—"
  const digits = acc.replace(/\D/g, "")
  if (digits.length < 4) return "••••"
  return `••••••${digits.slice(-4)}`
}

/**
 * Sapu satu objek: mask field yang namanya mengindikasikan PII.
 * Dipakai untuk memastikan payload log/debug tidak membocorkan PII mentah.
 */
/**
 * Sapu satu objek: mask field yang namanya mengindikasikan PII.
 * Dipakai untuk memastikan payload log/debug tidak membocorkan PII mentah.
 */
export function maskPiiInObject<T extends Record<string, unknown>>(obj: T): T {
  const out: Record<string, unknown> = { ...obj }
  for (const key of Object.keys(out)) {
    const lower = key.toLowerCase()
    const v = out[key]
    if (typeof v !== "string") continue
    if (lower.includes("email")) out[key] = maskEmail(v)
    else if (lower.includes("phone")) out[key] = maskPhone(v)
    else if (lower.includes("accountnumber")) out[key] = maskAccountNumber(v)
    else if (lower === "fullname" || lower === "name") out[key] = maskName(v)
  }
  return out as T
}
