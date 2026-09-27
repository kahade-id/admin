/**
 * Kahade Admin Web — setup global Vitest (G501).
 *
 * - `@testing-library/jest-dom` matchers (toBeInTheDocument, dll.)
 * - matcher a11y `toHaveNoViolations` dari vitest-axe
 * - cleanup otomatis antar test
 * - polyfill `matchMedia` (dipakai beberapa komponen) & `ResizeObserver`
 */
import "@testing-library/jest-dom/vitest"
import * as axeMatchers from "vitest-axe/matchers"
import { cleanup, configure } from "@testing-library/react"
import { afterEach, expect, vi } from "vitest"

expect.extend(axeMatchers)

// Testing Library: anggap semua di bawah `data-testid="root"` ter-render.
configure({ asyncUtilTimeout: 4000 })

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

if (typeof window !== "undefined" && !window.matchMedia) {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }),
  })
}

if (typeof window !== "undefined" && !window.ResizeObserver) {
  class ResizeObserverStub {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  Object.defineProperty(window, "ResizeObserver", {
    writable: true,
    value: ResizeObserverStub,
  })
}
