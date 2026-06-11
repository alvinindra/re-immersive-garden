import { useEffect } from "react"
import { ReactLenis, useLenis } from "lenis/react"
import { WebGLCanvas } from "./webgl/WebGLCanvas"
import { Topbar } from "./components/Topbar"
import { Hero } from "./components/Hero"
import { Blocks } from "./components/Blocks"
import { HomeFooter } from "./components/HomeFooter"
import { AllProjects } from "./components/AllProjects"
import { CursorLabel } from "./components/CursorLabel"
import { ScrollCursorDots } from "./components/ScrollCursorDots"
import { LENIS_OPTIONS, useScrollStore } from "./scroll/scrollStore"

/** Computes the real site's `scrollSmooth` payload on every lenis tick and fans
 *  it out to the (non-React) scroll listeners — pipeline, gallery, dot cursor. */
function ScrollBridge() {
  const lenis = useLenis((l) => {
    const store = useScrollStore.getState()
    const s = store.state
    const limit = l.limit || 1
    s.scrollY = l.scroll
    s.velocity = l.velocity
    s.speed = Math.abs(l.velocity / 1000) * 0.1
    s.scrollPct = limit > 0 ? l.scroll / limit : 0
    // footer is the last 100dvh of the page: 0 when it starts entering the
    // viewport, 1 when fully in view — independent of total page height
    const footerT = (s.scrollPct * limit - (limit - window.innerHeight)) / window.innerHeight
    useScrollStore.setState({ footerT })
    document.body.classList.toggle("is-dark", footerT > 0.3)
    for (const fn of store.listeners) fn(s)
  })

  useEffect(() => {
    useScrollStore.getState().setLenis(lenis ?? null)
    ;(window as unknown as { __lenis: unknown }).__lenis = lenis ?? null
  }, [lenis])

  return null
}

export default function App() {
  return (
    <ReactLenis root options={LENIS_OPTIONS}>
      <ScrollBridge />
      <WebGLCanvas />
      <Topbar />
      {/* everything inside scrolls under Lenis */}
      <div id="scroll-content">
        <Hero />
        {/* project + media blocks */}
        <main id="blocks">
          <Blocks />
        </main>
        <HomeFooter />
      </div>
      <AllProjects />
      <CursorLabel />
      <ScrollCursorDots />
    </ReactLenis>
  )
}
