import {
  BufferAttribute,
  BufferGeometry,
  ClampToEdgeWrapping,
  Color,
  HalfFloatType,
  LinearFilter,
  Mesh,
  NearestFilter,
  OrthographicCamera,
  RawShaderMaterial,
  RGBAFormat,
  Scene,
  type Texture,
  Vector2,
  Vector3,
  WebGLRenderer,
  WebGLRenderTarget,
} from "three"

// Faithful port of the real site's `Dl` GPU fluid simulation (default bundle).
// This is the texture the home relief samples as `tFluidFlowmap`: an OGL-style
// Navier-Stokes dye field where mouse movement injects velocity + colored dye.
// The relief's chromatic iridescent trail is gated by this field's blue channel
// (dye presence), so without a real sim there is no rainbow trail.

const SIM = 128 // velocity/pressure grid
const DYE = 512 // dye (density) field — what the relief reads
const PRESSURE_ITERATIONS = 3
const DT = 0.016

// real-site config: et.fluidFlowmap
const CFG = {
  densityDissipation: 0.95,
  velocityDissipation: 0.8891,
  pressureDissipation: 0.925,
  velocityRange: { min: 5, max: 78 },
  curlStrength: 0.1,
  radius: 0.7,
}

const remap = (v: number, a: number, b: number, c: number, d: number) =>
  c + (d - c) * ((v - a) / (b - a))
const clamp = (v: number, lo: number, hi: number) =>
  Math.min(hi, Math.max(lo, v))

const VERT = `
precision highp float;
attribute vec2 position;
attribute vec2 uv;
varying vec2 vUv;
varying vec2 vL;
varying vec2 vR;
varying vec2 vT;
varying vec2 vB;
uniform vec2 texelSize;
void main () {
  vUv = uv;
  vL = vUv - vec2(texelSize.x, 0.0);
  vR = vUv + vec2(texelSize.x, 0.0);
  vT = vUv + vec2(0.0, texelSize.y);
  vB = vUv - vec2(0.0, texelSize.y);
  gl_Position = vec4(position, 0.0, 1.0);
}
`

const CLEAR = `
precision mediump float;
precision mediump sampler2D;
varying highp vec2 vUv;
uniform sampler2D uTexture;
uniform float value;
void main () { gl_FragColor = value * texture2D(uTexture, vUv); }
`

const SPLAT = `
precision highp float;
precision highp sampler2D;
varying vec2 vUv;
uniform sampler2D uTarget;
uniform float aspectRatio;
uniform vec3 color;
uniform vec2 point;
uniform float radius;
void main () {
  vec2 p = vUv - point.xy;
  p.x *= aspectRatio;
  vec3 splat = exp(-dot(p, p) / radius) * color;
  vec3 base = texture2D(uTarget, vUv).xyz;
  gl_FragColor = vec4(base + splat, 1.0);
}
`

const ADVECTION = `
precision highp float;
precision highp sampler2D;
varying vec2 vUv;
uniform sampler2D uVelocity;
uniform sampler2D uSource;
uniform vec2 texelSize;
uniform float dt;
uniform float dissipation;
void main () {
  vec2 coord = vUv - dt * texture2D(uVelocity, vUv).xy * texelSize;
  gl_FragColor = dissipation * texture2D(uSource, coord);
  gl_FragColor.a = 1.0;
}
`

const DIVERGENCE = `
precision mediump float;
precision mediump sampler2D;
varying highp vec2 vUv;
varying highp vec2 vL;
varying highp vec2 vR;
varying highp vec2 vT;
varying highp vec2 vB;
uniform sampler2D uVelocity;
void main () {
  float L = texture2D(uVelocity, vL).x;
  float R = texture2D(uVelocity, vR).x;
  float T = texture2D(uVelocity, vT).y;
  float B = texture2D(uVelocity, vB).y;
  vec2 C = texture2D(uVelocity, vUv).xy;
  if (vL.x < 0.0) { L = -C.x; }
  if (vR.x > 1.0) { R = -C.x; }
  if (vT.y > 1.0) { T = -C.y; }
  if (vB.y < 0.0) { B = -C.y; }
  float div = 0.5 * (R - L + T - B);
  gl_FragColor = vec4(div, 0.0, 0.0, 1.0);
}
`

const CURL = `
precision mediump float;
precision mediump sampler2D;
varying highp vec2 vUv;
varying highp vec2 vL;
varying highp vec2 vR;
varying highp vec2 vT;
varying highp vec2 vB;
uniform sampler2D uVelocity;
void main () {
  float L = texture2D(uVelocity, vL).y;
  float R = texture2D(uVelocity, vR).y;
  float T = texture2D(uVelocity, vT).x;
  float B = texture2D(uVelocity, vB).x;
  float vorticity = R - L - T + B;
  gl_FragColor = vec4(0.5 * vorticity, 0.0, 0.0, 1.0);
}
`

const VORTICITY = `
precision highp float;
precision highp sampler2D;
varying vec2 vUv;
varying vec2 vL;
varying vec2 vR;
varying vec2 vT;
varying vec2 vB;
uniform sampler2D uVelocity;
uniform sampler2D uCurl;
uniform float curl;
uniform float dt;
void main () {
  float L = texture2D(uCurl, vL).x;
  float R = texture2D(uCurl, vR).x;
  float T = texture2D(uCurl, vT).x;
  float B = texture2D(uCurl, vB).x;
  float C = texture2D(uCurl, vUv).x;
  vec2 force = 0.5 * vec2(abs(T) - abs(B), abs(R) - abs(L));
  force /= length(force) + 0.0001;
  force *= curl * C;
  force.y *= -1.0;
  vec2 vel = texture2D(uVelocity, vUv).xy;
  gl_FragColor = vec4(vel + force * dt, 0.0, 1.0);
}
`

const PRESSURE = `
precision mediump float;
precision mediump sampler2D;
varying highp vec2 vUv;
varying highp vec2 vL;
varying highp vec2 vR;
varying highp vec2 vT;
varying highp vec2 vB;
uniform sampler2D uPressure;
uniform sampler2D uDivergence;
void main () {
  float L = texture2D(uPressure, vL).x;
  float R = texture2D(uPressure, vR).x;
  float T = texture2D(uPressure, vT).x;
  float B = texture2D(uPressure, vB).x;
  float divergence = texture2D(uDivergence, vUv).x;
  float pressure = (L + R + B + T - divergence) * 0.25;
  gl_FragColor = vec4(pressure, 0.0, 0.0, 1.0);
}
`

const GRADIENT_SUBTRACT = `
precision mediump float;
precision mediump sampler2D;
varying highp vec2 vUv;
varying highp vec2 vL;
varying highp vec2 vR;
varying highp vec2 vT;
varying highp vec2 vB;
uniform sampler2D uPressure;
uniform sampler2D uVelocity;
void main () {
  float L = texture2D(uPressure, vL).x;
  float R = texture2D(uPressure, vR).x;
  float T = texture2D(uPressure, vT).x;
  float B = texture2D(uPressure, vB).x;
  vec2 velocity = texture2D(uVelocity, vUv).xy;
  velocity.xy -= vec2(R - L, T - B);
  gl_FragColor = vec4(velocity, 0.0, 1.0);
}
`

interface DoubleFBO {
  read: WebGLRenderTarget
  write: WebGLRenderTarget
  swap(): void
}

interface Splat {
  x: number
  y: number
  dx: number
  dy: number
}

export class FluidSimulation {
  /** Current dye field — sampled by the relief as tFluidFlowmap. */
  texture: Texture

  private renderer: WebGLRenderer
  private scene = new Scene()
  private camera = new OrthographicCamera(-1, 1, 1, -1, 0, 1)
  private mesh: Mesh
  private texelSize = { value: new Vector2(1 / SIM, 1 / SIM) }

  private vel: DoubleFBO
  private dye: DoubleFBO
  private pressure: DoubleFBO
  private divergence: WebGLRenderTarget
  private curl: WebGLRenderTarget

  private clearMat: RawShaderMaterial
  private splatMat: RawShaderMaterial
  private advMat: RawShaderMaterial
  private divMat: RawShaderMaterial
  private curlMat: RawShaderMaterial
  private vortMat: RawShaderMaterial
  private pressMat: RawShaderMaterial
  private gradMat: RawShaderMaterial

  private pointer = { x: 0, y: 0, init: false }
  private splats: Splat[] = []

  constructor(renderer: WebGLRenderer) {
    this.renderer = renderer

    // 3-component position (z=0) like the real site's `es` geometry — a 2-comp
    // position makes three's computeBoundingSphere read NaN. The vertex shader
    // declares `attribute vec2 position` and only consumes x,y.
    const geo = new BufferGeometry()
    geo.setAttribute(
      "position",
      new BufferAttribute(
        new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]),
        3,
      ),
    )
    geo.setAttribute(
      "uv",
      new BufferAttribute(new Float32Array([0, 0, 2, 0, 0, 2]), 2),
    )
    this.mesh = new Mesh(geo)
    this.mesh.frustumCulled = false
    this.scene.add(this.mesh)

    this.vel = this.doubleFBO(SIM, SIM, LinearFilter)
    this.dye = this.doubleFBO(DYE, DYE, LinearFilter)
    this.pressure = this.doubleFBO(SIM, SIM, NearestFilter)
    this.divergence = this.singleFBO(SIM, SIM, NearestFilter)
    this.curl = this.singleFBO(SIM, SIM, NearestFilter)
    this.texture = this.dye.read.texture

    this.clearMat = this.material(CLEAR, {
      texelSize: this.texelSize,
      uTexture: { value: null },
      value: { value: 1 },
    })
    this.splatMat = this.material(SPLAT, {
      texelSize: this.texelSize,
      uTarget: { value: null },
      aspectRatio: { value: 1 },
      color: { value: new Vector3() },
      point: { value: new Vector2() },
      radius: { value: 1 },
    })
    this.advMat = this.material(ADVECTION, {
      texelSize: this.texelSize,
      uVelocity: { value: null },
      uSource: { value: null },
      dt: { value: DT },
      dissipation: { value: 1 },
    })
    this.divMat = this.material(DIVERGENCE, {
      texelSize: this.texelSize,
      uVelocity: { value: null },
    })
    this.curlMat = this.material(CURL, {
      texelSize: this.texelSize,
      uVelocity: { value: null },
    })
    this.vortMat = this.material(VORTICITY, {
      texelSize: this.texelSize,
      uVelocity: { value: null },
      uCurl: { value: null },
      curl: { value: CFG.curlStrength },
      dt: { value: DT },
    })
    this.pressMat = this.material(PRESSURE, {
      texelSize: this.texelSize,
      uPressure: { value: null },
      uDivergence: { value: null },
    })
    this.gradMat = this.material(GRADIENT_SUBTRACT, {
      texelSize: this.texelSize,
      uPressure: { value: null },
      uVelocity: { value: null },
    })

    this.clearAll()
    this.setupEvents()
  }

  private material(fragmentShader: string, uniforms: Record<string, unknown>) {
    return new RawShaderMaterial({
      vertexShader: VERT,
      fragmentShader,
      uniforms: uniforms as never,
      depthTest: false,
      depthWrite: false,
    })
  }

  private rtOptions(filter: typeof LinearFilter | typeof NearestFilter) {
    return {
      type: HalfFloatType,
      format: RGBAFormat,
      minFilter: filter,
      magFilter: filter,
      wrapS: ClampToEdgeWrapping,
      wrapT: ClampToEdgeWrapping,
      depthBuffer: false,
      stencilBuffer: false,
    } as const
  }

  private singleFBO(
    w: number,
    h: number,
    filter: typeof LinearFilter | typeof NearestFilter,
  ) {
    return new WebGLRenderTarget(w, h, this.rtOptions(filter))
  }

  private doubleFBO(
    w: number,
    h: number,
    filter: typeof LinearFilter | typeof NearestFilter,
  ): DoubleFBO {
    const fbo: DoubleFBO = {
      read: this.singleFBO(w, h, filter),
      write: this.singleFBO(w, h, filter),
      swap() {
        const t = this.read
        this.read = this.write
        this.write = t
      },
    }
    return fbo
  }

  private clearAll() {
    const prevTarget = this.renderer.getRenderTarget()
    const prevAutoClear = this.renderer.autoClear
    // Relief sets a grey clear color; force black so the dye field starts empty
    // (otherwise fluid.b reads non-zero everywhere and the effect shows at rest).
    const prevClear = new Color()
    this.renderer.getClearColor(prevClear)
    const prevAlpha = this.renderer.getClearAlpha()
    this.renderer.setClearColor(0x000000, 0)
    this.renderer.autoClear = true
    const targets = [
      this.vel.read,
      this.vel.write,
      this.dye.read,
      this.dye.write,
      this.pressure.read,
      this.pressure.write,
      this.divergence,
      this.curl,
    ]
    for (const t of targets) {
      this.renderer.setRenderTarget(t)
      this.renderer.clear()
    }
    this.renderer.setRenderTarget(prevTarget)
    this.renderer.autoClear = prevAutoClear
    this.renderer.setClearColor(prevClear, prevAlpha)
  }

  private setupEvents() {
    window.addEventListener("pointermove", this.onPointerMove)
    window.addEventListener("touchmove", this.onTouchMove, { passive: true })
  }

  private onPointerMove = (e: PointerEvent) => {
    const coalesced = (
      e as PointerEvent & { getCoalescedEvents?: () => PointerEvent[] }
    ).getCoalescedEvents?.()
    if (coalesced && coalesced.length > 1) {
      coalesced.forEach(this.onPointerMove)
      return
    }
    // viewport coords (NOT pageX/Y): the relief is a fixed full-screen surface, so
    // pageY's scroll offset would inject the dye off-screen once you scroll — which
    // is why the chromatic trail only showed at the hero.
    this.pushSplat(e.clientX, e.clientY)
  }

  private onTouchMove = (e: TouchEvent) => {
    const t = e.changedTouches[0]
    if (t) this.pushSplat(t.clientX, t.clientY)
  }

  private pushSplat(px: number, py: number) {
    if (!this.pointer.init) {
      this.pointer.init = true
      this.pointer.x = px
      this.pointer.y = py
    }
    let dx = px - this.pointer.x
    let dy = py - this.pointer.y
    const max = 20
    if (dx) dx /= Math.max(1, Math.abs(dx) / max)
    if (dy) dy /= Math.max(1, Math.abs(dy) / max)
    this.pointer.x = px
    this.pointer.y = py
    if (Math.abs(dx) || Math.abs(dy)) {
      this.splats.push({
        x: px / window.innerWidth,
        y: 1 - py / window.innerHeight,
        dx: dx * 5,
        dy: dy * -5,
      })
    }
  }

  private renderPass(material: RawShaderMaterial, target: WebGLRenderTarget) {
    this.mesh.material = material
    this.renderer.setRenderTarget(target)
    this.renderer.render(this.scene, this.camera)
  }

  private applySplat(s: Splat) {
    const m = this.splatMat
    m.uniforms.aspectRatio.value = window.innerWidth / window.innerHeight
    ;(m.uniforms.point.value as Vector2).set(s.x, s.y)
    ;(m.uniforms.color.value as Vector3).set(s.dx, s.dy, 1)
    const mag = Math.sqrt(s.dx * s.dx + s.dy * s.dy)
    const xe = clamp(
      remap(mag, CFG.velocityRange.min, CFG.velocityRange.max, 0, 2),
      0,
      2,
    )
    m.uniforms.radius.value = (CFG.radius / 100) * Math.max(xe, 0)

    m.uniforms.uTarget.value = this.vel.read.texture
    this.renderPass(m, this.vel.write)
    this.vel.swap()

    m.uniforms.uTarget.value = this.dye.read.texture
    this.renderPass(m, this.dye.write)
    this.dye.swap()
  }

  update() {
    const r = this.renderer
    const prevTarget = r.getRenderTarget()
    const prevAutoClear = r.autoClear
    r.autoClear = false

    // inject queued mouse splats
    for (let i = this.splats.length - 1; i >= 0; i--) {
      this.applySplat(this.splats.splice(i, 1)[0])
    }

    // curl
    this.curlMat.uniforms.uVelocity.value = this.vel.read.texture
    this.renderPass(this.curlMat, this.curl)

    // vorticity confinement
    this.vortMat.uniforms.uVelocity.value = this.vel.read.texture
    this.vortMat.uniforms.uCurl.value = this.curl.texture
    this.vortMat.uniforms.curl.value = CFG.curlStrength
    this.renderPass(this.vortMat, this.vel.write)
    this.vel.swap()

    // divergence
    this.divMat.uniforms.uVelocity.value = this.vel.read.texture
    this.renderPass(this.divMat, this.divergence)

    // clear/dissipate pressure
    this.clearMat.uniforms.uTexture.value = this.pressure.read.texture
    this.clearMat.uniforms.value.value = CFG.pressureDissipation
    this.renderPass(this.clearMat, this.pressure.write)
    this.pressure.swap()

    // pressure solve
    this.pressMat.uniforms.uDivergence.value = this.divergence.texture
    for (let i = 0; i < PRESSURE_ITERATIONS; i++) {
      this.pressMat.uniforms.uPressure.value = this.pressure.read.texture
      this.renderPass(this.pressMat, this.pressure.write)
      this.pressure.swap()
    }

    // subtract pressure gradient from velocity
    this.gradMat.uniforms.uPressure.value = this.pressure.read.texture
    this.gradMat.uniforms.uVelocity.value = this.vel.read.texture
    this.renderPass(this.gradMat, this.vel.write)
    this.vel.swap()

    // advect velocity
    this.advMat.uniforms.uVelocity.value = this.vel.read.texture
    this.advMat.uniforms.uSource.value = this.vel.read.texture
    this.advMat.uniforms.dissipation.value = CFG.velocityDissipation
    this.renderPass(this.advMat, this.vel.write)
    this.vel.swap()

    // advect dye (this is the field the relief reads)
    this.advMat.uniforms.uVelocity.value = this.vel.read.texture
    this.advMat.uniforms.uSource.value = this.dye.read.texture
    this.advMat.uniforms.dissipation.value = CFG.densityDissipation
    this.renderPass(this.advMat, this.dye.write)
    this.dye.swap()

    this.texture = this.dye.read.texture

    r.setRenderTarget(prevTarget)
    r.autoClear = prevAutoClear
  }

  dispose() {
    window.removeEventListener("pointermove", this.onPointerMove)
    window.removeEventListener("touchmove", this.onTouchMove)
    this.vel.read.dispose()
    this.vel.write.dispose()
    this.dye.read.dispose()
    this.dye.write.dispose()
    this.pressure.read.dispose()
    this.pressure.write.dispose()
    this.divergence.dispose()
    this.curl.dispose()
    this.mesh.geometry.dispose()
  }
}
