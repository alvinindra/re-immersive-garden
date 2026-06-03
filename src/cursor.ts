// Custom cursor: a small black dot (.cursor__follow) that rides just to the
// RIGHT of the native arrow (native cursor stays visible).
// The native arrow hotspot is at clientX/Y; offset the dot beside its body.
// The dot eases toward the pointer (lerp) for a smooth trailing follow.

const OFFSET_X = 16 // px to the right of the pointer
const OFFSET_Y = 0 // px top, to sit beside the arrow body
const EASE = 0.15 // 0..1 — lower = smoother / more lag

export function initCursor() {
  const dot = document.querySelector<HTMLElement>(".cursor__follow")
  if (!dot) return

  // target (pointer) vs current (eased) positions
  let tx = window.innerWidth / 2
  let ty = window.innerHeight / 2
  let cx = tx
  let cy = ty

  window.addEventListener(
    "pointermove",
    (e) => {
      tx = e.clientX + OFFSET_X
      ty = e.clientY + OFFSET_Y
    },
    { passive: true },
  )

  const tick = () => {
    cx += (tx - cx) * EASE
    cy += (ty - cy) * EASE
    dot.style.transform = `translate(${cx}px, ${cy}px) translate(-50%, -50%)`
    requestAnimationFrame(tick)
  }
  tick()
}
