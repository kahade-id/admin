/**
 * Katalog copy error backend → pesan spesifik (SYS-A-001).
 *
 * Root cause: backend melempar 362 kode error unik; admin meneruskan `code`
 * mentah tanpa pemetaan (admin-client.ts) sehingga operator melihat pesan
 * generik/menyesatkan untuk kegagalan bisnis yang spesifik — terutama jalur
 * uang. FE memakai katalog `ApiErrorCode` + heuristik substring
 * (frontend/lib/api/errors.ts); katalog ini adalah pasangan sisi admin:
 * lookup tabel EKSPLISIT `Record<kode backend, copy Indonesia>` — JANGAN
 * tambah pola `includes()` baru (audit: itu menambal gejala).
 *
 * Kontrak:
 * - `code` mentah SELALU dipertahankan di error untuk branching UI
 *   (`err.code` / `err.backendCode`) — yang diganti hanya `message` tampil.
 * - Kode yang TIDAK ada di tabel → pesan backend apa adanya (operator
 *   internal boleh melihat pesan teknis; lebih informatif daripada generik).
 * - Copy ditulis untuk operator admin: spesifik, menyebut aksi korektif,
 *   fail-closed (tidak menyarankan retry bila retry berbahaya untuk uang).
 */
export const BACKEND_CODE_COPY: Record<string, string> = {
  // ——— Jalur uang kritis ———
  ESCROW_LOCK_MISSING:
    "Kunci escrow tidak ditemukan. JANGAN ulangi aksi — catat ID order dan eskalasi ke tim backend.",
  DANA_REFUND_FAILED:
    "Refund via DANA gagal. Dana belum kembali ke pembeli — cek status di DANA dashboard sebelum mencoba lagi.",
  DANA_TRANSFER_BANK_FAILED:
    "Transfer/disburse DANA ke bank gagal. Jangan tandai sukses manual tanpa verifikasi mutasi DANA.",
  DISBURSEMENT_UNAVAILABLE:
    "Layanan disbursement sedang tidak tersedia. Tunda pencairan, jangan paksa status sukses.",
  ORDER_QRIS_REFUND_REQUIRES_REVIEW:
    "Refund QRIS order ini butuh review manual. Jangan proses otomatis — buka detail order.",
  MILESTONE_INVARIANT_VIOLATION:
    "Invariant milestone dilanggar (total alokasi tidak konsisten). Hentikan aksi dan eskalasi — kemungkinan bug.",
  MILESTONE_CANCEL_REFUND_FAILED:
    "Refund pembatalan milestone gagal. Cek ledger sebelum retry agar tidak bayar ganda.",
  // ——— Bukti sengketa ———
  MAX_EVIDENCE_REACHED:
    "Batas jumlah bukti tercapai. Hapus bukti lama bila perlu menambah yang baru.",
  EVIDENCE_SIZE_LIMIT_EXCEEDED:
    "Total ukuran bukti melebihi batas. Kecilkan/kompres file lalu coba lagi.",
  // ——— Auth & throttling ———
  CAPTCHA_REQUIRED:
    "Verifikasi CAPTCHA diperlukan sebelum lanjut.",
  ACCOUNT_LOCKED:
    "Akun terkunci sementara karena terlalu banyak percobaan gagal. Coba lagi setelah masa kunci berakhir.",
  PIN_RATE_LIMITED:
    "Terlalu banyak PIN salah — akses dikunci 15 menit.",
  // ——— Kontrak request ———
  IDEMPOTENCY_KEY_REQUIRED:
    "Kunci idempotensi wajib (bug klien — laporkan). Jangan kirim ulang manual tanpa kunci yang sama.",
  VALIDATION_ERROR:
    "Data tidak valid. Periksa field yang ditandai lalu coba lagi.",
}

/** Copy spesifik untuk kode backend, atau undefined bila kode tak dikenal. */
export function errorCopyForCode(code: string | undefined | null): string | undefined {
  if (!code) return undefined
  return BACKEND_CODE_COPY[code]
}
