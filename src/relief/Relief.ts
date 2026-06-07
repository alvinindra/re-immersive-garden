import {
  Box3,
  Color,
  DoubleSide,
  FrontSide,
  GLSL3,
  Group,
  LinearSRGBColorSpace,
  Matrix4,
  Mesh,
  Quaternion,
  MeshStandardMaterial,
  PerspectiveCamera,
  Raycaster,
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
import { loadLut, type LutData } from "./LutLoader"
import {
  pseudoNoise,
  initFlowerWind,
  updateFlowerWind,
  updateCursorWind,
  CursorDeltaBuffer,
  ILLUMINATION_RANGES,
  type FlowerWindState,
} from "./FooterWind"
import reliefVert from "./shaders/relief.vert.glsl"
import reliefFrag from "./shaders/relief.frag.glsl"
import footerVert from "./shaders/footer.vert.glsl"
import footerFrag from "./shaders/footer.frag.glsl"

const _identityQuat = new Quaternion()

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

  // Footer relief (footer_compressed.glb) — custom ShaderMaterial with baked
  // light reveal, cursor raycasting, LUT color grading, wind, fluid effect.
  private footerScene = new Scene()
  private footerModel = new Group()
  private footerCamera: PerspectiveCamera | null = null
  private footerProgress = 0
  private pointerVp = new Vector2(0.5, 0.5)
  private footerCamBaseQuat = new Quaternion()
  private fcx = 0
  private fcy = 0

  // footer wind + cursor state
  private footerFlowers: FlowerWindState[] = []
  private footerProxy: Mesh | null = null
  private footerRaycaster = new Raycaster()
  private footerCursorPoint = new Vector3()
  private footerCursorTarget = new Vector3()
  private footerLastCursorTarget = new Vector3()
  private footerCursorInit = false
  private footerDeltaBuffer = new CursorDeltaBuffer()
  private footerLightFade = 0
  private footerBakedLightProgress = 0
  private footerRevealStarted = false
  private footerWaveTriggered = false
  private footerLut: LutData | null = null
  private footerNoise: Texture | null = null
  private footerWindDirection = new Vector3(1, 0, 0)

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

  async loadFooter(url: string): Promise<void> {
    const draco = new DRACOLoader()
    draco.setDecoderPath("/draco/")
    const gltfLoader = new GLTFLoader()
    gltfLoader.setDRACOLoader(draco)

    const [lutData, noise, data] = await Promise.all([
      loadLut("/webgl/footer/lut.3dl"),
      new Promise<Texture>((res) => {
        const t = new TextureLoader().load("/webgl/global/noises/rgb-noise.jpg", res)
        t.wrapS = t.wrapT = RepeatWrapping
      }),
      new Promise<{ scene: Group; cameras: PerspectiveCamera[] }>((res, rej) =>
        gltfLoader.load(url, (d) => res(d as never), undefined, rej),
      ),
    ])

    this.footerLut = lutData
    this.footerNoise = noise

    const baseDefines: Record<string, string> = {
      UV: "uv1",
      HAS_WIND: "1",
      USE_LUT: "1",
      CURSOR_DECAY: "0.3",
      CURSOR_COLOR: "vec3(1.0, 1.0, 1.0)",
      DIFFUSE: "1.0",
      SHININESS: "5.0",
      SPECULAR: "4.0",
      SCENE_CENTER: "vec3(0.0, 0.15, 0.0)",
      FADE_EASE_1: "quadraticOut",
      FADE_EASE_2: "linear",
      FADE_EASE_3: "quinticOut",
      EFFECT_AMPLITUDE: "0.15",
      EFFECT_SHADOW_STRENGTH: "1.0",
      EFFECT_FLUID_MAGNITUDE: "0.1",
      EFFECT_FLUID_RED_COEF: "1.0",
      EFFECT_FLUID_GREEN_COEF: "3.1",
      EFFECT_FLUID_BLUE_COEF: "4.3",
      EFFECT_LINES_SPEED: "1.0",
      EFFECT_LINES_SCALE: "1.0",
      EFFECT_LINES_STRENGTH: "0.5",
      EFFECT_LINES_WAVE_LENGTH: "1.0",
      EFFECT_BASE_COLOR: "vec3(0.1647, 0.9804, 0.9804)",
      EFFECT_BASE_THRESHOLD: "0.2",
      EFFECT_HUE_SHIFT: "0.0",
      EFFECT_COLOR_RANGE: "1.0",
    }

    const drawing = this.renderer.getDrawingBufferSize(new Vector2())
    const maxAniso = this.renderer.capabilities.getMaxAnisotropy()

    data.scene.traverse((child) => {
      if (!(child instanceof Mesh)) return

      if (/proxy/i.test(child.name)) {
        child.visible = false
        this.footerProxy = child
        return
      }

      const nameMatch = child.name.match(/^(\w+?)(\d+)_low/)
      if (!nameMatch) return
      const id = `07_${nameMatch[1]}_${nameMatch[2].padStart(2, "0")}`

      const srcMat = child.material as MeshStandardMaterial
      const useAlpha = srcMat.metalnessMap != null
      const range = ILLUMINATION_RANGES[id] || [0, 0.4]

      const map = srcMat.map
      const lightMap = srcMat.emissiveMap
      const alphaMap = useAlpha ? srcMat.metalnessMap : null

      if (map) { map.colorSpace = LinearSRGBColorSpace; map.anisotropy = maxAniso; map.needsUpdate = true }
      if (lightMap) { lightMap.colorSpace = LinearSRGBColorSpace; lightMap.anisotropy = maxAniso; lightMap.needsUpdate = true }
      if (alphaMap) { alphaMap.colorSpace = LinearSRGBColorSpace; alphaMap.anisotropy = maxAniso; alphaMap.needsUpdate = true }

      const defines: Record<string, string> = { ...baseDefines }
      if (useAlpha) defines.USE_ALPHA_MAP = "1"

      const uniforms: Record<string, IUniform> = {
        uMap: { value: map },
        uLightMap: { value: lightMap },
        uNoise: { value: noise },
        uIlluminationRange: { value: new Vector2(range[0], range[1]) },
        uCursorPoint: { value: this.footerCursorPoint },
        uCursorIntensity: { value: 0 },
        uBakedLightIntensity: { value: 0 },
        uXBounds: { value: new Vector2(0, 1) },
        tFluidFlowmap: { value: this.fluid.texture },
        uTime: { value: 0 },
        uWaveTime: { value: 0 },
        uFooterOpacity: { value: 0 },
        uResolution: { value: new Vector2(drawing.x, drawing.y) },
        uLut: { value: lutData.texture3D },
        uLutSize: { value: lutData.size },
        uWindMatrix: { value: new Matrix4() },
        uMouseWindMatrix: { value: new Matrix4() },
      }
      if (useAlpha) uniforms.uAlphaMap = { value: alphaMap }

      // Material config matches the reference site exactly: FrontSide, and only the
      // alpha-mapped flowers are transparent (default depth write/test). The shader's
      // own `discard` (alpha < 0.05) keeps the petal edges crisp.
      const mat = new ShaderMaterial({
        glslVersion: GLSL3,
        vertexShader: footerVert,
        fragmentShader: footerFrag,
        defines,
        side: FrontSide,
        transparent: useAlpha,
        uniforms,
      })

      child.material = mat

      const windState = initFlowerWind(child)
      this.footerFlowers.push(windState)
    })

    this.footerModel.add(data.scene)
    this.footerModel.position.y = 1.0
    this.footerScene.updateWorldMatrix(true, true)

    let xMin = Infinity,
      xMax = -Infinity
    for (const flower of this.footerFlowers) {
      const worldCenter = flower.meshCenter
        .clone()
        .applyMatrix4(flower.mesh.matrixWorld)
      xMin = Math.min(xMin, worldCenter.x)
      xMax = Math.max(xMax, worldCenter.x)
    }
    for (const flower of this.footerFlowers) {
      const mat = flower.mesh.material as ShaderMaterial
      ;(mat.uniforms.uXBounds.value as Vector2).set(xMin, xMax)
    }

    const aspect = window.innerWidth / window.innerHeight
    const cam = new PerspectiveCamera(28, aspect, 0.1, 1000)
    const src = data.cameras[0] as PerspectiveCamera | undefined
    if (src) {
      src.updateWorldMatrix(true, true)
      const pos = new Vector3()
      const quat = new Quaternion()
      src.matrixWorld.decompose(pos, quat, new Vector3())
      cam.position.copy(pos)
      cam.quaternion.copy(quat)
      cam.fov = src.fov
    } else {
      cam.position.set(27, 0.15, 0)
      cam.lookAt(0, 0, 0)
    }
    cam.aspect = aspect
    cam.updateProjectionMatrix()
    this.footerCamera = cam
    this.footerCamBaseQuat.copy(cam.quaternion)
  }

  private _footerNdc = new Vector2()
  private _footerHits: { point: Vector3 }[] = []

  private updateFooterCursor(dt: number) {
    if (!this.footerProxy || !this.footerCamera) return

    this._footerNdc.set(
      this.pointerVp.x * 2 - 1,
      -(this.pointerVp.y * 2 - 1),
    )
    this.footerRaycaster.setFromCamera(this._footerNdc, this.footerCamera)

    this._footerHits.length = 0
    this.footerProxy.raycast(this.footerRaycaster, this._footerHits as never)

    if (this._footerHits.length > 0) {
      this.footerCursorTarget.copy(this._footerHits[0].point)
      // First valid hit: snap everything to it. Otherwise the cursor point starts at
      // the origin — dead centre of the flower bed — and the intensity-100 cursor
      // light glares specular over every petal until it lerps away (reads as damage).
      // Snapping also avoids a huge first-frame cursor delta spiking the wind springs.
      if (!this.footerCursorInit) {
        this.footerCursorInit = true
        this.footerCursorPoint.copy(this.footerCursorTarget)
        this.footerLastCursorTarget.copy(this.footerCursorTarget)
      }
    }

    const factor = 1 - Math.exp(-2 * dt)
    this.footerCursorPoint.lerp(this.footerCursorTarget, factor)

    const dx = this.footerCursorTarget.x - this.footerLastCursorTarget.x
    const dy = this.footerCursorTarget.y - this.footerLastCursorTarget.y
    const dz = this.footerCursorTarget.z - this.footerLastCursorTarget.z
    this.footerDeltaBuffer.push(dx, dy, dz)
    this.footerLastCursorTarget.copy(this.footerCursorTarget)
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
    for (const flower of this.footerFlowers) {
      const mat = flower.mesh.material as ShaderMaterial
      ;(mat.uniforms.uResolution.value as Vector2).set(drawing.x, drawing.y)
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

    if (this.footerProgress > 0.001 && this.footerCamera && this.footerModel.visible) {
      {
        const cam = this.footerCamera
        this.fcx += ((this.pointerVp.x - 0.5) - this.fcx) * 0.04
        this.fcy += ((this.pointerVp.y - 0.5) - this.fcy) * 0.04
        cam.quaternion.copy(this.footerCamBaseQuat)
        cam.rotateY(-this.fcx * 0.06 + Math.sin(time * 0.18) * 0.006)
        cam.rotateX(-this.fcy * 0.05 + Math.cos(time * 0.13) * 0.004)
      }

      this.updateFooterCursor(dt)

      if (!this.footerRevealStarted && this.footerProgress > 0.1) {
        this.footerRevealStarted = true
      }
      if (this.footerRevealStarted) {
        this.footerBakedLightProgress = Math.min(
          0.6,
          this.footerBakedLightProgress + (0.6 / 8) * dt,
        )
        this.footerLightFade = Math.min(1, this.footerLightFade + dt)
      }

      const windAngle = pseudoNoise(time * 0.03) * Math.PI * 2
      this.footerWindDirection.set(Math.cos(windAngle), 0, Math.sin(windAngle))

      const idQ = _identityQuat
      for (const flower of this.footerFlowers) {
        updateFlowerWind(flower, time, this.footerWindDirection)
        updateCursorWind(flower, this.footerDeltaBuffer, dt)

        const mat = flower.mesh.material as ShaderMaterial
        mat.uniforms.uTime.value = time
        mat.uniforms.uBakedLightIntensity.value = this.footerBakedLightProgress
        mat.uniforms.uCursorIntensity.value = this.footerLightFade * 100
        mat.uniforms.uFooterOpacity.value = this.footerProgress
        mat.uniforms.uWindMatrix.value = flower.windMatrix
        mat.uniforms.uMouseWindMatrix.value = flower.mouseWindMatrix
        mat.uniforms.tFluidFlowmap.value = this.fluid.texture

        if (flower.leanProgress > 0.001) {
          flower.leanProgress = Math.max(0, flower.leanProgress - dt / 8)
          flower.mesh.quaternion.slerpQuaternions(
            idQ,
            flower.revealQuaternion,
            flower.leanProgress,
          )
        }
      }

      if (this.footerRevealStarted && !this.footerWaveTriggered) {
        this.footerWaveTriggered = true
        for (const f of this.footerFlowers) {
          ;(f.mesh.material as ShaderMaterial).uniforms.uWaveTime.value = time
        }
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
