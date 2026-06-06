# Immersive Garden — homepage reverse-engineered

A faithful rebuild of the [immersive-g.com](https://immersive-g.com/) homepage: the
**bas-relief + mouse-trail** hero, plus the full **smooth-scrolling project gallery**
with per-project hover, the scroll-cursor dots, and the fade-to-black footer relief.

```bash
npm install
npm run dev      # http://localhost:5173
npm run build
```

Move the mouse over the page: the flat white plaster reveals a sculpted garden
relief along the cursor's trail, then fades. When idle, an automated random
sweep keeps the surface alive — exactly like the original.

Scroll down: 18 projects glide past under Lenis momentum scroll, each rendered as
a WebGL plane synced to its DOM slot. Hover a project to inset/dim it with a "View
project" cursor; flick-scroll to trigger fast mode (the 120-dot streak + hidden UI);
reach the bottom and the grey relief fades to the dark footer garden.

## Homepage scroll + gallery + hover (reverse-engineered)

The real homepage is a Lenis virtual scroll over a 13-column grid; each project
media is a `<img data-src…>` slot that the WebGL layer reads via `getBoundingClientRect`
and draws as a textured plane. This rebuild mirrors that pipeline:

- **Smooth scroll** (`src/scroll/SmoothScroll.ts`) — [Lenis](https://github.com/darkroomengineering/lenis)
  with the site's own config (`lerp 0.05`, exponential easing). Emits the real
  `scrollSmooth` payload `{scrollY, speed, scrollPct}` each frame.
- **Media gallery** (`src/home/Gallery.ts`, `shaders/gallery.*.glsl`) — an
  orthographic pixel-space camera; one plane per `[data-media]` slot, synced to its
  DOM rect, cover-fit UV, a quadratic **scroll-velocity bend**, and a hover scale-inset
  + dim + dark border. Drawn as a depth-cleared second pass in the relief's renderer.
  Each slot renders its real media type, like the live site:
    - **video** — the site's actual `.mp4` (mirrored from its CDN to `/public/videos`
      — run `scripts/fetch-videos.sh` once; git-ignored to keep history light) as a
      muted/looping `VideoTexture`, played only while in view (paused on exit).
    - **image** — the site's own `.ktx2` still (the few non-video slots).
    - **glb** — the real Cartier models rendered to a transparent render target
      (`aspect×1024`) each frame via the GLB's own camera, tilting with scroll
      (`rotation.x = scrollNorm × 0.45`) plus a slow idle spin — they float on the
      relief exactly like the original.
- **Hover cursor** (`src/cursor.ts`) — the dot gains a "View project" label over a
  media slot, matching the site's `setCursor`.
- **Scroll cursor** (`src/home/ScrollCursor.ts`) — 3 dots riding the pointer, plus a
  120-dot streak in fast mode (`{number:120, space:2, speed:50}`, lifted from the bundle).
- **Relief on scroll** (`src/relief/Relief.ts`) — the persistent relief panel pans
  vertically with `scrollPct`, so the sculpted creatures change as you scroll (not a
  fixed bird); the chromatic fluid trail reacts to the cursor across every section.
- **Text blocks** (`src/home/dom.ts`) — "Our approach" / "Our mission" reveal their
  words (fade up, staggered) on scroll into view, like the real AnimatedParagraph.
- **Footer** (`src/home/dom.ts`, `Relief.loadFooter`) — at the bottom the home relief
  cross-fades to the dark **`footer_compressed.glb`** garden (its own model, same fluid
  trail), under the centred email + address + links.

Content + grid layout (`src/home/manifest.ts`) is the real `__NUXT__.data.en_home`
payload: 18 projects with their titles, types, legends, and grid `position`/`width`.

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
  webgl/home/reliefs_high_compressed.glb   # hero relief panel (draco)
  webgl/libs/basis/                        # KTX2 / basis transcoder
  webgl/home/glb/                          # the 2 Cartier .glb models
  videos/                                   # the site's real project .mp4s (mirrored)
  ktx2/                                     # project images (the site's own .ktx2)
  plaster.jpg  rgb-noise.jpg  mask-noise.png
  draco/                                    # local draco decoder
  fonts/                                    # PSTimes + Helvetica Neue (real site fonts)
src/
  main.ts                 # wires scroll → relief (+ gallery overlay) → scroll cursor
  scroll/
    SmoothScroll.ts       # Lenis wrapper, emits scrollSmooth {scrollY, speed, scrollPct}
  home/
    manifest.ts           # 18-project content + 13-col grid layout (from __NUXT__)
    dom.ts                # builds the scrollable grid + footer DOM
    Gallery.ts            # WebGL media planes synced to DOM rects
    ScrollCursor.ts       # 3-dot pointer cluster + 120-dot fast-mode streak
    shaders/gallery.*.glsl
  relief/
    Relief.ts             # scene, camera framing, GLB load, pointer + idle sweep,
                          #   gallery overlay pass, grey→dark footer fade
    Flowmap.ts            # ping-pong velocity flowmap
    shaders/*.glsl
```
