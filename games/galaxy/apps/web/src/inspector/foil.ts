// A card finish's light as a shader (DESIGN_SYSTEM §7, GDD §8.1), shared by the 3D inspector and the pro scanner's
// cinematic (plan «escáner pro», part B): a glare that follows `uPointer`, plus each finish's own light. `uFinish` is
// the finish's index in FINISHES; `uMask` says where it may play (the name plate softer); `uActive` how strongly.

export const FOIL_VERTEX = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

// The finish's light: a glare that follows the pointer, plus holo bands, a prismatic spectrum with sparkles, the
// braille dots catching the light, the Static's scan lines and glitch rows, or the rift's violet shards (M8c).
export const FOIL_FRAGMENT = /* glsl */ `
uniform int uFinish;
uniform vec2 uPointer;
uniform float uTime;
uniform float uActive;
uniform sampler2D uMask;
varying vec2 vUv;
vec3 spectrum(float t) { return 0.5 + 0.5 * cos(6.28318 * (t + vec3(0.0, 0.33, 0.67))); }
float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
void main() {
  // The mask says where the finish plays and how strongly (the name plate gets a softer touch).
  float m = texture2D(uMask, vUv).a;
  if (m < 0.05) discard;
  vec2 p = vUv - uPointer;
  vec3 col = vec3(smoothstep(0.6, 0.0, length(p)) * 0.28 * uActive);
  if (uFinish == 1) {
    float band = fract((vUv.x + vUv.y) * 1.8 + uPointer.x * 1.6 + uPointer.y * 0.8);
    float lines = step(0.5, fract((vUv.x - vUv.y) * 110.0));
    col += spectrum(band) * (0.16 + 0.06 * lines) * (0.6 + 0.6 * uActive);
  } else if (uFinish == 2) {
    float ang = atan(p.y, p.x) / 6.28318 + uPointer.x * 0.7;
    col += spectrum(ang) * (0.22 + 0.16 * uActive);
    vec2 cell = vUv * vec2(26.0, 36.4);
    float on = step(0.72, hash(floor(cell)));
    float twinkle = 0.5 + 0.5 * sin(uTime * 2.0 + hash(floor(cell) + 3.1) * 6.28);
    col += vec3(smoothstep(0.16, 0.0, length(fract(cell) - 0.5)) * on * twinkle * 0.9);
  } else if (uFinish == 3) {
    vec2 cell = fract(vUv * vec2(29.4, 41.2)) - 0.5;
    float bump = smoothstep(0.24, 0.1, length(cell));
    vec2 light = normalize(uPointer - vec2(0.5) + vec2(0.0001));
    col += vec3(bump * max(dot(normalize(cell + 0.0001), light), 0.0) * 0.32);
  } else if (uFinish == 4) {
    float scan = step(0.6, fract(vUv.y * 160.0)) * 0.05;
    float row = floor(vUv.y * 48.0);
    float glitch = step(0.94, hash(vec2(row, floor(uTime * 2.5)))) * uActive;
    col += vec3(1.0, 0.18, 0.36) * (scan + glitch * 0.35) + vec3(0.2, 0.9, 1.0) * glitch * 0.15;
  } else if (uFinish == 5) {
    // Fisura (M8c): violet static, and crystal shards that catch the light where the pointer is.
    float s1 = smoothstep(0.012, 0.0, abs(fract(vUv.x * 0.9 + vUv.y * 1.7 + uTime * 0.05) - 0.5));
    float s2 = smoothstep(0.01, 0.0, abs(fract(vUv.x * 1.6 - vUv.y * 0.6 - uTime * 0.04) - 0.5));
    float near = smoothstep(0.7, 0.0, length(p));
    col += vec3(0.55, 0.42, 1.0) * (0.08 + (s1 + s2) * (0.25 + 0.5 * near * uActive));
    col += vec3(0.75, 0.6, 1.0) * step(0.985, hash(floor(vUv * vec2(40.0, 56.0)) + floor(uTime * 1.5))) * 0.4;
  }
  gl_FragColor = vec4(col * m, 1.0);
}`;
