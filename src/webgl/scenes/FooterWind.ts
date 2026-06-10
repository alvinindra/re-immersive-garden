import { Matrix4, Quaternion, Vector3, type Mesh } from "three"

// --- pseudoNoise (reference Jm) ---
export function pseudoNoise(u: number): number {
  return (
    (Math.sin(u) +
      Math.sin(2.2 * u + 5.52) +
      Math.sin(2.9 * u + 0.93) +
      Math.sin(4.6 * u + 8.94)) /
    4
  )
}

// --- sampleWindStrength (reference On) ---
function sampleWindStrength(x: number, S: number): number {
  const D = 1 / (1.1 * S + 0.24) + 0.25
  const base =
    Math.cos(x * Math.PI) *
      Math.cos(x * 3 * Math.PI) *
      Math.cos(x * 5 * Math.PI) *
      Math.cos(x * 7 * Math.PI) +
    Math.sin(x * 25 * Math.PI) * 0.1
  const s = Math.sign(base)
  return (1 / (-Math.abs(base) - 1 / D) + D) * s * S
}

// --- Rodrigues axis-angle rotation matrix (reference Km) ---
const _axis = new Vector3()
function makeAxisAngleMatrix(axis: Vector3, angle: number): number[] {
  const a = _axis.copy(axis).normalize()
  const s = Math.sin(angle),
    c = Math.cos(angle),
    oc = 1 - c
  return [
    oc * a.x * a.x + c,
    oc * a.x * a.y + a.z * s,
    oc * a.z * a.x - a.y * s,
    0,
    oc * a.x * a.y - a.z * s,
    oc * a.y * a.y + c,
    oc * a.y * a.z + a.x * s,
    0,
    oc * a.z * a.x + a.y * s,
    oc * a.y * a.z - a.x * s,
    oc * a.z * a.z + c,
    0,
    0,
    0,
    0,
    1,
  ]
}

// --- Y-axis rotation matrix (reference Zm) ---
function makeYRotationMatrix(angle: number): number[] {
  const c = Math.cos(angle),
    s = Math.sin(angle)
  return [c, 0, s, 0, 0, 1, 0, 0, -s, 0, c, 0, 0, 0, 0, 1]
}

function lerp(a: number, b: number, t: number): number {
  return (1 - t) * a + t * b
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v))
}

function remapClamped(
  v: number,
  inMin: number,
  inMax: number,
  outMin: number,
  outMax: number,
): number {
  const t = clamp((v - inMin) / (inMax - inMin), 0, 1)
  return outMin + (outMax - outMin) * t
}

// --- Wind config (from reference ji.components.wind) ---
const WIND_CONFIG = {
  rotationSpeed: 0.03,
  intensitySpeed: 0.027,
  strength: 0.1,
  amplitudeSharpness: 0.45,
}

// --- Per-flower wind params (ALL 15 share same values) ---
const WIND_PARAMS = {
  swayA: { min: 0, max: 0.48 },
  swayB: { min: 0, max: 0.4 },
  movementRandomization: { min: 0, max: 0.48 },
  suppressPower: { min: 1, max: 1.48 },
  branchNoise: { min: 0, max: 2 },
}

// --- Cursor wind config (from reference ji.components.cursor.wind) ---
const CURSOR_WIND = {
  k: 1,
  damping: 0.99,
  mass: 10,
  strength: 0.7,
  delayMin: 0.1,
  delayMax: 0.266,
  reversePct: 0.15,
}

// --- Flower mass config (from reference ji.components.globalBaked.flowerMass) ---
const MASS_CONFIG = {
  sizeInput: { min: 0.49, max: 3.95 },
  massOutput: { min: 0.2, max: 3.0 },
}

// --- Per-flower illumination ranges (exact from reference config) ---
export const ILLUMINATION_RANGES: Record<string, [number, number]> = {
  "07_at_01": [0.1, 0.52],
  "07_at_02": [0.11, 0.27],
  "07_at_03": [0.0, 0.26],
  "07_at_04": [0.0, 0.19],
  "07_at_05": [0.1, 0.45],
  "07_ff_01": [0.0, 0.45],
  "07_lt_01": [0.0, 0.47],
  "07_nord_01": [0.0, 0.4],
  "07_nord_02": [0.0, 0.42],
  "07_peri_01": [0.06, 0.29],
  "07_peri_02": [0.1, 0.37],
  "07_peri_03": [0.1, 0.39],
  "07_chrys_01": [0.03, 0.27],
  "07_chrys_02": [0.15, 0.74],
  "07_chrys_03": [0.0, 0.39],
}

// --- Spring (reference Ka) ---
export class Spring {
  x = new Vector3()
  prevX = new Vector3()
  force = new Vector3()
  private delta = new Vector3()
  damping: number
  k: number
  mass: number

  constructor(k = 1, damping = 0.99, mass = 1) {
    this.k = k
    this.damping = damping
    this.mass = mass
  }

  update(target: Vector3, dt: number) {
    this.delta.subVectors(target, this.x)
    this.force.x += this.delta.x / this.mass
    this.force.y += this.delta.y / this.mass
    this.force.z += this.delta.z / this.mass
    this.x.x += this.force.x * this.k * dt
    this.x.y += this.force.y * this.k * dt
    this.x.z += this.force.z * this.k * dt
    this.force.multiplyScalar(this.damping)
    this.prevX.copy(this.x)
  }

  reset() {
    this.x.setScalar(0)
    this.force.setScalar(0)
    this.delta.setScalar(0)
  }
}

// --- Cursor delta buffer (reference Xa._cursorDeltaBuffer) ---
export class CursorDeltaBuffer {
  private buf: number[]

  constructor(durationSec = 0.5, fps = 120) {
    this.buf = new Array(Math.floor(durationSec * fps * 3 * 2)).fill(0)
  }

  push(dx: number, dy: number, dz: number) {
    this.buf.shift()
    this.buf.shift()
    this.buf.shift()
    this.buf.push(dx, dy, dz)
  }

  sample(delaySec: number, dt: number, out: Vector3): Vector3 {
    const maxIdx = Math.floor(this.buf.length / 3 - 1)
    const offset = dt > 0 ? Math.floor(delaySec / dt) : 0
    const idx = clamp(maxIdx - offset, 0, maxIdx) * 3
    out.set(this.buf[idx], this.buf[idx + 1], this.buf[idx + 2])
    return out
  }
}

// --- Per-flower state ---
export interface FlowerWindState {
  mesh: Mesh
  seeds: number[]
  windMatrix: Matrix4
  mouseWindMatrix: Matrix4
  spring: Spring
  mass: number
  meshCenter: Vector3
  leanProgress: number
  revealQuaternion: Quaternion
}

function computeFlowerMass(mesh: Mesh): number {
  mesh.geometry.computeBoundingBox()
  const center = mesh.geometry.boundingBox!.getCenter(new Vector3())
  const dist = center.length()
  return remapClamped(
    dist,
    MASS_CONFIG.sizeInput.min,
    MASS_CONFIG.sizeInput.max,
    MASS_CONFIG.massOutput.min,
    MASS_CONFIG.massOutput.max,
  )
}

function createRevealQuaternion(
  mesh: Mesh,
  meshCenter: Vector3,
  intensity: number,
): Quaternion {
  const pivot = new Vector3(0, 0.1, 0)
  const base = new Vector3(0, 0, 0).applyMatrix4(mesh.matrix)
  const center = meshCenter.clone().applyMatrix4(mesh.matrix)

  const dir = new Vector3().subVectors(center, base)
  const leanAmount = dir.length() * intensity
  dir.normalize()

  center.sub(pivot)
  center.multiplyScalar(1 + leanAmount * leanAmount)
  center.add(pivot)

  const newDir = new Vector3().subVectors(center, base).normalize()
  return new Quaternion().setFromUnitVectors(dir, newDir)
}

export function initFlowerWind(mesh: Mesh): FlowerWindState {
  const mass = computeFlowerMass(mesh)
  mesh.geometry.computeBoundingBox()
  const meshCenter = mesh.geometry.boundingBox!.getCenter(new Vector3())
  const revealQuaternion = createRevealQuaternion(mesh, meshCenter, 0.2)

  return {
    mesh,
    seeds: Array.from({ length: 7 }, () => Math.random()),
    windMatrix: new Matrix4(),
    mouseWindMatrix: new Matrix4(),
    spring: new Spring(CURSOR_WIND.k, CURSOR_WIND.damping, CURSOR_WIND.mass * mass),
    mass,
    meshCenter,
    leanProgress: 1.0,
    revealQuaternion,
  }
}

// --- CPU wind matrix update (reference _CPUWind) ---
const _meshDir = new Vector3()
const _windTangent = new Vector3()
const _mixed = new Array(16).fill(0)

export function updateFlowerWind(
  state: FlowerWindState,
  time: number,
  windDirection: Vector3,
): void {
  const cfg = WIND_CONFIG
  const params = WIND_PARAMS

  _meshDir.copy(state.meshCenter).normalize()
  const t = time * cfg.intensitySpeed + 10
  const tDelayed = t - 0.1

  const swayA = lerp(params.swayA.min, params.swayA.max, state.seeds[0])
  const swayB = lerp(params.swayB.min, params.swayB.max, state.seeds[1])
  const moveRand = lerp(
    params.movementRandomization.min,
    params.movementRandomization.max,
    state.seeds[2],
  )
  const suppress = lerp(
    params.suppressPower.min,
    params.suppressPower.max,
    state.seeds[3],
  )
  const branchNoise = lerp(
    params.branchNoise.min,
    params.branchNoise.max,
    pseudoNoise(state.seeds[4] * 1000 + t * 0.8),
  )

  const windPower = sampleWindStrength(t, cfg.amplitudeSharpness) * cfg.strength
  const delayedWindPower =
    sampleWindStrength(tDelayed, cfg.amplitudeSharpness) * cfg.strength
  const facingWind = _meshDir.dot(windDirection)

  let a = swayA * Math.cos(t + branchNoise * moveRand)
  let b = swayB * Math.cos(tDelayed + branchNoise * moveRand)
  const oldA = a
  a = -0.5 * a + suppress * swayA
  b *= windPower
  const clampedFacing = clamp(1 - facingWind, 0, 1)
  a = lerp(oldA * windPower, a * windPower, delayedWindPower * clampedFacing)

  _windTangent.set(-windDirection.z, windDirection.y, windDirection.x)
  const rot1 = makeAxisAngleMatrix(_windTangent, a)
  const rot2 = makeYRotationMatrix(b)
  const absFacing = Math.abs(facingWind)

  for (let i = 0; i < 16; i++) _mixed[i] = 0
  for (let i = 0; i < 12; i++) {
    _mixed[i] = lerp(rot1[i], rot2[i], 1 - absFacing)
  }
  _mixed[15] = 1

  state.windMatrix.fromArray(_mixed)
}

// --- Cursor wind spring update (reference Za.update cursor section) ---
const _springTarget = new Vector3()
const _springDir = new Vector3()
const _negMeshDir = new Vector3()
const _rotAxis = new Vector3()
const _cursorQ = new Quaternion()

export function updateCursorWind(
  state: FlowerWindState,
  deltaBuffer: CursorDeltaBuffer,
  dt: number,
): void {
  const delay = lerp(CURSOR_WIND.delayMin, CURSOR_WIND.delayMax, state.seeds[5])
  const reverse = state.seeds[6] > CURSOR_WIND.reversePct ? 1 : -1

  deltaBuffer.sample(delay, dt, _springTarget)
  _springTarget.multiplyScalar(CURSOR_WIND.strength * reverse)

  state.spring.update(_springTarget, dt)

  const springLen = state.spring.x.length()
  if (springLen < 0.0001) {
    state.mouseWindMatrix.identity()
    return
  }

  _springDir.copy(state.spring.x).normalize()
  _negMeshDir.copy(state.meshCenter).negate().normalize()
  _rotAxis.crossVectors(_springDir, _negMeshDir)

  if (_rotAxis.lengthSq() < 0.0001) {
    state.mouseWindMatrix.identity()
    return
  }

  _cursorQ.setFromAxisAngle(_rotAxis.normalize(), springLen)
  state.mouseWindMatrix.identity()
  state.mouseWindMatrix.makeRotationFromQuaternion(_cursorQ)
}
