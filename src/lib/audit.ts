/**
 * Kahade Admin Web — helper audit log.
 *
 * CATATAN ARSITEKTUR: aksi admin dicatat OTOMATIS di sisi backend
 * (`AuditLogService.logAdminAction` di tiap service admin) — frontend
 * TIDAK perlu POST manual setiap aksi. Helper ini untuk MEMBACA jejak
 * audit (halaman Sistem → Audit Log), plus util format tampilan.
 */
import {
  listAuditLogs,
  type AdminAuditLogItem,
  type AuditLogQuery,
} from "@/lib/api/admin/system"

export type { AdminAuditLogItem, AuditLogQuery }

/** Ambil audit log dengan filter opsional. */
export function fetchAuditLogs(params?: AuditLogQuery) {
  return listAuditLogs(params)
}

/** Format aksi `admin.users.ban` → "users · ban" agar mudah dibaca. */
export function formatAuditAction(action: string): string {
  const parts = action.split(".")
  if (parts.length <= 2) return action
  return `${parts.slice(1, -1).join(".")} · ${parts[parts.length - 1]}`
}
