import { FINISHES, type PulledGalaxy } from '@galaxy/shared';
import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  Color,
  Group,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  type Material,
  Mesh,
  MeshBasicMaterial,
  NormalBlending,
  PerspectiveCamera,
  PlaneGeometry,
  Points,
  Scene,
  ShaderMaterial,
  SRGBColorSpace,
  type Texture,
  Vector2,
  Vector3,
  WebGLRenderer,
} from 'three';
import { FOIL_FRAGMENT, FOIL_VERTEX } from '../../inspector/foil';
import { drawMask } from '../../inspector/textures';
import { GUION, type Script, type TrailTint } from './script';
import { GRID, RING, type Rig, ringSpot, SINGLE } from './timeline';

// The pro scanner's 3D stage (plan «escáner pro», part B), in its own chunk with three.js. It draws what the rig says,
// frame by frame, and decides nothing: a warp tunnel of stars that stretch into streaks (one instanced draw), a nebula
// tinted by the trail, the point of light the jump is born from, shooting stars falling onto the cards' places, a
// shockwave, the legendary's god rays, the grid dimmed behind a close-up, and the cards — a face (frame, plate and the
// engine's galaxy, faces.ts), one shared back, a rim that lights with the tier, and the finish's light (the inspector's
// shader). One WebGL context, no post-processing, nothing allocated per frame. Units: a card is 5 × 7 at scale 1.
// A fusion (plan «fusión pro») draws, instead of the jump, its galaxies going in: face up round a core of light (the
// point the jump is born from, tinted as the trail), each with a streak behind it as the ring turns, sinking into the
// core one by one.

export interface SceneCard {
  galaxy: PulledGalaxy;
  front: HTMLCanvasElement;
}

export interface ProSceneOptions {
  script: Script;
  cards: readonly SceneCard[];
  /** A fusion's galaxies going in, in the order they sit round the ring. */
  inputs?: readonly SceneCard[];
  back: HTMLCanvasElement;
  /** Each tint as a CSS hex (from the design tokens, so the colour-blind palettes apply). */
  colors: Record<TrailTint, string>;
  reduced: boolean;
  onLost?: () => void;
}

export interface ProScene {
  render(rig: Rig, t: number, dt: number): void;
  resize(width: number, height: number): void;
  /** A card's face once its galaxy image is ready. */
  setFront(slot: number, front: HTMLCanvasElement): void;
  /** The same for one of a fusion's galaxies going in. */
  setInputFront(index: number, front: HTMLCanvasElement): void;
  /** Average frame time measured so far and whether the scene dropped to its light version. */
  readonly quality: 'high' | 'low';
  dispose(): void;
}

const FOV = 42;
const DEPTH = 200;

function softDot(size = 128): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.18, 'rgba(255,255,255,.75)');
  g.addColorStop(0.5, 'rgba(255,255,255,.18)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  return c;
}

/** A shooting star's tail: transparent at the back, white-hot at the head (+x), soft across. */
function streakTexture(): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 32;
  const ctx = c.getContext('2d')!;
  const along = ctx.createLinearGradient(0, 0, 256, 0);
  along.addColorStop(0, 'rgba(255,255,255,0)');
  along.addColorStop(0.7, 'rgba(255,255,255,.55)');
  along.addColorStop(1, 'rgba(255,255,255,1)');
  ctx.fillStyle = along;
  ctx.fillRect(0, 0, 256, 32);
  ctx.globalCompositeOperation = 'destination-in';
  const across = ctx.createLinearGradient(0, 0, 0, 32);
  across.addColorStop(0, 'rgba(0,0,0,0)');
  across.addColorStop(0.5, 'rgba(0,0,0,1)');
  across.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = across;
  ctx.fillRect(0, 0, 256, 32);
  return c;
}

/** A soft halo shaped like the card (its rim light), white so a colour tints it. */
function cardHalo(): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = 330;
  c.height = 450;
  const ctx = c.getContext('2d')!;
  ctx.filter = 'blur(14px)';
  ctx.fillStyle = '#fff';
  ctx.beginPath();
  ctx.roundRect(40, 40, 250, 370, 26);
  ctx.fill();
  ctx.filter = 'none';
  ctx.globalCompositeOperation = 'destination-out';
  ctx.beginPath();
  ctx.roundRect(52, 52, 226, 346, 20);
  ctx.fill();
  return c;
}

/** Seeded value noise in a 256² texture (two octaves): the nebula's clouds, scrolled by the shader. */
function nebulaNoise(seed: number): HTMLCanvasElement {
  const size = 256;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d')!;
  const img = ctx.createImageData(size, size);
  let s = seed || 1;
  const rand = () => (s = (s * 48271) % 2147483647) / 2147483647;
  const grid = (n: number) => Array.from({ length: n * n }, rand);
  const octaves = [
    { n: 8, w: 0.6, g: grid(8) },
    { n: 16, w: 0.3, g: grid(16) },
    { n: 32, w: 0.1, g: grid(32) },
  ];
  const smooth = (x: number) => x * x * (3 - 2 * x);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let v = 0;
      for (const o of octaves) {
        const fx = (x / size) * o.n;
        const fy = (y / size) * o.n;
        const x0 = Math.floor(fx);
        const y0 = Math.floor(fy);
        const at = (i: number, j: number) => o.g[((j % o.n) * o.n + (i % o.n)) % o.g.length]!;
        const sx = smooth(fx - x0);
        const sy = smooth(fy - y0);
        const top = at(x0, y0) * (1 - sx) + at(x0 + 1, y0) * sx;
        const bottom = at(x0, y0 + 1) * (1 - sx) + at(x0 + 1, y0 + 1) * sx;
        v += (top * (1 - sy) + bottom * sy) * o.w;
      }
      const k = (y * size + x) * 4;
      img.data[k] = img.data[k + 1] = img.data[k + 2] = Math.round(Math.min(1, v) * 255);
      img.data[k + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

const STAR_VERTEX = /* glsl */ `
attribute vec2 corner;
attribute vec3 aStar;
attribute float aSeed;
uniform float uTravel;
uniform float uWarp;
uniform float uLen;
uniform float uSize;
uniform vec2 uRes;
varying float vAlpha;
varying vec2 vCorner;
varying float vSeed;
void main() {
  float z = mod(aStar.z + uTravel, ${DEPTH.toFixed(1)}) - ${(DEPTH - 10).toFixed(1)};
  vec4 h = projectionMatrix * modelViewMatrix * vec4(aStar.xy, z, 1.0);
  vec4 t = projectionMatrix * modelViewMatrix * vec4(aStar.xy, z - 0.02 - uLen * uWarp, 1.0);
  vec2 hp = h.xy / h.w * 0.5 * uRes;
  vec2 tp = t.xy / t.w * 0.5 * uRes;
  vec2 d = hp - tp;
  float len = length(d);
  vec2 u = len > 0.001 ? d / len : vec2(0.0, 1.0);
  vec2 n = vec2(-u.y, u.x);
  float w = uSize * (0.6 + aSeed) * clamp(18.0 / max(h.w, 0.5), 0.35, 3.0);
  vec2 p = mix(tp - u * w, hp + u * w, corner.x) + n * corner.y * w;
  float cw = mix(t.w, h.w, corner.x);
  gl_Position = vec4(p / (0.5 * uRes) * cw, mix(t.z, h.z, corner.x), cw);
  vAlpha = smoothstep(${(-DEPTH + 10).toFixed(1)}, ${(-DEPTH + 70).toFixed(1)}, z) * smoothstep(11.5, 7.0, z);
  vCorner = corner;
  vSeed = aSeed;
}`;

const STAR_FRAGMENT = /* glsl */ `
uniform vec3 uTint;
uniform float uTintAmount;
uniform float uWarp;
uniform float uTime;
varying float vAlpha;
varying vec2 vCorner;
varying float vSeed;
void main() {
  float across = 1.0 - abs(vCorner.y);
  float edge = smoothstep(0.0, 0.6, across);
  // Streaks are brighter at the head; still stars twinkle a little.
  float along = mix(1.0, 0.25 + 0.75 * vCorner.x, uWarp);
  float twinkle = mix(0.75 + 0.25 * sin(uTime * (1.5 + vSeed * 3.0) + vSeed * 40.0), 1.0, uWarp);
  vec3 col = mix(vec3(0.86, 0.9, 1.0), uTint, uTintAmount * (0.55 + 0.45 * uWarp));
  gl_FragColor = vec4(col * edge * along * twinkle * vAlpha, 1.0);
}`;

const NEBULA_FRAGMENT = /* glsl */ `
uniform sampler2D uNoise;
uniform float uTravel;
uniform float uAmount;
uniform vec3 uTint;
uniform vec3 uDeep;
varying vec2 vUv;
void main() {
  vec2 c = vUv - 0.5;
  float a = texture2D(uNoise, vUv * 1.3 + vec2(0.0, uTravel * 0.0009)).r;
  float b = texture2D(uNoise, vUv * 2.6 - vec2(uTravel * 0.0005, 0.0)).r;
  float n = pow(clamp(a * 0.65 + b * 0.5 - 0.28, 0.0, 1.0), 1.8);
  float vignette = smoothstep(0.75, 0.15, length(c));
  vec3 col = mix(uDeep, uTint, 0.55 + 0.45 * b) * n * vignette * uAmount * 1.7;
  gl_FragColor = vec4(col, 1.0);
}`;

const SIMPLE_VERTEX = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const SPARK_VERTEX = /* glsl */ `
attribute vec3 aDir;
attribute float aSpeed;
attribute float aSize;
uniform float uProgress;
uniform vec3 uCenter;
uniform float uReach;
uniform float uPixel;
varying float vFade;
void main() {
  float k = 1.0 - pow(1.0 - uProgress, 3.0);
  vec3 p = uCenter + aDir * aSpeed * uReach * k + vec3(0.0, -1.4 * uProgress * uProgress, 0.0);
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  vFade = pow(max(0.0, 1.0 - uProgress), 1.5);
  gl_PointSize = aSize * uPixel * (1.0 - 0.5 * uProgress) * 64.0 / max(1.0, -mv.z);
}`;

const SPARK_FRAGMENT = /* glsl */ `
uniform vec3 uColor;
varying float vFade;
void main() {
  float d = length(gl_PointCoord - 0.5) * 2.0;
  float a = smoothstep(1.0, 0.0, d);
  gl_FragColor = vec4(mix(uColor, vec3(1.0), a * 0.6) * a * vFade, 1.0);
}`;

const RING_FRAGMENT = /* glsl */ `
uniform vec3 uColor;
uniform float uProgress;
uniform float uWidth;
varying vec2 vUv;
void main() {
  float r = length(vUv - 0.5) * 2.0;
  float ring = smoothstep(uWidth, 0.0, abs(r - 0.94)) * (1.0 - uProgress);
  float fill = smoothstep(1.0, 0.0, r) * 0.18 * (1.0 - uProgress) * (1.0 - uProgress);
  gl_FragColor = vec4(uColor * (ring + fill), 1.0);
}`;

const RAYS_FRAGMENT = /* glsl */ `
uniform vec3 uColor;
uniform float uAmount;
uniform float uTime;
varying vec2 vUv;
void main() {
  vec2 c = vUv - 0.5;
  float r = length(c) * 2.0;
  float ang = atan(c.y, c.x);
  float rays = pow(abs(sin(ang * 9.0 + uTime * 0.35)), 10.0) + 0.6 * pow(abs(sin(ang * 5.0 - uTime * 0.22)), 14.0);
  float fall = smoothstep(1.0, 0.1, r);
  float core = smoothstep(0.45, 0.0, r) * 0.6;
  gl_FragColor = vec4(uColor * (rays * fall * 0.75 + core) * uAmount, 1.0);
}`;

const FOIL_WITH_OPACITY = FOIL_FRAGMENT.replace('void main() {', 'uniform float uOpacity;\nvoid main() {').replace('gl_FragColor = vec4(col * m, 1.0);', 'gl_FragColor = vec4(col * m * uOpacity, 1.0);');

export function createProScene(canvas: HTMLCanvasElement, opts: ProSceneOptions): ProScene {
  const renderer = new WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: 'high-performance' });
  let dpr = Math.min(globalThis.devicePixelRatio || 1, 1.5);
  renderer.setPixelRatio(dpr);
  renderer.setClearColor(0x02030a, 1);
  renderer.outputColorSpace = SRGBColorSpace;

  const scene = new Scene();
  const camera = new PerspectiveCamera(FOV, 16 / 9, 0.1, 400);
  let baseDistance = 10.7;
  const textures: Texture[] = [];
  const materials: Material[] = [];
  const geometries: (PlaneGeometry | InstancedBufferGeometry | BufferGeometry)[] = [];
  const tex = (c: HTMLCanvasElement) => {
    const t = new CanvasTexture(c);
    t.colorSpace = SRGBColorSpace;
    textures.push(t);
    return t;
  };
  const color = (k: TrailTint) => new Color(opts.colors[k]);
  const plane = (w: number, h: number) => {
    const g = new PlaneGeometry(w, h);
    geometries.push(g);
    return g;
  };
  const mat = <M extends Material>(m: M) => {
    materials.push(m);
    return m;
  };
  const shader = (fragmentShader: string, uniforms: Record<string, { value: unknown }>, vertexShader = SIMPLE_VERTEX) =>
    mat(new ShaderMaterial({ vertexShader, fragmentShader, uniforms, blending: AdditiveBlending, transparent: true, depthWrite: false, depthTest: false }));

  const s = opts.script;
  const tints: [Color, Color, Color] = [color('ice'), color(s.trail.shown), color(s.trail.max)];
  const trailColor = new Color();
  const tintOf = (trail: number, out: Color) => {
    if (trail <= 1) out.copy(tints[0]).lerp(tints[1], Math.max(0, trail));
    else out.copy(tints[1]).lerp(tints[2], Math.min(1, trail - 1));
    return out;
  };

  // The nebula, far behind.
  const nebulaUniforms = { uNoise: { value: tex(nebulaNoise(Number(BigInt(opts.cards[0]?.galaxy.seed ?? '7') % 2147483647n))) }, uTravel: { value: 0 }, uAmount: { value: 0 }, uTint: { value: new Color() }, uDeep: { value: new Color('#1b1446') } };
  const nebula = new Mesh(plane(260, 150), shader(NEBULA_FRAGMENT, nebulaUniforms));
  nebula.position.z = -80;
  nebula.renderOrder = 0;
  scene.add(nebula);

  // The stars: one instanced draw, each a quad stretched from its tail to its head in the vertex shader.
  let starCount = opts.reduced ? 1400 : 3000;
  const starGeo = new InstancedBufferGeometry();
  geometries.push(starGeo);
  starGeo.setAttribute('corner', new BufferAttribute(new Float32Array([0, -1, 1, -1, 1, 1, 0, 1]), 2));
  starGeo.setIndex([0, 1, 2, 0, 2, 3]);
  const stars = new Float32Array(starCount * 3);
  const seeds = new Float32Array(starCount);
  let r = 7;
  const rand = () => (r = (r * 48271) % 2147483647) / 2147483647;
  for (let i = 0; i < starCount; i++) {
    const radius = 2.2 + Math.pow(rand(), 0.75) * 46;
    const angle = rand() * Math.PI * 2;
    stars[i * 3] = Math.cos(angle) * radius;
    stars[i * 3 + 1] = Math.sin(angle) * radius * 0.62;
    stars[i * 3 + 2] = rand() * DEPTH;
    seeds[i] = rand();
  }
  starGeo.setAttribute('aStar', new InstancedBufferAttribute(stars, 3));
  starGeo.setAttribute('aSeed', new InstancedBufferAttribute(seeds, 1));
  starGeo.instanceCount = starCount;
  const starUniforms = { uTravel: { value: 0 }, uWarp: { value: 0 }, uLen: { value: 26 }, uSize: { value: 1.1 }, uRes: { value: new Vector2(1280, 720) }, uTint: { value: new Color() }, uTintAmount: { value: 0 }, uTime: { value: 0 } };
  const starMesh = new Mesh(starGeo, shader(STAR_FRAGMENT, starUniforms, STAR_VERTEX));
  starMesh.frustumCulled = false;
  starMesh.renderOrder = 1;
  scene.add(starMesh);

  const dot = tex(softDot());
  // The point of light, and its anamorphic streak (a lens flare).
  const ignite = new Mesh(plane(1, 1), mat(new MeshBasicMaterial({ map: dot, blending: AdditiveBlending, transparent: true, depthWrite: false, depthTest: false, color: color('ice') })));
  const flare = new Mesh(plane(1, 1), mat(new MeshBasicMaterial({ map: dot, blending: AdditiveBlending, transparent: true, depthWrite: false, depthTest: false, color: color('ice') })));
  ignite.position.z = flare.position.z = 2;
  ignite.renderOrder = flare.renderOrder = 2;
  scene.add(ignite, flare);

  // Where the cards land (and the shooting stars fall).
  const ten = s.count > 1;
  const landing = (slot: number) => (ten ? { x: GRID.x(slot), y: GRID.y(slot) } : { x: SINGLE.x, y: SINGLE.y });

  // The shooting stars: a streak and a head each, the first in the strongest colour.
  const streakTex = tex(streakTexture());
  const meteors = Array.from({ length: s.count }, (_, slot) => {
    const streakMat = mat(new MeshBasicMaterial({ map: streakTex, blending: AdditiveBlending, transparent: true, depthWrite: false, depthTest: false }));
    const headMat = mat(new MeshBasicMaterial({ map: dot, blending: AdditiveBlending, transparent: true, depthWrite: false, depthTest: false }));
    const streak = new Mesh(plane(1, 1), streakMat);
    const head = new Mesh(plane(1, 1), headMat);
    streak.renderOrder = head.renderOrder = 3;
    scene.add(streak, head);
    const land = landing(slot);
    // From the upper left, entering just under the band, so the whole fall is seen.
    const start = ten ? { x: land.x - 4.5 - (slot % 5) * 0.2, y: land.y + 3.6 + Math.floor(slot / 5) * 0.4, z: -2 } : { x: land.x - 7, y: land.y + 4.6, z: -3 };
    return { streak, head, streakMat, headMat, land, start, delay: ten ? (slot * GUION.ten.caidaStagger) / GUION.ten.caida : 0 };
  });
  const maxDelay = ten ? ((s.count - 1) * GUION.ten.caidaStagger) / GUION.ten.caida : 0;

  // The shockwave (two rings from epic up) and the god rays.
  const ringUniforms = { uColor: { value: color(s.maxTier === 'common' ? 'ice' : s.maxTier) }, uProgress: { value: 1 }, uWidth: { value: 0.07 } };
  const ring = new Mesh(plane(1, 1), shader(RING_FRAGMENT, ringUniforms));
  // The burst at the strike: a glow that fades and sparks flying out (more for the rarer, fewer on a slow computer).
  const burstMat = mat(new MeshBasicMaterial({ map: dot, blending: AdditiveBlending, transparent: true, depthWrite: false, depthTest: false, color: ringUniforms.uColor.value }));
  const burst = new Mesh(plane(1, 1), burstMat);
  burst.renderOrder = 4;
  scene.add(burst);
  const sparkCount = opts.reduced ? 0 : Math.round((ten ? 1400 : 900) * (0.5 + 0.125 * ['common', 'uncommon', 'rare', 'epic', 'legendary'].indexOf(s.maxTier)));
  const sparkDir = new Float32Array(sparkCount * 3);
  const sparkSpeed = new Float32Array(sparkCount);
  const sparkSize = new Float32Array(sparkCount);
  for (let i = 0; i < sparkCount; i++) {
    const a = rand() * Math.PI * 2;
    const lift = (rand() - 0.5) * 0.6;
    sparkDir[i * 3] = Math.cos(a);
    sparkDir[i * 3 + 1] = Math.sin(a) * 0.8 + lift;
    sparkDir[i * 3 + 2] = (rand() - 0.3) * 0.8;
    sparkSpeed[i] = 0.25 + Math.pow(rand(), 0.6) * 0.75;
    sparkSize[i] = 0.5 + rand() * 1.4;
  }
  const sparkUniforms = { uProgress: { value: 1 }, uCenter: { value: new Vector3() }, uReach: { value: ten ? 9 : 7 }, uPixel: { value: dpr }, uColor: { value: ringUniforms.uColor.value } };
  let sparks: Points | null = null;
  if (sparkCount > 0) {
    // Points read their attributes per vertex: one per spark.
    const pts = new BufferGeometry();
    pts.setAttribute('position', new BufferAttribute(new Float32Array(sparkCount * 3), 3));
    pts.setAttribute('aDir', new BufferAttribute(sparkDir, 3));
    pts.setAttribute('aSpeed', new BufferAttribute(sparkSpeed, 1));
    pts.setAttribute('aSize', new BufferAttribute(sparkSize, 1));
    geometries.push(pts);
    sparks = new Points(pts, shader(SPARK_FRAGMENT, sparkUniforms, SPARK_VERTEX));
    sparks.frustumCulled = false;
    sparks.renderOrder = 4;
    scene.add(sparks);
  }
  const ring2Uniforms = { uColor: { value: new Color('#ffffff') }, uProgress: { value: 1 }, uWidth: { value: 0.03 } };
  const ring2 = new Mesh(plane(1, 1), shader(RING_FRAGMENT, ring2Uniforms));
  ring.renderOrder = ring2.renderOrder = 4;
  scene.add(ring, ring2);
  const raysUniforms = { uColor: { value: color('legendary') }, uAmount: { value: 0 }, uTime: { value: 0 } };
  const rays = new Mesh(plane(22, 22), shader(RAYS_FRAGMENT, raysUniforms));
  rays.renderOrder = 5;
  scene.add(rays);

  // The dim between the grid and a close-up.
  const dimMat = mat(new MeshBasicMaterial({ color: 0x02030a, transparent: true, opacity: 0, depthWrite: false, depthTest: false, blending: NormalBlending }));
  const dim = new Mesh(plane(80, 50), dimMat);
  dim.position.z = 0.6;
  dim.renderOrder = 20;
  scene.add(dim);

  // The cards.
  const backTex = tex(opts.back);
  const haloTex = tex(cardHalo());
  const maskTex = tex(drawMask());
  const cards = opts.cards.map((c) => {
    const group = new Group();
    const haloMat = mat(new MeshBasicMaterial({ map: haloTex, color: color(c.galaxy.tier), blending: AdditiveBlending, transparent: true, opacity: 0, depthWrite: false, depthTest: false }));
    const halo = new Mesh(plane(6.6, 9), haloMat);
    halo.position.z = -0.05;
    const frontMat = mat(new MeshBasicMaterial({ map: tex(c.front), transparent: true, opacity: 0, depthWrite: false, depthTest: false }));
    const front = new Mesh(plane(5, 7), frontMat);
    const backMat = mat(new MeshBasicMaterial({ map: backTex, transparent: true, opacity: 0, depthWrite: false, depthTest: false }));
    const back = new Mesh(plane(5, 7), backMat);
    back.rotation.y = Math.PI;
    group.add(halo, back, front);
    let foil: ShaderMaterial | null = null;
    let sheen: Mesh | null = null;
    if (c.galaxy.finish !== 'normal') {
      foil = shader(FOIL_WITH_OPACITY, { uFinish: { value: FINISHES.indexOf(c.galaxy.finish) }, uPointer: { value: new Vector2(0.5, 0.5) }, uTime: { value: 0 }, uActive: { value: 0.6 }, uMask: { value: maskTex }, uOpacity: { value: 0 } }, FOIL_VERTEX);
      sheen = new Mesh(plane(5, 7), foil);
      sheen.position.z = 0.01;
      group.add(sheen);
    }
    scene.add(group);
    return { group, halo, haloMat, front, frontMat, back, backMat, foil, sheen };
  });

  // A fusion's galaxies going in: face up, a rim of their tier, and a streak behind each while the ring turns fast.
  const fusion = s.intro === 'fusion';
  const ringScale = RING.scale(opts.inputs?.length ?? 0);
  const inputs = (opts.inputs ?? []).map((c) => {
    const group = new Group();
    const haloMat = mat(new MeshBasicMaterial({ map: haloTex, color: color(c.galaxy.tier), blending: AdditiveBlending, transparent: true, opacity: 0, depthWrite: false, depthTest: false }));
    const halo = new Mesh(plane(6.6, 9), haloMat);
    halo.position.z = -0.05;
    const frontMat = mat(new MeshBasicMaterial({ map: tex(c.front), transparent: true, opacity: 0, depthWrite: false, depthTest: false }));
    const front = new Mesh(plane(5, 7), frontMat);
    group.add(halo, front);
    const trailMat = mat(new MeshBasicMaterial({ map: streakTex, color: color(c.galaxy.tier), blending: AdditiveBlending, transparent: true, opacity: 0, depthWrite: false, depthTest: false }));
    const trail = new Mesh(plane(1, 1), trailMat);
    trail.renderOrder = 8;
    halo.renderOrder = 9;
    front.renderOrder = 9.001;
    scene.add(trail, group);
    return { group, halo, haloMat, front, frontMat, trail, trailMat };
  });
  // The core shines over the galaxies sinking into it.
  if (fusion) ignite.renderOrder = flare.renderOrder = 9.5;

  const cleanup: (() => void)[] = [];
  const lost = (e: Event) => {
    e.preventDefault();
    opts.onLost?.();
  };
  canvas.addEventListener('webglcontextlost', lost);
  cleanup.push(() => canvas.removeEventListener('webglcontextlost', lost));

  let travel = 0;
  let lastFocus = 0;
  let clock = 0;
  let frames = 0;
  let spent = 0;
  let quality: 'high' | 'low' = 'high';
  let width = 1280;
  let height = 720;

  function fit() {
    camera.aspect = width / Math.max(1, height);
    // The grid and the single card always fit between the cinema bands, on wide and narrow screens alike.
    const need = Math.max(8.2, 13 / camera.aspect);
    baseDistance = need / 2 / Math.tan((FOV / 2) * (Math.PI / 180));
    camera.updateProjectionMatrix();
    starUniforms.uRes.value.set(width * dpr, height * dpr);
    sparkUniforms.uPixel.value = dpr;
  }

  function dropQuality() {
    quality = 'low';
    dpr = 1;
    renderer.setPixelRatio(dpr);
    renderer.setSize(width, height, false);
    starCount = Math.floor(starCount / 2);
    starGeo.instanceCount = starCount;
    fit();
  }

  return {
    resize(w, h) {
      width = Math.max(1, Math.floor(w));
      height = Math.max(1, Math.floor(h));
      renderer.setSize(width, height, false);
      fit();
    },
    setFront(slot, front) {
      const c = cards[slot];
      if (!c) return;
      const old = c.frontMat.map;
      const t = tex(front);
      c.frontMat.map = t;
      c.frontMat.needsUpdate = true;
      old?.dispose();
    },
    setInputFront(index, front) {
      const c = inputs[index];
      if (!c) return;
      const old = c.frontMat.map;
      c.frontMat.map = tex(front);
      c.frontMat.needsUpdate = true;
      old?.dispose();
    },
    get quality() {
      return quality;
    },
    render(rig, t, dt) {
      clock += dt;
      // The camera, with its shake (a few sines, deterministic) and the final push.
      const amp = rig.shake * 0.22;
      camera.position.set(Math.sin(clock * 47) * amp + Math.sin(clock * 23) * amp * 0.5, Math.cos(clock * 41) * amp * 0.8, baseDistance + rig.camZ);
      camera.rotation.z = Math.sin(clock * 31) * rig.shake * 0.012;

      // The jump: the tunnel's speed, the streaks and the trail's tint.
      travel += (opts.reduced ? 0.4 : 0.7 + rig.speed * 150) * dt;
      tintOf(rig.trail, trailColor);
      starUniforms.uTravel.value = travel;
      starUniforms.uWarp.value = rig.warp;
      starUniforms.uTime.value = clock;
      starUniforms.uTint.value.copy(trailColor);
      starUniforms.uTintAmount.value = s.trail.shown === 'ice' ? 0.2 : Math.min(1, rig.trail);
      nebulaUniforms.uTravel.value = travel;
      nebulaUniforms.uAmount.value = rig.nebula * 0.9 + 0.12;
      nebulaUniforms.uTint.value.copy(trailColor);

      // The point of light (a fusion's core: tinted as the trail, breathing while it swells).
      const ig = fusion ? rig.core : rig.ignite;
      ignite.visible = flare.visible = ig > 0.001;
      const breath = fusion && !opts.reduced ? 1 + Math.sin(clock * 7) * 0.06 * ig : 1;
      ignite.scale.setScalar((0.25 + ig * (fusion ? 2.6 : 3.2)) * breath);
      flare.scale.set(0.4 + ig * (fusion ? 9 : 16), 0.08 + ig * 0.35, 1);
      (ignite.material as MeshBasicMaterial).opacity = ig;
      (flare.material as MeshBasicMaterial).opacity = ig * 0.7;
      if (fusion) {
        (ignite.material as MeshBasicMaterial).color.copy(trailColor);
        (flare.material as MeshBasicMaterial).color.copy(trailColor);
      }

      // A fusion's ring: each galaxy on its ellipse, turned by the spin, drawn in as it sinks (with reduced motion it
      // only fades where it is); a streak behind it and a tilt as fast as the rig says the ring turns.
      const whirl = opts.reduced ? 0 : rig.whirl;
      inputs.forEach((c, i) => {
        const ir = rig.inputs[i];
        const shown = !!ir && ir.alpha > 0.001;
        c.group.visible = shown;
        c.trail.visible = false;
        if (!ir || !shown) return;
        const spot = ringSpot(i, inputs.length, { ring: rig.ring, spin: rig.spin, absorb: ir.absorb }, opts.reduced);
        c.group.position.set(spot.x, spot.y, spot.z);
        c.group.scale.setScalar(spot.scale);
        c.group.rotation.set(0, opts.reduced ? 0 : Math.sin(clock * 1.3 + i) * 0.08, Math.min(0.35, whirl * 0.3));
        c.frontMat.opacity = ir.alpha;
        c.haloMat.opacity = ir.glow * ir.alpha * 0.9;
        if (whirl < 0.12) return;
        // Along the way it is going (anticlockwise round the ellipse), from behind the card.
        const vx = -Math.sin(spot.angle) * RING.rx;
        const vy = Math.cos(spot.angle) * RING.ry;
        const angle = Math.atan2(vy, vx);
        const length = Math.min(3.2, whirl * 2.8) * Math.max(0.3, spot.r);
        c.trail.visible = true;
        c.trail.position.set(spot.x - (Math.cos(angle) * length) / 2, spot.y - (Math.sin(angle) * length) / 2, -0.5);
        c.trail.rotation.z = angle;
        c.trail.scale.set(length, 0.45 * (ringScale / 0.3), 1);
        c.trailMat.opacity = ir.alpha * Math.min(1, (whirl - 0.12) / 0.5);
      });

      // The shooting stars.
      meteors.forEach((m, slot) => {
        const local = maxDelay > 0 ? (rig.meteor - m.delay) / (1 - maxDelay) : rig.meteor;
        const p = Math.min(1, Math.max(0, local));
        const visible = p > 0 && p < 1;
        m.streak.visible = m.head.visible = visible;
        if (!visible) return;
        const hx = m.start.x + (m.land.x - m.start.x) * p;
        const hy = m.start.y + (m.land.y - m.start.y) * p;
        const hz = m.start.z + (0 - m.start.z) * p;
        const dx = m.land.x - m.start.x;
        const dy = m.land.y - m.start.y;
        const angle = Math.atan2(dy, dx);
        const length = 1.5 + 4.5 * Math.min(1, p * 2) * (1 - p * 0.6);
        m.head.position.set(hx, hy, hz);
        m.head.scale.setScalar(ten ? 1.1 : 1.8);
        m.streak.position.set(hx - (Math.cos(angle) * length) / 2, hy - (Math.sin(angle) * length) / 2, hz);
        m.streak.rotation.z = angle;
        m.streak.scale.set(length, ten ? 0.3 : 0.5, 1);
        const lead = slot === 0 ? trailColor : tints[0];
        m.headMat.color.copy(lead);
        m.streakMat.color.copy(lead);
        m.headMat.opacity = 1;
        m.streakMat.opacity = 1;
      });

      // The shockwave rolls out from where the cards land.
      const centre = ten ? { x: 0, y: 0 } : landing(0);
      const k = rig.impact;
      ring.visible = ring2.visible = k > 0.001 && k < 0.999;
      ring.position.set(centre.x, centre.y, 0.2);
      ring.scale.setScalar(1.5 + k * (ten ? 26 : 18));
      ringUniforms.uProgress.value = k;
      ring2.position.copy(ring.position);
      ring2.scale.setScalar(1 + k * (ten ? 34 : 24));
      ring2Uniforms.uProgress.value = Math.min(1, k * 1.25);
      ring2.visible = ring.visible && (s.maxTier === 'epic' || s.maxTier === 'legendary');
      const glow = k > 0.001 && k < 0.999 ? (1 - k) * (1 - k) : 0;
      burst.visible = glow > 0.002;
      burst.position.set(centre.x, centre.y, 0.3);
      burst.scale.setScalar(2.5 + k * (ten ? 16 : 11));
      burstMat.opacity = glow * 0.95;
      if (sparks) {
        sparks.visible = k > 0.001 && k < 0.999;
        sparkUniforms.uProgress.value = k;
        sparkUniforms.uCenter.value.set(centre.x, centre.y, 0.4);
      }

      // The god rays, behind the card in focus (the last one, while they fade).
      if (rig.focus >= 0) lastFocus = rig.focus;
      rays.visible = rig.rays > 0.001;
      if (rays.visible) {
        const fc = rig.cards[lastFocus] ?? rig.cards[0]!;
        rays.position.set(fc.x, fc.y, fc.z - 0.4);
        raysUniforms.uAmount.value = rig.rays * 0.55;
        raysUniforms.uTime.value = opts.reduced ? 0 : clock;
      }
      dimMat.opacity = rig.dim;
      dim.visible = rig.dim > 0.001;

      // The cards.
      cards.forEach((c, slot) => {
        const cr = rig.cards[slot]!;
        const shown = cr.alpha > 0.001;
        c.group.visible = shown;
        if (!shown) return;
        const inFocus = rig.focus === slot;
        // The one in focus idles a little while it waits (never with reduced motion).
        const sway = inFocus && !opts.reduced && rig.summary < 0.01 ? Math.sin(clock * 0.9) * 0.06 : 0;
        c.group.position.set(cr.x, cr.y, cr.z);
        c.group.scale.setScalar(cr.scale);
        c.group.rotation.set(Math.sin(clock * 0.7) * (inFocus && !opts.reduced ? 0.035 : 0), Math.PI - cr.rotY + sway, cr.rotZ);
        // A close-up's card comes above the dim; the rest of the grid stays under it.
        const order = inFocus && rig.dim > 0.001 ? 30 : 10 + slot * 0.01;
        c.halo.renderOrder = order;
        c.back.renderOrder = order + 0.001;
        c.front.renderOrder = order + 0.002;
        // Two-sided by angle: the face shows while it looks at the camera, the back otherwise.
        const facing = Math.cos(Math.PI - cr.rotY) > 0;
        c.frontMat.opacity = facing ? cr.alpha : 0;
        c.backMat.opacity = facing ? 0 : cr.alpha;
        c.haloMat.opacity = cr.glow * cr.alpha * 0.9;
        if (c.foil) {
          c.foil.uniforms['uOpacity']!.value = facing ? cr.alpha : 0;
          c.foil.uniforms['uTime']!.value = opts.reduced ? 0 : clock;
          (c.foil.uniforms['uPointer']!.value as Vector2).set(0.5 + Math.sin(clock * 0.8) * 0.35, 0.5 + Math.cos(clock * 0.6) * 0.3);
          if (c.sheen) c.sheen.renderOrder = order + 0.003;
        }
      });

      void t;
      renderer.render(scene, camera);
      // The first frames tell how heavy this computer finds it: past 20 ms a frame on average, the light version.
      if (quality === 'high' && frames < 40 && dt > 0) {
        frames++;
        if (frames > 5) spent += dt * 1000;
        if (frames === 40 && spent / 35 > 20) dropQuality();
      }
    },
    dispose() {
      for (const f of cleanup) f();
      for (const g of geometries) g.dispose();
      for (const m of materials) m.dispose();
      for (const t of textures) t.dispose();
      renderer.dispose();
      // Give the context back at once: browsers cap the live WebGL contexts.
      renderer.forceContextLoss();
    },
  };
}
