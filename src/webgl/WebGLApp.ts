import {
  Color,
  LinearSRGBColorSpace,
  RepeatWrapping,
  Texture,
  TextureLoader,
  Vector2,
  WebGLRenderer,
  type IUniform,
} from "three"
import { Flowmap } from "./core/Flowmap"
import { FluidSimulation } from "./core/FluidSimulation"
import { HomeScene, HOME_CONFIG } from "./scenes/HomeScene"
import { FooterScene } from "./scenes/FooterScene"
import { Pointer } from "./utils/Pointer"

export class WebGLApp {
  readonly renderer: WebGLRenderer
  
  private flowmap: Flowmap
  private fluid: FluidSimulation
  private pointer = new Pointer()
  private sharedUniforms: Record<string, IUniform>
  
  private homeScene: HomeScene
  private footerScene: FooterScene
  
  private clock = { start: performance.now() }
  private dpr: number
  private lastDt = 0
  
  private overlay?: { update(dt: number): void; render(): void }
  
  private sweep = {
    active: false,
    t: 0,
    dur: 1,
    from: new Vector2(),
    to: new Vector2(),
    next: 1.5,
  }

  private clearGrey = new Color(0.745, 0.745, 0.745)
  private clearBlack = new Color(0.01, 0.01, 0.013)
  private clearTmp = new Color()

  constructor(canvas: HTMLCanvasElement) {
    this.dpr = Math.min(window.devicePixelRatio, 2)

    this.renderer = new WebGLRenderer({ canvas, antialias: true, alpha: false })
    this.renderer.setPixelRatio(this.dpr)
    this.renderer.setSize(window.innerWidth, window.innerHeight)
    this.renderer.outputColorSpace = LinearSRGBColorSpace
    this.renderer.setClearColor(this.clearGrey, 1)

    this.flowmap = new Flowmap(this.renderer, {
      size: 512,
      falloff: HOME_CONFIG.flowmap.falloff,
      alpha: HOME_CONFIG.flowmap.alpha,
      dissipation: HOME_CONFIG.flowmap.dissipation,
    })
    
    this.fluid = new FluidSimulation(this.renderer)

    const drawing = this.renderer.getDrawingBufferSize(new Vector2())
    this.sharedUniforms = {
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
      uTextureStrength: { value: HOME_CONFIG.extrude.textureStrength },
      uGradientStrength: { value: HOME_CONFIG.extrude.gradientStrength },
      uSwitchColorTransition: { value: 0 },
      uSwitchColorFastScroll: { value: 0 },
      uBrightnessFactor: { value: HOME_CONFIG.brightness.factor },
      uBrightnessOffset: { value: HOME_CONFIG.brightness.offset },
    }

    this.loadTextures()

    this.homeScene = new HomeScene(this.sharedUniforms)
    this.footerScene = new FooterScene(this.renderer)

    ;(window as unknown as { __relief: WebGLApp }).__relief = this

    window.addEventListener("resize", this.onResize)
    window.addEventListener("pointermove", this.onPointerMove)

    this.flowmap.setAspect(window.innerWidth / window.innerHeight)
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
    const maskNoise = raw(loader.load("/webgl/global/noises/rgb-attenuation-0,9.png"), true)
    const flowNoise = raw(loader.load("/webgl/global/noises/mask-noise.png"), true)

    this.sharedUniforms.tPlaster.value = plaster
    this.sharedUniforms.tMaskNoise.value = maskNoise
    this.flowmap.setNoise(flowNoise)
  }

  load(url: string): Promise<void> {
    return this.homeScene.load(url)
  }

  loadFooter(url: string): Promise<void> {
    return this.footerScene.load(url, this.fluid.texture)
  }

  private onResize = () => {
    const w = window.innerWidth
    const h = window.innerHeight
    this.renderer.setSize(w, h)
    
    this.homeScene.onResize()
    this.footerScene.onResize()
    
    const drawing = this.renderer.getDrawingBufferSize(new Vector2())
    ;(this.sharedUniforms.uResolution.value as Vector2).set(drawing.x, drawing.y)
    this.sharedUniforms.uAspect.value = w / h
    this.flowmap.setAspect(w / h)
  }

  private onPointerMove = (e: PointerEvent) => {
    const nx = e.clientX / window.innerWidth
    const ny = e.clientY / window.innerHeight
    this.pointer.set(nx, 1 - ny)
    this.footerScene.setPointerVp(nx, ny)
  }

  setOverlay(o: { update(dt: number): void; render(): void }) {
    this.overlay = o
  }

  setPixelRatio(r: number) {
    if (r === this.dpr) return
    this.dpr = r
    this.renderer.setPixelRatio(r)
    this.renderer.setSize(window.innerWidth, window.innerHeight)
    const drawing = this.renderer.getDrawingBufferSize(new Vector2())
    ;(this.sharedUniforms.uResolution.value as Vector2).set(drawing.x, drawing.y)
  }

  get pixelRatio() {
    return this.dpr
  }

  setScroll(scrollPct: number, speed: number) {
    this.homeScene.setScroll(scrollPct)
    this.sharedUniforms.uScreenScroll.value = scrollPct
    this.sharedUniforms.uScrollSpeed.value = speed

    const t = Math.max(0, Math.min(1, (scrollPct - 0.9) / 0.1))
    const fp = t * t * (3 - 2 * t)
    
    this.footerScene.progress = fp
    this.footerScene.model.visible = fp > 0.001
    
    this.setDarkness(fp)
    this.homeScene.model.visible = fp < 0.98
  }

  private setDarkness(d: number) {
    this.clearTmp.copy(this.clearGrey).lerp(this.clearBlack, d)
    this.renderer.setClearColor(this.clearTmp, 1)
    this.sharedUniforms.uBrightnessFactor.value = 0.6 + (0.18 - 0.6) * d
    this.sharedUniforms.uBrightnessOffset.value = 0.4 + (0.02 - 0.4) * d
  }

  private randDir(from?: Vector2): Vector2 {
    const base = from ?? new Vector2((Math.random() - 0.5) * 2, (Math.random() - 0.5) * 2)
    const angle = Math.atan2(base.y, base.x) + (Math.random() - 0.5) * 2 * Math.PI * 0.8
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
    const e = 1 - Math.pow(1 - k, 2)
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
    this.flowmap.mouse.lerp(this.pointer.normalFlip, HOME_CONFIG.flowmap.mouseEase)
    const vmag = this.pointer.velocity.length()
    this.flowmap.velocity.lerp(this.pointer.velocity, vmag ? 0.1 : 0.04)

    this.updateSweep(dt)

    this.flowmap.update(time, 0)
    this.fluid.update()

    this.sharedUniforms.tFlow.value = this.flowmap.texture
    this.sharedUniforms.tFluidFlowmap.value = this.fluid.texture
    this.sharedUniforms.uTime.value = time

    this.renderer.render(this.homeScene.scene, this.homeScene.camera)

    this.footerScene.updateAndRender(dt, time, this.fluid.texture)

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
