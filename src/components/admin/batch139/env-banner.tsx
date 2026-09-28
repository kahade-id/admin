/**
 * H15 — Banner environment selalu terlihat (Batch 139).
 *
 * Strip tipis di paling atas panel: selalu tampil, warna berbeda per
 * environment (production = merah tegas). Jangan tertukar production /
 * non-production hanya karena judul tab.
 */
"use client"

import { useEffect, useState } from "react"

import { ENV_META, detectEnv, type KahadeEnv } from "./env"
import { cn } from "@/lib/cn"

export function EnvBanner() {
  const [env, setEnv] = useState<KahadeEnv>("unknown")

  useEffect(() => {
    setEnv(
      detectEnv(
        process.env.NEXT_PUBLIC_KAHADE_ENV,
        typeof window !== "undefined" ? window.location.hostname : null,
      ),
    )
  }, [])

  const meta = ENV_META[env]
  return (
    <div
      role="status"
      aria-label={`Environment: ${meta.label}`}
      className={cn(
        "flex h-7 shrink-0 items-center justify-center gap-2 px-4 text-caption font-bold tracking-widest",
        meta.className,
      )}
    >
      <span aria-hidden="true">●</span>
      <span>{meta.label}</span>
      {env === "production" ? (
        <span className="font-normal tracking-normal">— data asli, bertindak hati-hati</span>
      ) : null}
    </div>
  )
}
