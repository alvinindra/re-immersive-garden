import { useEffect, useState } from "react"
import { useThree } from "@react-three/fiber"
import { GalleryCoordinator } from "./GalleryCoordinator"
import { galleryApi, useGalleryRegistry } from "./registry"
import { onScroll } from "../scroll/scrollStore"
import type { WebGLApp } from "../webgl/WebGLApp"

/** Bridges the React-registered media elements to the GalleryCoordinator and
 *  hooks it into the pipeline's overlay pass (app.setOverlay). */
export function GalleryOverlay({ app }: { app: WebGLApp }) {
  const gl = useThree((s) => s.gl)
  const items = useGalleryRegistry((s) => s.items)
  const [coord] = useState(
    () =>
      new GalleryCoordinator(gl, {
        flow: () => app.flowTexture,
        maskNoise: () => app.maskNoiseTexture,
      }),
  )

  useEffect(() => {
    galleryApi.current = coord
    app.setOverlay(coord)
    ;(window as unknown as { __gallery: unknown }).__gallery = coord

    // settle-time remeasures, like the old main.ts boot
    const t = setTimeout(() => coord.measureLayout(), 350)
    document.fonts?.ready.then(() => coord.measureLayout())

    const offScroll = onScroll((s) => coord.setScroll(s))
    return () => {
      clearTimeout(t)
      offScroll()
      galleryApi.current = null
      coord.dispose()
    }
  }, [coord, app])

  useEffect(() => {
    coord.setItems(items)
  }, [coord, items])

  return null
}
