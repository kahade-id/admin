/**
 * Kahade Admin — <Badge> (§9.7).
 *
 * Label status kecil, radius `xs` (4px). Dua gaya:
 *   - "soft"    (default): fill bgSoft + teks semantik — untuk status
 *                transaksi di list/detail (Success/Danger/Warning/Info).
 *   - "outline" : transparan + border-default + text-secondary — untuk
 *                kategori netral yang bukan status.
 * Tone "neutral" (soft) = bg-surface + text-secondary untuk badge non-semantik
 * yang tetap ingin fill.
 *
 * Aturan visual dari sumber yang dipertahankan:
 *   - Teks caption weight 500 — bukan label 600 — karena badge bukan judul;
 *     tidak ALL CAPS (§3.2).
 *   - `dot` menaruh titik 6px warna fill di kiri teks.
 *   - Semantic color eksklusif untuk STATUS transaksi (§2.3). Jangan pakai
 *     tone success/danger untuk kategori non-status — pakai "neutral"/outline.
 *   - Tone "accent" (§2.3b) eksklusif untuk momen TRUST & ESCROW — bukan
 *     status transaksi umum dan bukan kategori.
 */
"use client"

import type { ReactNode } from "react"
import { cn } from "@/lib/cn"

export type BadgeTone = "neutral" | "success" | "danger" | "warning" | "info" | "accent"
export type BadgeVariant = "soft" | "outline"

export type BadgeProps = {
  children: ReactNode
  tone?: BadgeTone
  variant?: BadgeVariant
  /** Titik 6px warna fill di kiri teks */
  dot?: boolean
  className?: string
}

const softBox: Record<BadgeTone, string> = {
  neutral: "bg-surface border border-border",
  success: "bg-success-soft",
  danger: "bg-danger-soft",
  warning: "bg-warning-soft",
  info: "bg-info-soft",
  accent: "bg-accent-soft",
}

const softText: Record<BadgeTone, string> = {
  neutral: "text-text-secondary",
  success: "text-success-text",
  danger: "text-danger-text",
  warning: "text-warning-text",
  info: "text-info-text",
  accent: "text-accent-text",
}

const dotClass: Record<BadgeTone, string> = {
  neutral: "bg-text-tertiary",
  success: "bg-success",
  danger: "bg-danger",
  warning: "bg-warning",
  info: "bg-info",
  accent: "bg-accent",
}

export function Badge({
  children,
  tone = "neutral",
  variant = "soft",
  dot = false,
  className,
}: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-xs px-2 py-[2px]",
        variant === "soft" ? softBox[tone] : "bg-transparent border border-border",
        className,
      )}
    >
      {dot ? (
        <span aria-hidden="true" className={cn("h-[6px] w-[6px] rounded-full", dotClass[tone])} />
      ) : null}
      <span
        className={cn(
          "text-caption font-medium",
          variant === "outline" ? "text-text-secondary" : softText[tone],
        )}
      >
        {children}
      </span>
    </span>
  )
}
