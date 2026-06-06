// Custom cursor: the real site shows the HomeScrollCursor dots as the pointer, plus a
// text label ("View project") when hovering a project. We render only the label here
// (the dots live in ScrollCursor.ts) so there is a single dot cluster, like the real site.

let labelEl: HTMLElement | null = null

export function initCursor() {
  labelEl = document.querySelector<HTMLElement>(".cursor__label")
  if (!labelEl) return

  let tx = window.innerWidth / 2
  let ty = window.innerHeight / 2
  let cx = tx
  let cy = ty

  window.addEventListener(
    "pointermove",
    (e) => {
      tx = e.clientX
      ty = e.clientY
    },
    { passive: true },
  )

  const tick = () => {
    cx += (tx - cx) * 0.15
    cy += (ty - cy) * 0.15
    labelEl!.style.transform = `translate(${cx}px, ${cy}px)`
    requestAnimationFrame(tick)
  }
  tick()
}

/** Show/hide the cursor label text (null hides it). */
export function setCursorLabel(text: string | null) {
  if (!labelEl) return
  if (text) {
    labelEl.textContent = text
    labelEl.classList.add("is-visible")
  } else {
    labelEl.classList.remove("is-visible")
  }
}
