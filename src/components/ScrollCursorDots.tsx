import { useEffect, useRef } from "react"
import { onScroll } from "../scroll/scrollStore"

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

const CFG = { number: 120, space: 2, speed: 50 }

export function ScrollCursorDots() {
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const root = rootRef.current
    if (!root) return
    const defaultDots = Array.from(
      root.querySelectorAll<HTMLElement>(".dot__default"),
    )
    const fastDots = Array.from(
      root.querySelectorAll<HTMLElement>(".dots__fast .dot"),
    )

    const mouse = { x: window.innerWidth / 2, y: window.innerHeight / 2 }
    const pos = { x: mouse.x, y: mouse.y }
    let scrollY = 0 // the scroll-driven offset
    let fast = 0 // fast-scroll progress 0..1
    let mix = 0 // default-dots ↔ fast-dots blend 0..1

    const onMove = (e: MouseEvent) => {
      mouse.x = e.clientX + 15
      mouse.y = e.clientY
    }
    document.addEventListener("mousemove", onMove, { passive: true })

    const offScroll = onScroll((s) => {
      scrollY = -s.scrollPct * CFG.speed
      // accumulate fast progress only above a brisk-scroll floor; decays in the loop
      if (s.speed > FAST.floor) {
        fast = Math.min(1, fast + (s.speed - FAST.floor) * FAST.gain)
      }
    })

    let raf = 0
    let prev = performance.now()
    const tick = (t: number) => {
      const dt = Math.min(0.05, (t - prev) / 1000)
      prev = t

      const k = 1 - Math.exp(-FAST.followEase * dt * 60)
      pos.x = lerp(pos.x, mouse.x, k)
      pos.y = lerp(pos.y, mouse.y, k)
      root.style.transform = `translate3d(${pos.x}px, ${pos.y}px, 0)`

      // fast progress decays toward 0 at rest; mix eases to match the fast state
      fast = Math.max(0, fast - dt * FAST.decay)
      const isFast = fast > FAST.threshold
      mix = lerp(mix, isFast ? 1 : 0, isFast ? dt * FAST.mixInEase : dt * FAST.mixOutEase)
      document.body.classList.toggle("is-fast", mix > 0.5)

      const spread = fast * FAST.spreadFactor * CFG.space
      const flow = scrollY * fast * FAST.spreadFactor

      for (let i = 0; i < CFG.number; i++) {
        const alt = i % 2
        const M = alt ? spread * (i + 1) : -spread * i
        const G = M + flow
        fastDots[i].style.opacity = mix > 0.5 ? "1" : "0"
        fastDots[i].style.transform = `translate3d(0, ${G}px, 0)`
        if (i < 3) {
          const H = 1 - mix
          defaultDots[i].style.transform = `scale(${H}) translateY(${M}px)`
        }
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)

    return () => {
      document.removeEventListener("mousemove", onMove)
      offScroll()
      cancelAnimationFrame(raf)
      document.body.classList.remove("is-fast")
    }
  }, [])

  return (
    <div ref={rootRef} className="scrollCursor">
      <div className="dots">
        {Array.from({ length: 3 }, (_, i) => (
          <div key={i} className="dot dot__default" />
        ))}
      </div>
      <div className="dots dots__fast">
        {Array.from({ length: CFG.number }, (_, i) => (
          <div key={i} className="dot" />
        ))}
      </div>
    </div>
  )
}
