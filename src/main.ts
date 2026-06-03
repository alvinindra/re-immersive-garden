import { Relief } from "./relief/Relief"
import { initCursor } from "./cursor"

initCursor()

const canvas = document.querySelector<HTMLCanvasElement>("#webgl")
if (!canvas) throw new Error("missing #webgl canvas")

const relief = new Relief(canvas)
relief
  .load("webgl/home/reliefs_high_compressed.glb")
  .then(() => {
    relief.start()
  })
  .catch((err) => {
    console.error("relief load failed", err)
  })
