import { create } from "zustand"
import type Lenis from "lenis"

/** Mirrors the real site's `scrollSmooth` event payload. */
export interface ScrollState {
  /** smoothed scroll position in px */
  scrollY: number
  /** raw lenis velocity (px/s, signed) */
  velocity: number
  /** the real site's `speed`: abs(velocity/1000) * 0.1 */
  speed: number
  /** 0..1 progress through the scrollable height */
  scrollPct: number
}

/** Lenis options verbatim from immersive-g.com (lerp 0.05, exponential easing). */
export const LENIS_OPTIONS = {
  lerp: 0.05,
  wheelMultiplier: 1,
  touchMultiplier: 1,
  smoothWheel: true,
  // real site: Oe => Math.min(1, 1.001 - 2^(-10 Oe))
  easing: (t: number) => Math.min(1, 1.001 - Math.pow(2, -10 * t)),
  orientation: "vertical" as const,
  // driven from the WebGL frame loop so scroll state lands before the render reads it
  autoRaf: false,
}

interface ScrollStore {
  lenis: Lenis | null
  /** mutated in place every lenis tick — transient, never triggers React renders */
  state: ScrollState
  /** 0..1 progress of the footer (last 100dvh) entering the viewport */
  footerT: number
  listeners: Set<(s: ScrollState) => void>
  setLenis(lenis: Lenis | null): void
}

export const useScrollStore = create<ScrollStore>((set) => ({
  lenis: null,
  state: { scrollY: 0, velocity: 0, speed: 0, scrollPct: 0 },
  footerT: 0,
  listeners: new Set(),
  setLenis: (lenis) => set({ lenis }),
}))

export function onScroll(fn: (s: ScrollState) => void): () => void {
  const { listeners } = useScrollStore.getState()
  listeners.add(fn)
  return () => listeners.delete(fn)
}
