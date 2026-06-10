import {
  Group,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  PerspectiveCamera,
  Quaternion,
  Raycaster,
  RepeatWrapping,
  Scene,
  ShaderMaterial,
  Texture,
  TextureLoader,
  Vector2,
  Vector3,
  WebGLRenderer,
  LinearSRGBColorSpace,
  GLSL3,
  FrontSide,
  type IUniform,
} from "three"
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js"
import { DRACOLoader } from "three/examples/jsm/loaders/DRACOLoader.js"
import { loadLut, type LutData } from "../core/LutLoader"
import {
  pseudoNoise,
  initFlowerWind,
  updateFlowerWind,
  updateCursorWind,
  CursorDeltaBuffer,
  ILLUMINATION_RANGES,
  type FlowerWindState,
} from "./FooterWind"
import footerVert from "../shaders/footer.vert.glsl"
import footerFrag from "../shaders/footer.frag.glsl"

const _identityQuat = new Quaternion()

export class FooterScene {
  readonly scene = new Scene()
  readonly model = new Group()
  camera: PerspectiveCamera | null = null

  progress = 0
  
  private pointerVp = new Vector2(0.5, 0.5)
  private camBaseQuat = new Quaternion()
  private fcx = 0
  private fcy = 0

  private flowers: FlowerWindState[] = []
  private proxy: Mesh | null = null
  private raycaster = new Raycaster()
  
  private cursorPoint = new Vector3()
  private cursorTarget = new Vector3()
  private lastCursorTarget = new Vector3()
  private cursorInit = false
  private deltaBuffer = new CursorDeltaBuffer()
  
  private lightFade = 0
  private bakedLightProgress = 0
  private revealStarted = false
  private waveTriggered = false
  private windDirection = new Vector3(1, 0, 0)
  
  private _ndc = new Vector2()
  private _hits: { point: Vector3 }[] = []

  constructor(private renderer: WebGLRenderer) {
    this.scene.add(this.model)
    this.model.visible = false
  }

  async load(url: string, fluidTexture: Texture | null): Promise<void> {
    const draco = new DRACOLoader()
    draco.setDecoderPath("/draco/")
    const gltfLoader = new GLTFLoader()
    gltfLoader.setDRACOLoader(draco)

    const [lutData, noise, data] = await Promise.all([
      loadLut("/webgl/footer/lut.3dl"),
      new Promise<Texture>((res, rej) => {
        const t = new TextureLoader().load("/webgl/global/noises/rgb-noise.jpg", res, undefined, rej)
        t.wrapS = t.wrapT = RepeatWrapping
      }),
      new Promise<{ scene: Group; cameras: PerspectiveCamera[] }>((res, rej) =>
        gltfLoader.load(url, (d) => res(d as never), undefined, rej),
      ),
    ])

    const baseDefines: Record<string, string> = {
      UV: "uv",
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
        this.proxy = child
        return
      }

      const nameMatch = child.name.match(/^(\w+?)(\d+)_low/)
      if (!nameMatch) return
      const id = `07_${nameMatch[1]}_${nameMatch[2].padStart(2, "0")}`

      const srcMat = child.material as MeshStandardMaterial
      const useAlpha = srcMat.metalnessMap != null
      const range = ILLUMINATION_RANGES[id] || [0, 0.4]

      const geo = child.geometry
      const uv1Attr = geo.getAttribute("uv1")
      if (uv1Attr) geo.setAttribute("uv", uv1Attr)

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
        uCursorPoint: { value: this.cursorPoint },
        uCursorIntensity: { value: 0 },
        uBakedLightIntensity: { value: 0 },
        uXBounds: { value: new Vector2(0, 1) },
        tFluidFlowmap: { value: fluidTexture },
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
      this.flowers.push(initFlowerWind(child))
    })

    this.model.add(data.scene)
    this.model.position.y = 1.0
    this.scene.updateWorldMatrix(true, true)

    let xMin = Infinity, xMax = -Infinity
    for (const flower of this.flowers) {
      const worldCenter = flower.meshCenter.clone().applyMatrix4(flower.mesh.matrixWorld)
      xMin = Math.min(xMin, worldCenter.x)
      xMax = Math.max(xMax, worldCenter.x)
    }
    for (const flower of this.flowers) {
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
    this.camera = cam
    this.camBaseQuat.copy(cam.quaternion)
  }

  onResize() {
    if (this.camera) {
      this.camera.aspect = window.innerWidth / window.innerHeight
      this.camera.updateProjectionMatrix()
    }
    const drawing = this.renderer.getDrawingBufferSize(new Vector2())
    for (const flower of this.flowers) {
      const mat = flower.mesh.material as ShaderMaterial
      ;(mat.uniforms.uResolution.value as Vector2).set(drawing.x, drawing.y)
    }
  }

  setPointerVp(x: number, y: number) {
    this.pointerVp.set(x, y)
  }

  private updateCursor(dt: number) {
    if (!this.proxy || !this.camera) return

    this._ndc.set(this.pointerVp.x * 2 - 1, -(this.pointerVp.y * 2 - 1))
    this.raycaster.setFromCamera(this._ndc, this.camera)

    this._hits.length = 0
    this.proxy.raycast(this.raycaster, this._hits as never)

    if (this._hits.length > 0) {
      this.cursorTarget.copy(this._hits[0].point)
      if (!this.cursorInit) {
        this.cursorInit = true
        this.cursorPoint.copy(this.cursorTarget)
        this.lastCursorTarget.copy(this.cursorTarget)
      }
    }

    const factor = 1 - Math.exp(-2 * dt)
    this.cursorPoint.lerp(this.cursorTarget, factor)

    const dx = this.cursorTarget.x - this.lastCursorTarget.x
    const dy = this.cursorTarget.y - this.lastCursorTarget.y
    const dz = this.cursorTarget.z - this.lastCursorTarget.z
    this.deltaBuffer.push(dx, dy, dz)
    this.lastCursorTarget.copy(this.cursorTarget)
  }

  updateAndRender(dt: number, time: number, fluidTexture: Texture | null) {
    if (this.progress <= 0.001 || !this.camera || !this.model.visible) return

    const cam = this.camera
    this.fcx += ((this.pointerVp.x - 0.5) - this.fcx) * 0.04
    this.fcy += ((this.pointerVp.y - 0.5) - this.fcy) * 0.04
    cam.quaternion.copy(this.camBaseQuat)
    cam.rotateY(-this.fcx * 0.06 + Math.sin(time * 0.18) * 0.006)
    cam.rotateX(-this.fcy * 0.05 + Math.cos(time * 0.13) * 0.004)

    this.updateCursor(dt)

    if (!this.revealStarted && this.progress > 0.1) {
      this.revealStarted = true
    }
    if (this.revealStarted) {
      this.bakedLightProgress = Math.min(0.6, this.bakedLightProgress + (0.6 / 8) * dt)
      this.lightFade = Math.min(1, this.lightFade + dt)
    }

    const windAngle = pseudoNoise(time * 0.03) * Math.PI * 2
    this.windDirection.set(Math.cos(windAngle), 0, Math.sin(windAngle))

    const idQ = _identityQuat
    for (const flower of this.flowers) {
      updateFlowerWind(flower, time, this.windDirection)
      updateCursorWind(flower, this.deltaBuffer, dt)

      const mat = flower.mesh.material as ShaderMaterial
      mat.uniforms.uTime.value = time
      mat.uniforms.uBakedLightIntensity.value = this.bakedLightProgress
      mat.uniforms.uCursorIntensity.value = this.lightFade * 100
      mat.uniforms.uFooterOpacity.value = this.progress
      mat.uniforms.uWindMatrix.value = flower.windMatrix
      mat.uniforms.uMouseWindMatrix.value = flower.mouseWindMatrix
      if (fluidTexture) {
        mat.uniforms.tFluidFlowmap.value = fluidTexture
      }

      if (flower.leanProgress > 0.001) {
        flower.leanProgress = Math.max(0, flower.leanProgress - dt / 8)
        flower.mesh.quaternion.slerpQuaternions(idQ, flower.revealQuaternion, flower.leanProgress)
      }
    }

    if (this.revealStarted && !this.waveTriggered) {
      this.waveTriggered = true
      for (const f of this.flowers) {
        ;(f.mesh.material as ShaderMaterial).uniforms.uWaveTime.value = time
      }
    }

    this.renderer.autoClear = false
    this.renderer.clearDepth()
    this.renderer.render(this.scene, this.camera)
    this.renderer.autoClear = true
  }
}
