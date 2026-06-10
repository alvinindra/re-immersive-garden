import type { ScrollState } from "../scroll/SmoothScroll"

const lerp = (a: number, b: number, t: number) => a + (b - a) * t

/**
 * The real site's HomeScrollCursor: a small cluster of 3 dots that rides the pointer
 * (top-left fixed origin, +15px x), plus a 120-dot vertical streak that appears in
 * "fast mode" and flows with scroll speed. Constants are lifted from the bundle:
 *   { number: 120, space: 2, speed: 50, mix: 0 }.
 */
// fast-mode tuning — values verbatim from the original bundle, do not retune
const FAST = {
  floor: 0.02, // scroll speed below this never charges fast mode
  gain: 5, // how quickly above-floor speed charges `fast`
  decay: 1.0, // fast progress lost per second at rest
  threshold: 0.6, // fast progress required to enter fast mode
  spreadFactor: 41, // dot spacing / flow multiplier
  mixInEase: 4,
  mixOutEase: 1.6,
  followEase: 0.1, // pointer-follow lerp (per 60fps frame)
}

export class ScrollCursor {
  private cfg = { number: 120, space: 2, speed: 50 }
  private root: HTMLElement
  private defaultDots: HTMLElement[] = []
  private fastDots: HTMLElement[] = []

  private mouse = { x: window.innerWidth / 2, y: window.innerHeight / 2 }
  private pos = { x: this.mouse.x, y: this.mouse.y }
  private scrollY = 0 // = m.y, the scroll-driven offset
  private fast = 0 // fast-scroll progress 0..1
  private mix = 0 // default-dots ↔ fast-dots blend 0..1

  constructor() {
    this.root = document.createElement("div")
    this.root.className = "scrollCursor"

    const def = document.createElement("div")
    def.className = "dots"
    for (let i = 0; i < 3; i++) {
      const d = document.createElement("div")
      d.className = "dot dot__default"
      def.appendChild(d)
      this.defaultDots.push(d)
    }

    const fastWrap = document.createElement("div")
    fastWrap.className = "dots dots__fast"
    for (let i = 0; i < this.cfg.number; i++) {
      const d = document.createElement("div")
      d.className = "dot"
      fastWrap.appendChild(d)
      this.fastDots.push(d)
    }

    this.root.appendChild(def)
    this.root.appendChild(fastWrap)
    document.body.appendChild(this.root)

    document.addEventListener(
      "mousemove",
      (e) => {
        this.mouse.x = e.clientX + 15
        this.mouse.y = e.clientY
      },
      { passive: true },
    )
  }

  onScroll(s: ScrollState) {
    this.scrollY = -s.scrollPct * this.cfg.speed
    // accumulate fast progress only above a brisk-scroll floor; decays in update()
    if (s.speed > FAST.floor) {
      this.fast = Math.min(1, this.fast + (s.speed - FAST.floor) * FAST.gain)
    }
  }

  update(dt: number) {
    const k = 1 - Math.exp(-FAST.followEase * dt * 60)
    this.pos.x = lerp(this.pos.x, this.mouse.x, k)
    this.pos.y = lerp(this.pos.y, this.mouse.y, k)
    this.root.style.transform = `translate3d(${this.pos.x}px, ${this.pos.y}px, 0)`

    // fast progress decays toward 0 at rest; mix eases to match the fast state
    this.fast = Math.max(0, this.fast - dt * FAST.decay)
    const isFast = this.fast > FAST.threshold
    this.mix = lerp(this.mix, isFast ? 1 : 0, isFast ? dt * FAST.mixInEase : dt * FAST.mixOutEase)
    document.body.classList.toggle("is-fast", this.mix > 0.5)

    const spread = (this.fast * FAST.spreadFactor) * this.cfg.space
    const flow = this.scrollY * this.fast * FAST.spreadFactor

    for (let i = 0; i < this.cfg.number; i++) {
      const alt = i % 2
      const M = alt ? spread * (i + 1) : -spread * i
      const G = M + flow
      this.fastDots[i].style.opacity = this.mix > 0.5 ? "1" : "0"
      this.fastDots[i].style.transform = `translate3d(0, ${G}px, 0)`
      if (i < 3) {
        const H = 1 - this.mix
        this.defaultDots[i].style.transform = `scale(${H}) translateY(${M}px)`
      }
    }
  }
}
