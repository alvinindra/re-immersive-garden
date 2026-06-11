import { useEffect, useState } from "react"
import { useFrame, useThree } from "@react-three/fiber"
import { WebGLApp } from "./WebGLApp"
import { GalleryOverlay } from "../gallery/GalleryOverlay"
import { onScroll, useScrollStore } from "../scroll/scrollStore"

/** Owns the imperative WebGL pipeline (relief + fluid + footer) inside the R3F
 *  canvas and takes over the frameloop, replicating the old main.ts RAF order:
 *  lenis tick → scroll listeners → pipeline update (incl. gallery overlay pass). */
export function Experience() {
  const gl = useThree((s) => s.gl)
  const [app] = useState(() => new WebGLApp(gl))

  useEffect(() => {
    // both GLBs stream in parallel; nothing below waits on them
    app.load("webgl/home/reliefs_high_compressed.glb").catch((err) => {
      console.error("relief load failed", err)
    })
    app.loadFooter("webgl/footer/footer_compressed.glb").catch((err) => {
      console.error("footer load failed", err)
    })

    const offScroll = onScroll((s) => {
      app.setScroll(s.scrollPct, s.speed, useScrollStore.getState().footerT)
    })
    return () => {
      offScroll()
      app.dispose()
    }
  }, [app])

  // priority 1 = manual render mode: R3F stops auto-rendering and this callback
  // owns the frame. Lenis ticks first so scroll state (and every onScroll
  // listener) lands before the pipeline reads it — same order as the old loop.
  useFrame(() => {
    const lenis = useScrollStore.getState().lenis
    if (lenis) lenis.raf(performance.now())
    app.update()
  }, 1)

  return <GalleryOverlay app={app} />
}
