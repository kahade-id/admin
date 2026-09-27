"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { Fragment } from "react"

import { MENU } from "@/lib/rbac"

/**
 * ADM-416 — breadcrumb otomatis untuk panel admin.
 *
 * Dibangun dari pathname aktif: segmen pertama dicocokkan ke MENU (label
 * resmi), segmen lanjutan (mis. ID detail) ditampilkan apa adanya.
 * Disembunyikan di halaman login.
 */
export function Breadcrumb() {
  const pathname = usePathname()
  if (pathname === "/login") return null

  const segments = pathname.split("/").filter(Boolean)
  if (segments.length === 0) return null

  const items: { label: string; href: string }[] = []
  let acc = ""
  segments.forEach((seg, i) => {
    acc += `/${seg}`
    if (i === 0) {
      const entry = MENU.find((m) => m.href === acc)
      items.push({ label: entry?.label ?? prettify(seg), href: acc })
    } else {
      items.push({ label: prettify(seg), href: acc })
    }
  })

  return (
    <nav aria-label="Breadcrumb" className="px-6 pt-4">
      <ol className="flex flex-wrap items-center gap-1 text-caption text-text-secondary">
        <li>
          <Link href="/" className="hover:text-text-primary hover:underline">
            Beranda
          </Link>
        </li>
        {items.map((it, i) => (
          <Fragment key={it.href}>
            <li aria-hidden="true" className="text-text-tertiary">
              /
            </li>
            <li>
              {i === items.length - 1 ? (
                <span aria-current="page" className="font-medium text-text-primary">
                  {it.label}
                </span>
              ) : (
                <Link href={it.href} className="hover:text-text-primary hover:underline">
                  {it.label}
                </Link>
              )}
            </li>
          </Fragment>
        ))}
      </ol>
    </nav>
  )
}

function prettify(seg: string): string {
  if (/^[0-9a-f-]{8,}$/i.test(seg)) return "Detail"
  return seg
    .split("-")
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w))
    .join(" ")
}
