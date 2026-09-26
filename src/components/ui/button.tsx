/**
 * Kahade Admin — <Button> (§9.1).
 *
 * Varian: primary (solid), secondary (outline), ghost, destructive, accent.
 * "accent" solid — EKSKLUSIF aksi trust & escrow (konfirmasi terima, lepas
 * dana, verifikasi trust). CTA umum tetap primary; aksi merusak tetap
 * destructive. Jangan pakai accent supaya "lebih berwarna".
 * State  : default, disabled (opacity 40%), loading (spinner inline, label
 *          tetap menahan lebar).
 *
 * Aturan visual dari sumber yang dipertahankan:
 *   - Radius `rounded-sm` (6px) — §5: button = sm. Bukan md.
 *   - Tinggi: sm=40 (min-h-10), md=48 (min-h-12); padding horizontal px-4/px-5.
 *   - Secondary memakai `border-border`, BUKAN border-focus: role focus
 *     disediakan untuk state fokus/aktif (§6.1), bukan resting outline.
 *   - Destructive solid `bg-danger` dengan teks putih di light dan gray.950
 *     di dark (fill dark terlalu terang untuk teks putih, < AA).
 *   - Loading: label dirender dengan `opacity-0` (bukan di-unmount) agar
 *     lebar button tidak melompat saat spinner muncul; spinner absolute di
 *     tengah. `disabled` otomatis saat loading supaya tidak double-submit.
 *   - Ikon di dalam button mengikuti warna label (via currentColor), bukan
 *     text-tertiary default — kirim SVG dengan stroke/fill="currentColor".
 */
"use client"

import type { ButtonHTMLAttributes, ReactNode } from "react"
import { cn } from "@/lib/cn"
import { Spinner, type SpinnerTone } from "./spinner"

export type ButtonVariant = "primary" | "secondary" | "ghost" | "destructive" | "accent"
export type ButtonSize = "sm" | "md"

export type ButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> & {
  children: ReactNode
  variant?: ButtonVariant
  size?: ButtonSize
  /** Spinner inline; label opacity-0 agar lebar tetap. Otomatis disabled. */
  loading?: boolean
  /** Lebar penuh container (default) atau mengikuti konten */
  fullWidth?: boolean
  /** Ikon kiri — SVG harus memakai currentColor agar mengikuti warna label */
  leftIcon?: ReactNode
  /** Ikon kanan — SVG harus memakai currentColor agar mengikuti warna label */
  rightIcon?: ReactNode
  className?: string
}

const variantBox: Record<ButtonVariant, string> = {
  primary: "bg-primary",
  secondary: "bg-transparent border border-border",
  ghost: "bg-transparent",
  // Teks putih di light, gray.950 di dark (kontras di atas fill terang)
  destructive: "bg-danger",
  accent: "bg-accent",
}

const variantText: Record<ButtonVariant, string> = {
  primary: "text-primary-foreground",
  secondary: "text-text-primary",
  ghost: "text-text-primary",
  destructive: "text-white dark:text-gray-950",
  // accent-foreground mode-aware via var (putih/hitam) — tanpa kelas dark:.
  accent: "text-accent-foreground",
}

/** Tone spinner mengikuti warna label: inverse = primary-foreground */
const variantSpinnerTone: Record<ButtonVariant, SpinnerTone> = {
  primary: "inverse",
  secondary: "active",
  ghost: "active",
  destructive: "inverse",
  // onFill accent praktis == primary-foreground di dua mode.
  accent: "inverse",
}

const sizeBox: Record<ButtonSize, string> = {
  sm: "min-h-10 px-4 py-2 gap-2",
  md: "min-h-12 px-5 py-3 gap-2",
}

/** Ring fokus keyboard (WCAG 2.4.7) — satu bentuk untuk semua varian. */
const focusRing =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus focus-visible:ring-offset-2 focus-visible:ring-offset-background"

export function Button({
  children,
  variant = "primary",
  size = "md",
  loading = false,
  fullWidth = true,
  leftIcon,
  rightIcon,
  disabled,
  type = "button",
  className,
  ...rest
}: ButtonProps) {
  const isDisabled = disabled || loading

  return (
    <button
      type={type}
      disabled={isDisabled}
      aria-busy={loading || undefined}
      className={cn(
        "relative inline-flex items-center justify-center rounded-sm font-semibold",
        fullWidth ? "w-full max-w-full" : "max-w-full",
        sizeBox[size],
        variantBox[variant],
        focusRing,
        isDisabled && "cursor-not-allowed opacity-disabled",
        className,
      )}
      {...rest}
    >
      {/* Konten label — opacity-0 saat loading agar lebar tetap */}
      <span
        className={cn(
          "inline-flex min-w-0 items-center justify-center gap-2",
          size === "sm" ? "text-label" : "text-body",
          variantText[variant],
          loading && "opacity-0",
        )}
      >
        {leftIcon}
        <span className="truncate text-center">{children}</span>
        {rightIcon}
      </span>

      {loading ? (
        <span aria-hidden="true" className="absolute inset-0 flex items-center justify-center">
          <Spinner size={size === "sm" ? "sm" : "md"} tone={variantSpinnerTone[variant]} />
        </span>
      ) : null}
    </button>
  )
}
