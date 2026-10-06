/** Kahade admin — moderasi sengketa (dispute). */
import { adminHttp, getAdminAccessToken } from "@/lib/api/admin-client"
import { API_BASE_URL } from "@/lib/api/config"
import type { Paginated } from "@/lib/api/admin/kyc"
import { STEP_UP_HEADER } from "@/lib/api/admin/step-up"

/**
 * UUID v4 untuk `Idempotency-Key`. Backend mewajibkan header ini pada
 * endpoint mutasi sengketa (`@Idempotency()`): assign, under-review,
 * resolve — tanpa header, backend menolak dengan 400 IDEMPOTENCY_KEY_REQUIRED.
 * Pola sama seperti `src/lib/api/admin/finance.ts`.
 *
 * SEC-504: diekspor agar pemanggil bisa membuat SATU kunci per sesi dialog
 * (bukan per panggilan — retry harus memakai kunci yang sama).
 *
 * CATATAN: tidak diekspor dari barrel agar tak bentrok dengan
 * `@/lib/api/admin/finance` (sumber kanonis `newIdempotencyKey`).
 */
function newIdempotencyKey(): string {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = Math.floor(Math.random() * 16)
    const v = c === "x" ? r : (r & 0x3) | 0x8
    return v.toString(16)
  })
}

const idempotencyHeaders = (): Record<string, string> => ({
  "Idempotency-Key": newIdempotencyKey(),
})

/**
 * Status sengketa — selaras enum backend `DisputeStatus`
 * (OPEN|ASSIGNED|UNDER_REVIEW|WAITING_RESPONSE|RESOLVED|ESCALATED).
 *
 * ESI-019 (audit integrasi 2026-09-30): sebelumnya `string` polos —
 * typo status tak tertangkap tsc dan drift enum backend tak terdeteksi.
 * `string` tetap ditoleransi sebagai fallback untuk nilai baru backend.
 */
export type DisputeStatus =
  | "OPEN"
  | "ASSIGNED"
  | "UNDER_REVIEW"
  | "WAITING_RESPONSE"
  | "RESOLVED"
  | "ESCALATED"
  | (string & {})

export type AdminDisputeItem = {
  id: string
  orderId: string
  status: DisputeStatus
  /** Kategori sengketa (enum backend DisputeCategory) — nullable untuk data lama. */
  category?: string | null
  reason?: string
  assignedAdminId?: string | null
  createdAt: string
  updatedAt?: string
  [key: string]: unknown
}

export type DisputeMessage = {
  id: string
  senderId: string
  message: string
  createdAt: string
  [key: string]: unknown
}

export function listDisputes(params?: {
  page?: number
  limit?: number
  status?: string
  /** Filter kategori sengketa (enum backend DisputeCategory). */
  category?: string
  /** Cari berdasarkan ID sengketa atau ID order (didukung backend). */
  search?: string
  /**
   * AW-001 (perf-fix): hanya sengketa yang BELUM ditugaskan
   * (`assignedAdminId IS NULL`) — difilter server-side. Menggantikan pola
   * lama fetch-all + filter client-side.
   */
  unassigned?: boolean
}): Promise<Paginated<AdminDisputeItem>> {
  return adminHttp.get<Paginated<AdminDisputeItem>>("/v1/admin/disputes", { query: params })
}

export function getDisputeDetail(disputeId: string): Promise<AdminDisputeItem> {
  return adminHttp.get<AdminDisputeItem>(
    `/v1/admin/disputes/${encodeURIComponent(disputeId)}`,
  )
}

export function assignDispute(disputeId: string, adminId: string): Promise<unknown> {
  return adminHttp.post(
    `/v1/admin/disputes/${encodeURIComponent(disputeId)}/assign`,
    { adminId },
    { headers: idempotencyHeaders() },
  )
}

export function markDisputeUnderReview(disputeId: string): Promise<unknown> {
  return adminHttp.post(
    `/v1/admin/disputes/${encodeURIComponent(disputeId)}/under-review`,
    {},
    { headers: idempotencyHeaders() },
  )
}

/** Respons mentah backend `GET /v1/admin/disputes/:id/messages`. */
export type DisputeMessagesResponse = {
  messages: DisputeMessage[]
  nextCursor: string | null
  hasMore: boolean
}

/**
 * Ambil pesan sengketa (pesan mediasi admin).
 *
 * ADM-127: backend mengembalikan envelope `{ messages, nextCursor, hasMore }`
 * (limit 50) — adaptor mengembalikan envelope utuh agar riwayat >50 pesan
 * bisa dimuat ("Muat pesan lama").
 */
export async function getDisputeMessages(
  disputeId: string,
  params?: { cursor?: string; limit?: number },
): Promise<DisputeMessagesResponse> {
  const res = await adminHttp.get<DisputeMessagesResponse>(
    `/v1/admin/disputes/${encodeURIComponent(disputeId)}/messages`,
    { query: params },
  )
  return {
    messages: Array.isArray(res?.messages) ? res.messages : [],
    nextCursor: res?.nextCursor ?? null,
    hasMore: res?.hasMore === true,
  }
}

export function sendDisputeMessage(disputeId: string, message: string): Promise<unknown> {
  // DP-002: backend SendDisputeMessageDto mewajibkan field `content`
  // (bukan `message`) — kontrak diselaraskan di sini agar pemanggil
  // tetap memakai string pesan biasa.
  return adminHttp.post(
    `/v1/admin/disputes/${encodeURIComponent(disputeId)}/messages`,
    { content: message },
    { headers: idempotencyHeaders() },
  )
}

export type DisputeOrderChatMessage = {
  id: string
  content?: string
  message?: string
  senderId?: string
  isDeleted?: boolean
  deletedContent?: string | null
  createdAt: string
  [key: string]: unknown
}

/** Respons `GET /v1/admin/disputes/:id/chat` — percakapan order (termasuk pesan terhapus). */
export type DisputeOrderChatResponse = {
  messages: DisputeOrderChatMessage[]
  nextCursor: string | null
  hasMore: boolean
}

/**
 * ADM-111: ambil percakapan buyer–seller di room order sengketa.
 * `includeDeleted` default true (backend) agar mediator melihat isi asli
 * pesan yang dihapus sebagai bukti.
 */
export async function getDisputeChat(
  disputeId: string,
  params?: { cursor?: string; limit?: number; includeDeleted?: boolean },
): Promise<DisputeOrderChatResponse> {
  const res = await adminHttp.get<DisputeOrderChatResponse>(
    `/v1/admin/disputes/${encodeURIComponent(disputeId)}/chat`,
    { query: params },
  )
  return {
    messages: Array.isArray(res?.messages) ? res.messages : [],
    nextCursor: res?.nextCursor ?? null,
    hasMore: res?.hasMore === true,
  }
}

export type DisputeDecision = "FULL_BUYER" | "FULL_SELLER" | "SPLIT"

export type ResolvePreviewResult = {
  disputeId: string
  orderId: string
  decision: DisputeDecision
  buyerPercent: number | null
  sellerPercent: number | null
  /** Nominal dalam rupiah (number). */
  buyerAmount: number
  sellerAmount: number
  platformRetainAmount: number
  escrowedAmount: number
  platformFee: number
  /** Nominal presisi dalam sen (string) — untuk tampilan presisi penuh. */
  buyerAmountSen: string
  sellerAmountSen: string
  platformRetainAmountSen: string
  isPostCompletionDispute: boolean
  feePolicy: { fullBuyerRefundsPlatformFee: boolean }
}

/**
 * ADM-109: pratinjau nominal disbursement SEBELUM eksekusi resolve.
 * GET read-only — tidak memutasi apa pun; guard status sama dengan resolve
 * sehingga angka yang ditampilkan pasti bisa dieksekusi.
 */
export function previewResolveDispute(
  disputeId: string,
  input: {
    decision: DisputeDecision
    buyerPercent?: number
    sellerPercent?: number
  },
): Promise<ResolvePreviewResult> {
  return adminHttp.get<ResolvePreviewResult>(
    `/v1/admin/disputes/${encodeURIComponent(disputeId)}/resolve/preview`,
    { query: input as Record<string, string | number | undefined> },
  )
}

/**
 * BAI-046: respons resolve membawa `settlement` (hasil eksekusi finansial
 * DANA) — bisa null = gagal total. UI WAJIB membacanya: jangan toast sukses
 * buta bila refund buyer / disbursement seller gagal.
 */
export type DisputeSettlementResult = {
  buyerRefunded: boolean
  buyerRefundAlready: boolean
  /** null bila porsi seller = 0 (tidak ada disbursement). */
  sellerDisbursement: {
    outcome: string
    disbursementId?: string | null
    status?: string | null
  } | null
}

export type ResolveDisputeResult = {
  decision?: string
  /**
   * P1-30: backend bisa tidak menyertakan settlement (mis. jalur wallet) —
   * undefined bukan bukti gagal. null = eksekusi settlement DANA gagal total.
   */
  settlement?: DisputeSettlementResult | null
  /**
   * SEC-501: true bila backend menahan eksekusi menunggu persetujuan admin
   * kedua (nominal besar) — UI wajib menampilkan status "Menunggu
   * persetujuan kedua", bukan sukses.
   */
  pendingSecondApproval?: boolean
}

export type ResolveDisputeOpts = {
  /**
   * SEC-504: kunci idempotency dibuat SEKALI per sesi dialog di pemanggil
   * (useMemo saat dialog dibuka) — retry memakai kunci yang sama.
   * Bila tidak diberi, dibuatkan (fallback).
   */
  idempotencyKey?: string
  /** SEC-501: token verifikasi ulang server (header X-Step-Up-Token). */
  stepUpToken?: string
}

export function resolveDispute(
  disputeId: string,
  input: {
    /** Wajib: enum backend DisputeDecisionDto. */
    decision: DisputeDecision
    /** Wajib: min 100 karakter (dokumentasi audit). */
    decisionNotes: string
    /** Wajib bila decision === 'SPLIT': int 1–99, jumlah dengan sellerPercent = 100. */
    buyerPercent?: number
    /** Wajib bila decision === 'SPLIT': int 1–99, jumlah dengan buyerPercent = 100. */
    sellerPercent?: number
  },
  opts?: ResolveDisputeOpts,
): Promise<ResolveDisputeResult> {
  // DP-001: payload persis kontrak backend DisputeDecisionDto.
  // Field lama {resolution, notes, winnerId} tidak dikenal backend dan
  // selalu menghasilkan 400.
  const headers: Record<string, string> = {
    "Idempotency-Key": opts?.idempotencyKey ?? newIdempotencyKey(),
  }
  if (opts?.stepUpToken) {
    headers[STEP_UP_HEADER] = opts.stepUpToken
  }
  return adminHttp.post<ResolveDisputeResult>(
    `/v1/admin/disputes/${encodeURIComponent(disputeId)}/resolve`,
    input,
    { headers },
  )
}

/**
 * Batch 43 item #33 — eskalasi sengketa 1 ketuk dari admin.
 *
 * KONTRAK TERVERIFIK ke backend (integrator, 2026-09-28):
 * `POST /v1/admin/disputes/:id/quick-escalate`, body `{ note?: string }`
 * (maks 500 karakter), HttpCode 200. Roles: SUPER_ADMIN, DISPUTE_ADMIN,
 * CUSTOMER_SUPPORT (lihat dispute-quick-escalation.controller.ts).
 * Catatan: eskalasi hanya menandai status ESCALATED; dana tetap di escrow
 * sampai resolve.
 */
export function escalateDispute(disputeId: string, reason: string): Promise<unknown> {
  return adminHttp.post(
    `/v1/admin/disputes/${encodeURIComponent(disputeId)}/quick-escalate`,
    { note: reason },
    { headers: idempotencyHeaders() },
  )
}

/**
 * BAI-095 — catatan internal sengketa (kolaboratif antar admin).
 * Backend: GET/POST /v1/admin/disputes/:disputeId/notes. Hanya mediator
 * yang di-assign / SUPER_ADMIN (NOT_ASSIGNED_ADMIN).
 */
export type DisputeInternalNote = {
  id: string
  disputeId: string
  adminId: string
  note: string
  createdAt: string
  admin?: { adminId: string; fullName: string } | null
}

export async function listDisputeNotes(disputeId: string): Promise<DisputeInternalNote[]> {
  const res = await adminHttp.get<{ disputeId: string; notes: DisputeInternalNote[] }>(
    `/v1/admin/disputes/${encodeURIComponent(disputeId)}/notes`,
  )
  return Array.isArray(res?.notes) ? res.notes : []
}

export function addDisputeNote(disputeId: string, note: string): Promise<DisputeInternalNote> {
  return adminHttp.post<DisputeInternalNote>(
    `/v1/admin/disputes/${encodeURIComponent(disputeId)}/notes`,
    { note },
    { headers: idempotencyHeaders() },
  )
}

/**
 * SYS-C-303 — batas server untuk bukti sengketa (jalur admin). Sumber kebenaran (backend):
 * - Upload (`POST :disputeId/evidence/upload`): `UploadPurpose.DISPUTE_EVIDENCE` →
 *   `ALLOWED_CONTENT_TYPES` + `MAX_FILE_SIZE` (50MB) di `src/modules/upload/upload.service.ts`.
 * - Submit (`POST :disputeId/evidence`): `submitEvidenceAsAdmin` di
 *   `admin-disputes.service.ts` → maks 10MB per file, total 50MB per submit;
 *   `SubmitEvidenceDto` → `@ArrayMaxSize(10)` untuk fileUrls.
 *
 * Batas EFEKTIF pra-upload memakai yang paling ketat dari kedua tahap
 * (10MB/file dari submit), agar file yang lolos upload tidak ditolak saat submit.
 */
export const DISPUTE_EVIDENCE_MAX_FILES = 10
export const DISPUTE_EVIDENCE_MAX_FILE_BYTES = 10 * 1024 * 1024
export const DISPUTE_EVIDENCE_MAX_TOTAL_BYTES = 50 * 1024 * 1024
/** Sama persis dengan `ALLOWED_CONTENT_TYPES[DISPUTE_EVIDENCE]` backend — termasuk HEIC/HEIF. */
export const DISPUTE_EVIDENCE_ALLOWED_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
  "application/pdf",
  "video/mp4",
  "video/quicktime",
  "video/webm",
] as const
/** Untuk atribut `accept=` input file — selaras dengan yang diterima server. */
export const DISPUTE_EVIDENCE_ACCEPT = DISPUTE_EVIDENCE_ALLOWED_TYPES.join(",")

export type DisputeEvidenceFileValidation = { ok: true } | { ok: false; message: string }

/**
 * Validasi pra-upload: cek jumlah/ukuran/tipe SESUAI batas server SEBELUM
 * upload, agar gagal cepat dengan pesan jelas (bukan setelah upload lalu
 * ditolak backend). Tipe kosong/tak dikenal ditolak — submit backend memakai
 * `file.type` kiriman klien untuk cek allowlist, jadi tipe yang tak terdeteksi
 * browser pasti ditolak di sana juga.
 */
export function validateDisputeEvidenceFiles(files: File[]): DisputeEvidenceFileValidation {
  if (files.length === 0) {
    return { ok: false, message: "Pilih minimal satu file bukti." }
  }
  if (files.length > DISPUTE_EVIDENCE_MAX_FILES) {
    return { ok: false, message: `Maksimal ${DISPUTE_EVIDENCE_MAX_FILES} file per pengiriman bukti.` }
  }
  const allowed = new Set<string>(DISPUTE_EVIDENCE_ALLOWED_TYPES)
  for (const f of files) {
    if (!f.type || !allowed.has(f.type)) {
      return {
        ok: false,
        message: `Tipe file tidak didukung: ${f.name}${f.type ? ` (${f.type})` : " (tipe tak terdeteksi)"}.`,
      }
    }
    if (f.size > DISPUTE_EVIDENCE_MAX_FILE_BYTES) {
      return { ok: false, message: `Ukuran file melebihi 10MB: ${f.name}.` }
    }
  }
  const total = files.reduce((sum, f) => sum + f.size, 0)
  if (total > DISPUTE_EVIDENCE_MAX_TOTAL_BYTES) {
    return { ok: false, message: "Total ukuran file melebihi 50MB." }
  }
  return { ok: true }
}

/**
 * BAI-094 — upload file bukti "titipan" admin (multipart). adminHttp tidak
 * mendukung FormData (selalu JSON), jadi pakai fetch langsung dengan token
 * dari memori (pola sama dengan admin-client).
 */
export async function adminUploadDisputeEvidenceFile(
  disputeId: string,
  file: File,
): Promise<{ fileKey: string; fileUrl?: string }> {
  const form = new FormData()
  form.append("file", file)
  const token = getAdminAccessToken()
  const res = await fetch(
    `${API_BASE_URL}/v1/admin/disputes/${encodeURIComponent(disputeId)}/evidence/upload`,
    {
      method: "POST",
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      credentials: "include",
      body: form,
    },
  )
  if (!res.ok) {
    throw new Error(`Upload bukti gagal (${res.status})`)
  }
  return (await res.json()) as { fileKey: string; fileUrl?: string }
}

export type AdminDisputeEvidenceResult = {
  evidence: unknown
  fileResults: unknown[]
  summary: { filesAttached: number; totalSizeBytes: number }
  notificationDelivered: boolean
}

export function adminSubmitDisputeEvidence(
  disputeId: string,
  input: { title: string; description: string; fileUrls: string[]; fileTypes: string[] },
): Promise<AdminDisputeEvidenceResult> {
  return adminHttp.post<AdminDisputeEvidenceResult>(
    `/v1/admin/disputes/${encodeURIComponent(disputeId)}/evidence`,
    input,
    { headers: idempotencyHeaders() },
  )
}
