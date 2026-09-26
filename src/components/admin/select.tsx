/**
 * Kahade Admin Web — Select native yang di-style sesuai design token.
 * (Belum ada komponen Select di ui/; pakai <select> native agar konsisten.)
 */
"use client"

import { forwardRef, type SelectHTMLAttributes } from "react"
import { cn } from "@/lib/cn"

export type SelectOption = { value: string; label: string }

export type SelectProps = Omit<SelectHTMLAttributes<HTMLSelectElement>, "children"> & {
  label?: string
  options: SelectOption[]
  error?: string
  hint?: string
  /** className untuk wrapper */
  className?: string
  /** className untuk elemen <select> */
  inputClassName?: string
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { label, options, error, hint, disabled, id, className, inputClassName, ...rest },
  ref,
) {
  const controlId = id ?? `select-${label?.replace(/\s+/g, "-").toLowerCase() ?? "field"}`
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      {label ? (
        <label htmlFor={controlId} className="text-body font-medium text-text-primary">
          {label}
        </label>
      ) : null}
      <select
        ref={ref}
        id={controlId}
        disabled={disabled}
        className={cn(
          "min-h-10 w-full rounded-sm border bg-surface px-3 py-2 text-body text-text-primary",
          "focus:outline-none focus:ring-2 focus:ring-focus",
          error ? "border-danger" : "border-border",
          disabled && "cursor-not-allowed opacity-40",
          inputClassName,
        )}
        {...rest}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      {error ? (
        <p className="text-caption text-danger-text">{error}</p>
      ) : hint ? (
        <p className="text-caption text-text-secondary">{hint}</p>
      ) : null}
    </div>
  )
})
