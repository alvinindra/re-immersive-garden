// Media-plane fragment shader — port of the real site's MediaBlock fragment
// (default bundle, shader `mu`). Cover-fits the project texture into the plane,
// then applies the hover treatment:
//
//   - a mouse-centred noise mask (tMaskNoise, screen-space falloff) drives a strong
//     HSV darkening that SKIPS pixels where the paper-relief trail (tFlow) is high —
//     the white dye wisps keep their brightness against the dimmed image and read
//     as white smoke bleeding across the plane border,
//   - a broad 20% dim plus a ±2% breathing scale while hovered,
//   - the plane insets a few px on hover (vertex) and the UV insets the same amount
//     here, so the content doesn't rescale — a sliver of paper shows around the edge.
//
// The KTX2 textures are sRGB-encoded bytes; with a raw ShaderMaterial three does no
// decode, and the renderer writes values straight to the (sRGB) framebuffer — so we
// output the sampled colour as-is, no colour-space conversion needed.

uniform sampler2D uTexture;
uniform float uTextureAspect;  // texture width / height
uniform float uPlaneAspect;    // plane (placeholder) width / height
uniform float uHover;          // 0..1 eased hover
uniform float uOpacity;        // 0..1 enter fade
uniform bool uHasTexture;
uniform vec3 uPlaceholder;     // colour shown before the texture loads
uniform float uTime;
uniform sampler2D tMaskNoise;  // real site's txt/mask-noise (g channel)
uniform sampler2D tFlow;       // home relief flowmap — the cursor trail the paper reads
uniform vec2 uMouse;           // pointer in screen UV (0..1, y up)
uniform vec2 uResolution;      // drawing-buffer size (device px, matches gl_FragCoord)
uniform vec3 uRandom;          // per-plane random noise offset
uniform vec2 uPlaneSize;       // plane size in CSS px
uniform float uShrinkPx;       // hover inset in px (real: 0.03 scene units)

varying vec2 vUv;

vec3 rgb2hsv(vec3 c) {
  vec4 K = vec4(0.0, -1.0 / 3.0, 2.0 / 3.0, -1.0);
  vec4 p = mix(vec4(c.bg, K.wz), vec4(c.gb, K.xy), step(c.b, c.g));
  vec4 q = mix(vec4(p.xyw, c.r), vec4(c.r, p.yzx), step(p.x, c.r));
  float d = q.x - min(q.w, q.y);
  float e = 1.0e-10;
  return vec3(abs(q.z + (q.w - q.y) / (6.0 * d + e)), d / (q.x + e), q.x);
}
vec3 hsv2rgb(vec3 c) {
  vec4 K = vec4(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
  vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
  return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
}

void main() {
  vec2 uvScreen = gl_FragCoord.xy / uResolution;
  float screenRatio = uResolution.x / uResolution.y;

  // hover noise mask — verbatim from the real shader: drifting tiled noise texture,
  // randomised per plane, gated by a pulsing screen-space falloff around the mouse
  vec2 uvHoverNoise = vUv;
  uvHoverNoise.x *= uPlaneAspect;
  uvHoverNoise *= 0.2;
  uvHoverNoise += uRandom.xy;
  uvHoverNoise += vec2(-0.001, -0.002) * uTime;
  float hoverNoise = texture2D(tMaskNoise, uvHoverNoise).g;

  vec2 mouseDiff = uMouse - uvScreen;
  mouseDiff.x *= screenRatio;
  float mouseFalloff = smoothstep(uHover * 0.7 + sin(uTime) * 0.05, 0.0,
                                  length(mouseDiff));
  float noiseMask = smoothstep(0.3, 0.45, mouseFalloff * uHover * hoverNoise);

  // cover-fit (object-fit: cover) UV remap
  vec2 ratio = vec2(
    min(uPlaneAspect / uTextureAspect, 1.0),
    min(uTextureAspect / uPlaneAspect, 1.0)
  );
  vec2 uv = vec2(
    vUv.x * ratio.x + (1.0 - ratio.x) * 0.5,
    vUv.y * ratio.y + (1.0 - ratio.y) * 0.5
  );

  // hover: inset the UV by the same amount the vertex shader insets the plane
  // (content keeps its scale, edges crop), plus the slow ±2% breathing scale
  vec2 hoverScale = vec2(1.0) - uShrinkPx / uPlaneSize;
  uv -= 0.5;
  uv *= mix(vec2(1.0), hoverScale, uHover);
  uv *= mix(1.0, 1.0 + sin(uTime * 0.2) * 0.02, uHover);
  uv += 0.5;

  vec3 color = uPlaceholder;
  float texA = 1.0;
  if (uHasTexture) {
    vec4 tex = texture2D(uTexture, uv);
    color = tex.rgb;
    texA = tex.a; // glb render-target planes carry real transparency
  }

  // the same trail data the relief background reads (relief.frag: extrude)
  vec4 flow = texture2D(tFlow, uvScreen - 0.01) * 2.0;
  float relief = mix(flow.b, flow.a, 0.5);

  // real: colorHSV.b -= mix(0.0, smoothstep(0.5,0.0,relief*0.5)*0.8, uHover*noiseMask)
  // — the 80% darken skips trail pixels, so dye wisps glow white through the mask.
  // (The real site also subtracts a small tDepth-driven extrude term; we have no
  // depth prepass, and its contribution is minor.)
  vec3 colorHSV = rgb2hsv(color);
  colorHSV.b -= mix(0.0, smoothstep(0.5, 0.0, relief * 0.5) * 0.8, uHover * noiseMask);
  colorHSV.b += noiseMask * 0.06;
  colorHSV.g *= mix(1.0, 0.9, noiseMask);
  color = hsv2rgb(colorHSV);

  // broad hover dim toward 20% black (real: color = mix(color, color*0.8, uHover))
  color = mix(color, mix(color, vec3(0.0), 0.2), uHover);

  gl_FragColor = vec4(color, texA * uOpacity);
}
