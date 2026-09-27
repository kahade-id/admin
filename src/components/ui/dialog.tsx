/**
 * Kahade Admin — <Dialog> + <ConfirmDialog> (§9.10, §10).
 *
 * Modal terpusat: overlay `bg-overlay`, kotak `rounded-md border bg-surface-
 * elevated`. Tutup via Escape + klik overlay. Fokus dipindah ke panel saat
 * dibuka (autofocus — trap fokus sederhana) dan dikembalikan ke pemicu saat
 * ditutup; scroll body dikunci selama terbuka.
 *
 * Animasi memakai token `motion.overlay` (§8): masuk fade + translateY 8px +
 * scale 0.97 (250ms, kurva enter); keluar fade cepat 200ms (kurva exit).
 * Unmount ditunda sampai animasi keluar selesai.
 *
 * <ConfirmDialog>: komposit konfirmasi — tombol di-stack vertikal (konfirmasi
 * di atas, batal ghost di bawah): hierarki primary > ghost tegas dan label
 * tidak terpotong di lebar sempit.
 */
"use client"

import { useEffect, useRef, useState, type ReactNode } from "react"
import { cn } from "@/lib/cn"
import { Button } from "./button"

export type DialogProps = {
  open: boolean
  onClose: () => void
  title: string
  description?: string
  children?: ReactNode
  footer?: ReactNode
  className?: string
}

export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  className,
}: DialogProps) {
  const [rendered, setRendered] = useState(open)
  const [entered, setEntered] = useState(false)
  const panelRef = useRef<HTMLDivElement>(null)
  const returnFocusRef = useRef<HTMLElement | null>(null)

  // Mount/unmount + animasi masuk/keluar (§8 motion.overlay)
  useEffect(() => {
    if (open) {
      setRendered(true)
      setEntered(false)
      const raf = requestAnimationFrame(() => requestAnimationFrame(() => setEntered(true)))
      return () => cancelAnimationFrame(raf)
    }
    // Keluar: mainkan fade-out 200ms dulu, baru unmount
    setEntered(false)
    const timer = setTimeout(() => setRendered(false), 200)
    return () => clearTimeout(timer)
  }, [open])

  // Escape menutup + trap fokus Tab di dalam panel (WCAG 2.1.2 — G515).
  // Tanpa trap, Tab bisa "kabur" ke konten latar di belakang modal.
  useEffect(() => {
    if (!rendered) return
    const panel = panelRef.current
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose()
        return
      }
      if (e.key !== "Tab" || !panel) return
      const focusables = Array.from(
        panel.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      ).filter(
        (el) =>
          !el.closest("[hidden]") &&
          el.getAttribute("aria-hidden") !== "true",
      )
      if (focusables.length === 0) {
        e.preventDefault()
        panel.focus()
        return
      }
      const first = focusables[0]
      const last = focusables[focusables.length - 1]
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault()
        first.focus()
      }
    }
    document.addEventListener("keydown", onKeyDown)
    return () => document.removeEventListener("keydown", onKeyDown)
  }, [rendered, onClose])

  // Autofocus panel + kunci scroll body + kembalikan fokus ke pemicu
  useEffect(() => {
    if (!rendered) return
    returnFocusRef.current = document.activeElement as HTMLElement | null
    panelRef.current?.focus({ preventScroll: true })
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = "hidden"
    return () => {
      document.body.style.overflow = prevOverflow
      returnFocusRef.current?.focus({ preventScroll: true })
    }
  }, [rendered])

  if (!rendered) return null

  return (
    <div className="fixed inset-0 z-modal flex items-center justify-center px-5">
      {/* Overlay — klik menutup */}
      <div
        aria-hidden="true"
        onClick={onClose}
        className={cn(
          "absolute inset-0 bg-overlay transition-opacity duration-200",
          entered ? "opacity-100" : "opacity-0",
        )}
      />
      {/* Panel */}
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        className={cn(
          "relative w-full max-w-content rounded-md border border-border bg-surface-elevated p-5 outline-none",
          "transition-all duration-[250ms] ease-[cubic-bezier(0.33,1,0.68,1)]",
          entered ? "translate-y-0 scale-100 opacity-100" : "translate-y-2 scale-[0.97] opacity-0",
          className,
        )}
      >
        {/* AW-012: tombol tutup yang bisa difokus keyboard (selain Escape/overlay) */}
        <button
          type="button"
          onClick={onClose}
          aria-label="Tutup dialog"
          className="absolute right-3 top-3 flex h-8 w-8 items-center justify-center rounded-sm text-h3 leading-none text-text-secondary transition-colors hover:bg-surface hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus focus-visible:ring-offset-2 focus-visible:ring-offset-surface-elevated"
        >
          <span aria-hidden="true">×</span>
        </button>
        <h3 className="pr-10 text-h3 font-semibold text-text-primary">{title}</h3>
        {description ? (
          <p className="mt-2 text-body text-text-secondary">{description}</p>
        ) : null}
        {children ? <div className="mt-4">{children}</div> : null}
        {footer ? <div className="mt-5">{footer}</div> : null}
      </div>
    </div>
  )
}

// ------------------------------------------------------------------
// ConfirmDialog — komposit konfirmasi / alert dua aksi
// ------------------------------------------------------------------

export type ConfirmDialogProps = {
  open: boolean
  onClose: () => void
  title: string
  description?: string
  confirmLabel?: string
  cancelLabel?: string
  onConfirm: () => void | Promise<void>
  /** Spinner di tombol konfirmasi; tombol batal ikut disabled */
  loading?: boolean
  /** Konfirmasi memakai tombol destructive */
  destructive?: boolean
}

export function ConfirmDialog({
  open,
  onClose,
  title,
  description,
  confirmLabel = "Konfirmasi",
  cancelLabel = "Batal",
  onConfirm,
  loading = false,
  destructive = false,
}: ConfirmDialogProps) {
  return (
    <Dialog open={open} onClose={onClose} title={title} description={description}>
      <div className="flex flex-col gap-2 pt-2">
        {/* Stack: konfirmasi di atas, batal ghost di bawah (hierarki primary > ghost) */}
        <Button
          variant={destructive ? "destructive" : "primary"}
          loading={loading}
          onClick={onConfirm}
        >
          {confirmLabel}
        </Button>
        <Button variant="ghost" disabled={loading} onClick={onClose}>
          {cancelLabel}
        </Button>
      </div>
    </Dialog>
  )
}
