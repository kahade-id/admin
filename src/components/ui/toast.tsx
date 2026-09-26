/**
 * Kahade Admin — Toast: notifikasi sementara non-blocking.
 *
 *   - <ToastProvider> : pasang SEKALI di root — merender viewport + antrean.
 *   - useToast()      : { show, dismiss, dismissAll } dari client component
 *                       mana pun di dalam provider.
 *
 * Aturan:
 *   - Posisi fixed bottom-right (z-banner, 70 — di atas modal).
 *   - Auto-dismiss 4 detik per toast; klik tombol X menutup manual.
 *   - Animasi sederhana: fade + geser 8px saat masuk (200ms, kurva exit
 *     saat keluar tidak dimainkan — unmount langsung).
 *   - Maks 3 toast tampil sekaligus; yang tertua dibuang bila meluap.
 *   - Kotak `bg-surface-elevated border-border` dengan ikon berwarna
 *     mengikuti tone (bukan background semantik pekat).
 */
"use client"

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react"
import { cn } from "@/lib/cn"

export type ToastTone = "success" | "danger" | "info"

export type ToastOptions = {
  title: string
  description?: string
  tone?: ToastTone
}

type ToastRecord = {
  id: number
  title: string
  description?: string
  tone: ToastTone
}

type ToastContextValue = {
  show: (opts: ToastOptions) => void
  dismiss: (id: number) => void
  dismissAll: () => void
}

const ToastContext = createContext<ToastContextValue | null>(null)

const AUTO_DISMISS_MS = 4000
const MAX_VISIBLE = 3

const toneIconClass: Record<ToastTone, string> = {
  success: "text-success-text",
  danger: "text-danger-text",
  info: "text-info-text",
}

function ToneIcon({ tone }: { tone: ToastTone }) {
  const cls = cn("h-5 w-5 shrink-0", toneIconClass[tone])
  if (tone === "success") {
    return (
      <svg viewBox="0 0 20 20" fill="none" className={cls} aria-hidden="true">
        <circle cx="10" cy="10" r="8.5" stroke="currentColor" strokeWidth="1.5" />
        <path
          d="M7 10.2l2.1 2.1L13.2 8"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    )
  }
  if (tone === "danger") {
    return (
      <svg viewBox="0 0 20 20" fill="none" className={cls} aria-hidden="true">
        <circle cx="10" cy="10" r="8.5" stroke="currentColor" strokeWidth="1.5" />
        <path d="M10 6.5v4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        <circle cx="10" cy="13.5" r="1" fill="currentColor" />
      </svg>
    )
  }
  return (
    <svg viewBox="0 0 20 20" fill="none" className={cls} aria-hidden="true">
      <circle cx="10" cy="10" r="8.5" stroke="currentColor" strokeWidth="1.5" />
      <path d="M10 9.2v4.3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <circle cx="10" cy="6.8" r="1" fill="currentColor" />
    </svg>
  )
}

function ToastItem({
  toast,
  onDismiss,
}: {
  toast: ToastRecord
  onDismiss: (id: number) => void
}) {
  const [entered, setEntered] = useState(false)

  useEffect(() => {
    const raf = requestAnimationFrame(() => setEntered(true))
    const timer = setTimeout(() => onDismiss(toast.id), AUTO_DISMISS_MS)
    return () => {
      cancelAnimationFrame(raf)
      clearTimeout(timer)
    }
  }, [toast.id, onDismiss])

  return (
    <div
      role="status"
      className={cn(
        "flex w-full items-start gap-3 rounded-md border border-border bg-surface-elevated px-4 py-3",
        "transition-all duration-200 ease-out",
        entered ? "translate-y-0 opacity-100" : "translate-y-2 opacity-0",
      )}
    >
      <span className="pt-[2px]">
        <ToneIcon tone={toast.tone} />
      </span>

      <div className="min-w-0 flex-1">
        <p className="text-body font-semibold text-text-primary">{toast.title}</p>
        {toast.description ? (
          <p className="mt-0.5 text-caption text-text-secondary">{toast.description}</p>
        ) : null}
      </div>

      <button
        type="button"
        onClick={() => onDismiss(toast.id)}
        aria-label="Tutup notifikasi"
        className="rounded-xs p-1 text-text-tertiary transition-colors hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus"
      >
        <svg viewBox="0 0 16 16" fill="none" className="h-4 w-4" aria-hidden="true">
          <path
            d="M4 4l8 8M12 4l-8 8"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
          />
        </svg>
      </button>
    </div>
  )
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastRecord[]>([])
  const idRef = useRef(0)

  const dismiss = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id))
  }, [])

  const dismissAll = useCallback(() => {
    setToasts([])
  }, [])

  const show = useCallback((opts: ToastOptions) => {
    idRef.current += 1
    const record: ToastRecord = {
      id: idRef.current,
      title: opts.title,
      description: opts.description,
      tone: opts.tone ?? "info",
    }
    // Antrean dibatasi — yang tertua dibuang karena pesan terbaru
    // mencerminkan keadaan sekarang.
    setToasts((prev) => [...prev, record].slice(-MAX_VISIBLE))
  }, [])

  const value = useMemo(() => ({ show, dismiss, dismissAll }), [show, dismiss, dismissAll])

  return (
    <ToastContext.Provider value={value}>
      {children}
      {toasts.length > 0 ? (
        <div
          aria-live="polite"
          className="pointer-events-none fixed bottom-4 right-4 z-banner flex w-[calc(100%-2rem)] max-w-sm flex-col gap-2"
        >
          {toasts.map((t) => (
            <div key={t.id} className="pointer-events-auto">
              <ToastItem toast={t} onDismiss={dismiss} />
            </div>
          ))}
        </div>
      ) : null}
    </ToastContext.Provider>
  )
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error("useToast harus dipakai di dalam <ToastProvider>")
  return ctx
}
