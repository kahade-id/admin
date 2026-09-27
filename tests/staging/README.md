# Staging Harness (G524)

Harness untuk menguji alur admin melawan **data sintetis** — tanpa backend
staging, tanpa PII asli.

## Struktur

| File | Isi |
|------|-----|
| `synthetic.ts` | Generator data fiktif deterministik (nama/email/telepon jelas palsu) |
| `mock-provider.ts` | `adminHttp` mock **stateful**: list/filter/paginasi + aksi tulis yang mengubah data |
| `flows.test.ts` | Test alur: KYC approve/reject, balas tiket, guard 409, audit no-PII |

## Menjalankan

```bash
npm run test:staging        # vitest run tests/staging
```

## Aturan data

- **Tidak ada PII asli.** Nama selalu mengandung penanda fiktif
  (`contoh`, `uji`, `fiktif`, …); email memakai domain `.example`
  (RFC 2606, tidak routable); telepon memakai prefix `0811000…`
  yang tidak dialokasikan.
- Test `data sintetis: tidak ada PII asli` gagal bila ada data yang
  lolos tanpa penanda — jangan pernah menyalin data produksi ke sini.

## Beralih ke backend staging nyata

1. Ganti `vi.mock("@/lib/api/admin-client")` dengan client yang menunjuk
   `https://staging-api.kahade.id` + kredensial akun uji.
2. Bentuk respons yang diharapkan provider ini mengikuti kontrak backend
   (`Paginated<T>`, `{ ok: true }`, error `{ status }`) — bila staging
   mengembalikan bentuk lain, perbaiki provider/test, bukan asumsi.

## Cakupan saat ini

- KYC: antrean + filter status, approve, reject, guard 409 untuk aksi ganda.
- Support: list tiket, balas tiket.

Belum di-cover (tambah bila dibutuhkan): finance, campaign, dispute,
showcase-report — pola yang sama, tambah koleksi di `mock-provider.ts`.
