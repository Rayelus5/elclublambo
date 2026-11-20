import { TRAITS } from '@galaxy/engine';
import { TIERS, type PulledGalaxy, type Tier } from '@galaxy/shared';
import { copy } from '../copy/es';

// The inspector's card faces, drawn with the 2D canvas (they become three.js textures). Same design as the CSS card
// (DESIGN_SYSTEM §7): 1000×1400 px, 1 cqw = 10 px. The front frame leaves the art window transparent, so the layers
// behind it (starfield, galaxy) move with parallax; the plate, the level and the finish are drawn on the frame.
export const W = 1000;
export const H = 1400;
const WINDOW = { x: 50, y: 50, size: 900, r: 45 };
const PLATE = { x: 50, y: 990, w: 900, h: 350, r: 45 };
const SANS = '"Fredoka", system-ui, sans-serif';
const BRAILLE = '"Segoe UI Symbol", "Noto Sans Symbols 2", "DejaVu Sans", monospace';

function token(name: string, fallback: string): string {
  const v = typeof getComputedStyle === 'function' ? getComputedStyle(document.documentElement).getPropertyValue(name).trim() : '';
  return v || fallback;
}
const FALLBACK_TIERS = ['#c9d0ea', '#45e3a6', '#6fb7ff', '#b39dff', '#ffc94a', '#ff4fd8'];
/** The mythic's «Vacío iridiscente»: a near black card in a frame of four turning tones (app.css, .gcard). */
const MYTHIC_VOID = '#0b0a14';
const IRIS = ['#ff4fd8', '#6fe3ff', '#ffc94a', '#b39dff'];
/** The tier colour as a hex from the design tokens (the fixed palette if the token is missing or not hex). */
function tierColor(t: Tier): string {
  const v = token(`--color-tier-${t}`, '');
  return /^#[0-9a-f]{6}$/i.test(v) ? v : FALLBACK_TIERS[TIERS.indexOf(t)]!;
}

/** `hex` mixed with `with` (an rgb triple) by `t` (0 = hex, 1 = with), as an rgb() string canvases always accept. */
function mix(hex: string, withRgb: [number, number, number], t: number): string {
  const n = Number.parseInt(hex.slice(1), 16);
  const rgb = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  return `rgb(${rgb.map((c, i) => Math.round(c + (withRgb[i]! - c) * t)).join(',')})`;
}
const WHITE: [number, number, number] = [255, 255, 255];
const BLACK: [number, number, number] = [0, 0, 0];

function canvas(w = W, h = H): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')!];
}

function rounded(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}

/** The mythic's frame: the iridescent ring (conic where the canvas has it) around a near black card. */
function mythicFrame(ctx: CanvasRenderingContext2D): void {
  let ring: CanvasGradient;
  if (typeof ctx.createConicGradient === 'function') {
    ring = ctx.createConicGradient(-Math.PI / 2, W / 2, H / 2);
    [...IRIS, IRIS[0]!].forEach((c, i) => ring.addColorStop(i / IRIS.length, c));
  } else {
    ring = ctx.createLinearGradient(0, 0, W, H);
    IRIS.forEach((c, i) => ring.addColorStop(i / (IRIS.length - 1), c));
  }
  rounded(ctx, 0, 0, W, H, 70);
  ctx.fillStyle = ring;
  ctx.fill();
  rounded(ctx, 22, 22, W - 44, H - 44, 52);
  ctx.fillStyle = MYTHIC_VOID;
  ctx.fill();
}

/** The tier frame with its relief: light top-left, the tier colour, dark bottom-right. */
function frame(ctx: CanvasRenderingContext2D, tc: string, tier?: Tier): void {
  if (tier === 'mythic') return mythicFrame(ctx);
  const g = ctx.createLinearGradient(0, 0, W * 0.6, H);
  g.addColorStop(0, mix(tc, WHITE, 0.3));
  g.addColorStop(0.38, tc);
  g.addColorStop(1, mix(tc, BLACK, 0.42));
  rounded(ctx, 0, 0, W, H, 70);
  ctx.fillStyle = g;
  ctx.fill();
  ctx.save();
  ctx.clip();
  ctx.fillStyle = 'rgba(255,255,255,.4)';
  ctx.fillRect(0, 0, W, 12);
  ctx.fillStyle = 'rgba(0,0,0,.24)';
  ctx.fillRect(0, H - 20, W, 20);
  ctx.restore();
}

function brailleDots(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, light: number): void {
  ctx.save();
  rounded(ctx, x, y, w, h, 45);
  ctx.clip();
  for (let py = y + 17; py < y + h; py += 34) {
    for (let px = x + 17; px < x + w; px += 34) {
      ctx.fillStyle = `rgba(0,0,0,${0.32 * light})`;
      ctx.beginPath();
      ctx.arc(px + 2, py + 2, 7, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = `rgba(255,255,255,${0.5 * light})`;
      ctx.beginPath();
      ctx.arc(px - 1, py - 1, 5, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.restore();
}

function chip(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, align: 'left' | 'right', fill: string, ink: string): void {
  ctx.font = `700 52px ${SANS}`;
  const w = ctx.measureText(text).width + 60;
  const left = align === 'left' ? x : x - w;
  rounded(ctx, left, y, w, 80, 40);
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.fillStyle = ink;
  ctx.textBaseline = 'middle';
  ctx.fillText(text, left + 30, y + 42);
}

/** The front: frame, plate, level and finish, with the art window cut out. */
export function drawFront(g: PulledGalaxy & { level?: number }): HTMLCanvasElement {
  const [c, ctx] = canvas();
  const tc = tierColor(g.tier);
  frame(ctx, tc, g.tier);
  if (g.finish === 'braille') brailleDots(ctx, 0, 0, W, H, 1);
  if (g.finish === 'corrupt') {
    ctx.save();
    rounded(ctx, 0, 0, W, H, 70);
    ctx.clip();
    ctx.fillStyle = 'rgba(0,0,0,.24)';
    for (let y = 0; y < H; y += 18) ctx.fillRect(0, y, W, 6);
    ctx.fillStyle = 'rgba(255,77,109,.55)';
    ctx.fillRect(0, 0, 14, H);
    ctx.fillStyle = 'rgba(80,240,255,.4)';
    ctx.fillRect(W - 14, 0, 14, H);
    ctx.restore();
  }
  // The window: transparent, so the layers behind show through.
  ctx.save();
  ctx.globalCompositeOperation = 'destination-out';
  rounded(ctx, WINDOW.x, WINDOW.y, WINDOW.size, WINDOW.size, WINDOW.r);
  ctx.fill();
  ctx.restore();
  // The plate.
  const p = ctx.createLinearGradient(0, PLATE.y, 0, PLATE.y + PLATE.h);
  p.addColorStop(0, token('--color-panel-2', '#20234f'));
  p.addColorStop(1, token('--color-panel', '#181a3d'));
  rounded(ctx, PLATE.x, PLATE.y, PLATE.w, PLATE.h, PLATE.r);
  ctx.fillStyle = p;
  ctx.fill();
  if (g.finish === 'braille') brailleDots(ctx, PLATE.x, PLATE.y, PLATE.w, PLATE.h, 0.35);
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = token('--color-ink', '#f3f5ff');
  ctx.font = `700 92px ${SANS}`;
  ctx.fillText(g.name, PLATE.x + 40, PLATE.y + 125, PLATE.w - 80);
  ctx.fillStyle = token('--color-ink-mute', '#8890c4');
  ctx.font = `500 50px ${SANS}`;
  ctx.fillText(g.designation, PLATE.x + 40, PLATE.y + 200);
  ctx.save();
  ctx.translate(PLATE.x + 58, PLATE.y + 272);
  ctx.rotate(Math.PI / 4);
  ctx.fillStyle = tc;
  ctx.fillRect(-16, -16, 32, 32);
  ctx.restore();
  ctx.fillStyle = tc;
  ctx.font = `700 54px ${SANS}`;
  ctx.fillText(copy.tiers[g.tier], PLATE.x + 100, PLATE.y + 290);
  chip(ctx, copy.card.levelShort(g.level ?? 1), 80, 80, 'left', 'rgba(2,3,10,.66)', token('--color-ink', '#f3f5ff'));
  if (g.finish !== 'normal') chip(ctx, copy.finishes[g.finish], W - 80, 80, 'right', g.finish === 'corrupt' ? token('--color-static', '#ff4d6d') : '#ffe7a8', g.finish === 'corrupt' ? '#fff' : '#3a1700');
  return c;
}

/** Where the finish shader may draw and how strongly: the whole card, softer over the name plate. */
export function drawMask(): HTMLCanvasElement {
  const [c, ctx] = canvas(250, 350);
  rounded(ctx, 0, 0, 250, 350, 18);
  ctx.fillStyle = '#fff';
  ctx.fill();
  ctx.globalCompositeOperation = 'destination-out';
  rounded(ctx, PLATE.x / 4, PLATE.y / 4, PLATE.w / 4, PLATE.h / 4, PLATE.r / 4);
  ctx.fillStyle = 'rgba(0,0,0,.72)';
  ctx.fill();
  return c;
}

/** The back: the seed's own braille at 48 columns, embossed, the traits and the name. */
export function drawBack(g: PulledGalaxy, braille: string): HTMLCanvasElement {
  const [c, ctx] = canvas();
  const tc = tierColor(g.tier);
  frame(ctx, tc, g.tier);
  const box = { x: 160, y: 60, size: 680 };
  const bg = ctx.createRadialGradient(W / 2, box.y + box.size * 0.4, 40, W / 2, box.y + box.size / 2, box.size * 0.7);
  bg.addColorStop(0, token('--color-panel-2', '#20234f'));
  bg.addColorStop(1, token('--color-panel-lip', '#0b0c24'));
  rounded(ctx, box.x, box.y, box.size, box.size, 50);
  ctx.fillStyle = bg;
  ctx.fill();
  const lines = braille.split('\n');
  const size = Math.floor(box.size / Math.max(48, ...lines.map((l) => l.length)) / 0.62);
  ctx.font = `400 ${size}px ${BRAILLE}`;
  ctx.textBaseline = 'top';
  const lineH = size * 1.2;
  const top = box.y + (box.size - lines.length * lineH) / 2;
  lines.forEach((line, i) => {
    const x = box.x + (box.size - ctx.measureText(line).width) / 2;
    const y = top + i * lineH;
    ctx.fillStyle = 'rgba(0,0,0,.85)';
    ctx.fillText(line, x + 2, y + 3);
    ctx.fillStyle = 'rgba(255,255,255,.55)';
    ctx.fillText(line, x - 1.5, y - 1.5);
    ctx.fillStyle = mix(tc, WHITE, 0.45);
    ctx.fillText(line, x, y);
  });
  const list = { x: 60, y: 790, w: 880, h: 450 };
  const p = ctx.createLinearGradient(0, list.y, 0, list.y + list.h);
  p.addColorStop(0, token('--color-panel-2', '#20234f'));
  p.addColorStop(1, token('--color-panel', '#181a3d'));
  rounded(ctx, list.x, list.y, list.w, list.h, 45);
  ctx.fillStyle = p;
  ctx.fill();
  const keys = TRAITS.drawOrder.filter((k) => g.traits[k] !== undefined);
  const rowH = (list.h - 50) / Math.max(keys.length, 1);
  const names = copy.traitValues as Record<string, Record<string, string>>;
  keys.forEach((k, i) => {
    const y = list.y + 40 + rowH * (i + 0.65);
    ctx.textBaseline = 'alphabetic';
    ctx.font = `500 40px ${SANS}`;
    ctx.fillStyle = token('--color-ink-mute', '#8890c4');
    ctx.fillText(copy.traitNames[k] ?? k, list.x + 45, y);
    ctx.font = `600 40px ${SANS}`;
    ctx.fillStyle = token('--color-ink', '#f3f5ff');
    const value = names[k]?.[g.traits[k]!] ?? g.traits[k]!;
    ctx.fillText(value, list.x + list.w - 45 - ctx.measureText(value).width, y);
  });
  ctx.fillStyle = 'rgba(0,0,0,.72)';
  ctx.font = `700 70px ${SANS}`;
  ctx.fillText(g.name, 70, 1340);
  ctx.font = `600 44px ${SANS}`;
  ctx.fillText(g.designation, W - 70 - ctx.measureText(g.designation).width, 1336);
  return c;
}

/** A deep starfield behind the galaxy, seeded by the galaxy so it is always the same one. */
export function drawStarfield(seed: string): HTMLCanvasElement {
  const [c, ctx] = canvas(512, 512);
  const g = ctx.createRadialGradient(256, 256, 20, 256, 256, 380);
  g.addColorStop(0, '#0a0d22');
  g.addColorStop(1, '#020309');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 512, 512);
  let s = Number(BigInt(seed) % 2147483647n) || 7;
  const rand = () => (s = (s * 48271) % 2147483647) / 2147483647;
  for (let i = 0; i < 260; i++) {
    const r = rand() < 0.92 ? 0.8 : 1.8;
    ctx.fillStyle = `rgba(${190 + rand() * 60},${200 + rand() * 50},255,${0.25 + rand() * 0.6})`;
    ctx.beginPath();
    ctx.arc(rand() * 512, rand() * 512, r, 0, Math.PI * 2);
    ctx.fill();
  }
  return c;
}

/**
 * The galaxy for the inspector's window, faded to nothing before the edges of its square (a radial fall-off from 62 % to
 * 98 % of its half-size), so tilting never shows a square behind the frame (M6d-1, the owner's request).
 */
export function featherGalaxy(src: HTMLCanvasElement): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = src.width;
  c.height = src.height;
  const ctx = c.getContext('2d')!;
  ctx.drawImage(src, 0, 0);
  const r = c.width / 2;
  const fade = ctx.createRadialGradient(r, c.height / 2, r * 0.62, r, c.height / 2, r * 0.98);
  fade.addColorStop(0, 'rgba(0,0,0,1)');
  fade.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.globalCompositeOperation = 'destination-in';
  ctx.fillStyle = fade;
  ctx.fillRect(0, 0, c.width, c.height);
  return c;
}

/** A blurred, faded copy of the galaxy: its glow, a layer nearer the glass than the galaxy itself, for depth. */
export function glowGalaxy(src: HTMLCanvasElement): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = src.width;
  c.height = src.height;
  const ctx = c.getContext('2d')!;
  ctx.filter = `blur(${Math.round(src.width / 40)}px)`;
  ctx.drawImage(src, 0, 0);
  ctx.filter = 'none';
  return featherGalaxy(c);
}
