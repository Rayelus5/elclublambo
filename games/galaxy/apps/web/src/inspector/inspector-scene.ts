import type { Finish } from '@galaxy/shared';
import {
  AdditiveBlending,
  type Blending,
  CanvasTexture,
  FrontSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  NormalBlending,
  PerspectiveCamera,
  Plane,
  PlaneGeometry,
  Scene,
  ShaderMaterial,
  SRGBColorSpace,
  Vector2,
  Vector3,
  WebGLRenderer,
  type Material,
  type Texture,
} from 'three';
import { FINISHES } from '@galaxy/shared';
import { dragSpin, type Face, faceOf, settle, toFace } from './spin';

// The 3D inspector's scene (GDD §8.1), in its own chunk so three.js only downloads when the inspector opens. The card
// is layers in depth — a starfield far behind, the galaxy (additive, so the starfield shows through its dark, and faded
// before its square's edges), its soft glow nearer the glass, the frame with its window, and the finish's light on top —
// so tilting it with the pointer gives real parallax. The back is its own plane: the card turns with the button or by
// dragging it sideways, and settles on the nearest face when let go (M6d-1). Units: the card is 5 × 7.
export interface InspectorFaces {
  front: HTMLCanvasElement;
  back: HTMLCanvasElement;
  galaxy: HTMLCanvasElement;
  /** The galaxy's blurred glow (textures.ts glowGalaxy); the pro view only. */
  glow?: HTMLCanvasElement;
  starfield: HTMLCanvasElement;
  mask: HTMLCanvasElement;
  finish: Finish;
  reduced: boolean;
  /**
   * An inverted palette (Antimateria): dark structure on a light field. Light adds nothing to it, so it is drawn as an
   * image (normal blending, its edges feathered) and without the additive glow, as the card shows it.
   */
  inverted?: boolean;
}

export interface InspectorScene {
  flip(back: boolean): void;
  dispose(): void;
}

/** What the scene tells the inspector: the face a drag left showing. */
export interface InspectorEvents {
  onFace?: (face: Face) => void;
}

const VERTEX = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

// The finish's light: a glare that follows the pointer, plus holo bands, a prismatic spectrum with sparkles, the
// braille dots catching the light, or the Static's scan lines and glitch rows.
const FRAGMENT = /* glsl */ `
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
  }
  gl_FragColor = vec4(col * m, 1.0);
}`;

function texture(c: HTMLCanvasElement): CanvasTexture {
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/**
 * `pro`: the layers further apart, the galaxy faded before its edges and its glow under the glass (M6d-1). `classic`: the
 * layers as they were before (M2b), for a computer that cannot make the pro view (the owner's request).
 */
export type InspectorVariant = 'pro' | 'classic';

export function createInspectorScene(canvas: HTMLCanvasElement, faces: InspectorFaces, events: InspectorEvents = {}, variant: InspectorVariant = 'pro'): InspectorScene {
  const renderer = new WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: true });
  try {
    return build(renderer, canvas, faces, events, variant);
  } catch (err) {
    // What was made goes, but the context stays: the classic view may still use this canvas.
    renderer.dispose();
    throw err;
  }
}

function build(renderer: WebGLRenderer, canvas: HTMLCanvasElement, faces: InspectorFaces, events: InspectorEvents, variant: InspectorVariant): InspectorScene {
  renderer.setPixelRatio(Math.min(globalThis.devicePixelRatio || 1, 2));
  renderer.localClippingEnabled = true;
  const scene = new Scene();
  const camera = new PerspectiveCamera(30, 1, 0.1, 100);
  camera.position.set(0, 0, 16.5);

  const textures: Texture[] = [];
  const materials: Material[] = [];
  const geometries: PlaneGeometry[] = [];
  const card = new Group();
  scene.add(card);

  function plane(w: number, h: number, material: Material, z: number, y = 0): Mesh {
    const g = new PlaneGeometry(w, h);
    geometries.push(g);
    materials.push(material);
    const m = new Mesh(g, material);
    m.position.set(0, y, z);
    card.add(m);
    return m;
  }
  const tex = (c: HTMLCanvasElement) => {
    const t = texture(c);
    textures.push(t);
    return t;
  };

  // The art window sits 0.25 from the top and is 4.5 wide: its centre is 1.0 above the card's. The layers behind it
  // are clipped to the window's prism (planes that follow the card), so tilting shows depth, never their edges.
  const local = [
    new Plane(new Vector3(1, 0, 0), 2.25),
    new Plane(new Vector3(-1, 0, 0), 2.25),
    new Plane(new Vector3(0, 1, 0), -1.0 + 2.25),
    new Plane(new Vector3(0, -1, 0), 1.0 + 2.25),
  ];
  const clip = local.map((p) => p.clone());
  // Additive lets the galaxy's black vanish and its stars glow; an inverted one is drawn as it is (see InspectorFaces).
  const galaxyBlend: Blending = faces.inverted ? NormalBlending : AdditiveBlending;
  if (variant === 'pro') {
    // Further apart (M6d-1): the starfield deep behind, the galaxy in the middle, its glow just under the glass.
    plane(7, 7, new MeshBasicMaterial({ map: tex(faces.starfield), side: FrontSide, clippingPlanes: clip }), -0.72, 1.0);
    plane(4.9, 4.9, new MeshBasicMaterial({ map: tex(faces.galaxy), blending: galaxyBlend, transparent: true, depthWrite: false, side: FrontSide, clippingPlanes: clip }), -0.34, 1.0);
    if (faces.glow && !faces.inverted) plane(5.3, 5.3, new MeshBasicMaterial({ map: tex(faces.glow), blending: AdditiveBlending, transparent: true, opacity: 0.42, depthWrite: false, side: FrontSide, clippingPlanes: clip }), -0.08, 1.0);
  } else {
    // As it was before M6d-1: the starfield behind and the galaxy (additive, its whole square) in front of it.
    plane(6, 6, new MeshBasicMaterial({ map: tex(faces.starfield), side: FrontSide, clippingPlanes: clip }), -0.42, 1.0);
    plane(4.9, 4.9, new MeshBasicMaterial({ map: tex(faces.galaxy), blending: galaxyBlend, transparent: true, depthWrite: false, side: FrontSide, clippingPlanes: clip }), -0.16, 1.0);
  }
  plane(5, 7, new MeshBasicMaterial({ map: tex(faces.front), transparent: true, alphaTest: 0.02, side: FrontSide }), 0);
  const foil = new ShaderMaterial({
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    uniforms: {
      uFinish: { value: FINISHES.indexOf(faces.finish) },
      uPointer: { value: new Vector2(0.5, 0.5) },
      uTime: { value: 0 },
      uActive: { value: 0 },
      uMask: { value: tex(faces.mask) },
    },
    blending: AdditiveBlending,
    transparent: true,
    depthWrite: false,
    side: FrontSide,
  });
  plane(5, 7, foil, 0.02);
  const back = plane(5, 7, new MeshBasicMaterial({ map: tex(faces.back), transparent: true, alphaTest: 0.02, side: FrontSide }), -0.5);
  back.rotation.y = Math.PI;

  const tilt = faces.reduced ? 0.09 : 0.34;
  const target = new Vector2();
  const pointer = new Vector2(0.5, 0.5);
  let active = 0;
  let wantActive = 0;
  // The card's yaw, by the button or by hand (spin.ts): free while dragging, on a face once let go.
  let spin = 0;
  let drag: { x0: number; spin0: number; id: number } | null = null;
  let raf = 0;
  const start = performance.now();

  function resize(): void {
    const w = canvas.clientWidth || 600;
    const h = canvas.clientHeight || 600;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    // Keep the whole card in view on wide and tall boxes.
    camera.position.z = Math.max(16.5, 16.5 * (0.72 / camera.aspect));
    camera.updateProjectionMatrix();
  }
  const observer = new ResizeObserver(resize);
  observer.observe(canvas);
  resize();

  function onMove(e: PointerEvent): void {
    const r = canvas.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width;
    const y = (e.clientY - r.top) / r.height;
    pointer.set(Math.min(1, Math.max(0, x)), Math.min(1, Math.max(0, 1 - y)));
    target.set((y - 0.5) * 2 * tilt, (x - 0.5) * 2 * tilt);
    wantActive = 1;
  }
  function onLeave(): void {
    if (drag) return;
    target.set(0, 0);
    wantActive = 0;
  }
  function onDown(e: PointerEvent): void {
    if (e.button !== 0) return;
    drag = { x0: e.clientX, spin0: spin, id: e.pointerId };
    try {
      canvas.setPointerCapture(e.pointerId);
    } catch {
      // A synthetic or already-gone pointer: the drag still follows the canvas's own events.
    }
    canvas.classList.add('dragging');
  }
  function onDrag(e: PointerEvent): void {
    if (!drag || e.pointerId !== drag.id) return;
    spin = dragSpin(drag.spin0, e.clientX - drag.x0, canvas.getBoundingClientRect().width);
  }
  function onUp(e: PointerEvent): void {
    if (!drag || e.pointerId !== drag.id) return;
    drag = null;
    spin = settle(spin);
    canvas.classList.remove('dragging');
    events.onFace?.(faceOf(spin));
  }
  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointermove', onDrag);
  canvas.addEventListener('pointerleave', onLeave);
  canvas.addEventListener('pointerdown', onDown);
  canvas.addEventListener('pointerup', onUp);
  canvas.addEventListener('pointercancel', onUp);

  const frame = (now: number) => {
    const t = (now - start) / 1000;
    // Under the hand the card follows at once; on its own it eases (snappier with reduced motion).
    const ease = drag ? 0.45 : faces.reduced ? 0.3 : 0.1;
    // A slow idle sway invites a closer look; none with reduced motion.
    const swayX = faces.reduced || wantActive || drag ? 0 : Math.sin(t * 0.6) * 0.05;
    const swayY = faces.reduced || wantActive || drag ? 0 : Math.sin(t * 0.45) * 0.09;
    card.rotation.x += (target.x + swayX - card.rotation.x) * ease;
    card.rotation.y += ((drag ? 0 : target.y) + swayY + spin - card.rotation.y) * ease;
    active += (wantActive - active) * 0.08;
    card.updateMatrixWorld();
    local.forEach((p, i) => clip[i]!.copy(p).applyMatrix4(card.matrixWorld));
    foil.uniforms['uPointer']!.value = pointer;
    // With reduced motion the finish holds still: no twinkle, no glitch rows changing.
    foil.uniforms['uTime']!.value = faces.reduced ? 0 : t;
    foil.uniforms['uActive']!.value = active;
    renderer.render(scene, camera);
    raf = requestAnimationFrame(frame);
  };
  raf = requestAnimationFrame(frame);
  renderer.render(scene, camera);

  return {
    flip(showBack) {
      if (!drag) spin = toFace(spin, showBack ? 'back' : 'front');
    },
    dispose() {
      cancelAnimationFrame(raf);
      observer.disconnect();
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointermove', onDrag);
      canvas.removeEventListener('pointerleave', onLeave);
      canvas.removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('pointerup', onUp);
      canvas.removeEventListener('pointercancel', onUp);
      for (const g of geometries) g.dispose();
      for (const m of materials) m.dispose();
      for (const t of textures) t.dispose();
      renderer.dispose();
      // Give the context back now: browsers cap live WebGL contexts.
      renderer.forceContextLoss();
    },
  };
}
