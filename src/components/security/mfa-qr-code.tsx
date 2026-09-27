/**
 * MfaQrCode — render QR enrollment TOTP sepenuhnya lokal di browser.
 *
 * SEC-506 (review): sebelumnya QR di-generate via api.qrserver.com dengan
 * otpauth URL (berisi TOTP secret) sebagai query param — secret bocor ke
 * pihak ketiga. Sekarang QR di-render dari `qrcode` (data URL), sehingga
 * secret tidak pernah meninggalkan browser. CSP `img-src data:` sudah
 * mengizinkan data URL.
 */
"use client"

import { useEffect, useState } from "react"
import QRCode from "qrcode"

export function MfaQrCode({ otpauthUrl }: { otpauthUrl: string }) {
  const [dataUrl, setDataUrl] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    QRCode.toDataURL(otpauthUrl, { width: 220, margin: 1, errorCorrectionLevel: "M" })
      .then((url) => {
        if (alive) setDataUrl(url)
      })
      .catch(() => {
        if (alive) setDataUrl(null)
      })
    return () => {
      alive = false
    }
  }, [otpauthUrl])

  if (!dataUrl) {
    return <p className="text-body text-text-secondary">Memuat kode QR…</p>
  }
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={dataUrl} alt="QR code MFA" width={220} height={220} />
}
