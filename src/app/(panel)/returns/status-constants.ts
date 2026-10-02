/**
 * BAD-002: konstanta status retur bersama — SATU sumber kebenaran.
 *
 * Sebelumnya `returns/page.tsx` mendeklarasikan
 * `APPROVABLE_STATUSES = ["APPROVED", "RECEIVED"]` yang SALAH: backend hanya
 * menerima APPROVE refund dari `REQUESTED`/`SELLER_REVIEW`
 * (`backend/src/modules/returns/returns.service.ts:1412-1413`), sehingga
 * tombol "Setujui refund" di daftar selalu 400. Halaman detail
 * (`returns/[id]/page.tsx`) sudah benar — kini keduanya import dari sini.
 */

/** Status awal — retur masih bisa dieskalasi / ditolak / diperpanjang deadline-nya. */
export const EARLY_STATUSES: string[] = ["REQUESTED", "SELLER_REVIEW"]

/**
 * BAD-002: status dari mana APPROVE refund diizinkan backend
 * (sellerRespondAsAdmin guard) — BUKAN ["APPROVED", "RECEIVED"].
 */
export const APPROVABLE_STATUSES: string[] = ["REQUESTED", "SELLER_REVIEW"]

/**
 * BAI-082: status dari mana "Tutup paksa" (resolveReturn) diizinkan backend.
 */
export const FORCEABLE_STATUSES: string[] = ["APPROVED", "RECEIVED"]

/** Status terminal — tidak ada aksi tersisa. */
export const TERMINAL_STATUSES: string[] = [
  "RESOLVED_REFUND",
  "RESOLVED_EXCHANGE",
  "RESOLVED_REPAIR",
  "CANCELLED",
  "EXPIRED",
]
