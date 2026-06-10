import {
  Box3,
  Color,
  Mesh,
  Object3D,
  OrthographicCamera,
  PerspectiveCamera,
  PlaneGeometry,
  PMREMGenerator,
  Scene,
  ShaderMaterial,
  SRGBColorSpace,
  Texture,
  Vector2,
  Vector3,
  VideoTexture,
  WebGLRenderTarget,
  WebGLRenderer,
} from "three"
import { KTX2Loader } from "three/examples/jsm/loaders/KTX2Loader.js"
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js"
import { DRACOLoader } from "three/examples/jsm/loaders/DRACOLoader.js"
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js"
import galleryVert from "./shaders/gallery.vert.glsl"
import galleryFrag from "./shaders/gallery.frag.glsl"
import type { ScrollState } from "../scroll/SmoothScroll"

const lerp = (a: number, b: number, t: number) => a + (b - a) * t
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))

const MAX_VIDEOS = 3

// scroll "feel" — values verbatim from the original bundle, do not retune
const SCROLL_PHYSICS = {
  velDivisor: 2600, // raw px/s → normalized shader velocity
  deformDivisor: 2200, // raw px/s → plane deform amount
  velEase: 0.12,
  deformEase: 0.1,
  velDecay: 0.9, // per-frame decay of the raw velocity sample
}

type Kind = "image" | "video" | "glb"

interface ScreenRect {
  top: number
  bottom: number
  left: number
  width: number
  height: number
}

interface GlbScene {
  root: Scene
  model: Object3D
  camera: PerspectiveCamera
  rt: WebGLRenderTarget
  tilt: number
}

interface MediaPlane {
  el: HTMLElement
  kind: Kind
  mesh: Mesh
  material: ShaderMaterial
  uri: string | null
  title: string
  loaded: boolean
  requested: boolean
  hoverTarget: number
  opacityTarget: number
  video?: HTMLVideoElement
  videoTex?: VideoTexture
  playing?: boolean
  glb?: GlbScene
  docTop: number
  left: number
  width: number
  height: number
  videoDist: number
}

export class Gallery {
  readonly scene = new Scene()
  readonly camera: OrthographicCamera
  private renderer: WebGLRenderer
  private geometry = new PlaneGeometry(1, 1, 32, 32)
  private ktx2: KTX2Loader
  private gltf: GLTFLoader
  private envMap: Texture
  private planes: MediaPlane[] = []

  private velNorm = 0
  private deform = 0
  private rawVel = 0
  private t0 = performance.now()

  private layoutObserver?: ResizeObserver
  private remeasureQueued = false

  // per-frame scratch — consumed synchronously inside update(), never retained
  private rect: ScreenRect = { top: 0, bottom: 0, left: 0, width: 0, height: 0 }
  private videoCandidates: MediaPlane[] = []

  private savedClear = new Color()
  private onCursor: (text: string | null) => void

  constructor(renderer: WebGLRenderer, onCursor: (text: string | null) => void) {
    this.renderer = renderer
    this.onCursor = onCursor

    const w = window.innerWidth
    const h = window.innerHeight
    this.camera = new OrthographicCamera(-w / 2, w / 2, h / 2, -h / 2, -1000, 1000)
    this.camera.position.z = 10

    this.ktx2 = new KTX2Loader()
      .setTranscoderPath("/webgl/libs/basis/")
      .detectSupport(this.renderer)

    const draco = new DRACOLoader()
    draco.setDecoderPath("/draco/")
    this.gltf = new GLTFLoader()
    this.gltf.setDRACOLoader(draco)
    this.gltf.setKTX2Loader(this.ktx2)

    const pmrem = new PMREMGenerator(this.renderer)
    this.envMap = pmrem.fromScene(new RoomEnvironment(), 0.04).texture

    window.addEventListener("resize", this.onResize)
  }

  build() {
    const els = Array.from(document.querySelectorAll<HTMLElement>("[data-media]"))
    for (const el of els) {
      const kind = (el.getAttribute("data-kind") as Kind) || "image"
      const portrait = el.hasAttribute("data-portrait")
      const material = new ShaderMaterial({
        vertexShader: galleryVert,
        fragmentShader: galleryFrag,
        transparent: true,
        depthWrite: false,
        uniforms: {
          uTexture: { value: null },
          uTextureAspect: { value: kind === "glb" ? 1 : portrait ? 3 / 4 : 16 / 9 },
          uPlaneAspect: { value: 16 / 9 },
          uHover: { value: 0 },
          uScrollVel: { value: 0 },
          uDeform: { value: 0 },
          uOpacity: { value: 0 },
          uHasTexture: { value: false },
          uPlaceholder: { value: new Color(0.74, 0.74, 0.74) },
          uTime: { value: 0 },
          uMouseLocal: { value: new Vector2(0.5, 0.5) },
        },
      })
      const mesh = new Mesh(this.geometry, material)
      mesh.frustumCulled = false
      mesh.visible = false
      this.scene.add(mesh)

      const plane: MediaPlane = {
        el,
        kind,
        mesh,
        material,
        uri: el.getAttribute("data-uri"),
        title: el.getAttribute("data-title") || "",
        loaded: false,
        requested: false,
        hoverTarget: 0,
        opacityTarget: 0,
        docTop: 0,
        left: 0,
        width: 0,
        height: 0,
        videoDist: 0,
      }
      this.planes.push(plane)

      el.addEventListener("pointerenter", () => {
        plane.hoverTarget = 1
        this.onCursor(plane.title ? "Discover" : null)
      })
      el.addEventListener("pointerleave", () => {
        plane.hoverTarget = 0
        this.onCursor(null)
      })
      el.addEventListener("pointermove", (e) => {
        const r = el.getBoundingClientRect()
        ;(plane.material.uniforms.uMouseLocal.value as Vector2).set(
          (e.clientX - r.left) / r.width,
          1 - (e.clientY - r.top) / r.height,
        )
      })
      el.addEventListener("click", () => {
        if (plane.uri) window.open("https://immersive-g.com/" + plane.uri, "_blank")
      })
    }
    this.measureLayout()

    const target = document.querySelector("#scroll-content") || document.documentElement
    this.layoutObserver = new ResizeObserver(() => {
      if (this.remeasureQueued) return
      this.remeasureQueued = true
      requestAnimationFrame(() => {
        this.remeasureQueued = false
        this.measureLayout()
      })
    })
    this.layoutObserver.observe(target)
  }

  measureLayout() {
    const scrollY = window.scrollY
    for (const p of this.planes) {
      const r = p.el.getBoundingClientRect()
      p.docTop = r.top + scrollY
      p.left = r.left
      p.width = r.width
      p.height = r.height
    }
  }

  private load(plane: MediaPlane) {
    plane.requested = true
    const src = plane.el.getAttribute("data-media")!
    if (plane.kind === "video") this.loadVideo(plane, src)
    else if (plane.kind === "glb") this.loadGlb(plane, src)
    else this.loadImage(plane, src)
  }

  private loadImage(plane: MediaPlane, src: string) {
    this.ktx2.load(
      src,
      (tex: Texture) => {
        tex.needsUpdate = true
        plane.material.uniforms.uTexture.value = tex
        plane.material.uniforms.uHasTexture.value = true
        const img = tex.image as { width: number; height: number }
        if (img && img.width) {
          plane.material.uniforms.uTextureAspect.value = img.width / img.height
        }
        plane.loaded = true
      },
      undefined,
      () => {},
    )
  }

  private loadVideo(plane: MediaPlane, src: string) {
    const video = document.createElement("video")
    video.crossOrigin = "anonymous"
    video.muted = true
    video.loop = true
    video.playsInline = true
    video.autoplay = false
    video.preload = "metadata"
    video.src = src
    const tex = new VideoTexture(video)
    plane.video = video
    plane.videoTex = tex
    video.addEventListener("loadeddata", () => {
      plane.material.uniforms.uTexture.value = tex
      plane.material.uniforms.uHasTexture.value = true
      if (video.videoWidth) {
        plane.material.uniforms.uTextureAspect.value =
          video.videoWidth / video.videoHeight
      }
      plane.loaded = true
    })
    video.load()
  }

  private loadGlb(plane: MediaPlane, src: string) {
    this.gltf.load(src, (data) => {
      const model = data.scene
      model.traverse((o) => {
        const m = o as Mesh
        if (m.isMesh) m.frustumCulled = false
      })

      const root = new Scene()
      root.environment = this.envMap
      root.environmentIntensity = 1.8

      let camera = data.cameras[0] as PerspectiveCamera | undefined
      const aspect = plane.material.uniforms.uTextureAspect.value as number
      if (camera && camera.isPerspectiveCamera) {
        camera.position.z = -12
        camera.aspect = aspect
        camera.updateProjectionMatrix()
        camera.removeFromParent()
        root.add(model)
      } else {
        camera = new PerspectiveCamera(35, aspect, 0.1, 100)
        const box = new Box3().setFromObject(model)
        const center = box.getCenter(new Vector3())
        const size = box.getSize(new Vector3()).length()
        model.position.sub(center)
        camera.position.set(0, 0, size * 1.4)
        camera.lookAt(0, 0, 0)
        root.add(model)
      }

      const rt = new WebGLRenderTarget(Math.round(aspect * 512), 512, {
        depthBuffer: true,
        samples: 4,
      })
      plane.glb = { root, model, camera, rt, tilt: 0 }
      plane.material.uniforms.uTexture.value = rt.texture
      plane.material.uniforms.uHasTexture.value = true
      plane.loaded = true
    })
  }

  setScroll(s: ScrollState) {
    this.rawVel = s.velocity
  }

  update(dt: number) {
    const w = window.innerWidth
    const h = window.innerHeight

    this.updateScrollPhysics()

    const scrollY = window.scrollY
    const loadMargin = h * 1.4
    const time = (performance.now() - this.t0) / 1000
    const candidates = this.videoCandidates
    candidates.length = 0
    const r = this.rect

    for (const p of this.planes) {
      if (p.width === 0) continue

      r.top = p.docTop - scrollY
      r.bottom = r.top + p.height
      r.left = p.left
      r.width = p.width
      r.height = p.height
      const onScreen = r.bottom > -loadMargin && r.top < h + loadMargin

      if (!onScreen) {
        this.hidePlane(p)
        continue
      }

      if (!p.requested) this.load(p)

      this.updatePlaneLayout(p, r, w, h)
      this.updatePlaneUniforms(p, r, dt, h, time)

      if (p.kind === "video" && p.video && p.loaded) {
        p.videoDist = Math.abs(r.top + r.height / 2 - h / 2)
        candidates.push(p)
      }

      if (p.kind === "glb" && p.glb) {
        const intersecting = r.top < h && r.bottom > 0
        if (intersecting || (p.material.uniforms.uOpacity.value as number) > 0.01) {
          const scrollNorm = clamp((h / 2 - (r.top + r.height / 2)) / (h / 2), -1, 1)
          this.renderGlb(p.glb, scrollNorm, dt)
        } else {
          // keep spin advancing off-screen so re-entry doesn't snap
          p.glb.model.rotation.y += dt * 0.3
        }
      }
    }

    this.manageVideoDecodes(candidates)
  }

  private updateScrollPhysics() {
    const targetVel = clamp(this.rawVel / SCROLL_PHYSICS.velDivisor, -1, 1)
    const targetDeform = Math.min(1, Math.abs(this.rawVel) / SCROLL_PHYSICS.deformDivisor)
    this.velNorm = lerp(this.velNorm, targetVel, SCROLL_PHYSICS.velEase)
    this.deform = lerp(this.deform, targetDeform, SCROLL_PHYSICS.deformEase)
    this.rawVel *= SCROLL_PHYSICS.velDecay
  }

  private hidePlane(p: MediaPlane) {
    p.mesh.visible = false
    if (p.playing && p.video) {
      p.video.pause()
      p.playing = false
    }
  }

  private updatePlaneLayout(p: MediaPlane, r: ScreenRect, w: number, h: number) {
    p.mesh.visible = true
    const cx = r.left + r.width / 2 - w / 2
    const cy = -(r.top + r.height / 2) + h / 2
    p.mesh.position.set(cx, cy, 0)
    p.mesh.scale.set(r.width, r.height, 1)
  }

  private updatePlaneUniforms(p: MediaPlane, r: ScreenRect, dt: number, h: number, time: number) {
    const u = p.material.uniforms
    u.uPlaneAspect.value = r.width / r.height
    u.uHover.value = lerp(u.uHover.value, p.hoverTarget, 1 - Math.exp(-dt * 1.6))
    u.uScrollVel.value = this.velNorm
    u.uDeform.value = this.deform
    u.uTime.value = time

    const inView = r.top < h * 0.92 && r.bottom > h * 0.08
    if (inView && p.loaded) p.opacityTarget = 1
    u.uOpacity.value = lerp(u.uOpacity.value, p.opacityTarget, 0.08)
  }

  private manageVideoDecodes(candidates: MediaPlane[]) {
    candidates.sort((a, b) => a.videoDist - b.videoDist)
    for (let i = 0; i < candidates.length; i++) {
      const p = candidates[i]
      if (i < MAX_VIDEOS) {
        if (!p.playing) p.video!.play().then(() => (p.playing = true)).catch(() => {})
        if (p.videoTex) p.videoTex.needsUpdate = true
      } else if (p.playing) {
        p.video!.pause()
        p.playing = false
      }
    }
  }

  private renderGlb(g: GlbScene, scrollNorm: number, dt: number) {
    g.model.rotation.x = scrollNorm * 0.45
    g.model.rotation.y += dt * 0.3

    const ren = this.renderer
    ren.getClearColor(this.savedClear)
    const savedAlpha = ren.getClearAlpha()
    const savedAutoClear = ren.autoClear
    const savedCS = ren.outputColorSpace

    ren.outputColorSpace = SRGBColorSpace
    ren.setClearColor(0x000000, 0)
    ren.autoClear = true
    ren.setRenderTarget(g.rt)
    ren.render(g.root, g.camera)

    ren.setRenderTarget(null)
    ren.outputColorSpace = savedCS
    ren.autoClear = savedAutoClear
    ren.setClearColor(this.savedClear, savedAlpha)
  }

  render() {
    this.renderer.render(this.scene, this.camera)
  }

  private onResize = () => {
    const w = window.innerWidth
    const h = window.innerHeight
    this.camera.left = -w / 2
    this.camera.right = w / 2
    this.camera.top = h / 2
    this.camera.bottom = -h / 2
    this.camera.updateProjectionMatrix()
    this.measureLayout()
  }
}
