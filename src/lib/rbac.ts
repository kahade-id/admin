/**
 * Kahade Admin Web — RBAC (Role-Based Access Control).
 *
 * Role persis dari backend (`AdminRole`):
 *   SUPER_ADMIN, DISPUTE_ADMIN, KYC_ADMIN, FINANCE_ADMIN, CUSTOMER_SUPPORT.
 *
 * SUPER_ADMIN melihat semua menu. Role lain hanya menu sesuai tugasnya —
 * sidebar difilter lewat `menuForRole()`, dan guard halaman memakai
 * `canAccess(role, href)`.
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
  { label: "Dasbor", href: "/", roles: ["*"] },
  { label: "Pengguna", href: "/users", roles: ["SUPER_ADMIN", "FINANCE_ADMIN", "CUSTOMER_SUPPORT"] },
  { label: "Antrean KYC", href: "/kyc", roles: ["SUPER_ADMIN", "KYC_ADMIN"] },
  { label: "Verifikasi Bisnis", href: "/business", roles: ["SUPER_ADMIN", "KYC_ADMIN"] },
  { label: "Sengketa", href: "/disputes", roles: ["SUPER_ADMIN", "DISPUTE_ADMIN"] },
  { label: "Tiket Bantuan", href: "/tickets", roles: ["SUPER_ADMIN", "CUSTOMER_SUPPORT", "DISPUTE_ADMIN"] },
  { label: "Laporan Pengguna", href: "/reports", roles: ["SUPER_ADMIN", "CUSTOMER_SUPPORT"] },
  { label: "Laporan Etalase", href: "/reports/showcase", roles: ["SUPER_ADMIN", "CUSTOMER_SUPPORT"] },
  { label: "Moderasi Chat", href: "/chat", roles: ["SUPER_ADMIN", "CUSTOMER_SUPPORT"] },
  { label: "Badge & Verifikasi", href: "/badges", roles: ["SUPER_ADMIN", "KYC_ADMIN"] },
  { label: "Keuangan & Escrow", href: "/finance", roles: ["SUPER_ADMIN", "FINANCE_ADMIN"] },
  { label: "Pesanan", href: "/orders", roles: ["SUPER_ADMIN", "FINANCE_ADMIN", "DISPUTE_ADMIN"] },
  { label: "Voucher", href: "/vouchers", roles: ["SUPER_ADMIN", "FINANCE_ADMIN"] },
  { label: "Kampanye", href: "/campaigns", roles: ["SUPER_ADMIN", "FINANCE_ADMIN"] },
  { label: "Ulasan", href: "/ratings", roles: ["SUPER_ADMIN", "CUSTOMER_SUPPORT"] },
  { label: "Referral", href: "/referral", roles: ["SUPER_ADMIN", "FINANCE_ADMIN"] },
  { label: "Langganan", href: "/subscriptions", roles: ["SUPER_ADMIN", "FINANCE_ADMIN"] },
  { label: "Klaim Asuransi", href: "/insurance-claims", roles: ["SUPER_ADMIN", "FINANCE_ADMIN", "DISPUTE_ADMIN"] },
  { label: "Analitik", href: "/analytics", roles: ["SUPER_ADMIN", "FINANCE_ADMIN"] },
  { label: "Sistem & Konfigurasi", href: "/system", roles: ["SUPER_ADMIN"] },
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
