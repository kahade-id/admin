/**
 * Kahade admin — Pengaturan Operasional (OPS).
 *
 * Endpoint: GET/PUT `/v1/admin/ops-settings/*`
 * (lihat `backend/src/modules/ops-settings/admin-ops-settings.controller.ts`).
 *
 * SUPER_ADMIN ONLY — halaman paling sensitif: token integrasi dikelola di sini.
 * Nilai secret TIDAK PERNAH dikembalikan utuh oleh API (hanya mask "••••ab12").
 */
import { adminHttp } from "@/lib/api/admin-client"

export type OpsSettingView = {
  key: string
  label: string
  description: string
  isSecret: boolean
  testable: boolean
  displayValue: string | null
  configured: boolean
  source: "db" | "env" | null
  /** BAI-117: "ok" | "not_set" | "decrypt_failed" — bedakan "belum diset"
   *  dari "baris DB ada tapi gagal didekripsi". */
  status: "ok" | "not_set" | "decrypt_failed"
  updatedAt: string | null
  updatedBy: string | null
  version: number
}

export type OpsSettingAuditItem = {
  id: string
  action: string
  changedBy: string
  valueHint: string | null
  success: boolean | null
  detail: string | null
  createdAt: string
}

export async function listOpsSettings(): Promise<OpsSettingView[]> {
  const res = await adminHttp.get("/v1/admin/ops-settings")
  return (res as { settings: OpsSettingView[] }).settings
}

export async function updateOpsSetting(
  key: string,
  value: string,
  expectedVersion?: number,
): Promise<OpsSettingView> {
  const res = await adminHttp.put(`/v1/admin/ops-settings/${encodeURIComponent(key)}`, {
    value,
    ...(expectedVersion !== undefined ? { expectedVersion } : {}),
  })
  return (res as { setting: OpsSettingView }).setting
}

/**
 * BAI-104: hapus override panel — nilai kembali ke default/.env.
 * Diaudit sebagai DELETE di backend (SUPER_ADMIN).
 */
export async function deleteOpsSetting(key: string): Promise<OpsSettingView> {
  const res = await adminHttp.delete(`/v1/admin/ops-settings/${encodeURIComponent(key)}`)
  return (res as { setting: OpsSettingView }).setting
}

export async function testOpsSetting(
  key: string,
  candidateValue?: string,
): Promise<{ ok: boolean; message: string }> {
  return adminHttp.post(`/v1/admin/ops-settings/${encodeURIComponent(key)}/test`, {
    candidateValue,
  }) as Promise<{ ok: boolean; message: string }>
}

export async function getOpsSettingHistory(key: string): Promise<OpsSettingAuditItem[]> {
  const res = await adminHttp.get(`/v1/admin/ops-settings/${encodeURIComponent(key)}/history`)
  return (res as { history: OpsSettingAuditItem[] }).history
}

// ---------------------------------------------------------------------------
// Item 9 (batch 2026-09-28): Mode maintenance.
// Endpoint: GET/PUT `/v1/admin/maintenance` (SUPER_ADMIN).
// Flag disimpan di app_settings (MAINTENANCE_MODE / MAINTENANCE_MESSAGE)
// via modul ops-settings backend — tanpa tabel baru.
// ---------------------------------------------------------------------------

export type MaintenanceStatus = {
  enabled: boolean
  message: string | null
  /** BAI-114: waktu/perubahan nyata dari baris DB (null bila belum pernah diset). */
  updatedAt: string | null
  updatedBy: string | null
  /** BAI-118: versi MAINTENANCE_MODE untuk optimistic locking. */
  version: number
}

export async function getMaintenanceStatus(): Promise<MaintenanceStatus> {
  return adminHttp.get("/v1/admin/maintenance") as Promise<MaintenanceStatus>
}

export async function updateMaintenance(
  enabled: boolean,
  message?: string,
  expectedVersion?: number,
): Promise<MaintenanceStatus> {
  return adminHttp.put("/v1/admin/maintenance", {
    enabled,
    ...(message !== undefined ? { message } : {}),
    ...(expectedVersion !== undefined ? { expectedVersion } : {}),
  }) as Promise<MaintenanceStatus>
}
