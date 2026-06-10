import {
  Box3,
  DoubleSide,
  GLSL3,
  Group,
  Mesh,
  MeshStandardMaterial,
  PerspectiveCamera,
  SRGBColorSpace,
  Scene,
  ShaderMaterial,
  Vector3,
  type IUniform,
} from "three"
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js"
import { DRACOLoader } from "three/examples/jsm/loaders/DRACOLoader.js"
import reliefVert from "../shaders/relief.vert.glsl"
import reliefFrag from "../shaders/relief.frag.glsl"

export const HOME_CONFIG = {
  flowmap: { mouseEase: 0.4, dissipation: 0.953, falloff: 0.38, alpha: 1 },
  extrude: { textureStrength: 1, gradientStrength: 0.17 },
  camera: { fov: 30, distance: 15, near: 5, far: 20, zoom: 1 },
  brightness: { factor: 0.6, offset: 0.4 },
  fovWidthRatio: 1.33,
  fovHeight: 9.995,
  scrollOffset: 0,
}

export class HomeScene {
  readonly scene = new Scene()
  readonly camera: PerspectiveCamera
  readonly model = new Group()

  private framePivot = new Vector3()
  private panTop = 0
  private panBottom = 0
  private modelCenterX = 0
  private scrollPct = 0
  private homeMaxY = 0
  private homeMinY = 0
  private heroLift = 0

  constructor(private sharedUniforms: Record<string, IUniform>) {
    this.camera = new PerspectiveCamera(
      HOME_CONFIG.camera.fov,
      window.innerWidth / window.innerHeight,
      HOME_CONFIG.camera.near,
      HOME_CONFIG.camera.far,
    )
    this.camera.position.set(0, 0, HOME_CONFIG.camera.distance)
    this.camera.lookAt(0, 0, 0)
    
    this.scene.add(this.model)
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
            const tBake1 = src.map ?? null
            const tBake2 = src.emissiveMap ?? null
            if (tBake1) tBake1.colorSpace = SRGBColorSpace
            if (tBake2) tBake2.colorSpace = SRGBColorSpace

            child.material = new ShaderMaterial({
              glslVersion: GLSL3,
              vertexShader: reliefVert,
              fragmentShader: reliefFrag,
              side: DoubleSide,
              uniforms: {
                ...this.sharedUniforms,
                tBake1: { value: tBake1 },
                tBake2: { value: tBake2 },
              },
            })
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

  private frameModel() {
    this.model.position.set(0, 0, 0)
    this.model.updateWorldMatrix(true, true)
    const box = new Box3().setFromObject(this.model)
    const center = box.getCenter(new Vector3())

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

    this.updateCameraFov()
    this.computePan()
    this.applyFraming()
  }

  private visibleHeight() {
    const fovRad = (this.camera.fov * Math.PI) / 180
    return (2 * Math.tan(fovRad / 2) * HOME_CONFIG.camera.distance) / this.camera.zoom
  }

  private computePan() {
    const vh = this.visibleHeight()
    this.panTop = -(this.homeMaxY - vh / 2)
    this.panBottom = -(this.homeMinY + vh / 2)
    this.heroLift = 0
  }

  private updateCameraFov() {
    const dist = HOME_CONFIG.camera.distance
    const aspect = window.innerWidth / window.innerHeight
    const a = (HOME_CONFIG.fovWidthRatio * (HOME_CONFIG.fovHeight - 0.1)) / aspect
    const fov = 2 * Math.atan(a / (2 * dist)) * (180 / Math.PI)
    this.camera.fov = Math.min(HOME_CONFIG.camera.fov, fov)
    this.camera.zoom = HOME_CONFIG.camera.zoom
    this.camera.updateProjectionMatrix()
  }

  private applyFraming() {
    this.model.position.x = -this.modelCenterX
    const t = Math.max(0, Math.min(1, this.scrollPct))
    const heroY = -this.framePivot.y + this.heroLift
    this.model.position.y = heroY + (this.panBottom - heroY) * t
  }

  onResize() {
    this.camera.aspect = window.innerWidth / window.innerHeight
    this.updateCameraFov()
    this.computePan()
    this.applyFraming()
  }

  setScroll(scrollPct: number) {
    this.scrollPct = scrollPct
    this.applyFraming()
  }
}
