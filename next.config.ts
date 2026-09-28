import type { NextConfig } from "next";

// SEC-506: header keamanan untuk admin.kahade.id (panel admin = aset paling sensitif).
//
// Catatan arsitektur: admin.kahade.id berada di belakang Cloudflare; header yang
// di-set di sini (origin) diteruskan Cloudflare ke browser. Jangan set header yang
// sama juga di Cloudflare Transform Rules — itu menyebabkan duplikasi (lihat SEC-513).
//
// INFO-1 (2026-09-28, GO-PUBLIK): header X-Frame-Options/X-Content-Type-Options/
// Referrer-Policy TETAP duplikat di produksi karena Cloudflare menambahkan
// versi default-nya sendiri (X-Frame-Options: SAMEORIGIN, X-Content-Type-Options:
// nosniff) di atas header origin ini. Duplikat tidak bisa dihapus dari sisi repo
// tanpa menghapus pertahanan origin (versi origin lebih ketat: DENY). Perbaikan
// kosmetik: matikan "Security headers" bawaan Cloudflare di dashboard (zona
// kahade.id) — langkah manual, di luar cakupan deploy otomatis.
const HSTS_VALUE = "max-age=31536000; includeSubDomains; preload";

// CSP statis yang ketat TAPI tidak memecah Next.js production:
// - script-src 'self' 'unsafe-inline': Next.js production menyisipkan inline
//   bootstrap script tanpa nonce bila tidak memakai middleware nonce (lihat
//   docs/01-app/02-guides/content-security-policy.md). 'unsafe-eval' TIDAK
//   dibutuhkan di production.
// - style-src 'self' 'unsafe-inline': Tailwind/Next membutuhkan inline style.
// - connect-src: panel admin hanya bicara ke API Kahade.
// - img-src: bukti dispute/showcase dimuat dari api.kahade.id (URL absolut).
// - frame-ancestors 'none': lebih ketat dari X-Frame-Options: DENY.
const CSP_VALUE = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https://api.kahade.id",
  "font-src 'self' data:",
  "connect-src 'self' https://api.kahade.id",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "upgrade-insecure-requests",
].join("; ");

const nextConfig: NextConfig = {
  // SEC-506: hilangkan header X-Powered-By (framework disclosure).
  poweredByHeader: false,
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          // SEC-506: HSTS 1 tahun + includeSubDomains + preload.
          // PERHATIAN: aktif hanya karena admin.kahade.id HANYA diakses via
          // HTTPS (Cloudflare). Jangan terapkan pola ini ke host yang masih
          // butuh akses HTTP internal/plain.
          { key: "Strict-Transport-Security", value: HSTS_VALUE },
          // SEC-506: Content Security Policy untuk panel admin.
          { key: "Content-Security-Policy", value: CSP_VALUE },
          // Cegah clickjacking pada panel admin.
          { key: "X-Frame-Options", value: "DENY" },
          // Cegah MIME-sniffing.
          { key: "X-Content-Type-Options", value: "nosniff" },
          // Batasi informasi referrer yang bocor ke pihak ketiga.
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        ],
      },
    ];
  },
};

export default nextConfig;
