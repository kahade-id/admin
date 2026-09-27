# Manual Test Checklist — Admin Web Kahade

> G525. Salin file ini per rilis: `docs/manual-checklist-<tanggal>.md`.
> Tandai tiap baris: ✅ LULUS / ❌ GAGAL / ➖ N/A + inisial penguji.

## A. Auth & sesi (G511)

- [ ] Login email+password valid → dashboard
- [ ] Login salah → pesan error, tetap di /login
- [ ] Token kedaluwarsa → refresh otomatis, tidak logout paksa
- [ ] Logout → /login, buka / manual → redirect /login
- [ ] Buka / tanpa token → redirect /login

## B. RBAC per role (G502/G512)

Untuk tiap role (SUPER_ADMIN, DISPUTE_ADMIN, KYC_ADMIN, FINANCE_ADMIN,
CUSTOMER_SUPPORT):

- [ ] Menu hanya menampilkan route yang diizinkan
- [ ] Akses langsung URL terlarang → "Akses ditolak" (bukan crash)
- [ ] `/login` bisa diakses semua (termasuk guest)

## C. Alur domain (G503–G509)

- [ ] Tiket: list → detail → ubah status → balas
- [ ] KYC: antrean → detail → setujui/tolak + alasan
- [ ] KYC bulk: pilih 2 → setujui massal → hasil partial tampil
- [ ] Bisnis: antrean → detail → verifikasi
- [ ] Finance: daftar transaksi → detail → tarik dana (cek idempotency: klik 2× = 1 aksi)
- [ ] Kampanye: buat → aktifkan → jeda → hapus
- [ ] Laporan etalase: list → tinjau → takedown/abaikan
- [ ] Feedback: list → balas (terpisah dari tiket support)

## D. PII & locale (G506/G519)

- [ ] Email/no. HP di daftar tampil ter-mask (b***@…)
- [ ] Nominal tampil format IDR (Rp1.500.000)
- [ ] Waktu tampil WIB + label Indonesia

## E. Aksesibilitas manual (G513–G518)

- [ ] Navigasi keyboard penuh satu halaman (tanpa mouse)
- [ ] Dialog: Tab tidak kabur ke latar; Esc menutup; fokus kembali ke pemicu
- [ ] Zoom browser 400%: tidak ada konten terpotong tanpa scroll
- [ ] Screen reader (NVDA/VoiceOver): tabel terbaca dengan header; toast diumumkan

## F. Viewport (G521)

- [ ] Laptop 1440×900: sidebar + konten normal
- [ ] Tablet 768×1024: tidak ada overlap
- [ ] Ponsel 390×844: tidak ada scroll horizontal halaman

## G. Regresi visual (G520)

- [ ] Screenshot 6 halaman kunci dibanding baseline: tidak ada perbedaan tak disengaja

---

Penguji: _______________ Tanggal: _______________ Hasil: LULUS / GAGAL
Temuan: _______________
