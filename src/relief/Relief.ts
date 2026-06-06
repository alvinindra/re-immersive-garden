import {
  Box3,
  Color,
  DoubleSide,
  FrontSide,
  GLSL3,
  PMREMGenerator,
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
  // lighter + lower-contrast remap so the reveal stays soft plaster-white like the
  // real site (our flowmap reaches deeper bake levels; this keeps darks from going harsh)
  brightness: { factor: 0.6, offset: 0.4 }, // desktop (same as main branch)
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

  // vertical scroll panning of the home relief (top → bottom of the panel)
  private panTop = 0
  private panBottom = 0
  private modelCenterX = 0
  private scrollPct = 0
  private homeMaxY = 0
  private homeMinY = 0
  private heroLift = 0 // lifts the relief content toward the top at the hero

  // dark footer relief (footer_compressed.glb). Rendered in its OWN scene with
  // the GLB's embedded camera + env map for proper PBR lighting (the real site
  // uses a baked-light shader; we approximate by keeping the GLB's native PBR
  // materials with an environment so the flowers actually catch highlights).
  private footerScene = new Scene()
  private footerModel = new Group()
  private footerCamera: PerspectiveCamera | null = null
  private footerOpacity: IUniform = { value: 0 }
  private footerProgress = 0
  private footerEnvMap: import("three").Texture | null = null
  private footerCursorLight: import("three").PointLight | null = null
  private footerCursorTarget: Vector3 | null = null
  private pointerVp = new Vector2(0.5, 0.5)

  private shared: Record<string, IUniform>
  private clock = { start: performance.now() }
  private dpr: number

  // optional overlay (the scrolling media gallery), rendered as a second pass
  private overlay?: { update(dt: number): void; render(): void }
  private lastDt = 0

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
    // full Retina crispness for the relief (cap at 2 like the original site).
    // Smoothness comes from cached layout + capped video decode, not lower DPR.
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
    // footer lives in its OWN scene + camera (the GLB's embedded one)
    this.footerScene.add(this.footerModel)
    this.footerModel.visible = false
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
              // opaque + depthWrite ON, same as main. With transparent + depthWrite
              // off, the 18 relief tiles alpha-blended each other instead of depth-
              // occluding, producing fragmented dark blobs. The footer relief draws
              // over this via depthTest:false (see loadFooter).
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

  /** Load the dark footer relief (its own GLB), framed by its embedded camera and
   *  rendered in its own scene with an environment map. Crossfades in at the
   *  bottom — opacity follows scrollPct via footerOpacity. */
  async loadFooter(url: string): Promise<void> {
    const draco = new DRACOLoader()
    draco.setDecoderPath("/draco/")
    const gltf = new GLTFLoader()
    gltf.setDRACOLoader(draco)

    // env map: gives the GLB's PBR materials something to reflect so the flowers
    // catch light highlights (the real site uses a baked lightmap; this is a fast,
    // generic stand-in that produces the same lit-flower look).
    const pmrem = new PMREMGenerator(this.renderer)
    const RoomEnv = (
      await import("three/examples/jsm/environments/RoomEnvironment.js")
    ).RoomEnvironment
    this.footerEnvMap = pmrem.fromScene(new RoomEnv(), 0.04).texture
    this.footerScene.environment = this.footerEnvMap
    this.footerScene.environmentIntensity = 0.35
    // Real site: cursorLight() + numberLight() — a moving spotlight at the cursor
    // illuminates the petals (PointLight), plus a strong ambient lift and a key
    // directional. Result: deep-black shadows with bright cream highlights where
    // the cursor passes — matches the live footer.
    const { DirectionalLight, AmbientLight, PointLight, Vector3: V3 } = await import("three")
    const key = new DirectionalLight(0xffffff, 1.2)
    key.position.set(0.3, 1, 0.8)
    const amb = new AmbientLight(0xfff4e0, 0.55) // slightly warm fill
    const cursorLight = new PointLight(0xfff1d6, 60, 10, 1.2) // strong warm spotlight
    cursorLight.position.set(0, 0, 1.5)
    this.footerScene.add(key, amb, cursorLight)
    this.footerCursorLight = cursorLight
    this.footerCursorTarget = new V3(0, 0, 1.2)

    return new Promise((resolve, reject) => {
      gltf.load(
        url,
        (data) => {
          // GLB has baked albedo (.map) + baked lightmap (.emissiveMap). The real
          // footer composes them: color = albedo * lightmap. We reuse MeshStandardMaterial
          // and set emissive=white so emissiveMap acts as that baked light layer,
          // plus an env map for subtle highlights. Result reads lit-on-black like real.
          data.scene.traverse((child) => {
            if (!(child instanceof Mesh)) return
            // hide the backdrop / proxy cloth meshes — they cover the scene with a
            // solid white slab in the GLB; we want pure black + flowers only.
            if (/proxy|cloth/i.test(child.name)) {
              child.visible = false
              return
            }
            const m = child.material as MeshStandardMaterial
            if (m.map) m.map.colorSpace = SRGBColorSpace
            // GLB's emissiveMap isn't a clean lightmap — disable it (was muddying
            // colors). Lighting comes from env + key/ambient instead.
            m.emissive.setRGB(0, 0, 0)
            m.emissiveIntensity = 0
            m.metalness = 0
            m.roughness = 0.8
            m.transparent = true
            m.depthWrite = true
            const orig = m.onBeforeRender
            m.onBeforeRender = (...args) => {
              m.opacity = this.footerOpacity.value as number
              orig?.apply(m, args)
            }
          })
          this.footerModel.add(data.scene)

          // Fit a perspective camera to the model so the floral relief fills the
          // viewport (the GLB's embedded cam zooms onto a single flower — wrong for
          // our use). Distance derived from bounding sphere + a small overscan.
          const aspect = window.innerWidth / window.innerHeight
          const cam = new PerspectiveCamera(28, aspect, 0.1, 1000)
          this.footerModel.updateWorldMatrix(true, true)
          const box = new Box3().setFromObject(this.footerModel)
          const center = box.getCenter(new Vector3())
          const size = box.getSize(new Vector3())
          // re-centre the model at the origin so the camera looks straight at it
          this.footerModel.position.sub(center)
          const fitH = size.y
          const fitW = size.x / aspect
          const fit = Math.max(fitH, fitW)
          const dist = (fit / 2) / Math.tan((cam.fov / 2) * (Math.PI / 180))
          cam.position.set(0, 0, dist * 0.8) // 0.8 = overscan (fill + crop edges)
          cam.lookAt(0, 0, 0)
          this.footerCamera = cam
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
    this.modelCenterX = center.x
    this.homeMaxY = box.max.y
    this.homeMinY = box.min.y
    // pan extent: top row visible at scrollPct 0 → bottom row at scrollPct 1, so the
    // creatures change as you scroll (the real site pans the relief panel vertically).
    this.updateCameraFov()
    this.computePan()
    this.applyFraming()
  }

  private visibleHeight() {
    const fovRad = (this.camera.fov * Math.PI) / 180
    return (2 * Math.tan(fovRad / 2) * CONFIG.camera.distance) / this.camera.zoom
  }

  private computePan() {
    const vh = this.visibleHeight()
    this.panTop = -(this.homeMaxY - vh / 2)
    this.panBottom = -(this.homeMinY + vh / 2)
    this.heroLift = 0 // hero frames the bird tile dead-centre (the original framing)
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

  /** Pan the relief panel vertically by scrollPct (top row → bottom row), keeping
   *  the centre column framed. Recomputed on resize since fov drives the extent. */
  private applyFraming() {
    this.model.position.x = -this.modelCenterX
    const t = Math.max(0, Math.min(1, this.scrollPct))
    // hero (t=0) frames the bird tile, nudged up toward the top; scrolling pans
    // down through the panel to the bottom (where the footer relief takes over).
    const heroY = -this.framePivot.y + this.heroLift
    this.model.position.y = heroY + (this.panBottom - heroY) * t
  }

  private onResize = () => {
    const w = window.innerWidth
    const h = window.innerHeight
    this.renderer.setSize(w, h)
    this.camera.aspect = w / h
    this.updateCameraFov() // aspect-aware fov recalc
    this.computePan() // pan extent depends on fov
    this.applyFraming() // re-pan after resize
    const drawing = this.renderer.getDrawingBufferSize(new Vector2())
    ;(this.shared.uResolution.value as Vector2).set(drawing.x, drawing.y)
    this.shared.uAspect.value = w / h
    this.flowmap.setAspect(w / h)
    if (this.footerCamera) {
      this.footerCamera.aspect = w / h
      this.footerCamera.updateProjectionMatrix()
    }
  }

  private onPointerMove = (e: PointerEvent) => {
    this.pointer.set(
      e.clientX / window.innerWidth,
      1 - e.clientY / window.innerHeight,
    )
    this.pointerVp.set(
      e.clientX / window.innerWidth,
      e.clientY / window.innerHeight,
    )
  }

  /** Register the scrolling media gallery, drawn over the relief each frame. */
  setOverlay(o: { update(dt: number): void; render(): void }) {
    this.overlay = o
  }

  /** Adaptive quality: lower the device pixel ratio when FPS dips. */
  setPixelRatio(r: number) {
    if (r === this.dpr) return
    this.dpr = r
    this.renderer.setPixelRatio(r)
    this.renderer.setSize(window.innerWidth, window.innerHeight)
    const drawing = this.renderer.getDrawingBufferSize(new Vector2())
    ;(this.shared.uResolution.value as Vector2).set(drawing.x, drawing.y)
  }

  get pixelRatio() {
    return this.dpr
  }

  /** Feed the smooth-scroll signal: pan the relief, drive scroll uniforms, and
   *  cross-fade the dark footer relief in as the bottom approaches. */
  setScroll(scrollPct: number, speed: number) {
    this.scrollPct = scrollPct
    this.applyFraming() // pan the panel vertically
    this.shared.uScreenScroll.value = scrollPct
    this.shared.uScrollSpeed.value = speed

    // footer relief cross-fade over the last 10% of scroll.
    const t = Math.max(0, Math.min(1, (scrollPct - 0.9) / 0.1))
    const fp = t * t * (3 - 2 * t)
    this.footerProgress = fp
    this.footerModel.visible = fp > 0.001
    this.footerOpacity.value = fp
    this.setDarkness(fp)
    // hide the HOME relief once the footer fade is complete — otherwise its dim-
    // grey draw shows through wherever the floral relief has gaps, washing the bg
    this.model.visible = fp < 0.98
  }

  // grey plaster at rest → near-black for the footer
  private clearGrey = new Color(0.745, 0.745, 0.745)
  private clearBlack = new Color(0.01, 0.01, 0.013)
  private clearTmp = new Color()
  /** 0 = grey home relief, 1 = dark footer relief. Drives the bottom fade-to-black. */
  setDarkness(d: number) {
    // fade the clear color toward black AND dim the HOME relief brightness toward
    // dark. The footer relief has its OWN brightness uniforms (set in loadFooter),
    // so footer stays at its dim baseline and doesn't double-dim with this.
    this.clearTmp.copy(this.clearGrey).lerp(this.clearBlack, d)
    this.renderer.setClearColor(this.clearTmp, 1)
    this.shared.uBrightnessFactor.value = 0.6 + (0.18 - 0.6) * d
    this.shared.uBrightnessOffset.value = 0.4 + (0.02 - 0.4) * d
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
    this.lastDt = dt
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

    // footer pass: when the bottom approaches, render the GLB's own scene + camera
    // on top of the home relief. Uses the GLB's PBR materials with env-lit flowers
    // + a moving cursor PointLight (the real site's cursorLight()).
    if (this.footerProgress > 0.001 && this.footerCamera && this.footerModel.visible) {
      // map viewport pointer (0..1) to a world position in front of the flowers
      if (this.footerCursorLight && this.footerCursorTarget) {
        const cam = this.footerCamera
        const fovRad = (cam.fov * Math.PI) / 180
        const z = 0.2 // just in front of the model centre
        const distZ = cam.position.z - z
        const vh = 2 * Math.tan(fovRad / 2) * distZ
        const vw = vh * cam.aspect
        const x = (this.pointerVp.x - 0.5) * vw
        const y = (0.5 - this.pointerVp.y) * vh
        // ease toward target so the light glides
        this.footerCursorTarget.set(x, y, z + 1.0)
        this.footerCursorLight.position.lerp(this.footerCursorTarget, 0.18)
      }
      this.renderer.autoClear = false
      this.renderer.clearDepth()
      this.renderer.render(this.footerScene, this.footerCamera)
      this.renderer.autoClear = true
    }

    // second pass: the scrolling media gallery, drawn on top of the relief.
    // overlay.update() runs first (it may render glb sub-scenes to their own
    // render targets and restore renderer state) before we draw planes to screen.
    if (this.overlay) {
      this.overlay.update(this.lastDt)
      this.renderer.autoClear = false
      this.renderer.clearDepth()
      this.overlay.render()
      this.renderer.autoClear = true
    }
  }

  start() {
    const loop = () => {
      this.update()
      requestAnimationFrame(loop)
    }
    requestAnimationFrame(loop)
  }
}
