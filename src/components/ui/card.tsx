/**
 * Kahade Admin — <Card> + <CardHeader> / <CardBody> / <CardTitle> (§9.6).
 *
 * Kontainer konten dengan radius `md` (8px) dan border 1px: bg-surface +
 * border-border di atas background.
 *
 * Aturan visual dari sumber yang dipertahankan:
 *   - Padding default 20px (`p-5`, tokens.layout.cardPadding). `padded={false}`
 *     untuk card yang isinya list ber-divider full-bleed; sub-komponen Header/
 *     Body lalu membawa padding sendiri.
 *   - Header: judul H3 + aksi kanan opsional, dipisah divider dari body.
 */
"use client"

import type { HTMLAttributes, ReactNode } from "react"
import { cn } from "@/lib/cn"

export type CardProps = HTMLAttributes<HTMLDivElement> & {
  children?: ReactNode
  /** Padding 20px semua sisi (default true) */
  padded?: boolean
  className?: string
}

export function Card({ children, padded = true, className, ...rest }: CardProps) {
  return (
    <div
      className={cn(
        "w-full overflow-hidden rounded-md border border-border bg-surface",
        padded && "p-5",
        className,
      )}
      {...rest}
    >
      {children}
    </div>
  )
}

export type CardHeaderProps = HTMLAttributes<HTMLDivElement> & {
  title?: string
  subtitle?: string
  /** Slot kanan (Badge, aksi teks, dsb.) */
  action?: ReactNode
  children?: ReactNode
  /** Garis pemisah ke body (default true) */
  divider?: boolean
  className?: string
}

/** Header: judul H3 + aksi kanan opsional, dipisah divider dari body */
export function CardHeader({
  title,
  subtitle,
  action,
  children,
  divider = true,
  className,
  ...rest
}: CardHeaderProps) {
  return (
    <div {...rest}>
      <div className={cn("flex items-center gap-3 px-5 py-4", className)}>
        <div className="min-w-0 flex-1 space-y-1">
          {title ? <CardTitle className="truncate">{title}</CardTitle> : null}
          {subtitle ? <p className="text-caption text-text-secondary">{subtitle}</p> : null}
          {children}
        </div>
        {action}
      </div>
      {divider ? <div className="border-b border-border" /> : null}
    </div>
  )
}

export type CardBodyProps = HTMLAttributes<HTMLDivElement> & {
  children?: ReactNode
  className?: string
}

export function CardBody({ children, className, ...rest }: CardBodyProps) {
  return (
    <div className={cn("p-5", className)} {...rest}>
      {children}
    </div>
  )
}

export type CardTitleProps = HTMLAttributes<HTMLHeadingElement> & {
  children?: ReactNode
  className?: string
}

export function CardTitle({ children, className, ...rest }: CardTitleProps) {
  return (
    <h3 className={cn("text-h3 font-semibold text-text-primary", className)} {...rest}>
      {children}
    </h3>
  )
}
