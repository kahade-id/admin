# Release Gate — Admin Web Kahade

> G523. Checklist ini WAJIB lolos sebelum setiap rilis admin ke produksi
> (`admin.kahade.id`). Produk keuangan — zero tolerance.

## 1. Automated gates (harus hijau)

| Gate | Perintah | Ambang |
|------|----------|--------|
| Unit + smoke | `npm test` | 100% lolos |
| Coverage | `npm run test:coverage` | lihat §3 |
| Typecheck | `npx tsc --noEmit` | 0 error |
| Lint | `npm run lint` | 0 error |
| Aksesibilitas | `npm test -- tests/a11y` | 100% lolos (axe, kontras, keyboard) |
| E2E auth | `npm run test:e2e` | lolos (butuh `npx playwright install chromium`) |

## 2. Manual gates (checklist G525)

Isi `docs/manual-test-checklist.md` untuk rilis ini: setiap baris
ditandai LULUS / GAGAL / N/A dengan nama penguji dan tanggal.

## 3. Coverage minimum per domain (G525)

Diukur dari suite unit (`npx vitest run --coverage tests/unit`) pada
2026-09-26. Kolom "Aktual" adalah hasil nyata, bukan target.

| Domain | File sumber | Min. | Aktual (2026-09-26) |
|--------|-------------|------|---------------------|
| RBAC | `src/lib/rbac.ts`, `role-gate.tsx` | 90% | 100% ✅ |
| API support | `src/lib/api/admin/support.ts` | 80% | 100% ✅ |
| API KYC | `src/lib/api/admin/kyc.ts` | 80% | 66% ⚠️ |
| API bisnis | `src/lib/api/admin/business.ts` | 80% | 43% ⚠️ |
| API finance | `src/lib/api/admin/finance.ts` | 80% | 50% ⚠️ |
| API campaign | `src/lib/api/admin/campaigns.ts` | 80% | 64% ⚠️ |
| API showcase-reports | `src/lib/api/admin/showcase-reports.ts` | 80% | 59% ⚠️ |
| API feedback | `src/lib/api/admin/feedback.ts` | 80% | 83% ✅ |
| PII masking | `src/lib/pii.ts` | 95% | 100% ✅ |
| Locale/format | `src/lib/format.ts` | 90% | 85% ⚠️ |

**Status gate: BELUM LULUS.** Modul baru dari worker paralel
(users, vouchers, management, disputes, orders, chat, courier, products,
returns, dll.) berada di 0% dan butuh test kontrak API menyusul —
**release blocker sampai gate ini hijau**, kecuali disetujui eksplisit
oleh user dengan catatan risiko.

Jalankan: `npx vitest run --coverage tests/unit` lalu baca
`tests/coverage/coverage-summary.json` (di-gitignore).

## 4. Aksesibilitas (G513–G518)

- [ ] axe scan 5 halaman kunci tanpa violation
- [ ] Semua icon-button punya accessible name (audit statis hijau)
- [ ] Dialog: focus trap + return focus (test G515 hijau)
- [ ] Kontras token ≥ 4.5:1 (test G516 hijau)
- [ ] Tidak ada min-width > 320px (audit G517 hijau)

## 5. Keamanan rilis

- [ ] Tidak ada secret/credential di diff (`git diff` diinspeksi)
- [ ] `@AdminRoles` tidak berubah tanpa persetujuan eksplisit
- [ ] PII di-mask di tampilan daftar (test G506 hijau)
- [ ] Idempotency-Key terkirim untuk aksi uang (test G506/G504 hijau)

## 6. Tanda tangan rilis

- Rilis: _______________ Tanggal: _______________
- QA: _______________ (semua gate di atas hijau)
- Catatan: _______________
