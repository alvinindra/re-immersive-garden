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

function showWebglFallback() {
  if (document.querySelector(".webgl-fallback")) return
  const el = document.createElement("div")
  el.className = "webgl-fallback"
  el.textContent = "This site requires WebGL — please enable it or use a modern browser."
  el.style.cssText =
    "position:fixed;inset:0;display:flex;align-items:center;justify-content:center;" +
    "padding:2rem;text-align:center;background:#bebebe;color:#111;z-index:100;" +
    "font:500 1rem/1.5 sans-serif"
  document.body.appendChild(el)
}

let app: WebGLApp
try {
  app = new WebGLApp(canvas)
} catch (err) {
  showWebglFallback()
  throw err
}
canvas.addEventListener("webglcontextlost", (e) => {
  e.preventDefault()
  showWebglFallback()
})

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

// both GLBs stream in parallel; nothing below waits on them
app.load("webgl/home/reliefs_high_compressed.glb").catch((err) => {
  console.error("relief load failed", err)
})
app.loadFooter("webgl/footer/footer_compressed.glb").catch((err) => {
  console.error("footer load failed", err)
})

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
