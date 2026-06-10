import { WebGLApp } from "./webgl/WebGLApp"
import { initCursor, setCursorLabel } from "./cursor"
import { SmoothScroll } from "./scroll/SmoothScroll"
import { Gallery } from "./home/Gallery"
import { ScrollCursor } from "./home/ScrollCursor"
import { buildHomeDom, buildFooter } from "./home/dom"

if ("scrollRestoration" in history) history.scrollRestoration = "manual"

initCursor()

const blocksRoot = document.querySelector<HTMLElement>("#blocks")
const content = document.querySelector<HTMLElement>("#scroll-content")
if (!blocksRoot || !content) throw new Error("missing scroll content roots")
buildHomeDom(blocksRoot)
buildFooter(content)

const canvas = document.querySelector<HTMLCanvasElement>("#webgl")
if (!canvas) throw new Error("missing #webgl canvas")

const app = new WebGLApp(canvas)
const scroll = new SmoothScroll()
const gallery = new Gallery(app.renderer, setCursorLabel)
const scrollCursor = new ScrollCursor()

app.setOverlay(gallery)
;(window as unknown as { __lenis: unknown; __gallery: unknown }).__lenis = scroll.lenis
;(window as unknown as { __gallery: unknown }).__gallery = gallery

scroll.onScroll((s) => {
  gallery.setScroll(s)
  app.setScroll(s.scrollPct, s.speed)
  scrollCursor.onScroll(s)
  document.body.classList.toggle("is-dark", s.scrollPct > 0.93)
})

app.load("webgl/home/reliefs_high_compressed.glb").then(() => {
  app.loadFooter("webgl/footer/footer_compressed.glb").catch(() => {})
  gallery.build()

  setTimeout(() => gallery.measureLayout(), 350)
  document.fonts?.ready.then(() => gallery.measureLayout())

  let prev = performance.now()
  const loop = (t: number) => {
    const dt = Math.min(0.05, (t - prev) / 1000)
    prev = t
    scroll.raf(t)
    app.update()
    scrollCursor.update(dt)
    requestAnimationFrame(loop)
  }
  requestAnimationFrame(loop)
}).catch((err) => {
  console.error("relief load failed", err)
})
