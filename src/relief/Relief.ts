import {
  Box3,
  Color,
  DoubleSide,
  GLSL3,
  Group,
  LinearSRGBColorSpace,
  Mesh,
  MeshStandardMaterial,
  PerspectiveCamera,
  RepeatWrapping,
  SRGBColorSpace,
  Scene,
  ShaderMaterial,
  Texture,
  TextureLoader,
  Vector2,
  Vector3,
  WebGLRenderer,
  type IUniform,
} from "three"
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js"
import { DRACOLoader } from "three/examples/jsm/loaders/DRACOLoader.js"
import { Flowmap } from "./Flowmap"
import { FluidSimulation } from "./FluidSimulation"
import reliefVert from "./shaders/relief.vert.glsl"
import reliefFrag from "./shaders/relief.frag.glsl"

// Real-site home-relief config (default bundle: relief.*)
const CONFIG = {
  flowmap: { mouseEase: 0.4, dissipation: 0.953, falloff: 0.38, alpha: 1 },
  extrude: { textureStrength: 1, gradientStrength: 0.17 },
  camera: { fov: 30, distance: 15, near: 5, far: 20, zoom: 1 },
  brightness: { factor: 0.6, offset: 0.4 }, // desktop
  // Real-site fov constants ($o / Ei). fov stays decoupled from model size so the
  // relief shows a fixed-scale slice (~one section) instead of fitting all 6 tiles.
  fovWidthRatio: 1.33, // $o
  fovHeight: 9.995, // Ei
  // The GLB is a 6-section tiled relief; we frame the bird section. This offset is
  // a fraction of visible height: 0 = bird centered (fills view), >0 nudges it up.
  scrollOffset: 0,
}

/** A pointer that tracks its eased normalized position and per-frame velocity,
 *  matching the real site's `Yt` (normalFlip + velocity). UV space, Y up. */
class Pointer {
  normalFlip = new Vector2(-1, -1)
  velocity = new Vector2()
  private last = new Vector2(-1, -1)
  private has = false

  set(x: number, y: number) {
    this.normalFlip.set(x, y)
    if (!this.has) {
      this.last.copy(this.normalFlip)
      this.has = true
    }
  }
  update() {
    this.velocity.subVectors(this.normalFlip, this.last)
    this.last.copy(this.normalFlip)
  }
}

export class Relief {
  readonly renderer: WebGLRenderer
  readonly scene = new Scene()
  readonly camera: PerspectiveCamera

  private flowmap: Flowmap
  private fluid!: FluidSimulation
  private pointer = new Pointer()
  private model = new Group()
  // x = model center, y = chosen bird-tile center (model-local, before offset)
  private framePivot = new Vector3()

  private shared: Record<string, IUniform>
  private clock = { start: performance.now() }
  private dpr: number

  // automated idle sweep (mouse2)
  private sweep: {
    active: boolean
    t: number
    dur: number
    from: Vector2
    to: Vector2
    next: number
  } = {
    active: false,
    t: 0,
    dur: 1,
    from: new Vector2(),
    to: new Vector2(),
    next: 1.5,
  }

  constructor(canvas: HTMLCanvasElement) {
    this.dpr = Math.min(window.devicePixelRatio, 2)

    this.renderer = new WebGLRenderer({ canvas, antialias: true, alpha: false })
    this.renderer.setPixelRatio(this.dpr)
    this.renderer.setSize(window.innerWidth, window.innerHeight)
    this.renderer.outputColorSpace = LinearSRGBColorSpace // shader does its own OETF
    // matches the relief's flat at-rest tone so any uncovered sliver blends in
    this.renderer.setClearColor(new Color(0.745, 0.745, 0.745), 1)

    this.camera = new PerspectiveCamera(
      CONFIG.camera.fov,
      window.innerWidth / window.innerHeight,
      CONFIG.camera.near,
      CONFIG.camera.far,
    )
    this.camera.position.set(0, 0, CONFIG.camera.distance)
    // applyFraming() parks the hero tile near world Y 0, so the camera must look
    // straight at 0 — looking up (0,10,0) re-centered the view onto the deer row.
    this.camera.lookAt(0, 0, 0)

    this.flowmap = new Flowmap(this.renderer, {
      size: 512,
      falloff: CONFIG.flowmap.falloff,
      alpha: CONFIG.flowmap.alpha,
      dissipation: CONFIG.flowmap.dissipation,
    })

    // Real-site `Dl` fluid sim — its dye field is the relief's tFluidFlowmap and
    // is what produces the chromatic RGB trail under the cursor.
    this.fluid = new FluidSimulation(this.renderer)

    const drawing = this.renderer.getDrawingBufferSize(new Vector2())
    this.shared = {
      tFlow: { value: null },
      tFluidFlowmap: { value: null },
      tMaskNoise: { value: null },
      tPlaster: { value: null },
      uResolution: { value: new Vector2(drawing.x, drawing.y) },
      uTime: { value: 0 },
      uAspect: { value: window.innerWidth / window.innerHeight },
      uScreenScroll: { value: 0 },
      uScrollSpeed: { value: 0 },
      uFastScroll: { value: 0 },
      uOpacity: { value: 1 },
      uTextureStrength: { value: CONFIG.extrude.textureStrength },
      uGradientStrength: { value: CONFIG.extrude.gradientStrength },
      uSwitchColorTransition: { value: 0 },
      uSwitchColorFastScroll: { value: 0 },
      uBrightnessFactor: { value: CONFIG.brightness.factor },
      uBrightnessOffset: { value: CONFIG.brightness.offset },
    }

    this.loadTextures()
    this.scene.add(this.model)
    ;(window as unknown as { __relief: Relief }).__relief = this

    window.addEventListener("resize", this.onResize)
    window.addEventListener("pointermove", this.onPointerMove)
  }

  private loadTextures() {
    const loader = new TextureLoader()
    const raw = (t: Texture, repeat = false) => {
      t.colorSpace = LinearSRGBColorSpace
      if (repeat) {
        t.wrapS = t.wrapT = RepeatWrapping
      }
      return t
    }
    const plaster = raw(loader.load("/plaster.jpg"), true)
    // noise-rgb/attenuation-0.9 — drives getFastScrollNoise() in both vert+frag
    const maskNoise = raw(
      loader.load("/webgl/global/noises/rgb-attenuation-0,9.png"),
      true,
    )
    // txt/mask-noise — flowmap's internal stamp modulator
    const flowNoise = raw(
      loader.load("/webgl/global/noises/mask-noise.png"),
      true,
    )

    this.shared.tPlaster.value = plaster
    this.shared.tMaskNoise.value = maskNoise
    // tFluidFlowmap is the live fluid-sim dye, fed each frame in update()
    this.flowmap.setNoise(flowNoise)
  }

  load(url: string): Promise<void> {
    const draco = new DRACOLoader()
    draco.setDecoderPath("/draco/")
    const gltf = new GLTFLoader()
    gltf.setDRACOLoader(draco)

    return new Promise((resolve, reject) => {
      gltf.load(
        url,
        (data) => {
          data.scene.traverse((child) => {
            if (!(child instanceof Mesh)) return
            const src = child.material as MeshStandardMaterial
            const tBake1 = src.map ?? null // baseColor
            const tBake2 = src.emissiveMap ?? null // emissive
            // sRGB so three decodes them to linear on sample; the shader's
            // srgbEncodeLocal() re-encodes for display. Forcing Linear here
            // (no decode) double-lifts the bake levels → blown-out white on
            // hover instead of plaster tone.
            if (tBake1) tBake1.colorSpace = SRGBColorSpace
            if (tBake2) tBake2.colorSpace = SRGBColorSpace

            const material = new ShaderMaterial({
              glslVersion: GLSL3,
              vertexShader: reliefVert,
              fragmentShader: reliefFrag,
              side: DoubleSide,
              uniforms: {
                ...this.shared,
                tBake1: { value: tBake1 },
                tBake2: { value: tBake2 },
              },
            })
            child.material = material
          })

          this.model.add(data.scene)
          this.frameModel()
          resolve()
        },
        undefined,
        reject,
      )
    })
  }

  /** Find the model's horizontal center + the bird tile nearest the model center,
   *  then set fov + framing so that bird section is what the camera sees. */
  private frameModel() {
    this.model.position.set(0, 0, 0)
    this.model.updateWorldMatrix(true, true)
    const box = new Box3().setFromObject(this.model)
    const center = box.getCenter(new Vector3())

    // The relief is an 18-tile grid (3 cols × 6 rows). Three tiles use the bird
    // material; only the center-column one (bird_01 at x≈0) is framable head-on,
    // so pick the bird nearest the center column and keep its FULL position.
    // (The old code kept the bird's Y but reused center.x, which centered the
    //  center-column tile at that Y — dragonflies — instead of an actual bird.)
    const birdPos = new Vector3(center.x, center.y, 0)
    let best = Infinity
    const tmp = new Box3()
    const c = new Vector3()
    this.model.traverse((o) => {
      if (!(o instanceof Mesh) || !/bird/i.test(o.name)) return
      tmp.setFromObject(o).getCenter(c)
      const dx = Math.abs(c.x - center.x)
      if (dx < best) {
        best = dx
        birdPos.copy(c)
      }
    })

    this.framePivot.set(birdPos.x, birdPos.y, 0)
    this.updateCameraFov()
    this.applyFraming()
  }

  /** Real-site fov: a = $o * (Ei - 0.1) / aspect; fov = min(30, 2·atan(a / 2d)).
   *  Fixed constants, independent of model size → one section ~fills the view. */
  private updateCameraFov() {
    const dist = CONFIG.camera.distance
    const aspect = window.innerWidth / window.innerHeight
    const a = (CONFIG.fovWidthRatio * (CONFIG.fovHeight - 0.1)) / aspect
    const fov = 2 * Math.atan(a / (2 * dist)) * (180 / Math.PI)
    this.camera.fov = Math.min(CONFIG.camera.fov, fov)
    this.camera.zoom = CONFIG.camera.zoom
    this.camera.updateProjectionMatrix()
  }

  /** Place the chosen bird tile at the camera center (world Y 0), nudged up by
   *  scrollOffset × visible height. Recomputed on resize since fov drives it. */
  private applyFraming() {
    const fovRad = (this.camera.fov * Math.PI) / 180
    const visibleHeight =
      (2 * Math.tan(fovRad / 2) * CONFIG.camera.distance) / this.camera.zoom
    this.model.position.x = -this.framePivot.x
    this.model.position.y =
      visibleHeight * CONFIG.scrollOffset - this.framePivot.y
  }

  private onResize = () => {
    const w = window.innerWidth
    const h = window.innerHeight
    this.renderer.setSize(w, h)
    this.camera.aspect = w / h
    this.updateCameraFov() // aspect-aware fov recalc
    this.applyFraming() // keep bird framed after resize
    const drawing = this.renderer.getDrawingBufferSize(new Vector2())
    ;(this.shared.uResolution.value as Vector2).set(drawing.x, drawing.y)
    this.shared.uAspect.value = w / h
    this.flowmap.setAspect(w / h)
  }

  private onPointerMove = (e: PointerEvent) => {
    this.pointer.set(
      e.clientX / window.innerWidth,
      1 - e.clientY / window.innerHeight,
    )
  }

  // ---- idle automated sweep (mouse2 / velocity2) -------------------------
  private randDir(from?: Vector2): Vector2 {
    const base =
      from ?? new Vector2((Math.random() - 0.5) * 2, (Math.random() - 0.5) * 2)
    const angle =
      Math.atan2(base.y, base.x) + (Math.random() - 0.5) * 2 * Math.PI * 0.8
    const r = 0.7 + Math.random() * 0.2
    return new Vector2(Math.cos(angle) * r, Math.sin(angle) * r)
  }
  private updateSweep(dt: number) {
    const s = this.sweep
    if (!s.active) {
      s.next -= dt
      if (s.next <= 0) {
        const start = this.randDir()
        const end = this.randDir(start)
        s.from.set(start.x / 2 + 0.5, start.y / 2 + 0.5)
        s.to.set(end.x / 2 + 0.5, end.y / 2 + 0.5)
        s.dur = 0.7 + Math.random() * 0.3
        s.t = 0
        s.active = true
        this.flowmap.velocity2.set(1, 1)
      } else {
        this.flowmap.mouse2.set(-1, -1)
        return
      }
    }
    s.t += dt
    const k = Math.min(1, s.t / s.dur)
    const e = 1 - Math.pow(1 - k, 2) // power2.out
    this.flowmap.mouse2.set(
      s.from.x + (s.to.x - s.from.x) * e,
      s.from.y + (s.to.y - s.from.y) * e,
    )
    if (k >= 1) {
      s.active = false
      s.next = 1 + Math.random() * 2
      this.flowmap.mouse2.set(-1, -1)
    }
  }

  private prev = performance.now()
  update = () => {
    const now = performance.now()
    const dt = Math.min(0.05, (now - this.prev) / 1000)
    this.prev = now
    const time = (now - this.clock.start) / 1000

    this.pointer.update()
    this.flowmap.mouse.lerp(this.pointer.normalFlip, CONFIG.flowmap.mouseEase)
    const vmag = this.pointer.velocity.length()
    this.flowmap.velocity.lerp(this.pointer.velocity, vmag ? 0.1 : 0.04)

    this.updateSweep(dt)

    this.flowmap.setAspect(window.innerWidth / window.innerHeight)
    this.flowmap.update(time, 0)

    // Step the Navier-Stokes fluid; its dye field drives the chromatic trail.
    this.fluid.update()

    this.shared.tFlow.value = this.flowmap.texture
    this.shared.tFluidFlowmap.value = this.fluid.texture
    this.shared.uTime.value = time

    this.renderer.render(this.scene, this.camera)
  }

  start() {
    const loop = () => {
      this.update()
      requestAnimationFrame(loop)
    }
    requestAnimationFrame(loop)
  }
}
