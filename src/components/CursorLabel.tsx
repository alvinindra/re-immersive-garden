import { useEffect, useRef } from "react"
import { useCursorStore } from "../cursor/cursorStore"

/** The pointer-following text label ("Discover"); the dot cluster is <ScrollCursorDots>. */
export function CursorLabel() {
  const text = useCursorStore((s) => s.text)
  const light = useCursorStore((s) => s.light)
  const ref = useRef<HTMLSpanElement>(null)
  // keep the last label while fading out, like the original (textContent persisted)
  const lastText = useRef<string>("")
  if (text) lastText.current = text

  useEffect(() => {
    const el = ref.current
    if (!el) return
    let tx = window.innerWidth / 2
    let ty = window.innerHeight / 2
    let cx = tx
    let cy = ty
    const onMove = (e: PointerEvent) => {
      tx = e.clientX
      ty = e.clientY
    }
    window.addEventListener("pointermove", onMove, { passive: true })
    let raf = 0
    const tick = () => {
      cx += (tx - cx) * 0.15
      cy += (ty - cy) * 0.15
      el.style.transform = `translate(${cx}px, ${cy}px)`
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => {
      window.removeEventListener("pointermove", onMove)
      cancelAnimationFrame(raf)
    }
  }, [])

  return (
    <span
      ref={ref}
      className={
        "cursor__label" + (text ? " is-visible" : "") + (light ? " is-light" : "")
      }
      aria-hidden="true"
    >
      {text ?? lastText.current}
    </span>
  )
}
