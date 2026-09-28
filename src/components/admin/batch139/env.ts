/**
 * H15 — Banner environment selalu terlihat (Batch 139), util murni.
 *
 * Production dan non-production mudah tertukar bila hanya mengandalkan judul
 * tab. Deteksi environment: flag build `NEXT_PUBLIC_KAHADE_ENV` dulu, fallback
 * ke hostname saat runtime.
 */
export type KahadeEnv = "production" | "staging" | "development" | "unknown"

export function detectEnv(
  envFlag?: string | null,
  hostname?: string | null,
): KahadeEnv {
  const flag = (envFlag ?? "").trim().toLowerCase()
  if (flag === "production" || flag === "prod") return "production"
  if (flag === "staging" || flag === "stage") return "staging"
  if (flag === "development" || flag === "dev" || flag === "local") return "development"

  const host = (hostname ?? "").toLowerCase()
  if (!host) return "unknown"
  if (host === "admin.kahade.id") return "production"
  if (host.includes("staging") || host.includes("preview")) return "staging"
  if (host === "localhost" || host === "127.0.0.1" || host.endsWith(".local")) return "development"
  return "unknown"
}

/** Label + warna banner per environment. */
export const ENV_META: Record<KahadeEnv, { label: string; className: string }> = {
  production: {
    label: "PRODUCTION",
    className: "bg-danger text-white",
  },
  staging: {
    label: "STAGING",
    className: "bg-warning text-black",
  },
  development: {
    label: "DEVELOPMENT",
    className: "bg-info-text text-white",
  },
  unknown: {
    label: "ENV TAK DIKENAL",
    className: "bg-surface-elevated text-text-primary border-b border-border",
  },
}
