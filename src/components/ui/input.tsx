/**
 * Kahade Admin — <Input> / <TextArea> + <Field> (§9.2).
 *
 * Outlined, label di atas. State: default, focus (border-focus 1.5px),
 * error (border-error + helper merah), disabled (opacity 40%).
 *
 * Aturan visual dari sumber yang dipertahankan:
 *   - Border resting = `border-border-control` (bukan `border-border`):
 *     outline form control wajib >= 3:1 vs background (WCAG 1.4.11).
 *   - Border width fokus 1.5 vs resting 1 menggeser konten 0.5px — padding
 *     dikompensasi (`px-[15px]`) supaya tidak layout jump; nilai arbitrary
 *     ini turunan langsung dari borderWidth token (16 − 0.5).
 *   - Error MENGGANTIKAN hint (bukan ditumpuk) agar tinggi field tidak
 *     melompat saat validasi berubah; saat error, border tetap error
 *     walau fokus.
 *   - Label: 13/600 (text-label) tone secondary, tidak all-caps (§3.2).
 *     Required ditandai " *" tone danger, bukan teks "(wajib)".
 *   - Helper/error: caption; error tone danger. Placeholder = text-secondary
 *     (harus terbaca, bukan text-disabled).
 *   - Tidak ada shake pada error (§8) — cukup border + helper text.
 *   - `outline-none`: focus ring browser dimatikan agar tidak dobel dengan
 *     border-focus sistem.
 */
"use client"

import {
  forwardRef,
  useId,
  type InputHTMLAttributes,
  type ReactNode,
  type TextareaHTMLAttributes,
} from "react"
import { cn } from "@/lib/cn"

// ------------------------------------------------------------------
// Field — kerangka label + kontrol + helper/error (pendukung form)
// ------------------------------------------------------------------

export type FieldProps = {
  label?: string
  required?: boolean
  /** Teks bantuan di bawah kontrol — digantikan `error` saat ada galat */
  hint?: string
  /** Pesan galat — MENGGANTIKAN hint, bukan ditumpuk */
  error?: string
  /** Sisakan ruang satu baris caption meski hint/error kosong */
  reserveHelperSpace?: boolean
  disabled?: boolean
  children: ReactNode
  className?: string
  /** id kontrol di dalam — untuk <label htmlFor> */
  htmlFor?: string
  /** id elemen hint/error — untuk aria-describedby */
  describedBy?: string
}

export function Field({
  label,
  required = false,
  hint,
  error,
  reserveHelperSpace = false,
  disabled = false,
  children,
  className,
  htmlFor,
  describedBy,
}: FieldProps) {
  const message = error ?? hint

  return (
    <div className={cn("w-full space-y-2", className)}>
      {label ? (
        <label
          htmlFor={htmlFor}
          className={cn(
            "block text-label font-semibold",
            disabled ? "text-text-disabled" : "text-text-secondary",
          )}
        >
          {label}
          {required ? <span className="text-danger-text"> *</span> : null}
        </label>
      ) : null}
      {children}
      {message || reserveHelperSpace ? (
        <p
          id={describedBy}
          role={error ? "alert" : undefined}
          className={cn(
            "min-h-[18px] text-caption",
            error ? "text-danger-text" : "text-text-secondary",
          )}
        >
          {message ?? ""}
        </p>
      ) : null}
    </div>
  )
}

// ------------------------------------------------------------------
// Kotak field bersama (Input & TextArea)
// ------------------------------------------------------------------

function boxClassName(hasError: boolean, multiline: boolean): string {
  return cn(
    "w-full rounded-sm border bg-surface px-4 text-body text-text-primary placeholder:text-text-secondary outline-none",
    multiline ? "py-3" : "min-h-12",
    // Border: resting 1px border-control -> fokus/error 1.5px, padding
    // dikompensasi 16px -> 15px supaya konten tidak bergeser.
    hasError
      ? "border-error border-border-error px-[15px] focus:border-error focus:border-border-error"
      : "border border-border-control focus:border-focus focus:border-border-focus focus:px-[15px]",
  )
}

type ControlIds = {
  id?: string
  "aria-describedby"?: string
}

function useFieldIds(id: string | undefined, hasMessage: boolean) {
  const autoId = useId()
  const controlId = id ?? autoId
  const hintId = `${controlId}-hint`
  return { controlId, describedBy: hasMessage ? hintId : undefined, hintId }
}

// ------------------------------------------------------------------
// Input
// ------------------------------------------------------------------

export type InputProps = Omit<InputHTMLAttributes<HTMLInputElement>, "children"> & {
  label?: string
  required?: boolean
  hint?: string
  error?: string
  /** className untuk wrapper <Field> */
  className?: string
  /** className untuk elemen <input> */
  inputClassName?: string
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  {
    label,
    required,
    hint,
    error,
    disabled,
    id,
    className,
    inputClassName,
    "aria-describedby": ariaDescribedBy,
    ...rest
  }: InputProps,
  ref,
) {
  const { controlId, describedBy, hintId } = useFieldIds(id, !!(hint || error))

  return (
    <Field
      label={label}
      required={required}
      hint={hint}
      error={error}
      disabled={disabled}
      htmlFor={controlId}
      describedBy={hintId}
      className={className}
    >
      <input
        ref={ref}
        id={controlId}
        disabled={disabled}
        aria-invalid={error ? true : undefined}
        aria-describedby={ariaDescribedBy ?? describedBy}
        className={cn(
          boxClassName(!!error, false),
          disabled && "cursor-not-allowed text-text-disabled opacity-disabled",
          inputClassName,
        )}
        {...rest}
      />
    </Field>
  )
})

// ------------------------------------------------------------------
// TextArea
// ------------------------------------------------------------------

export type TextAreaProps = Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "children"> & {
  label?: string
  required?: boolean
  hint?: string
  error?: string
  /** Jumlah baris (default 4) */
  rows?: number
  /** className untuk wrapper <Field> */
  className?: string
  /** className untuk elemen <textarea> */
  inputClassName?: string
}

export const TextArea = forwardRef<HTMLTextAreaElement, TextAreaProps>(function TextArea(
  {
    label,
    required,
    hint,
    error,
    disabled,
    id,
    rows = 4,
    className,
    inputClassName,
    "aria-describedby": ariaDescribedBy,
    ...rest
  }: TextAreaProps,
  ref,
) {
  const { controlId, describedBy, hintId } = useFieldIds(id, !!(hint || error))

  return (
    <Field
      label={label}
      required={required}
      hint={hint}
      error={error}
      disabled={disabled}
      htmlFor={controlId}
      describedBy={hintId}
      className={className}
    >
      <textarea
        ref={ref}
        id={controlId}
        rows={rows}
        disabled={disabled}
        aria-invalid={error ? true : undefined}
        aria-describedby={ariaDescribedBy ?? describedBy}
        className={cn(
          boxClassName(!!error, true),
          disabled && "cursor-not-allowed text-text-disabled opacity-disabled",
          inputClassName,
        )}
        {...rest}
      />
    </Field>
  )
})
