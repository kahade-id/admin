/** Kahade admin — sistem: config, approval config finansial, broadcast, webhook dead-letter, audit log. */
import { adminHttp } from "@/lib/api/admin-client"
import type { Paginated } from "@/lib/api/admin/kyc"

export type SystemConfigDataType = "STRING" | "NUMBER" | "BOOLEAN" | "JSON"

export interface AdminSystemConfig {
  id: string
  key: string
  value: string
  description?: string | null
  dataType: SystemConfigDataType
  isPublic: boolean
  updatedBy?: string | null
  createdAt?: string
  updatedAt?: string
}

/** Perubahan config finansial yang menunggu persetujuan admin lain. */
export interface PendingConfigChange {
  key: string
  proposedValue: string
  proposedDescription?: string | null
  currentValue?: string | null
  currentDescription?: string | null
  proposedBy: string
  proposedAt: string
  ipAddress?: string | null
}

export interface AdminAuditLogItem {
  id: string
  adminId: string
  action: string
  targetType?: string | null
  targetId?: string | null
  description: string
  before?: Record<string, unknown> | null
  after?: Record<string, unknown> | null
  ipAddress?: string | null
  userAgent?: string | null
  createdAt: string
}

export interface AdminWebhookLogItem {
  id: string
  source: string
  event: string
  transactionId?: string | null
  isProcessed: boolean
  processedAt?: string | null
  errorMessage?: string | null
  retryCount: number
  lastAttemptAt?: string | null
  nextRetryAt?: string | null
  deadLetteredAt?: string | null
  createdAt?: string
}

export type BroadcastChannel = "in_app" | "push"

export type BroadcastAudience = "all" | "active" | "kahade_plus" | "verified"

export interface BroadcastInput {
  title: string
  body: string
  channels: BroadcastChannel[]
  targetAudience?: BroadcastAudience
}

export interface BroadcastResult {
  recipientCount: number
}

export interface AuditLogQuery {
  page?: number
  limit?: number
  action?: string
  adminId?: string
  targetType?: string
  startDate?: string
  endDate?: string
}

export interface WebhookLogQuery {
  page?: number
  limit?: number
  source?: string
  isProcessed?: string
  deadLettered?: string
  search?: string
  startDate?: string
  endDate?: string
}

/** GET /v1/admin/system/configs — daftar config sistem. */
export function listConfigs(): Promise<AdminSystemConfig[]> {
  return adminHttp.get<AdminSystemConfig[]>("/v1/admin/system/configs")
}

/**
 * PUT /v1/admin/system/configs/:key — ubah nilai config.
 * Untuk config finansial, perubahan disimpan sebagai pending dan butuh
 * persetujuan admin lain sebelum berlaku.
 */
export function updateConfig(
  key: string,
  value: string,
  description?: string,
): Promise<AdminSystemConfig | PendingConfigChange> {
  return adminHttp.put<AdminSystemConfig | PendingConfigChange>(
    `/v1/admin/system/configs/${encodeURIComponent(key)}`,
    description !== undefined ? { value, description } : { value },
  )
}

/** GET /v1/admin/system/configs/pending — daftar perubahan config menunggu persetujuan. */
export function listPendingConfigChanges(): Promise<PendingConfigChange[]> {
  return adminHttp.get<PendingConfigChange[]>(
    "/v1/admin/system/configs/pending",
  )
}

/** POST /v1/admin/system/configs/:key/approve — setujui perubahan config (harus admin berbeda dari pengusul). */
export function approveConfigChange(
  key: string,
): Promise<AdminSystemConfig | { message: string }> {
  return adminHttp.post<AdminSystemConfig | { message: string }>(
    `/v1/admin/system/configs/${encodeURIComponent(key)}/approve`,
  )
}

/** POST /v1/admin/system/configs/:key/reject — tolak perubahan config pending. */
export function rejectConfigChange(key: string): Promise<{ message: string }> {
  return adminHttp.post<{ message: string }>(
    `/v1/admin/system/configs/${encodeURIComponent(key)}/reject`,
  )
}

/** POST /v1/admin/system/broadcast — kirim broadcast ke pengguna. */
export function sendBroadcast(input: BroadcastInput): Promise<BroadcastResult> {
  return adminHttp.post<BroadcastResult>("/v1/admin/system/broadcast", input)
}

/** GET /v1/admin/system/audit-logs — daftar audit log admin (read-only). */
export function listAuditLogs(
  params?: AuditLogQuery,
): Promise<Paginated<AdminAuditLogItem>> {
  return adminHttp.get<Paginated<AdminAuditLogItem>>(
    "/v1/admin/system/audit-logs",
    { query: params as Record<string, string | number | boolean | null | undefined> },
  )
}

/** GET /v1/admin/system/webhook-logs — daftar log webhook (termasuk dead-letter). */
export function listWebhookLogs(
  params?: WebhookLogQuery,
): Promise<Paginated<AdminWebhookLogItem>> {
  return adminHttp.get<Paginated<AdminWebhookLogItem>>(
    "/v1/admin/system/webhook-logs",
    { query: params as Record<string, string | number | boolean | null | undefined> },
  )
}

/** POST /v1/admin/system/webhook-logs/:id/retry — antre ulang webhook dead-letter. */
export function retryWebhook(id: string): Promise<AdminWebhookLogItem> {
  return adminHttp.post<AdminWebhookLogItem>(
    `/v1/admin/system/webhook-logs/${encodeURIComponent(id)}/retry`,
  )
}

/** POST /v1/admin/system/webhook-logs/:id/resolve — tandai dead-letter sebagai diselesaikan manual. */
export function resolveWebhook(
  id: string,
  resolution: string,
): Promise<AdminWebhookLogItem> {
  return adminHttp.post<AdminWebhookLogItem>(
    `/v1/admin/system/webhook-logs/${encodeURIComponent(id)}/resolve`,
    { resolution },
  )
}
