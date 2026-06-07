// Media-plane vertex shader — reverse-engineered from the real site's MediaBlock
// WebGL material. The plane is rendered by an orthographic pixel-space camera and
// synced each frame to its DOM placeholder's bounding rect.
//
//  - hover scales the plane slightly inward (the real site insets ~3%),
//  - scroll velocity bends the plane quadratically (the signature "drag" curve),
//  - vUv is passed to the fragment shader for cover-fit sampling.

uniform float uHover;          // 0..1 eased hover state
uniform float uScrollVel;      // signed normalized scroll velocity
uniform float uDeform;         // 0..1 deformation progress (ramps with scroll speed)

varying vec2 vUv;

void main() {
  vUv = uv;

  vec3 pos = position;

  // Real site barely insets the plane on hover (≈3px), so the geometry effectively
  // stays put — the hover treatment lives in the fragment shader. No vertex hover
  // scale here (the old ~4% shrink + edge-widen made the plane "pop").

  vec4 clip = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);

  // Quadratic velocity bend (real site: gl_Position.y += pow(abs(x),2)*y*amount*progress).
  // clip.xy are in [-1,1] for on-screen verts, so the bend is strongest at the edges.
  float amount = 1.6 * uDeform * uScrollVel;
  clip.y += pow(abs(clip.x), 2.0) * clip.y * amount;
  clip.x += pow(abs(clip.y), 2.0) * clip.x * amount * 0.4;

  gl_Position = clip;
}
