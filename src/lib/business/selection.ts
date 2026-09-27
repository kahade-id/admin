/**
 * Utilitas seleksi bulk untuk antrean verifikasi bisnis — FUNGSI MURNI
 * (tanpa React) supaya bisa di-unit-test.
 *
 * Kontrak:
 * - Selection disimpan sebagai `Set<string>` berisi ID (bukan index) → aman
 *   lintas halaman & paginasi.
 * - Setiap ID terpilih mengingat status saat dipilih (`Map<id, status>`) →
 *   saat refresh, item yang statusnya berubah otomatis dibatalkan.
 * - Selection DIBERSIHKAN saat filter berubah (dipanggil eksplisit oleh UI).
 */

/** Status item pada saat dipilih — dipakai untuk deteksi perubahan. */
export type SelectionSnapshot = Map<string, string>

/** Toggle satu ID. Mengembalikan Set BARU (immutable). */
export function toggleSelection(selected: Set<string>, id: string): Set<string> {
  const next = new Set(selected)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  return next
}

/** Tambahkan semua ID halaman ini ke selection. */
export function selectPageIds(selected: Set<string>, ids: string[]): Set<string> {
  const next = new Set(selected)
  for (const id of ids) next.add(id)
  return next
}

/** Hapus semua ID halaman ini dari selection. */
export function deselectPageIds(selected: Set<string>, ids: string[]): Set<string> {
  const next = new Set(selected)
  for (const id of ids) next.delete(id)
  return next
}

/**
 * Pangkas selection: buang ID yang statusnya berubah sejak dipilih.
 * `currentById`: status terkini per ID (dari hasil refresh terakhir).
 * Mengembalikan { kept, dropped } — `dropped` berisi ID yang dibatalkan.
 */
export function pruneChangedStatuses(
  selected: Set<string>,
  snapshot: SelectionSnapshot,
  currentById: Map<string, string>,
): { kept: Set<string>; dropped: string[] } {
  const kept = new Set<string>()
  const dropped: string[] = []
  for (const id of selected) {
    const atSelect = snapshot.get(id)
    const current = currentById.get(id)
    // Item tidak ada di hasil refresh (mis. pindah halaman / keluar filter):
    // pertahankan — selection lintas halaman by ID.
    // Item ada dan statusnya berubah → batalkan pilihan.
    if (current !== undefined && atSelect !== undefined && current !== atSelect) {
      dropped.push(id)
    } else {
      kept.add(id)
    }
  }
  return { kept, dropped }
}

/**
 * Bagi ID menjadi batch sesuai batas backend. Batas default 50 =
 * BULK_BUSINESS_VERIFICATION_MAX di backend.
 */
export function chunkIds(ids: string[], batchSize = 50): string[][] {
  const chunks: string[][] = []
  for (let i = 0; i < ids.length; i += batchSize) chunks.push(ids.slice(i, i + batchSize))
  return chunks
}

/** Catat snapshot status untuk ID yang baru dipilih. */
export function snapshotStatuses(
  snapshot: SelectionSnapshot,
  rows: Array<{ id: string; status: string }>,
): SelectionSnapshot {
  const next = new Map(snapshot)
  for (const r of rows) {
    if (!next.has(r.id)) next.set(r.id, r.status)
  }
  return next
}

/** Bersihkan snapshot dari ID yang sudah tidak terpilih. */
export function pruneSnapshot(snapshot: SelectionSnapshot, selected: Set<string>): SelectionSnapshot {
  const next = new Map<string, string>()
  for (const [id, status] of snapshot) {
    if (selected.has(id)) next.set(id, status)
  }
  return next
}

/**
 * Apakah kegagalan layak di-retry? Kegagalan "permanen" (status sudah berubah
 * / sudah diproses admin lain / validasi) TIDAK di-retry; sisanya (jaringan,
 * 429, 5xx) dianggap sementara.
 */
const PERMANENT_PATTERNS = [
  /already processed/i,
  /already (approved|rejected|revoked)/i,
  /is already /i,
  /not found/i,
  /tidak ditemukan/i,
  /invalid/i,
  /must contain/i,
  /wajib/i,
]

export function isTransientFailure(reason: string): boolean {
  const msg = reason ?? ""
  return !PERMANENT_PATTERNS.some((re) => re.test(msg))
}

/** Ringkasan teks TANPA PII untuk disalin — hanya berisi ID verifikasi. */
export function buildBulkSummaryText(opts: {
  action: "approve" | "reject"
  batchIds: string[]
  succeeded: string[]
  failed: Array<{ id: string; reason: string }>
}): string {
  const actionLabel = opts.action === "approve" ? "Disetujui" : "Ditolak"
  const lines = [
    `Verifikasi bisnis bulk — ${actionLabel}`,
    `Batch: ${opts.batchIds.join(", ") || "—"}`,
    `Berhasil: ${opts.succeeded.length}`,
  ]
  if (opts.succeeded.length > 0) {
    lines.push(...opts.succeeded.map((id) => `  ✓ ${id}`))
  }
  lines.push(`Gagal: ${opts.failed.length}`)
  if (opts.failed.length > 0) {
    lines.push(...opts.failed.map((f) => `  ✗ ${f.id} — ${f.reason}`))
  }
  return lines.join("\n")
}
