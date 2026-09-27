/**
 * Utilitas seleksi bulk untuk antrean KYC — memakai ulang fungsi murni
 * (tanpa React) dari `@/lib/business/selection` supaya kontraknya konsisten
 * dengan antrean verifikasi bisnis: selection by ID lintas halaman, snapshot
 * status saat dipilih, prune otomatis saat status berubah, batch 50.
 */
export {
  toggleSelection,
  selectPageIds,
  deselectPageIds,
  pruneChangedStatuses,
  chunkIds,
  snapshotStatuses,
  pruneSnapshot,
  isTransientFailure,
  type SelectionSnapshot,
} from "../business/selection"

/** Ringkasan teks TANPA PII untuk disalin — hanya berisi ID KYC. */
export function buildKycBulkSummaryText(opts: {
  action: "approve" | "reject"
  succeeded: string[]
  failed: Array<{ id: string; reason: string }>
  skipped: string[]
}): string {
  const actionLabel = opts.action === "approve" ? "Disetujui" : "Ditolak"
  const lines = [
    `KYC bulk — ${actionLabel}`,
    `Berhasil: ${opts.succeeded.length}`,
    ...opts.succeeded.map((id) => `  ✓ ${id}`),
    `Gagal: ${opts.failed.length}`,
    ...opts.failed.map((f) => `  ✗ ${f.id} — ${f.reason}`),
  ]
  if (opts.skipped.length > 0) {
    lines.push(`Dilewati (bukan PENDING saat dipilih): ${opts.skipped.length}`)
    lines.push(...opts.skipped.map((id) => `  – ${id}`))
  }
  return lines.join("\n")
}

/** Batas bulk KYC per aksi — selaras validasi backend (maks 50). */
export const KYC_BULK_MAX = 50
