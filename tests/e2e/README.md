# E2E — Playwright (G511, G520, G521)

## Prasyarat

```bash
npx playwright install chromium   # browser belum terunduh di repo ini
npm run test:e2e
```

Tanpa browser terinstal, spec hanya bisa di-review statis — JANGAN klaim
"lolos" sebelum dijalankan dengan browser nyata.

## Spec

| File | Gap | Isi |
|------|-----|-----|
| `auth.spec.ts` | G511 | login sukses/gagal, refresh token otomatis, logout, session expiry |
| `visual.spec.ts` | G520 | screenshot 6 halaman + dark mode dashboard |
| `viewports.spec.ts` | G521 | dashboard di 1440×900 / 768×1024 / 390×844 + screenshot |

Backend di-mock pada level network (`page.route("**/v1/admin/**")`) —
yang diuji adalah perilaku browser + aplikasi (form, redirect, layout),
bukan backend.

## Baseline visual (G520)

Buat sekali di mesin referensi (Linux, sama dengan CI):

```bash
npm run test:e2e -- tests/e2e/visual.spec.ts --update-snapshots
git add tests/e2e/__screenshots__/
```

Jangan campur baseline antar-OS (font berbeda → diff palsu).
Threshold: `maxDiffPixelRatio: 0.02` (0.03 untuk viewport).
