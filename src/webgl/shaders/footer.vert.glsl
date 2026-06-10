// Footer flower vertex shader (GLSL3, CPU wind path)
//
// three.js auto-declares position/normal/uv. uv1 (TEXCOORD_1, renamed from
// uv2→uv1 in r152) only gets declared when the material defines USE_UV1 — we
// set that in baseDefines (Relief.ts), since the footer baked atlases sample
// from TEXCOORD_1.

out vec2 vUv;
out vec3 vToEye;
out vec3 vWorldPosition;
out vec3 vNormal;

#ifdef HAS_WIND
uniform mat4 uWindMatrix;
uniform mat4 uMouseWindMatrix;
#endif

void main() {
  vec3 transformedNormal = normal;
  vec4 transformed = vec4(position, 1.0);

#ifdef HAS_WIND
  transformed = uMouseWindMatrix * uWindMatrix * transformed;
  transformedNormal = (uWindMatrix * vec4(transformedNormal, 1.0)).xyz;
#endif

  vec4 worldPosition = modelMatrix * transformed;
  vec4 mvPosition = viewMatrix * worldPosition;
  gl_Position = projectionMatrix * mvPosition;

  vToEye = cameraPosition - worldPosition.xyz;
  vWorldPosition = worldPosition.xyz;
  vNormal = normalize(transformedNormal);
  vUv = UV;
}
