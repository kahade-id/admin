/**
 * H07 — Diff sebelum/sesudah untuk audit trail (Batch 139), util murni.
 *
 * Mengubah pasangan objek `before`/`after` (dari AdminAuditLogItem) menjadi
 * daftar perubahan per field, bukan JSON mentah. Rekursif untuk objek
 * bertingkat (path "a.b.c"), array dibandingkan sebagai JSON ringkas.
 */
export type FieldDiffKind = "added" | "removed" | "changed"

export type FieldDiff = {
  /** Path field, mis. "status" atau "address.city". */
  path: string
  kind: FieldDiffKind
  before: unknown
  after: unknown
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v)
}

/** Format satu nilai diff agar ringkas & aman dibaca (tanpa PII mentah berlebih). */
export function formatDiffValue(v: unknown): string {
  if (v === null || v === undefined) return "—"
  if (typeof v === "string") return v.length > 80 ? `${v.slice(0, 80)}…` : v
  if (typeof v === "number" || typeof v === "boolean" || typeof v === "bigint") return String(v)
  if (Array.isArray(v)) {
    if (v.length === 0) return "[]"
    const inner = v
      .slice(0, 3)
      .map((x) => formatDiffValue(x))
      .join(", ")
    return `[${inner}${v.length > 3 ? `, +${v.length - 3} lainnya` : ""}]`
  }
  try {
    const s = JSON.stringify(v)
    return s.length > 80 ? `${s.slice(0, 80)}…` : s
  } catch {
    return String(v)
  }
}

/**
 * Bandingkan dua objek; kembalikan daftar field yang berubah.
 * Key yang hanya ada di satu sisi → added/removed. Nilai deep-equal
 * (JSON) → dilewati. Objek bertingkat di-flatten dengan path dotted.
 */
export function diffObjects(
  before: Record<string, unknown> | null | undefined,
  after: Record<string, unknown> | null | undefined,
  basePath = "",
): FieldDiff[] {
  const b = before ?? {}
  const a = after ?? {}
  const keys = new Set([...Object.keys(b), ...Object.keys(a)])
  const out: FieldDiff[] = []

  for (const key of keys) {
    const path = basePath ? `${basePath}.${key}` : key
    const bv = b[key]
    const av = a[key]
    const inB = key in b
    const inA = key in a

    if (isPlainObject(bv) && isPlainObject(av)) {
      out.push(...diffObjects(bv, av, path))
      continue
    }
    if (!inB && inA) {
      out.push({ path, kind: "added", before: undefined, after: av })
    } else if (inB && !inA) {
      out.push({ path, kind: "removed", before: bv, after: undefined })
    } else {
      let same = false
      try {
        same = JSON.stringify(bv) === JSON.stringify(av)
      } catch {
        same = bv === av
      }
      if (!same) out.push({ path, kind: "changed", before: bv, after: av })
    }
  }
  return out
}
