// Custom cursor: the real site shows the HomeScrollCursor dots as the pointer, plus a
// text label ("View project") when hovering a project. We render only the label here
// (the dots live in ScrollCursor.ts) so there is a single dot cluster, like the real site.

let labelEl: HTMLElement | null = null

const noop = () => {}

/** Returns an update function to call from the main RAF loop (no own loop). */
export function initCursor(): () => void {
  labelEl = document.querySelector<HTMLElement>(".cursor__label")
  if (!labelEl) return noop
  const el = labelEl

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

  return () => {
    cx += (tx - cx) * 0.15
    cy += (ty - cy) * 0.15
    el.style.transform = `translate(${cx}px, ${cy}px)`
  }
}

/** Show/hide the cursor label text (null hides it). `light` renders it #e8e8e8 —
 *  the real site's `.cursor.isDark` (cursor over dark content). */
export function setCursorLabel(text: string | null, light = false) {
  if (!labelEl) return
  if (text) {
    labelEl.textContent = text
    labelEl.classList.add("is-visible")
    labelEl.classList.toggle("is-light", light)
  } else {
    labelEl.classList.remove("is-visible")
  }
}
