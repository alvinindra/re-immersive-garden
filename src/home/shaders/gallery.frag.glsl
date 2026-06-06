// Media-plane fragment shader. Cover-fits the project texture into the plane (the
// DOM placeholder's aspect varies), then applies the hover treatment from the real
// site: a slight overall dim plus a thin dark inner border, both driven by uHover.
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
uniform vec2 uMouseLocal;      // mouse in plane local UV (0..1, 0.5/0.5 = centre)

varying vec2 vUv;

// hash-based 2D noise for the hover stipple mask (matches the real site's
// tMaskNoise-driven hoverNoise — different source, same intent).
float hash21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}
float noise2(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  float a = hash21(i);
  float b = hash21(i + vec2(1.0, 0.0));
  float c = hash21(i + vec2(0.0, 1.0));
  float d = hash21(i + vec2(1.0, 1.0));
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(a, b, u.x) + (c - a) * u.y * (1.0 - u.x) + (d - b) * u.x * u.y;
}

void main() {
  // cover-fit (object-fit: cover) UV remap
  vec2 ratio = vec2(
    min(uPlaneAspect / uTextureAspect, 1.0),
    min(uTextureAspect / uPlaneAspect, 1.0)
  );
  vec2 uv = vec2(
    vUv.x * ratio.x + (1.0 - ratio.x) * 0.5,
    vUv.y * ratio.y + (1.0 - ratio.y) * 0.5
  );

  // hover distortion: smoothly zoom the texture in toward the centre (~8%)
  uv = (uv - 0.5) * (1.0 - 0.08 * uHover) + 0.5;
  // subtle breathing (real site: sin(uTime*0.2)*0.02 mixed with uHover)
  uv = (uv - 0.5) * mix(1.0, 1.0 + sin(uTime * 0.2) * 0.02, uHover) + 0.5;

  vec3 color = uPlaceholder;
  float texA = 1.0;
  if (uHasTexture) {
    vec4 tex = texture2D(uTexture, uv);
    color = tex.rgb;
    texA = tex.a; // glb render-target planes carry real transparency
  }

  // hover noise mask centred on the mouse — drives darken stipple + brightness
  // boost in localised splotches. Real site: tMaskNoise + mouseFalloff smoothstep.
  vec2 mouseDiff = uMouseLocal - vUv;
  float mouseFalloff = smoothstep(uHover * 0.7 + sin(uTime) * 0.04, 0.0,
                                  length(mouseDiff));
  float hoverNoise = noise2(vUv * 5.0 + uTime * 0.05);
  float noiseMask = smoothstep(0.3, 0.55,
                               mouseFalloff * uHover * hoverNoise);

  // hover dim (subtle, broad)
  color *= mix(1.0, 0.86, uHover);
  // localised darken + slight saturation drop where noiseMask hits
  color = mix(color, color * 0.65, noiseMask);

  // hover inner border (thin dark frame, ~60% black at edge — fades with hover)
  vec2 b = smoothstep(vec2(0.0), vec2(0.012), vUv)
         * smoothstep(vec2(0.0), vec2(0.012), 1.0 - vUv);
  float inside = b.x * b.y;
  color = mix(color, color * 0.4, (1.0 - inside) * uHover);

  gl_FragColor = vec4(color, texA * uOpacity);
}
