/**
 * G524 — Data sintetis untuk staging harness.
 *
 * ATURAN KERAS: tidak ada PII asli. Semua nama/email/telepon dibuat
 * secara deterministik dari pola yang jelas-jelas fiktif ("contoh",
 * "test", domain `.example`). Jangan pernah menyalin data produksi
 * ke file ini.
 */

function pad(n: number, w = 3): string {
  return String(n).padStart(w, "0")
}

/** Nama fiktif Indonesia — jelas sintetis. */
export function syntheticName(i: number): string {
  const first = ["Budi", "Sari", "Agus", "Dewi", "Rina", "Joko", "Putri", "Hendra"]
  const last = ["Contoh", "Uji", "Fiktif", "Sampel", "Tes", "Dummy"]
  return `${first[i % first.length]} ${last[Math.floor(i / first.length) % last.length]} ${pad(i)}`
}

/** Email fiktif — domain .example tidak bisa menerima email (RFC 2606). */
export function syntheticEmail(i: number): string {
  return `pengguna.contoh.${pad(i)}@kahade.example`
}

/** Telepon fiktif — prefix 0811-000 yang tidak dialokasikan. */
export function syntheticPhone(i: number): string {
  return `0811000${pad(i, 4)}`
}

export type SyntheticKycRow = {
  kycId: string
  userId: string
  fullName: string
  status: "PENDING" | "APPROVED" | "REJECTED"
  submittedAt: string
}

export function syntheticKycQueue(n: number): SyntheticKycRow[] {
  return Array.from({ length: n }, (_, i) => ({
    kycId: `kyc-synth-${pad(i, 4)}`,
    userId: `user-synth-${pad(i, 4)}`,
    fullName: syntheticName(i),
    status: i % 5 === 4 ? "REJECTED" : i % 3 === 0 ? "APPROVED" : "PENDING",
    submittedAt: new Date(Date.UTC(2026, 8, 20 + (i % 6), 8, 0, 0)).toISOString(),
  }))
}

export type SyntheticTicket = {
  id: string
  subject: string
  status: "OPEN" | "IN_PROGRESS" | "RESOLVED"
  requesterName: string
}

export function syntheticTickets(n: number): SyntheticTicket[] {
  const subjects = [
    "Dana escrow belum cair",
    "Gagal verifikasi KTP",
    "Pertanyaan biaya layanan",
    "Akun terkunci setelah ganti HP",
  ]
  return Array.from({ length: n }, (_, i) => ({
    id: `tkt-synth-${pad(i, 4)}`,
    subject: `${subjects[i % subjects.length]} (contoh #${pad(i)})`,
    status: (["OPEN", "IN_PROGRESS", "RESOLVED"] as const)[i % 3],
    requesterName: syntheticName(i + 100),
  }))
}

/** Nominal IDR acak deterministik (tanpa pecahan). */
export function syntheticAmountIDR(i: number): number {
  return 50000 + ((i * 137500) % 4950000)
}
