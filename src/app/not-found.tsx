import Link from "next/link"

import { Button } from "@/components/ui/button"
import { EmptyState } from "@/components/ui/empty-state"

/**
 * ADM-414 — halaman 404 global admin web.
 * Sebelumnya: route tidak dikenal menampilkan halaman 404 default Next.js.
 */
export default function NotFound() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-6">
      <EmptyState
        title="Halaman tidak ditemukan"
        description="Alamat yang Anda buka tidak tersedia di admin panel Kahade."
        action={
          <Link href="/">
            <Button variant="primary" size="sm" fullWidth={false}>
              Kembali ke beranda
            </Button>
          </Link>
        }
      />
    </div>
  )
}
