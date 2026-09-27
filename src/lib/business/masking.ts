/**
 * Masking NPWP untuk preview minim-PII (mirror dari
 * backend/src/modules/admin/business-verification/legal-entity.util.ts).
 * Semua digit kecuali 4 digit terakhir diganti '•', format grup Indonesia
 * dipertahankan. Contoh: "01.234.567.8-901.000" → "••.•••.•••.•-••1.000".
 */

export function maskNpwp(npwp?: string | null): string | null {
  if (!npwp) return null
  const digits = npwp.replace(/\D/g, "")
  if (digits.length < 4) return "••••"
  const masked = "•".repeat(digits.length - 4) + digits.slice(-4)
  if (digits.length === 15) {
    // Format NPWP 15 digit: XX.XXX.XXX.X-XXX.XXX
    const g = [2, 3, 3, 1, 3, 3]
    const parts: string[] = []
    let i = 0
    for (const len of g) {
      parts.push(masked.slice(i, i + len))
      i += len
    }
    return `${parts[0]}.${parts[1]}.${parts[2]}.${parts[3]}-${parts[4]}.${parts[5]}`
  }
  if (digits.length === 16) {
    // Format NIK 16 digit: grup per 4
    return [0, 4, 8, 12].map((s) => masked.slice(s, s + 4)).join(" ")
  }
  return masked
}

/** Jenis badan hukum → label Indonesia untuk filter/tabel. */
export const LEGAL_ENTITY_LABEL: Record<string, string> = {
  PT: "PT",
  CV: "CV",
  UD: "UD",
  FIRMA: "Firma",
  KOPERASI: "Koperasi",
  YAYASAN: "Yayasan",
  PD: "PD",
  BUMN: "BUMN",
  BUMD: "BUMD",
  PERUM: "Perum",
  LAINNYA: "Lainnya",
}

export const LEGAL_ENTITY_OPTIONS = [
  { value: "ALL", label: "Semua jenis" },
  ...Object.entries(LEGAL_ENTITY_LABEL).map(([value, label]) => ({ value, label })),
]
