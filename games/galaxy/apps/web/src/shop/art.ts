// The shop's pack art (shop and lab plan, F5; the approved F0 mockup), painted pixel by pixel on a small canvas shown
// big: a pile that grows with the pack's size in its container (a sack, a chest, jars, a crate), with a glow and
// sparkles that twinkle (more with the size). Deterministic: the sparkles' places come from a fixed hash, only their
// phase follows the time. The Aseprite set (F5c) replaces it product by product.

export type PackArt = { kind: 'coins' | 'dust' | 'components' | 'bundle'; tier: number };

const PAL = {
  coin: ['#ffe9a3', '#ffc94a', '#ff9a3c', '#c25f1c', '#7a3a10'],
  dust: ['#f1eaff', '#c9b8ff', '#9b86ff', '#7259ee', '#3a2a9a'],
  comp: ['#d9fff0', '#7cf0c4', '#45e3a6', '#17b07e', '#0b5a40'],
  wood: ['#d79b5a', '#a8693a', '#6e3f1e', '#3e2210'],
  metal: ['#e9ecff', '#b9bfe6', '#8890c4', '#4a4f86', '#23264f'],
  ink: '#0b0c24',
};
const GLOW: Record<PackArt['kind'], string> = { coins: '255,201,74', dust: '155,134,255', components: '69,227,166', bundle: '255,107,122' };
const N = [3, 6, 10, 15, 21, 28];

/** The art of a product's `art` id: `coins-3`, `dust-1`, `components-6`, or a bundle (the welcome pack, a kit). */
export function artOf(art: string, kind: 'pack' | 'bundle' | 'welcome'): PackArt {
  const m = /^(coins|dust|components)-([1-6])$/.exec(art);
  if (m) return { kind: m[1] as PackArt['kind'], tier: Number(m[2]) - 1 };
  if (kind === 'welcome') return { kind: 'bundle', tier: 1 };
  const big = /comandante|best|3$/.test(art) ? 5 : /explorador|2$/.test(art) ? 4 : 3;
  return { kind: 'bundle', tier: big };
}

type Ctx = CanvasRenderingContext2D;
const px = (c: Ctx, x: number, y: number, color: string) => {
  c.fillStyle = color;
  c.fillRect(x | 0, y | 0, 1, 1);
};
const rect = (c: Ctx, x: number, y: number, w: number, h: number, color: string) => {
  c.fillStyle = color;
  c.fillRect(x | 0, y | 0, w | 0, h | 0);
};

function coin(c: Ctx, x: number, y: number) {
  const p = PAL.coin;
  rect(c, x + 1, y, 5, 1, PAL.ink);
  rect(c, x, y + 1, 7, 3, PAL.ink);
  rect(c, x + 1, y + 4, 5, 1, PAL.ink);
  rect(c, x + 1, y + 1, 5, 3, p[1]!);
  rect(c, x + 1, y + 1, 5, 1, p[0]!);
  rect(c, x + 1, y + 3, 5, 1, p[2]!);
  px(c, x + 3, y + 2, p[3]!);
}
function orb(c: Ctx, x: number, y: number) {
  const p = PAL.dust;
  rect(c, x + 1, y, 3, 1, PAL.ink);
  rect(c, x, y + 1, 5, 3, PAL.ink);
  rect(c, x + 1, y + 4, 3, 1, PAL.ink);
  rect(c, x + 1, y + 1, 3, 3, p[2]!);
  px(c, x + 1, y + 1, p[0]!);
  px(c, x + 2, y + 1, p[1]!);
  px(c, x + 3, y + 3, p[3]!);
}
function gear(c: Ctx, x: number, y: number) {
  const p = PAL.comp;
  rect(c, x + 2, y, 3, 7, PAL.ink);
  rect(c, x, y + 2, 7, 3, PAL.ink);
  rect(c, x + 1, y + 1, 5, 5, PAL.ink);
  rect(c, x + 2, y + 1, 3, 5, p[2]!);
  rect(c, x + 1, y + 2, 5, 3, p[2]!);
  px(c, x + 2, y + 1, p[0]!);
  px(c, x + 1, y + 2, p[1]!);
  px(c, x + 3, y + 3, PAL.ink);
  px(c, x + 5, y + 4, p[3]!);
  px(c, x + 4, y + 5, p[3]!);
}
const ITEM = { coins: [coin, 7, 4], dust: [orb, 5, 4], components: [gear, 7, 6] } as const;

function pile(c: Ctx, kind: keyof typeof ITEM, n: number, cx: number, base: number) {
  const [draw, w, h] = ITEM[kind];
  const rows: number[] = [];
  let left = n;
  for (let r = 1; left > 0; r++) {
    rows.unshift(Math.min(r, left));
    left -= r;
  }
  rows.reverse().forEach((count, i) => {
    const y = base - (i + 1) * (h - 1);
    const start = cx - (count * (w - 1)) / 2;
    for (let k = 0; k < count; k++) draw(c, start + k * (w - 1) + (i % 2 ? 1 : 0), y);
  });
}
function chest(c: Ctx, x: number, y: number, w: number, h: number, trim: string) {
  const wd = PAL.wood;
  rect(c, x - 1, y - 1, w + 2, h + 2, PAL.ink);
  rect(c, x, y, w, h, wd[1]!);
  rect(c, x, y, w, 2, wd[0]!);
  rect(c, x, y + h - 2, w, 2, wd[2]!);
  for (let i = 4; i < w; i += 6) rect(c, x + i, y + 2, 1, h - 4, wd[2]!);
  rect(c, x, y + 3, w, 1, trim);
  rect(c, x + (w >> 1) - 2, y + 4, 4, 4, trim);
  px(c, x + (w >> 1), y + 6, PAL.ink);
}
function sack(c: Ctx, x: number, y: number, w: number, h: number) {
  const wd = PAL.wood;
  for (let j = 0; j < h; j++) {
    const ww = Math.round(w * (0.6 + 0.4 * Math.sin((Math.PI * (j + 2)) / (h + 3))));
    rect(c, x + (w - ww) / 2 - 1, y + j, ww + 2, 1, PAL.ink);
    rect(c, x + (w - ww) / 2, y + j, ww, 1, j < 3 ? wd[0]! : j > h - 4 ? wd[2]! : wd[1]!);
  }
  rect(c, x + w / 2 - 4, y - 2, 8, 3, PAL.ink);
  rect(c, x + w / 2 - 3, y - 1, 6, 1, wd[0]!);
}
function jar(c: Ctx, x: number, y: number, w: number, h: number, fill: number) {
  const m = PAL.metal;
  rect(c, x - 1, y - 1, w + 2, h + 2, PAL.ink);
  rect(c, x, y, w, h, 'rgba(191,227,255,.18)');
  rect(c, x, y + Math.round(h * (1 - fill)), w, Math.round(h * fill), PAL.dust[3]!);
  rect(c, x, y + Math.round(h * (1 - fill)), w, 1, PAL.dust[1]!);
  rect(c, x + 1, y + 1, 1, h - 2, 'rgba(255,255,255,.5)');
  rect(c, x - 1, y - 3, w + 2, 3, PAL.ink);
  rect(c, x, y - 2, w, 1, m[1]!);
}
function crate(c: Ctx, x: number, y: number, w: number, h: number) {
  const m = PAL.metal;
  rect(c, x - 1, y - 1, w + 2, h + 2, PAL.ink);
  rect(c, x, y, w, h, m[3]!);
  rect(c, x, y, w, 1, m[2]!);
  rect(c, x, y + h - 1, w, 1, m[4]!);
  rect(c, x + 2, y + 2, w - 4, h - 4, m[4]!);
  rect(c, x + 3, y + 3, w - 6, 1, PAL.comp[2]!);
}
function portal(c: Ctx, cx: number, cy: number, r: number, color: string) {
  for (let a = 0; a < 360; a += 4) {
    const rad = (a * Math.PI) / 180;
    px(c, cx + Math.cos(rad) * r, cy + Math.sin(rad) * r * 0.8, color);
    px(c, cx + Math.cos(rad) * (r - 1), cy + Math.sin(rad) * (r - 1) * 0.8, PAL.ink);
  }
}
const hash = (i: number, k: number) => (((Math.sin(i * k) * 43758.5453) % 1) + 1) % 1;

/** Paints one frame of a pack (`t` in ms moves only the sparkles; 0 is a still frame). */
export function paintPack(canvas: HTMLCanvasElement, art: PackArt, t = 0): void {
  const c = canvas.getContext('2d');
  if (!c) return;
  const W = canvas.width;
  const H = canvas.height;
  const { kind, tier } = art;
  c.clearRect(0, 0, W, H);
  const cx = W / 2;
  const base = H - 8;
  const glow = GLOW[kind];
  const g = c.createRadialGradient(cx, H * 0.55, 2, cx, H * 0.55, W * (0.25 + tier * 0.05));
  g.addColorStop(0, `rgba(${glow},${0.25 + tier * 0.06})`);
  g.addColorStop(1, `rgba(${glow},0)`);
  c.fillStyle = g;
  c.fillRect(0, 0, W, H);
  if (tier >= 5) portal(c, cx, H * 0.48, W * 0.36, `rgb(${glow})`);
  if (kind === 'coins') {
    if (tier >= 3) chest(c, cx - 14, base - 12, 28, 12, PAL.coin[1]!);
    else if (tier === 2) sack(c, cx - 10, base - 14, 20, 14);
    pile(c, 'coins', N[tier]!, cx, tier >= 2 ? base - (tier >= 3 ? 10 : 9) : base);
  } else if (kind === 'dust') {
    const jars = Math.min(tier + 1, 4);
    for (let j = 0; j < jars; j++) jar(c, cx - jars * 6 + j * 12 + 1, base - 16 - (j % 2) * 3, 9, 14, 0.5 + tier / 10);
    if (tier >= 3) pile(c, 'dust', N[tier - 2]!, cx, base - 15);
  } else if (kind === 'components') {
    if (tier >= 2) crate(c, cx - 13, base - 12, 26, 12);
    pile(c, 'components', N[Math.max(0, tier - 1)]!, cx, tier >= 2 ? base - 11 : base);
  } else {
    chest(c, cx - 16, base - 13, 32, 13, PAL.dust[2]!);
    pile(c, 'coins', 4 + tier * 2, cx - 7, base - 12);
    pile(c, 'dust', 2 + tier, cx + 9, base - 12);
    pile(c, 'components', 1 + Math.floor(tier / 2), cx + 1, base - 20);
  }
  const sparks = 2 + tier * 2;
  for (let i = 0; i < sparks; i++) {
    const phase = (t / 400 + i * 1.7) % 3;
    if (phase > 1) continue;
    const x = hash(i, 12.9898) * (W - 8) + 4;
    const y = hash(i, 78.233) * (H * 0.6) + 3;
    const color = phase < 0.5 ? '#ffffff' : `rgb(${glow})`;
    px(c, x, y, color);
    if (phase > 0.25 && phase < 0.75) {
      px(c, x - 1, y, color);
      px(c, x + 1, y, color);
      px(c, x, y - 1, color);
      px(c, x, y + 1, color);
    }
  }
}
