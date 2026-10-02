/**
 * Validasi sisi klien — pola kanonis lintas repo.
 *
 * SYS-C-204 (audit integrasi ronde 3): tiga pola email berbeda hidup tanpa
 * dokumentasi — FE mobile `/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/`, admin
 * `/^\S+@\S+\.\S+$/` (bahkan pernah tertulis dengan backslash ganda
 * `/^\\S+@\\S+\\.\\S+$/` di team/page.tsx sehingga MENOLAK SEMUA email
 * valid), backend `@IsEmail()` (validator.js, paling ketat).
 *
 * KEPUTUSAN KANONIS (didokumentasikan di sini):
 * - Klien (admin & FE) memakai pola LONGGAR di bawah — hanya untuk UX
 *   (menangkap typo jelas seperti "tanpa @"). Pola longgar SENGAJA tidak
 *   meniru validator.js: pola admin lama (`/^\S+@\S+\.\S+$/`, team/page.tsx)
 *   menolak `user@my_domain.com` yang sah, sementara FE menerima —
 *   inkonsistensi antar klien tanpa alasan. Satu pola = satu perilaku.
 * - Backend `@IsEmail()` (validator.js) adalah PENEGAK FINAL (fail-safe:
 *   klien lolos tapi server tolak — tidak pernah sebaliknya).
 * - Jangan menulis regex email inline baru; selalu pakai `isValidEmail()`.
 */
export const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/

/** true bila email lolos pola kanonis klien (bukan pengganti validasi server). */
export function isValidEmail(value: string): boolean {
  return EMAIL_PATTERN.test(value.trim())
}
