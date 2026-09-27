/**
 * Ekspor CSV client-side untuk antrean admin (ADM-125).
 * BOM \uFEFF agar Excel membuka UTF-8 dengan benar.
 */
export function downloadCsv(
  filename: string,
  headers: string[],
  rows: Array<Array<string | number | null | undefined>>,
): void {
  const esc = (v: string | number | null | undefined): string =>
    `"${String(v ?? "").replace(/"/g, '""')}"`
  const csv = ["\uFEFF" + headers.map(esc).join(",")]
  for (const row of rows) csv.push(row.map(esc).join(","))
  const blob = new Blob([csv.join("\n")], { type: "text/csv;charset=utf-8" })
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}
