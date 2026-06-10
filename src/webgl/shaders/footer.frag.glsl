// Footer flower fragment shader (GLSL3)
// Baked light reveal + cursor light + LUT color grading + fluid effect

precision mediump sampler3D;
layout(location = 0) out highp vec4 pc_fragColor;
#define gl_FragColor pc_fragColor

// --- Uniforms ---
uniform sampler2D uMap;
uniform sampler2D uNoise;
uniform sampler2D uLightMap;
#ifdef USE_ALPHA_MAP
uniform sampler2D uAlphaMap;
#endif
uniform vec2 uIlluminationRange;
uniform vec3 uCursorPoint;
uniform float uCursorIntensity;
uniform float uBakedLightIntensity;
uniform vec2 uXBounds;
uniform sampler2D tFluidFlowmap;
uniform float uTime;
uniform float uWaveTime;
uniform float uFooterOpacity;
uniform vec2 uResolution;
#ifdef USE_LUT
uniform highp sampler3D uLut;
uniform float uLutSize;
#endif

// --- Varyings ---
in vec2 vUv;
in vec3 vNormal;
in vec3 vToEye;
in vec3 vWorldPosition;

// --- Utility ---
#define saturate(a) clamp(a, 0.0, 1.0)
float pow2(const in float x) { return x * x; }
float pow4(const in float x) { float x2 = x * x; return x2 * x2; }

// --- FadeAnimation struct ---
struct FadeAnimation {
  float intensity;
  float normalMix;
  vec3 lightDirection;
  vec2 dotRange;
  vec2 timeRange;
};

float quadraticOut(float t) { return -t * (t - 2.0); }
float linear(float t) { return t; }
float quinticOut(float t) { float f = 1.0 - t; return 1.0 - f*f*f*f*f; }

const FadeAnimation FADE_1 = FadeAnimation(1.0, 0.0, vec3(1.0, -1.0, 0.0), vec2(-1.0, 1.0), vec2(0.0, 0.83));
const FadeAnimation FADE_2 = FadeAnimation(1.0, 0.0, vec3(1.0, 1.0, 1.0), vec2(-1.0, -0.06), vec2(0.0, 0.92));
const FadeAnimation FADE_3 = FadeAnimation(0.0, 0.4, vec3(1.0, 0.5, 0.3), vec2(-1.0, 1.0), vec2(0.25, 1.0));

#ifndef PI
#define PI 3.141592653589793
#endif
#ifndef HALF_PI
#define HALF_PI 1.5707963267948966
#endif

// --- Remap functions ---
float cremap(float value, float start1, float stop1, float start2, float stop2) {
  float r = start2 + (stop2 - start2) * ((value - start1) / (stop1 - start1));
  return clamp(r, min(start2, stop2), max(start2, stop2));
}

float remap(float value, float start1, float stop1, float start2, float stop2) {
  return start2 + (stop2 - start2) * ((value - start1) / (stop1 - start1));
}

// --- Fluid effect ---
struct FluidEffectConfig {
  float amplitude;
  float shadowStrength;
  float fluidMagnitude;
  float fluidRedCoef;
  float fluidGreenCoef;
  float fluidBlueCoef;
  float linesSpeed;
  float linesScale;
  float linesStrength;
  float linesWaveLength;
  vec3 baseColor;
  float baseThreshold;
  float hueShift;
  float colorRange;
};

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

vec3 applyFluidEffect(FluidEffectConfig config, vec3 color, vec4 fluid, vec2 uv, float time, float mask, vec3 normal) {
  float rgbVel = (fluid.r + fluid.g) * 0.005 * 4.0;
  vec3 rgbCoef = vec3(config.fluidRedCoef, config.fluidGreenCoef, config.fluidBlueCoef);
  vec3 aberrationColor = vec3(sin(rgbVel * rgbCoef));

  float fluidEdges = smoothstep(0.0, 1.0, fluid.b * config.fluidMagnitude);

  vec2 uvLines = uv + time * 0.01 * config.linesSpeed;
  uvLines.x = uvLines.x * 1000.0 / config.linesScale;
  uvLines.y = sin(uvLines.y * 50.0 * config.linesWaveLength) * 20.0 / config.linesScale;
  float lines = smoothstep(-1.0, 0.5, sin(uvLines.x + uvLines.y));
  lines = mix(1.0, lines, config.linesStrength);

  vec3 normalVector = normal;
  normalVector.z *= config.colorRange;
  normalVector = normalize(normalVector);
  vec3 normalColor = (normalVector + 1.0) / 2.0;
  normalColor = rgb2hsv(normalColor);
  normalColor.r = fract(normalColor.r + config.hueShift);
  normalColor = hsv2rgb(normalColor);
  vec3 effectColor = normalColor;

  color = mix(color, effectColor, mask * fluidEdges * lines * config.amplitude);
  return color;
}

const FluidEffectConfig effectConfig = FluidEffectConfig(
  EFFECT_AMPLITUDE, EFFECT_SHADOW_STRENGTH, EFFECT_FLUID_MAGNITUDE,
  EFFECT_FLUID_RED_COEF, EFFECT_FLUID_GREEN_COEF, EFFECT_FLUID_BLUE_COEF,
  EFFECT_LINES_SPEED, EFFECT_LINES_SCALE, EFFECT_LINES_STRENGTH,
  EFFECT_LINES_WAVE_LENGTH, EFFECT_BASE_COLOR, EFFECT_BASE_THRESHOLD,
  EFFECT_HUE_SHIFT, EFFECT_COLOR_RANGE
);

// --- Light attenuation ---
float getDistanceAttenuation(const in float lightDistance, const in float cutoffDistance, const in float decayExponent) {
  float distanceFalloff = 1.0 / max(pow(lightDistance, decayExponent), 0.01);
  if (cutoffDistance > 0.0) {
    distanceFalloff *= pow2(saturate(1.0 - pow4(lightDistance / cutoffDistance)));
  }
  return distanceFalloff;
}

// --- Cursor light ---
void cursorLight(const vec3 surfaceNormal, const vec3 eyeDirection, const vec3 cursorPos, const vec3 worldPos, inout vec3 outputColor) {
  vec3 cursorDir = normalize(cursorPos - worldPos);
  float attenuation = getDistanceAttenuation(length(cursorPos - worldPos), -1.0, CURSOR_DECAY);

  vec3 reflection = normalize(reflect(-cursorDir, surfaceNormal));
  float direction = max(0.0, dot(normalize(eyeDirection), reflection));
  vec3 specularColor = pow(direction, SHININESS) * CURSOR_COLOR * SPECULAR * 0.001;

  vec3 diffuseColor = max(dot(cursorDir, surfaceNormal), 0.0) * CURSOR_COLOR * DIFFUSE * 0.001;

  outputColor += diffuseColor * uCursorIntensity * attenuation;
  outputColor += specularColor * uCursorIntensity * attenuation;
}

// --- Baked light reveal ---
float fadeFromNormal(vec3 worldPos, vec3 normal, float progress, FadeAnimation animation) {
  vec3 n = normalize(mix(normalize(vWorldPosition - SCENE_CENTER), normal, animation.normalMix));
  float lightDot = dot(n, normalize(animation.lightDirection));
  lightDot = cremap(lightDot, animation.dotRange.x, animation.dotRange.y, -1.0, 1.0);
  return cremap(lightDot, -2.0 + (progress * 3.0), -1.0 + (progress * 3.0), 1.0, 0.0) * animation.intensity;
}

// --- Impulse ---
float impulse(float k, float x) {
  float h = k * x;
  return h * exp(1.0 - h);
}

// --- Main ---
void main() {
  vec2 uv = vUv;
  vec2 screenUv = gl_FragCoord.xy / uResolution;
  vec3 normal = normalize(vNormal);

  // --- Baked light reveal (3 directional sweeps) ---
  float p1 = FADE_EASE_1(cremap(uBakedLightIntensity, FADE_1.timeRange.x, FADE_1.timeRange.y, 0.0, 1.0));
  float n1 = fadeFromNormal(vWorldPosition, normal, p1, FADE_1);
  float p2 = FADE_EASE_2(cremap(uBakedLightIntensity, FADE_2.timeRange.x, FADE_2.timeRange.y, 0.0, 1.0));
  float n2 = fadeFromNormal(vWorldPosition, normal, p2, FADE_2);
  float p3 = FADE_EASE_3(cremap(uBakedLightIntensity, FADE_3.timeRange.x, FADE_3.timeRange.y, 0.0, 1.0));
  float n3 = fadeFromNormal(vWorldPosition, normal, p3, FADE_3);
  float normalBakeFade = max(max(n1, n2), n3);
  float bakedLightIntensity = normalBakeFade;

  // --- Lightmap illumination ---
  float bakedIllumination = texture(uLightMap, vUv).r;
  bakedIllumination = cremap(bakedIllumination, uIlluminationRange.x, uIlluminationRange.y, 0.0, 1.0);

  // --- Baked albedo ---
  vec4 bakedTexture = texture(uMap, vUv);

  // --- Compose ---
  vec3 color = vec3(0.0);
  cursorLight(normal, vToEye, uCursorPoint, vWorldPosition, color);
  color *= bakedIllumination;
  color += bakedTexture.rgb * bakedLightIntensity;

  // --- LUT color grading ---
#ifdef USE_LUT
  float pixelWidth = 1.0 / uLutSize;
  float halfPixelWidth = 0.5 / uLutSize;
  vec3 uvw = vec3(halfPixelWidth) + color * (1.0 - pixelWidth);
  color = texture(uLut, uvw).rgb;
#endif

  // --- Fake fluid effect (polar noise swirl, not Navier-Stokes) ---
  vec2 dir = (screenUv - vec2(0.5, 0.3));
  float mag = length(dir);
  float angle = atan(dir.x, dir.y);
  float compensatedMag = uTime * -0.06 + mag * 10.0;
  angle += (cos(compensatedMag * 0.3 + 4.43298) - sin(compensatedMag * 0.03 + 0.535)) * 2.0;

  vec4 noise = texture(uNoise, vec2(angle * 0.6, compensatedMag + vWorldPosition.x * 2.0) * 0.2);
  float velocityStrength = smoothstep(0.9, 0.2, max(max(noise.r, noise.b), noise.g));
  velocityStrength = pow(velocityStrength, 0.3);
  vec2 fakeVelocity = normalize(noise.rg) * 6.0;
  fakeVelocity *= velocityStrength + 0.1;

  float time = uTime;
  float waveTime = uWaveTime;
  float correctedTime = (time - waveTime) * 0.35;
  vec3 worldPosition = vWorldPosition;
  float timeOffset = length(SCENE_CENTER - worldPosition - vec3(0.0, 0.2, 0.0));
  timeOffset = remap(worldPosition.x, uXBounds.x, uXBounds.y, 1.0, 0.0);
  float wave = impulse(6.0, clamp(correctedTime - timeOffset, 0.0, 1.0));

  vec4 fluid = vec4(fakeVelocity, length(fakeVelocity), 0.0);
  fluid *= wave;
  fluid *= normalBakeFade;

  float fresnelFactor = abs(dot(normalize(vToEye), vNormal));
  float inversefresnelFactor = 1.0 - fresnelFactor;
  fluid *= inversefresnelFactor * 2.0;

  color = applyFluidEffect(effectConfig, color, fluid, uv, uTime, 1.0, normal.zyx);

  color = pow(max(color, vec3(0.0)), vec3(1.0 / 2.2));
  float footerFade = smoothstep(0.5, 1.0, uFooterOpacity);
  gl_FragColor = vec4(color * footerFade, 1.0);

  // --- Alpha discard ---
#ifdef USE_ALPHA_MAP
  float alpha = texture(uAlphaMap, vUv).b;
  gl_FragColor.a = alpha;
#endif

  if (gl_FragColor.a < 0.05) discard;
}
