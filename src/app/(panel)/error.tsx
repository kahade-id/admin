"use client"

import { useEffect } from "react"
import Link from "next/link"

import { Button } from "@/components/ui/button"
import { EmptyState } from "@/components/ui/empty-state"

/**
 * ADM-415 — error boundary untuk segmen (panel).
 * Menangkap error render di halaman panel dan menampilkan pesan ramah
 * alih-alih layar putih; admin bisa mencoba lagi atau kembali ke beranda.
 */
export default function PanelError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    // Catat ke console untuk diagnosa; jangan tampilkan detail ke layar.
    console.error("Panel error:", error)
  }, [error])

  return (
    <div className="flex min-h-[60vh] items-center justify-center p-6">
      <EmptyState
        title="Terjadi kesalahan"
        description="Halaman gagal dimuat. Coba muat ulang, atau kembali ke beranda bila masalah berlanjut."
        action={
          <Button variant="primary" size="sm" fullWidth={false} onClick={() => reset()}>
            Coba lagi
          </Button>
        }
        secondaryAction={
          <Link href="/">
            <Button variant="secondary" size="sm" fullWidth={false}>
              Kembali ke beranda
            </Button>
          </Link>
        }
      />
    </div>
  )
}
