# GO-PUBLIK Wave 2 — Catatan performa admin web

Tanggal: 2026-09-28. Branch: `go-publik/admin-wave2`. Scope: polish ringan + perf, tanpa fitur baru, tanpa ubah matriks RBAC.

## Yang diperiksa (halaman berat / pola query)

| Area | Hasil |
|---|---|
| Dasbor (`(panel)/page.tsx`) | **Diperbaiki**: `getFinancialSummary()` dipanggil sekuensial setelah 3 request paralel → kini ikut dalam `Promise.all` yang sama (`.catch(() => null)` menjaga semantik fail-soft: gagal = tampil "—"). |
| Pengguna, Sengketa, Moderasi chat, Pesanan | Semua tabel pakai pagination server-side (limit 20) + debounce pencarian + `Promise.all` untuk fetch paralel. Tidak ada N+1 per-baris di sisi klien. |
| Keuangan (`finance/page.tsx`) | Agregat masuk/keluar dihitung **client-side** dari hasil `listTransactions` dengan cap `AGGREGATE_CAP = 3000` baris (`Math.min(total, 3000)`). Sudah diberi label "(dibatasi 3.000 pertama)" di UI. |
| Detail pengguna (`users/[id]`) | 5 fetch paralel via `Promise.allSettled` — OK. |
| Detail sengketa / order | Fetch paralel (`Promise.all`) — OK. |

## Tidak diubah (sengaja)

- Agregat finance client-side 3000 baris: bisa, tapi perbaikan "benar" adalah endpoint agregasi di backend (repo backend, di luar scope admin). Cap + label UI sudah jujur soal batasnya.
- RBAC Wave 1 (`src/lib/rbac.ts`, `role-gate`): tidak disentuh — diff kosong terhadap `origin/main`.

## Polish bahasa Indonesia (ringkasan)

- `chat/page.tsx`: filter "Pending" → "Menunggu"; severity "Low/Medium/High/Critical" → "Rendah/Sedang/Tinggi/Kritis"; label filter "Severity" → "Tingkat keparahan"; badge status tidak lagi render raw enum (map `STATUS_LABEL`); riwayat review memakai label yang sama.
- `disputes/[id]/page.tsx`: status usulan damai (ACCEPTED/REJECTED/EXPIRED/PENDING) → "Diterima/Ditolak/Kedaluwarsa/Menunggu".
- `finance/page.tsx`: filter "Pending" → "Menunggu".
- `users/page.tsx`: kolom saldo `Rp ${formatNumber(null)}` = "Rp —" yang aneh → `formatIDR` (null-safe, tampil "—"; konsisten tanpa spasi `Rp1.234` seperti halaman lain).
- `observability/page.tsx`: header tabel antrean Bull "Queue/Waiting/Active/Delayed/Failed" → "Antrean/Menunggu/Aktif/Tertunda/Gagal"; "Severity" → "Tingkat keparahan"; "Error" (errorRate) → "Gagal".
- `system/page.tsx`: header "Error" → "Pesan error". `status/page.tsx`: label/header "Severity" → "Tingkat keparahan".
- `reports/showcase/page.tsx`: toast "Assign gagal" → "Penugasan gagal".
- `courier/page.tsx`: tombol "Refresh" → "Segarkan".
- `kyc/metrics/page.tsx`: header "Min" → "Min." (konsisten dengan "Maks").
- Dasbor: tanpa perubahan bahasa (sudah Indonesia).

## Verifikasi

- `npx tsc --noEmit`: 0 error.
- `npm test` (vitest): 28 file, 300 test — semua lolos.
- `npm run build`: sukses.
