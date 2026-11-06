/**
 * Living backdrop (DESIGN_SYSTEM §8), ported from the approved title demo: a 400×225 pixel-art sky with Bayer-dithered
 * nebula, a planet, the ECN station with its scan beam, probes and comets; plus a DECORATIVE braille galaxy drawn as
 * Unicode text (the real engine arrives in M2a). Pure drawing: no React, no Math.random in anything that matters.
 */

type Rgb = [number, number, number];
export type SceneTargets = {
  canvas: HTMLCanvasElement;
  arms: HTMLPreElement;
  core: HTMLPreElement;
  glitch: HTMLPreElement;
  scan: HTMLPreElement;
};

const W = 400;
const H = 225;
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
const at = <T,>(a: readonly T[], i: number): T => a[i] as T;

function mulberry(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function hash2(x: number, y: number) {
  let h = Math.imul(x, 374761393) ^ Math.imul(y, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
const smooth = (t: number) => t * t * (3 - 2 * t);
function vnoise(x: number, y: number) {
  const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
  const a = hash2(xi, yi), b = hash2(xi + 1, yi), c = hash2(xi, yi + 1), d = hash2(xi + 1, yi + 1);
  const u = smooth(xf), v = smooth(yf);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
function fbm(x: number, y: number) {
  let s = 0, amp = 0.5, f = 1;
  for (let i = 0; i < 5; i++) {
    s += amp * vnoise(x * f, y * f);
    f *= 2.03;
    amp *= 0.5;
  }
  return s;
}
const hex = (h: string): Rgb => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];

const SKY = ['#050817', '#08102a', '#0b1a3e', '#10264f', '#16305c', '#2b3069', '#4b2f6e', '#7a3570', '#ad476d', '#d86563', '#f28e5c', '#ffc27a'].map(hex);
const PLANET = ['#06071a', '#0d0f29', '#161838', '#221f48', '#3b2a55', '#6a3a5e', '#b25e62', '#ffa36b'].map(hex);
const PCX = 232, PCY = H + 330, PR = 382;
const SX = PCX, SY = H - 50;

function bakeSky(ctx: CanvasRenderingContext2D): ImageData {
  const img = ctx.createImageData(W, H);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4, th = at(BAYER, (y & 3) * 4 + (x & 3)) / 16;
      const dx = x - PCX, dy = y - PCY, dist = Math.hypot(dx, dy);
      let col: Rgb;
      if (dist < PR) {
        const depth = PR - dist;
        const light = Math.max(0, (-dx / PR) * 0.6 + 0.7);
        let v = Math.max(0, 7.2 - depth * 0.55) * light + (fbm(x * 0.05, y * 0.09) - 0.5) * 1.6;
        v = Math.max(0, Math.min(PLANET.length - 1.001, v));
        const k = Math.floor(v);
        col = at(PLANET, v - k > th ? Math.min(k + 1, PLANET.length - 1) : k);
      } else {
        let v = (y / H) * 4.2;
        const band = Math.exp(-(((y - (150 - x * 0.28)) / 52) ** 2));
        v += Math.max(0, fbm(x * 0.011 + 3, y * 0.02) - 0.32) * band * 15;
        v += Math.max(0, fbm(x * 0.02 + 40, y * 0.03 + 9) - 0.55) * 7 * Math.exp(-(((x - 300) / 90) ** 2));
        v += Math.exp(-(dist - PR) / 12) * 4;
        v = Math.max(0, Math.min(SKY.length - 1.001, v));
        const k = Math.floor(v);
        col = at(SKY, v - k > th ? Math.min(k + 1, SKY.length - 1) : k);
      }
      img.data[i] = col[0];
      img.data[i + 1] = col[1];
      img.data[i + 2] = col[2];
      img.data[i + 3] = 255;
    }
  return img;
}

/* ---------- Braille galaxy (decorative) ---------- */
const COLS = 90, ROWS = 42, DW = COLS * 2, DH = ROWS * 4;
const BIT = [[0x01, 0x08], [0x02, 0x10], [0x04, 0x20], [0x40, 0x80]];
const BLANK = '⠀';
type Pt = { r: number; th: number; c: boolean };

function galaxyPoints(): Pt[] {
  const rg = mulberry(7);
  const gauss = () => {
    let u = 0, v = 0;
    while (!u) u = rg();
    while (!v) v = rg();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(6.283 * v);
  };
  const pts: Pt[] = [];
  for (let i = 0; i < 7600; i++) {
    const arm = i % 3, t = rg(), r = 0.1 + 0.9 * Math.pow(t, 0.75);
    pts.push({ r, th: arm * 2.094 + 2.7 * Math.log(r * 10 + 1) + gauss() * 0.32 * (1.1 - r * 0.5), c: false });
  }
  for (let i = 0; i < 2600; i++) pts.push({ r: Math.abs(gauss()) * 0.12, th: rg() * 6.283, c: true });
  for (let i = 0; i < 700; i++) pts.push({ r: Math.sqrt(rg()) * 1.05, th: rg() * 6.283, c: false });
  return pts;
}

function toRows(g: Uint8Array): string[] {
  const out: string[] = [];
  for (let r = 0; r < ROWS; r++) {
    let s = '';
    for (let c = 0; c < COLS; c++) s += String.fromCharCode(0x2800 + (g[r * COLS + c] ?? 0));
    out.push(s);
  }
  return out;
}

/** Starts the backdrop; returns a stop function. With `reduce`, draws one still frame. */
export function startScene(t: SceneTargets, opts: { reduce: boolean }): () => void {
  const maybe = t.canvas.getContext('2d');
  if (!maybe) return () => {};
  const ctx: CanvasRenderingContext2D = maybe;
  const base = bakeSky(ctx);
  const rs = mulberry(42);
  const stars = Array.from({ length: 280 }, () => ({
    x: Math.floor(rs() * W), y: Math.floor(rs() * H * 0.8), b: rs(), s: 0.6 + rs() * 2.4, p: rs() * 6.28,
    c: rs() < 0.15 ? '#ffd9a0' : rs() < 0.3 ? '#bfe3ff' : '#ffffff',
  })).filter((s) => Math.hypot(s.x - PCX, s.y - PCY) > PR + 2);
  const fx = mulberry(99);
  const pts = galaxyPoints();
  const gA = new Uint8Array(COLS * ROWS), gC = new Uint8Array(COLS * ROWS);
  const blankRow = BLANK.repeat(COLS);
  const px = (x: number, y: number, w: number, h: number, c: string) => {
    ctx.fillStyle = c;
    ctx.fillRect(x | 0, y | 0, w, h);
  };

  function station(time: number) {
    const blink = (ph: number, sp = 1) => Math.sin(time * sp + ph) > -0.2;
    const pulse = 0.55 + 0.35 * Math.sin(time * 2.2);
    for (let y = 40; y < SY - 44; y++) {
      const k = (y - 40) / (SY - 84), hw = Math.round(22 * (1 - k) + 1.5);
      for (let x = SX - hw; x <= SX + hw; x++) {
        const edge = 1 - Math.abs(x - SX) / (hw + 0.5);
        const a = edge * 0.9 * pulse * (0.35 + 0.65 * k);
        if (a > at(BAYER, (y & 3) * 4 + (x & 3)) / 16 + 0.04) {
          ctx.globalAlpha = 0.42 + edge * 0.4;
          px(x, y, 1, 1, (x * 3 + y - Math.floor(time * 30)) % 11 === 0 ? '#ffffff' : '#9fd2ff');
        }
      }
    }
    ctx.globalAlpha = 1;
    px(SX - 36, SY - 4, 72, 4, '#232650'); px(SX - 36, SY - 4, 72, 1, '#4b5190');
    for (let i = 0; i < 8; i++) px(SX - 33 + i * 9, SY - 2, 2, 1, blink(i * 1.7, 1.3) ? '#45e3a6' : '#1a5a48');
    px(SX - 27, SY - 23, 54, 19, '#30366a'); px(SX - 27, SY - 23, 54, 1, '#5a64b0'); px(SX - 27, SY - 23, 1, 19, '#4a539a');
    px(SX + 26, SY - 23, 1, 19, '#1f2350');
    for (let i = 0; i < 10; i++) px(SX - 24 + i * 5, SY - 16, 2, 3, blink(i * 2.3, 0.7) ? '#ffc94a' : '#5b4a2a');
    for (let i = 0; i < 10; i++) px(SX - 24 + i * 5, SY - 10, 2, 2, blink(i * 1.1 + 3, 0.5) ? '#ffe3a0' : '#3a3550');
    px(SX - 15, SY - 29, 30, 6, '#3a4180'); px(SX - 15, SY - 29, 30, 1, '#6a75c8');
    for (let dy = 0; dy < 15; dy++) {
      const w = Math.round(Math.sqrt(225 - dy * dy));
      px(SX - w, SY - 30 - dy, w * 2, 1, '#9aa6d8');
      px(SX - w, SY - 30 - dy, Math.max(1, Math.round(w * 0.55)), 1, '#c9d3f0');
      px(SX + w - 2, SY - 30 - dy, 2, 1, '#6f7bb0');
    }
    px(SX - 2, SY - 45, 4, 15, '#0d0f2e'); px(SX - 1, SY - 49, 2, 6, '#e8eeff');
    px(SX - 43, SY - 41, 4, 37, '#262b5c'); px(SX - 43, SY - 41, 1, 37, '#3d4590'); px(SX - 44, SY - 44, 6, 3, '#30366a');
    if (blink(0, 3)) {
      px(SX - 42, SY - 46, 2, 2, '#ff6b7a');
      ctx.fillStyle = 'rgba(255,107,122,.35)';
      ctx.fillRect(SX - 44, SY - 48, 6, 6);
    }
    px(SX + 37, SY - 27, 2, 23, '#262b5c');
    px(SX + 30, SY - 33, 15, 2, '#aeb8dd'); px(SX + 31, SY - 31, 13, 2, '#7f8bc0'); px(SX + 33, SY - 29, 9, 1, '#5d6799');
    px(SX + 37, SY - 38, 2, 5, '#c9d3f0');
    if (blink(1, 4)) px(SX + 37, SY - 39, 2, 1, '#45e3a6');
  }

  type Probe = { x: number; y: number; v: number; tr: Array<[number, number]> };
  type Comet = { x: number; y: number; vx: number; vy: number; life: number };
  const probes: Probe[] = [], comets: Comet[] = [];
  let nextProbe = 1.5, nextComet = 3;
  function sky(time: number, dt: number) {
    for (const s of stars) {
      const v = s.b * (0.55 + 0.45 * Math.sin(time * s.s + s.p));
      if (v < 0.35) continue;
      px(s.x, s.y, 1, 1, s.c);
      if (v > 0.88 && s.b > 0.9) {
        ctx.globalAlpha = 0.45;
        px(s.x - 1, s.y, 3, 1, s.c);
        px(s.x, s.y - 1, 1, 3, s.c);
        ctx.globalAlpha = 1;
      }
    }
    if (opts.reduce) return;
    if (time > nextProbe) {
      const dir = fx() < 0.5 ? 1 : -1;
      probes.push({ x: dir > 0 ? -6 : W + 6, y: 20 + fx() * 90, v: dir * (26 + fx() * 18), tr: [] });
      nextProbe = time + 4 + fx() * 5;
    }
    if (time > nextComet) {
      comets.push({ x: 260 + fx() * 160, y: -4, vx: -95 - fx() * 40, vy: 55 + fx() * 20, life: 1.6 });
      nextComet = time + 6 + fx() * 6;
    }
    for (let i = probes.length - 1; i >= 0; i--) {
      const p = probes[i]!;
      p.tr.unshift([p.x, p.y]);
      p.tr.length = Math.min(p.tr.length, 14);
      p.x += p.v * dt;
      p.tr.forEach(([x, y], k) => {
        ctx.globalAlpha = (1 - k / 14) * 0.5;
        px(x, y, 1, 1, '#45e3a6');
      });
      ctx.globalAlpha = 1;
      px(p.x - 1, p.y - 1, 3, 2, '#e8eeff');
      px(p.x + (p.v > 0 ? 2 : -2), p.y - 1, 1, 1, '#ffc94a');
      if (p.x < -20 || p.x > W + 20) probes.splice(i, 1);
    }
    for (let i = comets.length - 1; i >= 0; i--) {
      const c = comets[i]!;
      c.x += c.vx * dt; c.y += c.vy * dt; c.life -= dt;
      for (let k = 0; k < 16; k++) {
        ctx.globalAlpha = (1 - k / 16) * Math.min(1, c.life);
        px(c.x - c.vx * k * 0.012, c.y - c.vy * k * 0.012, 1, 1, k < 3 ? '#ffffff' : '#ffc27a');
      }
      ctx.globalAlpha = 1;
      if (c.life <= 0) comets.splice(i, 1);
    }
  }

  const REVEAL = opts.reduce ? 0 : 1.25;
  let glitchUntil = 0, nextGlitch = 4.5;
  function noiseRow(r: number) {
    let s = '';
    const ny = (r - ROWS / 2) / (ROWS * 0.36);
    for (let c = 0; c < COLS; c++) {
      const nx = (c - COLS / 2) / (COLS * 0.48), d = Math.hypot(nx, ny);
      s += fx() < 0.5 * Math.max(0, 1 - d) ? String.fromCharCode(0x2800 + ((fx() * 256) | 0)) : BLANK;
    }
    return s;
  }
  function drawGalaxy(time: number) {
    gA.fill(0); gC.fill(0);
    const rot = time * 0.07, RX = DW * 0.47, RY = DH * 0.47 * 0.62 * (3 / 2.25);
    for (const p of pts) {
      const th = p.th + rot * (p.c ? 1.8 : 1 / (p.r * 1.4 + 0.6));
      const dx = Math.round(DW / 2 + Math.cos(th) * p.r * RX), dy = Math.round(DH / 2 + Math.sin(th) * p.r * RY);
      if (dx < 0 || dy < 0 || dx >= DW || dy >= DH) continue;
      const cell = (dy >> 2) * COLS + (dx >> 1), bit = BIT[dy & 3]![dx & 1]!;
      if (p.c) gC[cell] = (gC[cell] ?? 0) | bit;
      else gA[cell] = (gA[cell] ?? 0) | bit;
    }
    for (let i = 0; i < gC.length; i++) if (gC[i]) gA[i] = (gA[i] ?? 0) & ~(gC[i] ?? 0);
    const arms = toRows(gA), core = toRows(gC);
    if (time < REVEAL) {
      const scanRow = Math.floor((time / REVEAL) * (ROWS + 2));
      const a: string[] = [], c: string[] = [], s: string[] = [];
      for (let r = 0; r < ROWS; r++) {
        if (r < scanRow) { a.push(at(arms, r)); c.push(at(core, r)); s.push(blankRow); }
        else if (r === scanRow) { a.push(blankRow); c.push(blankRow); s.push('⣿'.repeat(COLS)); }
        else { a.push(noiseRow(r)); c.push(blankRow); s.push(blankRow); }
      }
      t.arms.textContent = a.join('\n'); t.core.textContent = c.join('\n'); t.scan.textContent = s.join('\n');
      return;
    }
    t.scan.textContent = '';
    t.arms.textContent = arms.join('\n');
    t.core.textContent = core.join('\n');
    if (!opts.reduce && time > nextGlitch) { glitchUntil = time + 0.32; nextGlitch = time + 7 + fx() * 5; }
    if (time < glitchUntil) {
      const r0 = 6 + ((fx() * (ROWS - 14)) | 0), h = 3 + ((fx() * 5) | 0), off = (fx() < 0.5 ? -1 : 1) * (3 + ((fx() * 6) | 0));
      const g = arms.map((row, r) => (r >= r0 && r < r0 + h ? row.slice(-off) + row.slice(0, -off) : blankRow));
      t.glitch.textContent = g.join('\n');
      t.glitch.style.opacity = '1';
      t.arms.style.transform = `translateX(${(fx() - 0.5) * 4}px)`;
    } else {
      t.glitch.style.opacity = '0';
      t.arms.style.transform = '';
    }
  }

  let raf = 0, stopped = false;
  const t0 = performance.now();
  let last = t0, acc = 0;
  const frame = (now: number) => {
    if (stopped) return;
    const time = (now - t0) / 1000, dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    ctx.putImageData(base, 0, 0);
    sky(opts.reduce ? 0 : time, dt);
    station(opts.reduce ? 0 : time);
    acc += dt;
    if (acc > 1 / 24 || time < REVEAL + 0.1) { acc = 0; drawGalaxy(opts.reduce ? 0 : time); }
    if (!opts.reduce) raf = requestAnimationFrame(frame);
  };
  raf = requestAnimationFrame(frame);
  return () => {
    stopped = true;
    cancelAnimationFrame(raf);
  };
}
