/**
 * Kahade Admin Web — RBAC (Role-Based Access Control).
 *
 * Role persis dari backend (`AdminRole`):
 *   SUPER_ADMIN, DISPUTE_ADMIN, KYC_ADMIN, FINANCE_ADMIN, CUSTOMER_SUPPORT.
 *
 * AW-004 s/d AW-010 (batch 6, 2026-09-26): matriks menu DISELARASKAN dengan
 * `@AdminRoles` di tiap controller backend (backend = otoritas; diverifikasi
 * per controller). Menu yang lebih longgar dari backend hanya menghasilkan
 * halaman 403 — menu yang lebih ketat menyembunyikan fitur yang sebenarnya
 * diizinkan.
 *
 * Backend per controller (class-level; method-level dapat menyempitkan lagi,
 * mis. aksi destruktif users hanya SUPER_ADMIN):
 * - dashboard.controller.ts:13        → SUPER_ADMIN
 * - admin-users.controller.ts:25      → SUPER_ADMIN, CUSTOMER_SUPPORT
 * - admin-orders.controller.ts:19     → SUPER_ADMIN, DISPUTE_ADMIN
 * - admin-badges.controller.ts:18     → SUPER_ADMIN
 * - admin-campaigns.controller.ts:26  → SUPER_ADMIN
 * - admin-insurance-claims.controller.ts:18 → SUPER_ADMIN, FINANCE_ADMIN, CUSTOMER_SUPPORT
 * - admin-support.controller.ts:19    → SUPER_ADMIN, CUSTOMER_SUPPORT
 * - admin-feedback.controller.ts       → TERVERIFIKASI di kode backend
 *   (@AdminRoles('SUPER_ADMIN','CUSTOMER_SUPPORT'), class-level) —
 *   sebelumnya tertulis "kontrak asumsi", kini cocok (audit AUT-012,
 *   2026-10-01).
 * - admin-milestones.controller.ts     → TERVERIFIKASI di kode backend
 *   (@AdminRoles('SUPER_ADMIN','FINANCE_ADMIN'), class-level) —
 *   sebelumnya tertulis "kontrak asumsi", kini cocok (audit AUT-012,
 *   2026-10-01).
 * - admin-qa-moderation.controller.ts  → SUPER_ADMIN, CUSTOMER_SUPPORT
 *   (hapus permanen & ekspor agregat: SUPER_ADMIN-only, method-level)
 * - admin-partner.controller.ts        → SUPER_ADMIN (semua endpoint CRUD/kunci)
 * - observability.controller.ts        → SUPER_ADMIN untuk endpoint detail
 *   (latency per-route, spans, queues); agregat (latency/summary,
 *   dependencies, alerts) ALL_ROLES. Halaman admin memanggil endpoint detail
 *   sehingga nav dibatasi SUPER_ADMIN-only (konservatif; sesuai instruksi
 *   integrasi).
 * - action-locations.controller.ts      → SUPER_ADMIN (+ role fraud/dispute
 *   bila backend mengizinkan; AdminRole belum punya role "fraud" sehingga UI
 *   section "Riwayat lokasi aksi" di detail pengguna SUPER_ADMIN-only).
 *
 * Catatan: KYC_ADMIN boleh revoke/restore tier abu via endpoint users
 * (method-level `@AdminRoles('SUPER_ADMIN','KYC_ADMIN')` di
 * admin-users.controller.ts:223,240) — belum ada entry UI khusus; gunakan
 * halaman detail pengguna sebagai SUPER_ADMIN bila perlu.
 */

export type AdminRole =
  | "SUPER_ADMIN"
  | "DISPUTE_ADMIN"
  | "KYC_ADMIN"
  | "FINANCE_ADMIN"
  | "CUSTOMER_SUPPORT"

export type MenuItem = {
  /** Label Indonesia di sidebar */
  label: string
  /** Route Next.js */
  href: string
  /** Role yang boleh melihat; ["*"] = semua */
  roles: AdminRole[] | ["*"]
}

export const MENU: MenuItem[] = [
  { label: "Dasbor", href: "/", roles: ["SUPER_ADMIN"] },
  { label: "Pengguna", href: "/users", roles: ["SUPER_ADMIN", "CUSTOMER_SUPPORT"] },
  { label: "Antrean KYC", href: "/kyc", roles: ["SUPER_ADMIN", "KYC_ADMIN"] },
  { label: "Verifikasi Bisnis", href: "/business", roles: ["SUPER_ADMIN", "KYC_ADMIN"] },
  { label: "Sengketa", href: "/disputes", roles: ["SUPER_ADMIN", "DISPUTE_ADMIN"] },
  { label: "Retur", href: "/returns", roles: ["SUPER_ADMIN", "DISPUTE_ADMIN", "CUSTOMER_SUPPORT"] },
  { label: "Kurir & Pengiriman", href: "/courier", roles: ["SUPER_ADMIN", "FINANCE_ADMIN", "CUSTOMER_SUPPORT"] },
  { label: "Produk & Stok", href: "/products", roles: ["SUPER_ADMIN", "CUSTOMER_SUPPORT"] },
  { label: "Tiket Bantuan", href: "/tickets", roles: ["SUPER_ADMIN", "CUSTOMER_SUPPORT"] },
  { label: "Masukan", href: "/feedback", roles: ["SUPER_ADMIN", "CUSTOMER_SUPPORT"] },
  { label: "Milestone", href: "/milestones", roles: ["SUPER_ADMIN", "FINANCE_ADMIN"] },
  { label: "Laporan Pengguna", href: "/reports", roles: ["SUPER_ADMIN", "CUSTOMER_SUPPORT"] },
  { label: "Laporan Etalase", href: "/reports/showcase", roles: ["SUPER_ADMIN", "CUSTOMER_SUPPORT"] },
  { label: "Moderasi Chat", href: "/chat", roles: ["SUPER_ADMIN", "DISPUTE_ADMIN", "CUSTOMER_SUPPORT"] },
  { label: "Moderasi Q&A", href: "/qa-moderation", roles: ["SUPER_ADMIN", "CUSTOMER_SUPPORT"] },
  { label: "Badge & Verifikasi", href: "/badges", roles: ["SUPER_ADMIN"] },
  { label: "Keuangan & Escrow", href: "/finance", roles: ["SUPER_ADMIN", "FINANCE_ADMIN"] },
  // MFE-015: antrean disbursement escrow DANA (read-only) — role sama dengan
  // backend @AdminRoles('FINANCE_ADMIN','SUPER_ADMIN') di controller finance.
  { label: "Disbursement", href: "/disbursements", roles: ["SUPER_ADMIN", "FINANCE_ADMIN"] },
  { label: "Pesanan", href: "/orders", roles: ["SUPER_ADMIN", "DISPUTE_ADMIN"] },
  { label: "Voucher", href: "/vouchers", roles: ["SUPER_ADMIN", "FINANCE_ADMIN"] },
  // GO-PUBLIK (2026-09-28): role provisoris batch 43 diselaraskan dengan
  // @AdminRoles backend (otoritatif): seller-vouchers, banners, group-buying,
  // jastip semuanya SUPER_ADMIN, CUSTOMER_SUPPORT di backend.
  { label: "Voucher Seller", href: "/seller-vouchers", roles: ["SUPER_ADMIN", "CUSTOMER_SUPPORT"] },
  { label: "Banner & Carousel", href: "/banners", roles: ["SUPER_ADMIN", "CUSTOMER_SUPPORT"] },
  { label: "Patungan Grup", href: "/group-buying", roles: ["SUPER_ADMIN", "CUSTOMER_SUPPORT"] },
  { label: "Jastip", href: "/jastip", roles: ["SUPER_ADMIN", "CUSTOMER_SUPPORT"] },
  { label: "Kampanye", href: "/campaigns", roles: ["SUPER_ADMIN"] },
  { label: "Ulasan", href: "/ratings", roles: ["SUPER_ADMIN", "CUSTOMER_SUPPORT"] },
  { label: "Referral", href: "/referral", roles: ["SUPER_ADMIN", "FINANCE_ADMIN"] },
  { label: "Langganan", href: "/subscriptions", roles: ["SUPER_ADMIN", "FINANCE_ADMIN"] },
  { label: "Klaim Asuransi", href: "/insurance-claims", roles: ["SUPER_ADMIN", "FINANCE_ADMIN", "CUSTOMER_SUPPORT"] },
  { label: "Analitik", href: "/analytics", roles: ["SUPER_ADMIN", "FINANCE_ADMIN"] },
  { label: "Sistem & Konfigurasi", href: "/system", roles: ["SUPER_ADMIN"] },
  { label: "Klien Mitra", href: "/partner-clients", roles: ["SUPER_ADMIN"] },
  { label: "Observabilitas", href: "/observability", roles: ["SUPER_ADMIN"] },
  // ADM-417: status publik & insiden — didaftarkan agar SUPER_ADMIN punya navigasi.
  { label: "Status", href: "/status", roles: ["SUPER_ADMIN"] },
  { label: "Pengaturan Operasional", href: "/ops-settings", roles: ["SUPER_ADMIN"] },
  { label: "Tim Admin", href: "/team", roles: ["SUPER_ADMIN"] },
]

function roleAllowed(item: MenuItem, role: AdminRole): boolean {
  if ((item.roles as string[]).includes("*")) return true
  return (item.roles as AdminRole[]).includes(role)
}

/** Daftar menu yang boleh dilihat role ini (SUPER_ADMIN = semua). */
export function menuForRole(role: AdminRole | null | undefined): MenuItem[] {
  if (!role) return []
  if (role === "SUPER_ADMIN") return MENU
  return MENU.filter((m) => roleAllowed(m, role))
}

/** Apakah role boleh mengakses route ini. */
export function canAccess(role: AdminRole | null | undefined, href: string): boolean {
  if (!role) return false
  if (role === "SUPER_ADMIN") return true
  const item = MENU.find((m) => m.href === href)
  // Route yang belum terdaftar di menu: tolak kecuali SUPER_ADMIN.
  if (!item) return false
  return roleAllowed(item, role)
}

/** Label ramah untuk role. */
export function roleLabel(role: string): string {
  switch (role) {
    case "SUPER_ADMIN":
      return "Super Admin"
    case "DISPUTE_ADMIN":
      return "Admin Sengketa"
    case "KYC_ADMIN":
      return "Admin KYC"
    case "FINANCE_ADMIN":
      return "Admin Keuangan"
    case "CUSTOMER_SUPPORT":
      return "Customer Support"
    default:
      return role
  }
}
