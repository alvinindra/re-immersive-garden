import { Relief } from "./relief/Relief"
import { initCursor, setCursorLabel } from "./cursor"
import { SmoothScroll } from "./scroll/SmoothScroll"
import { Gallery } from "./home/Gallery"
import { ScrollCursor } from "./home/ScrollCursor"
import { buildHomeDom, buildFooter } from "./home/dom"

if ("scrollRestoration" in history) history.scrollRestoration = "manual"

initCursor()

// build the scrollable homepage DOM (hero is in index.html; blocks + footer here)
const blocksRoot = document.querySelector<HTMLElement>("#blocks")
const content = document.querySelector<HTMLElement>("#scroll-content")
if (!blocksRoot || !content) throw new Error("missing scroll content roots")
buildHomeDom(blocksRoot)
buildFooter(content)

const canvas = document.querySelector<HTMLCanvasElement>("#webgl")
if (!canvas) throw new Error("missing #webgl canvas")

const relief = new Relief(canvas)
const scroll = new SmoothScroll()
const gallery = new Gallery(relief.renderer, setCursorLabel)
const scrollCursor = new ScrollCursor()

relief.setOverlay(gallery)
;(window as unknown as { __lenis: unknown; __gallery: unknown }).__lenis = scroll.lenis
;(window as unknown as { __gallery: unknown }).__gallery = gallery

scroll.onScroll((s) => {
  gallery.setScroll(s)
  relief.setScroll(s.scrollPct, s.speed) // pans relief + cross-fades footer
  scrollCursor.onScroll(s)
  document.body.classList.toggle("is-dark", s.scrollPct > 0.93)
})

relief
  .load("webgl/home/reliefs_high_compressed.glb")
  .then(() => {
    // dark footer relief (its own GLB), loaded in the background
    relief.loadFooter("webgl/footer/footer_compressed.glb").catch(() => {})
    gallery.build()
    // re-measure plane layout once fonts/aspect-ratios settle
    setTimeout(() => gallery.measureLayout(), 350)
    document.fonts?.ready.then(() => gallery.measureLayout())

    // single RAF loop drives Lenis → relief (+ gallery overlay) → scroll cursor
    let prev = performance.now()
    const loop = (t: number) => {
      const dt = Math.min(0.05, (t - prev) / 1000)
      prev = t
      scroll.raf(t)
      relief.update()
      scrollCursor.update(dt)
      requestAnimationFrame(loop)
    }
    requestAnimationFrame(loop)
  })
  .catch((err) => {
    console.error("relief load failed", err)
  })
