// Angles as whole steps of a 4096-step circle, with a sine table built from a Taylor polynomial (only + and *), so
// every JS engine computes the same values. Math.sin/atan2 are "implementation-approximated" and can differ by an ulp
// between browsers, which would desynchronise a replay. Angle 0 points along +x and grows towards +y (screen down).

export const ANGLE_STEPS = 4096;
const QUARTER = ANGLE_STEPS / 4;
const PI = 3.141592653589793;
const TWO_PI = 6.283185307179586;
const HALF_PI = 1.5707963267948966;

/** sin(x) for x in [0, π/2]: Taylor series to x^17 (error < 1e-11 there). */
function sinPoly(x: number): number {
  const x2 = x * x;
  let t = 1;
  // Horner on 1 − x²/3! + x⁴/5! − … with the factorial ratios.
  for (let k = 17; k >= 3; k -= 2) t = 1 - (x2 / (k * (k - 1))) * t;
  return x * t;
}

const QUADRANT = new Float64Array(QUARTER + 1);
for (let i = 0; i <= QUARTER; i++) QUADRANT[i] = sinPoly((i * HALF_PI) / QUARTER);
QUADRANT[0] = 0;
QUADRANT[QUARTER] = 1;

function wrap(a: number): number {
  return ((a % ANGLE_STEPS) + ANGLE_STEPS) % ANGLE_STEPS;
}

export function sinA(a: number): number {
  const i = wrap(Math.round(a));
  if (i <= QUARTER) return QUADRANT[i]!;
  if (i <= 2 * QUARTER) return QUADRANT[2 * QUARTER - i]!;
  if (i <= 3 * QUARTER) return -QUADRANT[i - 2 * QUARTER]!;
  return -QUADRANT[4 * QUARTER - i]!;
}

export function cosA(a: number): number {
  return sinA(a + QUARTER);
}

/** Direction of (dx, dy) as a whole step in [0, 4096); (0, 0) → 0. */
export function angleTo(dx: number, dy: number): number {
  const ax = Math.abs(dx);
  const ay = Math.abs(dy);
  if (ax === 0 && ay === 0) return 0;
  const a = Math.min(ax, ay) / Math.max(ax, ay);
  const s = a * a;
  // atan on [0, 1], max error ≈ 1e-5 rad (≈ 0.007 steps).
  let r = ((-0.0464964749 * s + 0.15931422) * s - 0.327622764) * s * a + a;
  if (ay > ax) r = HALF_PI - r;
  if (dx < 0) r = PI - r;
  if (dy < 0) r = -r;
  return wrap(Math.round((r * ANGLE_STEPS) / TWO_PI));
}

export function degToSteps(deg: number): number {
  return Math.round((deg * ANGLE_STEPS) / 360);
}
