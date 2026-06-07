import {
  ClampToEdgeWrapping,
  Data3DTexture,
  LinearFilter,
  RGBAFormat,
  UnsignedByteType,
} from "three"

export interface LutData {
  texture3D: Data3DTexture
  size: number
}

export async function loadLut(url: string): Promise<LutData> {
  const res = await fetch(url)
  const text = await res.text()

  const clean = text
    .replace(/^#.*?(\n|\r)/gm, "")
    .replace(/^\s*?(\n|\r)/gm, "")
    .trim()

  const lines = clean.split(/[\n\r]+/g)

  const size = lines[0].trim().split(/\s+/g).map(Number).length

  const total = size * size * size
  const data = new Array(total * 4)
  let maxVal = 0

  for (let i = 1, len = lines.length; i < len; i++) {
    const parts = lines[i].trim().split(/\s/g)
    const r = parseFloat(parts[0])
    const g = parseFloat(parts[1])
    const b = parseFloat(parts[2])
    maxVal = Math.max(maxVal, r, g, b)

    const srcIdx = i - 1
    const z = srcIdx % size
    const y = Math.floor(srcIdx / size) % size
    const x = Math.floor(srcIdx / (size * size)) % size
    const dstIdx = z * size * size + y * size + x

    data[4 * dstIdx + 0] = r
    data[4 * dstIdx + 1] = g
    data[4 * dstIdx + 2] = b
    data[4 * dstIdx + 3] = 1
  }

  const bits = Math.ceil(Math.log2(maxVal))
  const domainMax = Math.pow(2, bits)

  for (let i = 0, len = data.length; i < len; i += 4) {
    data[i + 0] = (255 * data[i + 0]) / domainMax
    data[i + 1] = (255 * data[i + 1]) / domainMax
    data[i + 2] = (255 * data[i + 2]) / domainMax
  }

  const bytes = new Uint8Array(data)

  const texture3D = new Data3DTexture(bytes, size, size, size)
  texture3D.format = RGBAFormat
  texture3D.type = UnsignedByteType
  texture3D.magFilter = LinearFilter
  texture3D.minFilter = LinearFilter
  texture3D.wrapS = ClampToEdgeWrapping
  texture3D.wrapT = ClampToEdgeWrapping
  texture3D.wrapR = ClampToEdgeWrapping
  texture3D.generateMipmaps = false
  texture3D.needsUpdate = true

  return { texture3D, size }
}
