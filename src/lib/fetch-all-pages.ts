/**
 * AW-006 (perf-fix): ambil semua halaman list secara paralel per batch.
 *
 * Menggantikan pola lama "loop sekuensial await per halaman" (hingga 50
 * halaman × 100 baris untuk ekspor CSV) yang lambat karena latency
 * berakumulasi: halaman 1 diambil dulu untuk mengetahui totalPages, lalu
 * sisa halaman diambil paralel dengan batas konkuren agar tidak membanjiri
 * backend maupun browser.
 *
 * @param fetchPage fungsi yang mengambil satu halaman (1-based).
 * @param opts.maxPages batas keras jumlah halaman (default 50).
 * @param opts.limit jumlah baris per halaman yang diminta ke backend.
 * @param opts.concurrency batas request paralel per batch (default 4).
 * @param opts.onProgress dipanggil setiap batch selesai: (donePages, totalPages).
 */
export async function fetchAllPages<T>(
  fetchPage: (page: number, limit: number) => Promise<{ data?: T[]; totalPages?: number }>,
  opts: {
    maxPages?: number
    limit?: number
    concurrency?: number
    onProgress?: (donePages: number, totalPages: number) => void
  } = {},
): Promise<T[]> {
  const maxPages = opts.maxPages ?? 50
  const limit = opts.limit ?? 100
  const concurrency = Math.max(1, opts.concurrency ?? 4)

  // Halaman 1 dulu: untuk mengetahui totalPages sekaligus validasi filter.
  const first = await fetchPage(1, limit)
  const items = first.data ?? []
  const totalPages = Math.min(first.totalPages ?? 1, maxPages)
  opts.onProgress?.(1, totalPages)
  if (totalPages <= 1 || items.length === 0) return items

  const out: T[][] = new Array(totalPages)
  out[0] = items
  const pages: number[] = []
  for (let p = 2; p <= totalPages; p++) pages.push(p)

  // Ambil sisa halaman paralel per batch dengan batas konkuren.
  for (let i = 0; i < pages.length; i += concurrency) {
    const batch = pages.slice(i, i + concurrency)
    const results = await Promise.all(batch.map((p) => fetchPage(p, limit)))
    batch.forEach((p, idx) => {
      out[p - 1] = results[idx].data ?? []
    })
    opts.onProgress?.(Math.min(i + concurrency + 1, totalPages), totalPages)
  }

  return out.flat()
}
