import { Component, useState, type CSSProperties, type ReactNode } from "react"
import { Canvas } from "@react-three/fiber"
import { Experience } from "./Experience"

const FALLBACK_STYLE: CSSProperties = {
  position: "fixed",
  inset: 0,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: "2rem",
  textAlign: "center",
  background: "#bebebe",
  color: "#111",
  zIndex: 100,
  font: "500 1rem/1.5 sans-serif",
}

function WebglFallback() {
  return (
    <div className="webgl-fallback" style={FALLBACK_STYLE}>
      This site requires WebGL — please enable it or use a modern browser.
    </div>
  )
}

class CanvasErrorBoundary extends Component<
  { onError: () => void; children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  componentDidCatch(err: unknown) {
    console.error("webgl init failed", err)
    this.props.onError()
  }
  render() {
    return this.state.failed ? null : this.props.children
  }
}

/** Fixed full-screen WebGL: relief background + scrolling media gallery (2nd pass).
 *  The #webgl id moves to this wrapper (R3F's container forces inline
 *  position:relative, so the fixed positioning has to live one level up). */
export function WebGLCanvas() {
  const [failed, setFailed] = useState(false)

  return (
    <>
      {failed && <WebglFallback />}
      <div id="webgl">
        <CanvasErrorBoundary onError={() => setFailed(true)}>
          <Canvas
            // `flat` keeps tone mapping off (three's default; R3F would set ACES).
            // No `legacy`: three's ColorManagement default was active before too.
            flat
            gl={{ antialias: true, alpha: false }}
            dpr={[1, 2]}
            onCreated={({ gl }) => {
              gl.domElement.addEventListener("webglcontextlost", (e) => {
                e.preventDefault()
                setFailed(true)
              })
            }}
          >
            <Experience />
          </Canvas>
        </CanvasErrorBoundary>
      </div>
    </>
  )
}
