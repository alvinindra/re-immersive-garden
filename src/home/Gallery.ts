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

/** max videos decoding at once — keeps Retina FPS smooth */
const MAX_VIDEOS = 3

type Kind = "image" | "video" | "glb"

interface GlbScene {
  root: Scene // wrapper we render (carries the environment)
  model: Object3D // what we rotate
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
}

/**
 * Renders every `[data-media]` DOM placeholder as a WebGL plane synced to its rect,
 * matching the real homepage gallery:
 *   - image  → KTX2 still
 *   - video  → muted/loop VideoTexture, played only while in view (paused otherwise)
 *   - glb    → the model rendered to a render target each frame, tilting with scroll
 * Drawn as a depth-cleared second pass in the relief's renderer.
 */
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

  // reused scratch for save/restore around render-target passes
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

    // studio environment so the metallic GLB models read as gold, not black
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
      }
      this.planes.push(plane)

      el.addEventListener("pointerenter", () => {
        plane.hoverTarget = 1
        this.onCursor(plane.title ? "View project" : null)
      })
      el.addEventListener("pointerleave", () => {
        plane.hoverTarget = 0
        this.onCursor(null)
      })
      el.addEventListener("click", () => {
        if (plane.uri) window.open("https://immersive-g.com/" + plane.uri, "_blank")
      })
    }
  }

  // ---- per-kind loaders ------------------------------------------------------
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
      root.environmentIntensity = 1.8 // lift the metallic models out of shadow

      // reuse the GLB's own framed camera (real site does), else a fallback
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
        samples: 4, // MSAA for clean model edges
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

    const targetVel = clamp(this.rawVel / 2600, -1, 1)
    const targetDeform = Math.min(1, Math.abs(this.rawVel) / 2200)
    this.velNorm = lerp(this.velNorm, targetVel, 0.12)
    this.deform = lerp(this.deform, targetDeform, 0.1)
    this.rawVel *= 0.9

    const loadMargin = h * 1.4
    const videoCandidates: Array<{ p: MediaPlane; dist: number }> = []
    for (const p of this.planes) {
      const r = p.el.getBoundingClientRect()
      const onScreen = r.bottom > -loadMargin && r.top < h + loadMargin
      if (!onScreen) {
        p.mesh.visible = false
        if (p.playing && p.video) {
          p.video.pause()
          p.playing = false
        }
        continue
      }
      if (!p.requested) this.load(p)

      p.mesh.visible = true
      const cx = r.left + r.width / 2 - w / 2
      const cy = -(r.top + r.height / 2) + h / 2
      p.mesh.position.set(cx, cy, 0)
      p.mesh.scale.set(r.width, r.height, 1)

      const u = p.material.uniforms
      u.uPlaneAspect.value = r.width / r.height
      // slow ease → smooth ~1s hover distortion (real site tweens uHover over 2s)
      u.uHover.value = lerp(u.uHover.value, p.hoverTarget, 0.045)
      u.uScrollVel.value = this.velNorm
      u.uDeform.value = this.deform

      const inView = r.top < h * 0.92 && r.bottom > h * 0.08
      if (inView && p.loaded) p.opacityTarget = 1
      u.uOpacity.value = lerp(u.uOpacity.value, p.opacityTarget, 0.08)

      // queue in-view videos; only the nearest few actually decode (see below)
      if (p.kind === "video" && p.video && p.loaded) {
        videoCandidates.push({ p, dist: Math.abs(r.top + r.height / 2 - h / 2) })
      }

      // render glb models to their target, tilting with scroll position
      if (p.kind === "glb" && p.glb) {
        const e = clamp((h / 2 - (r.top + r.height / 2)) / (h / 2), -1, 1)
        this.renderGlb(p.glb, e, dt)
      }
    }

    // cap concurrent video decode (Retina + many mp4s was the lag): play the
    // MAX_VIDEOS nearest the viewport centre, pause the rest.
    videoCandidates.sort((a, b) => a.dist - b.dist)
    for (let i = 0; i < videoCandidates.length; i++) {
      const p = videoCandidates[i].p
      if (i < MAX_VIDEOS) {
        if (!p.playing) p.video!.play().then(() => (p.playing = true)).catch(() => {})
        if (p.videoTex) p.videoTex.needsUpdate = true
      } else if (p.playing) {
        p.video!.pause()
        p.playing = false
      }
    }
  }

  /** Render one GLB sub-scene to its target; rotation.x tracks scroll (×0.45). */
  private renderGlb(g: GlbScene, scrollNorm: number, dt: number) {
    g.model.rotation.x = scrollNorm * 0.45
    g.model.rotation.y += dt * 0.3 // slow idle spin

    const ren = this.renderer
    ren.getClearColor(this.savedClear)
    const savedAlpha = ren.getClearAlpha()
    const savedAutoClear = ren.autoClear
    const savedCS = ren.outputColorSpace

    ren.outputColorSpace = SRGBColorSpace // so the RT stores display-ready colour
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
  }
}
