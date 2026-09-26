/**
 * Kahade Admin — <Spinner> (§8 "Loading inline / pagination").
 *
 * Indicator kecil STANDAR untuk loading inline: monokrom `text-tertiary`,
 * 16–20px (tokens.motion.inlineSpinnerSize). Bukan logo brand — logo dipakai
 * untuk momen full-screen.
 *
 * Border spinner (border-current + border-t-transparent) dengan `animate-spin`.
 * Ukuran dibatasi ke rentang token; `size="sm"` (16) untuk di dalam Button
 * kecil, `"md"` (20) default.
 */
import { cn } from "@/lib/cn"

export type SpinnerSize = "sm" | "md"
export type SpinnerTone = "default" | "inverse" | "active"

export type SpinnerProps = {
  size?: SpinnerSize
  tone?: SpinnerTone
  className?: string
}

const sizeClass: Record<SpinnerSize, string> = {
  sm: "h-4 w-4",
  md: "h-5 w-5",
}

const toneClass: Record<SpinnerTone, string> = {
  default: "text-text-tertiary",
  inverse: "text-primary-foreground",
  active: "text-text-primary",
}

export function Spinner({ size = "md", tone = "default", className }: SpinnerProps) {
  return (
    <span
      role="status"
      aria-label="Memuat"
      className={cn(
        "inline-block animate-spin rounded-full border-2 border-current border-t-transparent",
        sizeClass[size],
        toneClass[tone],
        className,
      )}
    />
  )
}
