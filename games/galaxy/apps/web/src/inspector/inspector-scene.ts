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
import { FOIL_FRAGMENT as FRAGMENT, FOIL_VERTEX as VERTEX } from './foil';
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
