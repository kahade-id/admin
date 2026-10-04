/** Peta label & tone status tiket bantuan — dipakai halaman daftar & detail. */

export const TICKET_STATUS_LABEL: Record<string, string> = {
  OPEN: "Terbuka",
  IN_PROGRESS: "Ditangani",
  WAITING_USER: "Menunggu balasan pengguna",
  RESOLVED: "Selesai",
  CLOSED: "Ditutup",
}

export const TICKET_STATUS_TONE: Record<
  string,
  "neutral" | "info" | "success" | "warning" | "danger" | "accent"
> = {
  OPEN: "warning",
  IN_PROGRESS: "info",
  WAITING_USER: "warning",
  RESOLVED: "success",
  CLOSED: "neutral",
}
