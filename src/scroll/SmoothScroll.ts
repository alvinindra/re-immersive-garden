import Lenis from "lenis"

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

/**
 * Lenis-backed smooth scroll, configured to match immersive-g.com:
 *   lerp 0.05, smoothWheel, exponential easing, vertical, window scroll.
 * Emits a ScrollState every frame Lenis ticks (the site's `scrollSmooth`).
 */
export class SmoothScroll {
  readonly lenis: Lenis
  readonly state: ScrollState = { scrollY: 0, velocity: 0, speed: 0, scrollPct: 0 }
  private listeners: Array<(s: ScrollState) => void> = []

  constructor() {
    this.lenis = new Lenis({
      lerp: 0.05,
      wheelMultiplier: 1,
      touchMultiplier: 1,
      smoothWheel: true,
      // real site: Oe => Math.min(1, 1.001 - 2^(-10 Oe))
      easing: (t: number) => Math.min(1, 1.001 - Math.pow(2, -10 * t)),
      orientation: "vertical",
    })

    this.lenis.on("scroll", () => this.emit())
  }

  private emit() {
    const limit = this.lenis.limit || 1
    this.state.scrollY = this.lenis.scroll
    this.state.velocity = this.lenis.velocity
    this.state.speed = Math.abs(this.lenis.velocity / 1000) * 0.1
    this.state.scrollPct = limit > 0 ? this.lenis.scroll / limit : 0
    for (const fn of this.listeners) fn(this.state)
  }

  onScroll(fn: (s: ScrollState) => void) {
    this.listeners.push(fn)
  }

  /** Drive from the main RAF loop with the rAF timestamp (ms). */
  raf(timeMs: number) {
    this.lenis.raf(timeMs)
  }
}
