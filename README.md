# Immersive Garden — homepage reverse-engineered

A faithful rebuild of the [immersive-g.com](https://immersive-g.com/) homepage hero,
focused on making the **bas-relief + mouse-trail** effect identical to the real site.

```bash
npm install
npm run dev      # http://localhost:5173
npm run build
```

Move the mouse over the page: the flat white plaster reveals a sculpted garden
relief along the cursor's trail, then fades. When idle, an automated random
sweep keeps the surface alive — exactly like the original.

## How the real effect works (reverse-engineered)

The real site is a Nuxt 3 app; the relief lives in the WebGL bundle
(`default.*.js`). It is **not** the canvas-2D radial-gradient trail some clones
use — it is a GPU velocity **flowmap** driving a screen-space relief reveal.

### Pipeline

1. **Flowmap** (`shaders/flowmap.*.glsl`, bundle shader `s034`) — a ping-pong
   `HalfFloat` render target. Each frame the previous flow is read, multiplied by
   a dissipation factor, then a velocity "stamp" is added at the eased mouse
   position. Channels: `rg` = velocity, `b` = velocity magnitude, `a` = presence.

2. **Relief** (`shaders/relief.*.glsl`, bundle shaders `s033` vertex / `s036`
   fragment) — the home `reliefs_high_compressed.glb` (an 18-tile garden panel).
   - **Vertex:** projects each vertex to screen UVs, samples the flowmap,
     `extrude = mix(flow.b, flow.a, 0.5)`, then `pos.z *= mix(0.05, 1.0, extrude)`.
     Flat where there's no trail, full sculpted height where the trail is bright.
   - **Fragment:** a 6-level blend between the two baked textures
     (`tBake1` = baseColor, `tBake2` = emissive) driven by `extrude`, multiplied
     by a tiling plaster texture, a screen gradient, a brightness remap, plus a
     normal-derived chromatic "fluid" tint on the edges.

### Config (lifted verbatim from the bundle `relief.*`)

| group | values |
|-------|--------|
| flowmap | `mouseEase 0.4`, `dissipation 0.953`, `falloff 0.38`, `alpha 1` |
| extrude | `textureStrength 1`, `gradientStrength 0.17` |
| camera | `fov 30`, `distance 15`, `near 5`, `far 20` |
| brightness (desktop) | `factor 0.6`, `offset 0.4` |
| fluidEffect | `amplitude .57`, `hueShift -.52`, `colorRange 2`, `fluidMagnitude .15` … |
| chromaticMask | `fresnelSharpness 35`, `fresnelOpacity .98`, `shadowRange .2–.42` |

## Porting notes (three.js r177)

- `dFdx`/`dFdy` are not available in GLSL ES 1.00 (three's default) under WebGL2,
  so the relief material is compiled as **GLSL3** (`glslVersion: GLSL3`). three's
  GLSL3 prefix provides `texture2D`→`texture` and `varying`→`in`/`out`, but **not**
  `gl_FragColor`, so the shader declares its own output.
- three's GLSL3 prefix already defines `sRGBTransferOETF`; the local copy is
  renamed `srgbEncodeLocal` to avoid a "function already has a body" link error.
- GLB materials are `doubleSided`, so the relief material uses `side: DoubleSide`.
- The relief writes its final color directly (no three output color-space encode),
  matching the original.

## Layout

```
public/
  relief.glb            # = real site's reliefs_high_compressed.glb (draco)
  plaster.jpg           # = webgl/home/plaster.jpg
  rgb-noise.jpg         # tMaskNoise  (= bas-relief/noise)
  mask-noise.png        # flowmap tNoise
  draco/                # local draco decoder
  fonts/                # PSTimes + Helvetica Neue (real site fonts)
src/
  main.ts
  relief/
    Relief.ts           # scene, camera framing, GLB load, pointer + idle sweep
    Flowmap.ts          # ping-pong velocity flowmap
    shaders/*.glsl
```
