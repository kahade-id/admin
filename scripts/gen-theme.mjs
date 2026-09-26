/**
 * Generate `src/app/theme.css` dari design tokens Kahade.
 *
 * Menjalankan: node scripts/gen-theme.mjs
 * Membaca src/lib/tokens.ts (framework-agnostic, tanpa dependensi RN)
 * dan memancarkan CSS variables untuk :root (light) dan .dark.
 */
import { writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const root = join(dirname(fileURLToPath(import.meta.url)), "..")
const tokensUrl = join(root, "src", "lib", "tokens.ts")

const { toCssVariables } = await import(tokensUrl)

function block(selector, vars) {
  const lines = Object.entries(vars)
    .map(([k, v]) => `  ${k}: ${v};`)
    .join("\n")
  return `${selector} {\n${lines}\n}`
}

const css = `/**
 * Kahade Design Tokens — CSS variables (GENERATED).
 * Jangan edit manual; jalankan \`node scripts/gen-theme.mjs\`.
 * Sumber: src/lib/tokens.ts → toCssVariables("light" | "dark").
 */
${block(":root", toCssVariables("light"))}

${block(".dark", toCssVariables("dark"))}
`

writeFileSync(join(root, "src", "app", "theme.css"), css)
console.log("src/app/theme.css ditulis.")
