/**
 * AW-006 (perf-fix): ambil semua halaman list secara paralel per batch.
 *
 * Menggantikan pola lama "loop sekuensial await per halaman" (hingga 50
 * halaman × 100 baris untuk ekspor CSV) yang lambat karena latency
 * berakumulasi: halaman 1 diambil dulu untuk mengetahui totalPages, lalu
 * sisa halaman diambil paralel dengan batas konkuren agar tidak membanjiri
 * backend maupun browser.
 *
 * BAD-035: JANGAN percaya buta `totalPages` — sejak BD-008 backend boleh
 * mengembalikan `totalPages` sebagai "halaman terkonfirmasi" (tanpa COUNT).
 * Bila respons tidak membawa `total` tetapi membawa `hasNext`, pakai loop
 * `hasNext` sekuensial sampai habis (tetap dibatasi maxPages).
 *
 * BAD-032: ekspor diam-diam terpotong di maxPages (50 halaman = 5.000 baris).
 * Fungsi ini mengembalikan `truncated: true` bila itu terjadi — PEMANGGIL
 * WAJIB menampilkannya di toast ("hanya 5.000 baris pertama diekspor"),
 * bukan sukses seolah lengkap.
 *
 * @param fetchPage fungsi yang mengambil satu halaman (1-based).
 * @param opts.maxPages batas keras jumlah halaman (default 50).
 * @param opts.limit jumlah baris per halaman yang diminta ke backend.
 * @param opts.concurrency batas request paralel per batch (default 4).
 * @param opts.onProgress dipanggil setiap batch selesai: (donePages, totalPages).
 */
export type FetchAllPagesResult<T> = {
  /** Semua item yang berhasil diambil. */
  items: T[]
  /** True bila backend punya lebih banyak halaman dari maxPages (terpotong). */
  truncated: boolean
  /** Total halaman menurut backend (atau halaman terkonfirmasi). */
  totalPages: number
  /** Jumlah halaman yang benar-benar diambil. */
  fetchedPages: number
}

export type FetchPageResult<T> = {
  data?: T[]
  totalPages?: number
  /** BD-008: total baris nyata — ABSEN berarti totalPages tidak tepercaya. */
  total?: number
  /** BD-008: lanjutkan selama true bila `total` absen. */
  hasNext?: boolean
}

export async function fetchAllPages<T>(
  fetchPage: (page: number, limit: number) => Promise<FetchPageResult<T>>,
  opts: {
    maxPages?: number
    limit?: number
    concurrency?: number
    onProgress?: (donePages: number, totalPages: number) => void
  } = {},
): Promise<FetchAllPagesResult<T>> {
  const maxPages = opts.maxPages ?? 50
  const limit = opts.limit ?? 100
  const concurrency = Math.max(1, opts.concurrency ?? 4)

  // Halaman 1 dulu: untuk mengetahui totalPages sekaligus validasi filter.
  const first = await fetchPage(1, limit)
  const items = first.data ?? []

  // BAD-035: `total` absen + `hasNext` ada = pola BD-008 — totalPages TIDAK
  // tepercaya sebagai total nyata. Loop sekuensial mengikuti hasNext.
  if (first.total === undefined && typeof first.hasNext === "boolean") {
    const out: T[] = [...items]
    let page = 1
    let hasNext = first.hasNext && items.length > 0
    opts.onProgress?.(1, Math.min(page + 1, maxPages))
    while (hasNext && page < maxPages) {
      page += 1
      const res = await fetchPage(page, limit)
      const batch = res.data ?? []
      out.push(...batch)
      hasNext = !!res.hasNext && batch.length > 0
      opts.onProgress?.(page, Math.min(page + 1, maxPages))
    }
    // Terpotong bila masih ada halaman berikutnya setelah batas.
    return {
      items: out,
      truncated: hasNext,
      totalPages: page + (hasNext ? 1 : 0),
      fetchedPages: page,
    }
  }

  const totalPages = Math.min(first.totalPages ?? 1, maxPages)
  // BAD-032: backend melaporkan lebih banyak halaman dari yang kita ambil.
  const truncated = (first.totalPages ?? 1) > maxPages
  opts.onProgress?.(1, totalPages)
  if (totalPages <= 1 || items.length === 0) {
    return { items, truncated, totalPages, fetchedPages: 1 }
  }

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

  return { items: out.flat(), truncated, totalPages, fetchedPages: totalPages }
}
