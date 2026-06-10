import {
  ClampToEdgeWrapping,
  HalfFloatType,
  LinearFilter,
  Mesh,
  OrthographicCamera,
  PlaneGeometry,
  RGBAFormat,
  Scene,
  ShaderMaterial,
  Texture,
  Vector2,
  WebGLRenderer,
  WebGLRenderTarget,
} from "three";
import vertexShader from "../shaders/flowmap.vert.glsl";
import fragmentShader from "../shaders/flowmap.frag.glsl";

export interface FlowmapOptions {
  /** Render-target size (longest side). The stamp lives in UV space, so this
   *  mostly controls trail sharpness, not its scale. */
  size?: number;
  falloff?: number; // config.flowmap.falloff  (the shader gets falloff * 0.5)
  alpha?: number; // config.flowmap.alpha
  dissipation?: number; // config.flowmap.dissipation
}

/**
 * Ping-pong velocity flowmap, faithful to the real Immersive Garden home relief.
 * Exposes `texture` (read as tFlow by the relief) plus the eased mouse / velocity
 * vectors the controller feeds every frame.
 */
export class Flowmap {
  public mouse = new Vector2(-1, -1);
  public velocity = new Vector2();
  public mouse2 = new Vector2(-1, -1);
  public velocity2 = new Vector2();

  private renderer: WebGLRenderer;
  private scene = new Scene();
  private camera = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private material: ShaderMaterial;
  private mesh: Mesh;

  private read: WebGLRenderTarget;
  private write: WebGLRenderTarget;
  private width: number;
  private height: number;

  constructor(renderer: WebGLRenderer, opts: FlowmapOptions = {}) {
    this.renderer = renderer;
    const size = opts.size ?? 512;
    this.width = size;
    this.height = size;

    const rtOptions = {
      type: HalfFloatType,
      format: RGBAFormat,
      minFilter: LinearFilter,
      magFilter: LinearFilter,
      wrapS: ClampToEdgeWrapping,
      wrapT: ClampToEdgeWrapping,
      depthBuffer: false,
      stencilBuffer: false,
    } as const;

    this.read = new WebGLRenderTarget(this.width, this.height, rtOptions);
    this.write = new WebGLRenderTarget(this.width, this.height, rtOptions);

    this.material = new ShaderMaterial({
      vertexShader,
      fragmentShader,
      depthTest: false,
      depthWrite: false,
      uniforms: {
        tMap: { value: this.read.texture },
        uFalloff: { value: (opts.falloff ?? 0.38) * 0.5 },
        uAlpha: { value: opts.alpha ?? 1 },
        uDissipation: { value: opts.dissipation ?? 0.953 },
        uDeltaMult: { value: 1 },
        uOffset: { value: 0 },
        uAspect: { value: 1 },
        uMouse: { value: this.mouse },
        uVelocity: { value: this.velocity },
        uMouse2: { value: this.mouse2 },
        uVelocity2: { value: this.velocity2 },
        tNoise: { value: null as Texture | null },
        uTime: { value: 0 },
      },
    });

    this.mesh = new Mesh(new PlaneGeometry(2, 2), this.material);
    this.mesh.frustumCulled = false;
    this.scene.add(this.mesh);
  }

  setNoise(noise: Texture) {
    this.material.uniforms.tNoise.value = noise;
  }

  /** Drives the screen-space circular falloff so the trail stays round. */
  setAspect(aspect: number) {
    this.material.uniforms.uAspect.value = aspect;
  }

  /** The current (most recently written) flow texture, sampled as tFlow.
   *  NOTE: the backing render target alternates every frame, so consumers must
   *  re-read this getter each frame rather than caching the Texture. */
  get texture(): Texture {
    return this.read.texture;
  }

  setFalloff(v: number) {
    this.material.uniforms.uFalloff.value = v * 0.5;
  }
  setDissipation(v: number) {
    this.material.uniforms.uDissipation.value = v;
  }
  setAlpha(v: number) {
    this.material.uniforms.uAlpha.value = v;
  }

  update(time: number, offset = 0) {
    this.material.uniforms.uTime.value = time;
    this.material.uniforms.uOffset.value = offset;
    this.material.uniforms.tMap.value = this.read.texture;

    const prevTarget = this.renderer.getRenderTarget();
    const prevXr = this.renderer.xr.enabled;
    this.renderer.xr.enabled = false;
    this.renderer.setRenderTarget(this.write);
    this.renderer.render(this.scene, this.camera);
    this.renderer.setRenderTarget(prevTarget);
    this.renderer.xr.enabled = prevXr;

    // swap so `read` now holds the freshly written flow
    const tmp = this.read;
    this.read = this.write;
    this.write = tmp;
  }

  dispose() {
    this.read.dispose();
    this.write.dispose();
    this.mesh.geometry.dispose();
    this.material.dispose();
  }
}
