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
import { stepUpHeaders } from "@/lib/api/admin/step-up"

function isNotFoundError(e: unknown): boolean {
  return (
    typeof e === "object" && e !== null && (e as { status?: number }).status === 404
  )
}

/**
 * Dilempar fungsi defensif bila endpoint ops-settings baru belum ada di
 * backend yang sedang jalan (tim backend membangun paralel).
 */
export class OpsSettingsNotSupportedError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "OpsSettingsNotSupportedError"
  }
}

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

/**
 * SEC-506 (audit integrasi 2026-10-03): two-person rule untuk key
 * finansial/kritis. Bila backend menjawab 202 dengan
 * `{ pendingApproval: { id, key, ... } }`, perubahan TIDAK langsung berlaku
 * — fungsi mengembalikan `{ pendingApproval }` (jangan anggap sukses).
 * Pemanggil (halaman ops-settings) wajib menanganinya: tampilkan info
 * "menunggu persetujuan admin kedua" dan refresh antrean persetujuan.
 */
export type PendingApproval = {
  id: string
  key: string
  label?: string | null
  oldValue?: string | null
  newValue?: string | null
  proposedBy?: string | null
  proposedById?: string | null
  proposedAt?: string | null
  [key: string]: unknown
}

export type UpdateOpsSettingResult = { pendingApproval: PendingApproval }

export function isUpdatePending(
  res: OpsSettingView | UpdateOpsSettingResult,
): res is UpdateOpsSettingResult {
  return (
    typeof res === "object" &&
    res !== null &&
    "pendingApproval" in res &&
    typeof (res as { pendingApproval?: unknown }).pendingApproval === "object"
  )
}

/**
 * true bila key menyentuh uang / batas finansial — kandidat two-person rule.
 * Pola longgar by design (fail-closed: lebih baik menandai berlebih lalu
 * backend memutuskan final).
 */
export function isFinancialKey(key: string): boolean {
  return /fee|limit|dana|disburs|wallet|withdraw|payout/i.test(key)
}

/**
 * PUT /v1/admin/ops-settings/:key — ubah nilai setting operasional.
 * Backend: @RequireStepUp('opsSetting.update','key') (P0-9).
 */
export async function updateOpsSetting(
  key: string,
  value: string,
  expectedVersion?: number,
  stepUpToken?: string,
): Promise<OpsSettingView | UpdateOpsSettingResult> {
  const headers = stepUpToken ? stepUpHeaders(stepUpToken) : {}
  const res = await adminHttp.put(
    `/v1/admin/ops-settings/${encodeURIComponent(key)}`,
    {
      value,
      ...(expectedVersion !== undefined ? { expectedVersion } : {}),
    },
    { headers },
  )
  // SEC-506: backend bisa menjawab {approvalId,status,expiresAt,message}
  // (dual control untuk key finansial) alih-alih { setting }.
  // P1-29 (audit integrasi 2026-10-06): cek approvalId, bukan pendingApproval.
  const body = res as {
    approvalId?: string
    status?: string
    expiresAt?: string
    message?: string
    pendingApproval?: PendingApproval
    setting?: OpsSettingView
  }
  if (body && typeof body.approvalId === "string") {
    // P1-29: backend kirim {approvalId,status,expiresAt,message} — petakan
    // ke bentuk PendingApproval yang dipakai UI.
    return {
      pendingApproval: {
        id: body.approvalId,
        key: key,
        proposedAt: body.expiresAt ?? null,
        approvalId: body.approvalId,
        approvalStatus: body.status ?? "PENDING",
        message: body.message ?? "",
      } as PendingApproval,
    }
  }
  if (body && typeof body.pendingApproval === "object" && body.pendingApproval !== null) {
    return { pendingApproval: body.pendingApproval }
  }
  return body.setting as OpsSettingView
}

/**
 * BAI-104: hapus override panel — nilai kembali ke default/.env.
 * Diaudit sebagai DELETE di backend (SUPER_ADMIN).
 * Backend: @RequireStepUp('opsSetting.update','key') (P0-9).
 */
export async function deleteOpsSetting(
  key: string,
  stepUpToken?: string,
): Promise<OpsSettingView> {
  const headers = stepUpToken ? stepUpHeaders(stepUpToken) : {}
  const res = await adminHttp.delete(
    `/v1/admin/ops-settings/${encodeURIComponent(key)}`,
    { headers },
  )
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

// ---------------------------------------------------------------------------
// SEC-506 (audit integrasi 2026-10-03): two-person rule — antrean persetujuan.
//
// KONTRAK YANG DIASUMSISKAN (tim backend membangun paralel; selaraskan bila
// berbeda — halaman hanya memakai signature di bawah):
// - GET  /v1/admin/approvals/pending
//   → { approvals: PendingApproval[] }  (atau array langsung)
// - POST /v1/admin/approvals/:id/approve
//   → { setting: OpsSettingView } | { approval: PendingApproval }
//   Wajib header `X-Step-Up-Token` (aksi step-up `ops-setting.approve`).
// - POST /v1/admin/approvals/:id/reject
//   → { approval: PendingApproval }
//   Wajib header `X-Step-Up-Token` (aksi step-up `ops-setting.reject`).
// - PUT  /v1/admin/ops-settings/:key menjawab 202 + `{ pendingApproval }`
//   bila key finansial/kritis masuk antrean dua orang.
//
// SEMUA fungsi defensif 404 → `OpsSettingsNotSupportedError` dengan pesan
// jelas ("membutuhkan backend terbaru"), bukan crash.
// ---------------------------------------------------------------------------

/** Daftar perubahan setting yang menunggu persetujuan admin kedua. */
export async function getPendingApprovals(): Promise<PendingApproval[]> {
  try {
    const res = await adminHttp.get("/v1/admin/approvals/pending")
    const body = res as { approvals?: PendingApproval[] } | PendingApproval[]
    if (Array.isArray(body)) return body
    return Array.isArray(body?.approvals) ? body.approvals : []
  } catch (e) {
    if (isNotFoundError(e)) {
      throw new OpsSettingsNotSupportedError(
        "Two-person rule belum aktif di backend — membutuhkan backend terbaru (GET /v1/admin/approvals/pending).",
      )
    }
    throw e
  }
}

/**
 * Setujui perubahan yang tertunda. `stepUpToken` dari step-up gate
 * (aksi `ops-setting.approve`) — jangan panggil tanpa token. Penyusul tidak
 * boleh menyetujui usulannya sendiri (ditegakkan di UI + WAJIB di backend).
 */
export async function approvePendingApproval(
  id: string,
  stepUpToken: string,
): Promise<unknown> {
  try {
    return await adminHttp.post(
      `/v1/admin/approvals/${encodeURIComponent(id)}/approve`,
      {},
      { headers: stepUpHeaders(stepUpToken) },
    )
  } catch (e) {
    if (isNotFoundError(e)) {
      throw new OpsSettingsNotSupportedError(
        "Two-person rule belum aktif di backend — membutuhkan backend terbaru (POST /v1/admin/approvals/:id/approve).",
      )
    }
    throw e
  }
}

/**
 * Tolak perubahan yang tertunda. `stepUpToken` dari step-up gate
 * (aksi `ops-setting.reject`).
 */
export async function rejectPendingApproval(
  id: string,
  stepUpToken: string,
): Promise<unknown> {
  try {
    return await adminHttp.post(
      `/v1/admin/approvals/${encodeURIComponent(id)}/reject`,
      {},
      { headers: stepUpHeaders(stepUpToken) },
    )
  } catch (e) {
    if (isNotFoundError(e)) {
      throw new OpsSettingsNotSupportedError(
        "Two-person rule belum aktif di backend — membutuhkan backend terbaru (POST /v1/admin/approvals/:id/reject).",
      )
    }
    throw e
  }
}

// ---------------------------------------------------------------------------
// FAL-006 (audit integrasi 2026-10-03): indikator health layanan terjemahan.
//
// KONTRAK YANG DIASUMSISKAN:
// - GET /v1/admin/ops-settings/translation/health
//   → { configured: boolean, provider?: string }
//   `configured` = secret `CHAT_TRANSLATION_*` terdaftar & valid di registry
//   ops-settings (secret terenkripsi). 404 → { supported: false } dan halaman
//   menampilkan "status tak diketahui".
// ---------------------------------------------------------------------------

export type TranslationHealth = {
  configured: boolean
  provider?: string
  /** false bila endpoint belum ada di backend (defensif 404). */
  supported: boolean
}

export async function getTranslationHealth(): Promise<TranslationHealth> {
  try {
    const res = (await adminHttp.get("/v1/admin/ops-settings/translation/health")) as {
      configured?: boolean
      provider?: string
    }
    return {
      configured: res?.configured === true,
      provider: typeof res?.provider === "string" ? res.provider : undefined,
      supported: true,
    }
  } catch (e) {
    if (isNotFoundError(e)) {
      return { configured: false, provider: undefined, supported: false }
    }
    throw e
  }
}
