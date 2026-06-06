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

varying vec2 vUv;

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

  vec3 color = uPlaceholder;
  float texA = 1.0;
  if (uHasTexture) {
    vec4 tex = texture2D(uTexture, uv);
    color = tex.rgb;
    texA = tex.a; // glb render-target planes carry real transparency
  }

  // hover dim
  color *= mix(1.0, 0.82, uHover);

  // hover inner border (thin dark frame, ~60% black at the edge — fades in with hover)
  vec2 b = smoothstep(vec2(0.0), vec2(0.012), vUv)
         * smoothstep(vec2(0.0), vec2(0.012), 1.0 - vUv);
  float inside = b.x * b.y;
  color = mix(color, color * 0.4, (1.0 - inside) * uHover);

  gl_FragColor = vec4(color, texA * uOpacity);
}
