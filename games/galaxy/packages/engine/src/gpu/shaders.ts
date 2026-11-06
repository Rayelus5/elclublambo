// GLSL ES 3.00 for compose (ENGINE_PORT §7). Every texture holds one texel per braille dot, row 0 = top row of dots.

export const FULLSCREEN_VS = `#version 300 es
const vec2 P[3] = vec2[3](vec2(-1.0, -1.0), vec2(3.0, -1.0), vec2(-1.0, 3.0));
void main() { gl_Position = vec4(P[gl_VertexID], 0.0, 1.0); }
`;

/** One axis of scipy's gaussian_filter (mode "constant": zero outside), at dot resolution. */
export const BLUR_FS = `#version 300 es
precision highp float;
precision highp int;
uniform sampler2D uSrc;
uniform ivec2 uSize;
uniform ivec2 uDir;
uniform int uRadius;
uniform float uW[64];
out vec4 o;
vec4 at(ivec2 p) {
  if (p.x < 0 || p.y < 0 || p.x >= uSize.x || p.y >= uSize.y) return vec4(0.0);
  return texelFetch(uSrc, p, 0);
}
void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  vec4 acc = at(p) * uW[0];
  for (int j = 1; j < 64; j++) {
    if (j > uRadius) break;
    acc += (at(p + uDir * j) + at(p - uDir * j)) * uW[j];
  }
  o = acc;
}
`;

/** Σ weight_i · blur_i, times the glow strength. */
export const COMBINE_FS = `#version 300 es
precision highp float;
uniform sampler2D uB0;
uniform sampler2D uB1;
uniform sampler2D uB2;
uniform vec3 uWeights;
uniform float uStrength;
out vec4 o;
void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  o = (texelFetch(uB0, p, 0) * uWeights.x + texelFetch(uB1, p, 0) * uWeights.y + texelFetch(uB2, p, 0) * uWeights.z) * uStrength;
}
`;

/**
 * The image, per output pixel. Coordinates are mapped to the 2048-px space of the Python compose (X, Y = pixel
 * centre), so any output size draws the same picture; the 1-px anti-aliasing ramp of each dot is one output pixel.
 */
export const FINAL_FS = `#version 300 es
precision highp float;
precision highp int;
uniform sampler2D uColor;    // dot colour (linear HDR), 0 where off
uniform sampler2D uRadius;   // dot radius in px of the 2048 space, < 0 where off
uniform sampler2D uGlow;     // glow total at dot resolution
uniform ivec2 uDots;         // nx, ny
uniform vec2 uCanvas;        // W, H of the 2048 space
uniform float uStep;
uniform float uOy;
uniform float uScale;        // output px per 2048-space px
uniform float uSize;         // output size in px
uniform vec3 uBackground;
uniform bool uInverted;
uniform bool uGlowOn;
uniform float uVignette;
uniform float uShift;        // chromatic aberration in 2048-space px (0 = off)
uniform int uScanPeriod;     // 0 = off
uniform float uScanDepth;
out vec4 o;

float smooth01(float a, float b, float x) {
  float t = clamp((x - a) / (b - a), 0.0, 1.0);
  return t * t * (3.0 - 2.0 * t);
}

// Keys cubic, a = -0.5 (Pillow BICUBIC).
float cubic(float x) {
  float a = -0.5;
  x = abs(x);
  if (x < 1.0) return ((a + 2.0) * x - (a + 3.0)) * x * x + 1.0;
  if (x < 2.0) return (((x - 5.0) * x + 8.0) * x - 4.0) * a;
  return 0.0;
}

// Pillow's resize taps for one axis: indices [lo, hi) and their normalised weights.
void taps(float center, int size, out int lo, out int hi, out vec4 w) {
  lo = max(int(center - 2.0 + 0.5), 0);
  hi = min(int(center + 2.0 + 0.5), size);
  float sum = 0.0;
  for (int i = 0; i < 4; i++) {
    float k = (lo + i < hi) ? cubic(float(lo + i) - center + 0.5) : 0.0;
    w[i] = k;
    sum += k;
  }
  w /= sum;
}

vec3 glowAt(float X, float Y) {
  int x0; int x1; vec4 wx;
  int y0; int y1; vec4 wy;
  taps(X / uStep, uDots.x, x0, x1, wx);
  taps((Y - uOy) / uStep, uDots.y, y0, y1, wy);
  vec3 acc = vec3(0.0);
  for (int j = 0; j < 4; j++) {
    if (y0 + j >= y1) break;
    vec3 row = vec3(0.0);
    for (int i = 0; i < 4; i++) {
      if (x0 + i >= x1) break;
      row += texelFetch(uGlow, ivec2(x0 + i, y0 + j), 0).rgb * wx[i];
    }
    acc += row * wy[j];
  }
  return max(acc, vec3(0.0));
}

vec3 linAt(float X, float Y) {
  int ix = clamp(int(floor(X / uStep)), 0, uDots.x - 1);
  float iyRaw = floor((Y - uOy) / uStep);
  bool valid = iyRaw >= 0.0 && iyRaw < float(uDots.y);
  int iy = clamp(int(iyRaw), 0, uDots.y - 1);
  float dx = X - (float(ix) + 0.5) * uStep;
  float dy = Y - uOy - (float(iy) + 0.5) * uStep;
  float dist = sqrt(dx * dx + dy * dy);
  float radius = texelFetch(uRadius, ivec2(ix, iy), 0).r;
  // An off dot (radius < 0) covers nothing at any scale.
  float cov = (valid && radius > 0.0) ? clamp((radius - dist) * uScale + 0.5, 0.0, 1.0) : 0.0;
  vec3 color = texelFetch(uColor, ivec2(ix, iy), 0).rgb;
  vec3 lin;
  if (uInverted) {
    lin = uBackground * (1.0 - cov) + clamp(color, 0.0, 1.0) * cov;
    if (uGlowOn) lin -= 0.6 * glowAt(X, Y);
  } else {
    lin = uBackground + color * cov;
    if (uGlowOn) lin += glowAt(X, Y);
  }
  vec2 c = vec2(X, Y) / uCanvas * 2.0 - 1.0;
  return lin * (1.0 - uVignette * smooth01(0.5, 1.35, sqrt(c.x * c.x + c.y * c.y)));
}

vec3 tonemap(vec3 x) {
  float knee = 0.8;
  vec3 over = max(x - knee, 0.0);
  vec3 y = min(x, vec3(knee)) + (1.0 - knee) * (1.0 - exp(-over / (1.0 - knee)));
  float peak = max(x.r, max(x.g, x.b));
  float white = clamp((peak - 1.0) / 4.0, 0.0, 0.85);
  return y + (1.0 - y) * white;
}

vec3 toSrgb(vec3 c) {
  c = clamp(c, 0.0, 1.0);
  vec3 lo = c * 12.92;
  vec3 hi = 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055;
  return mix(hi, lo, vec3(lessThanEqual(c, vec3(0.0031308))));
}

void main() {
  float xOut = gl_FragCoord.x - 0.5;
  float yOut = uSize - gl_FragCoord.y - 0.5;           // image row 0 at the top
  float X = (xOut + 0.5) / uScale;
  float Y = (yOut + 0.5) / uScale;
  vec3 lin = linAt(X, Y);
  if (uShift > 0.0) {
    // CRT misconvergence: red moves right, blue moves left; the uncovered edge columns keep their own values.
    float x = X - 0.5;
    if (x >= uShift) lin.r = linAt(X - uShift, Y).r;
    if (x < uCanvas.x - uShift) lin.b = linAt(X + uShift, Y).b;
  }
  if (uScanPeriod > 0) {
    if (uScale >= 1.0) {
      if (int(floor(Y)) % uScanPeriod == 0) lin *= 1.0 - uScanDepth;
    } else {
      lin *= 1.0 - uScanDepth / float(uScanPeriod);  // the average of the darkened rows under this pixel
    }
  }
  o = vec4(toSrgb(tonemap(max(lin, 0.0))), 1.0);
}
`;
