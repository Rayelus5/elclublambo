import { dist, draw, inEllipse, lit } from './fauna2';
import { P } from './palette';
import type { SpriteDef } from './types';

// The second and third forms of every Core (Nov plan B4; DESIGN_SYSTEM §8 quater): 40×40 like their first form, drawn by
// rule, each with a silhouette and palette of its own so a player knows at a glance which form came. Two frames: what
// makes the form itself moves (wings, a hammer, orbiting mites, a broadcast).

const C: [number, number] = [0.5, 0.5];
const N = 40;
const M = 19.5;
const TAU = Math.PI * 2;
/** Angle of a pixel's centre around (cx, cy), 0–2π. */
const angleAt = (x: number, y: number, cx = M, cy = M) => (Math.atan2(y + 0.5 - cy, x + 0.5 - cx) + TAU) % TAU;
/** Whether angle `a` is within `width` of `b`. */
const near = (a: number, b: number, width: number) => Math.abs(((a - b + Math.PI * 3) % TAU) - Math.PI) < width;
/** Inside a rotated ellipse centred at (cx, cy), turned by `turn` radians. */
const inTurned = (x: number, y: number, cx: number, cy: number, rx: number, ry: number, turn: number) => {
  const dx = x + 0.5 - cx;
  const dy = y + 0.5 - cy;
  const u = dx * Math.cos(turn) + dy * Math.sin(turn);
  const v = -dx * Math.sin(turn) + dy * Math.cos(turn);
  return (u / rx) * (u / rx) + (v / ry) * (v / ry) <= 1;
};
/** A 2×2 checker for dithered shading. */
const checker = (x: number, y: number) => (x + y) % 2 === 0;

// ——— La Colmena Rota ———

/** El Nido Voraz: a paper nest of amber bands, its mouth glowing, and a ring of mites that turns between frames. */
const hiveSwarm = (f: number) =>
  draw(N, N, (x, y) => {
    // The mites: eight small bodies orbiting the nest, lit on top.
    for (let k = 0; k < 8; k++) {
      const a = (k * TAU) / 8 + (f === 0 ? 0.2 : 0.2 + TAU / 16);
      const mx = M + Math.cos(a) * 16.4;
      const my = M + Math.sin(a) * 16.4;
      if (inEllipse(x, y, mx, my, 2.3, 1.9)) return x + 0.5 < mx && y + 0.5 < my ? 'q' : y + 0.5 < my ? 'm' : 'e';
    }
    const d = dist(x, y, M, M + 0.5);
    const a = angleAt(x, y, M, M + 0.5);
    // A lumpy rim: paper layers bulge.
    const rim = 12.2 + Math.sin(a * 5 + 0.6) * 0.9 + Math.sin(a * 3) * 0.5;
    if (d > rim) return '.';
    // The mouth: a dark hole low on the nest with an ember glow inside.
    if (inEllipse(x, y, M, 25.5, 4.6, 3.2)) {
      if (inEllipse(x, y, M, 26, f === 0 ? 1.6 : 2.4, f === 0 ? 1 : 1.5)) return 's';
      return inEllipse(x, y, M, 26, 3.2, 2.2) ? 'r' : 'z';
    }
    // Paper bands that follow the shape: alternate every 3 rows, curved like the nest.
    const band = Math.floor((y + Math.abs(x + 0.5 - M) * 0.18) / 3) % 2 === 0;
    if (Math.abs(((y + Math.abs(x + 0.5 - M) * 0.18) % 3) - 0) < 0.5 && d < rim - 0.8) return 'L';
    // Three small holes where the mites come and go.
    for (const [hx, hy] of [
      [14.5, 13],
      [24, 11.5],
      [27, 19],
    ] as const) {
      if (inEllipse(x, y, hx, hy, 1.6, 1.2)) return 'z';
    }
    return lit(x, y, M - 2, M - 2, 10, band ? ['s', 'o', 'r'] : ['o', 'r', 'L']);
  });

/** La Reina Falsa: the queen the Colmena never had. Crowned head, banded abdomen, two pairs of wings that beat. */
const hiveQueen = (f: number) =>
  draw(N, N, (x, y) => {
    const cx = M;
    // The crown: three gold points over the head.
    if (y >= 1 && y <= 4) {
      const ox = Math.abs(x + 0.5 - cx);
      const point = (ox < 1 && y >= 1) || (Math.abs(ox - 3) < 1 && y >= 2);
      if (point) return y === 1 || (y === 2 && ox > 2) ? 'w' : 's';
    }
    if (y >= 4 && y <= 5 && Math.abs(x + 0.5 - cx) <= 4) return y === 4 ? 's' : 'o';
    // Head with two red eyes.
    if (inEllipse(x, y, cx, 8.5, 4.2, 3.4)) {
      if (y === 8 && (x === 17 || x === 22)) return 'm';
      return lit(x, y, cx, 8.5, 4, ['U', 'u', 'a']);
    }
    // Wings, under the body: an upper and a lower pair that rise and fall between frames.
    const beat = f === 0 ? 0 : 0.38;
    const wings = [
      { cx: cx - 9.5, cy: 15, rx: 9.5, ry: 3.6, turn: -0.55 - beat },
      { cx: cx + 9.5, cy: 15, rx: 9.5, ry: 3.6, turn: 0.55 + beat },
      { cx: cx - 8, cy: 22, rx: 7, ry: 2.8, turn: 0.35 + beat * 0.6 },
      { cx: cx + 8, cy: 22, rx: 7, ry: 2.8, turn: -0.35 - beat * 0.6 },
    ];
    const body = inEllipse(x, y, cx, 15.5, 4.6, 4) || inEllipse(x, y, cx, 27, 6.4, 10.5);
    if (!body) {
      for (const w of wings) {
        if (!inTurned(x, y, w.cx, w.cy, w.rx, w.ry, w.turn)) continue;
        // Veins: a darker line along each wing; the rest a pale membrane.
        const edge = !inTurned(x, y, w.cx, w.cy, w.rx - 1.2, w.ry - 1.1, w.turn);
        if (edge) return 'b';
        return checker(x, y) ? 'i' : 'w';
      }
      return '.';
    }
    // Thorax.
    if (inEllipse(x, y, cx, 15.5, 4.6, 4)) return lit(x, y, cx, 15.5, 4, ['U', 'u', 'p']);
    // Abdomen: bands of violet and gold, a sting of white at the end.
    if (y >= 36) return 'w';
    const stripe = Math.floor((y - 18) / 3) % 2 === 0;
    if (stripe) return lit(x, y, cx, 27, 6, ['U', 'u', 'a']);
    return lit(x, y, cx, 27, 6, ['s', 'o', 'r']);
  });

// ——— La Madre Glaciar ———

/** El Huevo de Escarcha: a faceted egg of teal ice on a nest of shards; something curled inside lights up. */
const glacierEgg = (f: number) =>
  draw(N, N, (x, y) => {
    // The cradle: crystals rising from the ground around the egg's foot, leaning outwards.
    const crystals = [
      { x: 8, len: 11, lean: -0.55, w: 2.2 },
      { x: 12, len: 8, lean: -0.3, w: 1.8 },
      { x: 31, len: 11, lean: 0.55, w: 2.2 },
      { x: 27, len: 8, lean: 0.3, w: 1.8 },
      { x: 16, len: 5, lean: -0.15, w: 1.5 },
      { x: 23, len: 5, lean: 0.15, w: 1.5 },
    ];
    // The egg: narrower at the top.
    const cy = 18;
    const ry = 15;
    const t = (y + 0.5 - cy) / ry;
    const half = Math.abs(t) > 1 ? -1 : 11.6 * Math.sqrt(1 - t * t) * (1 + 0.16 * t);
    const ox = x + 0.5 - M;
    const inEgg = Math.abs(ox) <= half;
    for (const c of crystals) {
      const up = 37.5 - (y + 0.5);
      if (up < 0 || up > c.len) continue;
      const axis = c.x + 0.5 + up * Math.sin(c.lean);
      const w = c.w * (1 - up / (c.len + 0.5));
      const off = x + 0.5 - axis;
      // The egg sits in front of the inner crystals.
      if (Math.abs(off) <= w + 0.25 && !(inEgg && Math.abs(c.lean) < 0.4)) return off < 0 ? (up > c.len - 2 ? 'w' : 'i') : 'b';
    }
    if (!inEgg) return '.';
    // The thing inside: a curled shadow, its eye glowing in frame 1.
    const curl = dist(x, y, M + 1, 20);
    if (curl < 5.5 && curl > 2.4 && angleAt(x, y, M + 1, 20) > 0.6) return f === 0 ? 'J' : 'D';
    if (curl <= 2.4) return f === 0 ? 'j' : curl < 1.4 ? 'w' : 'c';
    // Cracks: two jagged white lines.
    if ((Math.abs(ox + 6 - (y - 6) * 0.3) < 0.6 && y > 6 && y < 15) || (Math.abs(ox - 5 + Math.abs(y - 26) * 0.5) < 0.6 && y > 22 && y < 30)) return 'w';
    // Facets: diamond cells shaded by the light.
    const facet = (Math.floor((x + y) / 5) + Math.floor((x - y + 40) / 5)) % 2 === 0;
    return lit(x, y, M - 3, cy - 4, 11, facet ? ['w', 'i', 'j'] : ['i', 'j', 'J']);
  });

/** La Hija del Glaciar: what hatched. A crystal moth with four wings of frost that open and close. */
const glacierDaughter = (f: number) =>
  draw(N, N, (x, y) => {
    const cx = M;
    // Antennae.
    for (const side of [-1, 1]) {
      const ax = cx + side * (1.6 + (9 - y) * 0.45);
      if (y >= 3 && y <= 8 && Math.abs(x + 0.5 - ax) < 0.6) return y === 3 ? 'c' : 'Y';
    }
    // Body: head, thorax and a tapered tail.
    if (inEllipse(x, y, cx, 10, 2.6, 2.2)) return y === 10 && (x === 18 || x === 21) ? 'c' : lit(x, y, cx, 10, 3, ['U', 'u', 'a']);
    if (inEllipse(x, y, cx, 16, 3, 4)) return lit(x, y, cx, 16, 3, ['w', 'U', 'u']);
    if (inEllipse(x, y, cx, 26, 2.2, 7.5)) return Math.floor(y / 2) % 2 === 0 ? lit(x, y, cx, 26, 3, ['U', 'u', 'a']) : 'p';
    // Wings: big upper pair, smaller lower pair; frame 1 lifts them.
    const open = f === 0 ? 0 : 0.18;
    const wings = [
      { cx: cx - 10, cy: 14 - open * 6, rx: 10, ry: 7, turn: -0.4 - open },
      { cx: cx + 10, cy: 14 - open * 6, rx: 10, ry: 7, turn: 0.4 + open },
      { cx: cx - 8, cy: 26, rx: 7.5, ry: 5, turn: 0.5 + open * 0.5 },
      { cx: cx + 8, cy: 26, rx: 7.5, ry: 5, turn: -0.5 - open * 0.5 },
    ];
    for (let k = 0; k < wings.length; k++) {
      const w = wings[k]!;
      if (!inTurned(x, y, w.cx, w.cy, w.rx, w.ry, w.turn)) continue;
      const inner = inTurned(x, y, w.cx, w.cy, w.rx - 1.4, w.ry - 1.4, w.turn);
      if (!inner) return 'D';
      // An eye spot of frost on each upper wing, white rims on each.
      const spot = dist(x, y, w.cx + (w.cx < cx ? -2 : 2), w.cy);
      if (k < 2 && spot < 2) return 'w';
      if (k < 2 && spot < 3.2) return 'c';
      return lit(x, y, w.cx - 3, w.cy - 3, 8, ['i', 'b', 'd']);
    }
    return '.';
  });

// ——— La Anémona Rey ———

/** La Flor de Esporas: six green petals open around a coral heart full of seeds; spores drift away between frames. */
const anemoneSpore = (f: number) =>
  draw(N, N, (x, y) => {
    // Loose spores drifting outwards.
    const spores = f === 0 ? [[3, 6], [35, 9], [36, 31], [4, 33], [20, 1]] : [[2, 4], [37, 7], [37, 34], [2, 35], [21, 0]];
    for (const [sx, sy] of spores) if (x === sx && y === sy) return 'q';
    const d = dist(x, y, M, M);
    const a = angleAt(x, y);
    // The heart: a coral disk with a ring of seed pods.
    if (d <= 6.4) {
      if (d > 4.6 && Math.floor(a / (TAU / 10)) % 2 === 0) return f === 0 ? 's' : 'w';
      if (d < 2) return 'z';
      return lit(x, y, M, M, 5, ['q', 'Q', 'x']);
    }
    // Six rounded petals, each a lobe at radius 11.
    for (let k = 0; k < 6; k++) {
      const pa = (k * TAU) / 6 - Math.PI / 2 + (f === 0 ? 0 : 0.06);
      const px = M + Math.cos(pa) * 11.5;
      const py = M + Math.sin(pa) * 11.5;
      if (inTurned(x, y, px, py, 7.6, 5.6, pa)) {
        const vein = Math.abs((x + 0.5 - M) * Math.sin(pa) - (y + 0.5 - M) * Math.cos(pa)) < 0.55;
        if (vein) return 'h';
        // Coral spots near each tip.
        if (dist(x, y, M + Math.cos(pa) * 15, M + Math.sin(pa) * 15) < 1.6) return 'q';
        return lit(x, y, px, py, 6, ['g', 'G', 'h']);
      }
    }
    return '.';
  });

/** La Boca del Arrecife: a lip of coral ringed with stubby arms, rows of teeth and, deep in the throat, stolen light. */
const anemoneMaw = (f: number) =>
  draw(N, N, (x, y) => {
    const d = dist(x, y, M, M);
    const a = angleAt(x, y);
    // Stubby arms around the lip, swaying between frames.
    if (d > 15 && d <= 19) {
      const sway = f === 0 ? 0 : TAU / 32;
      for (let k = 0; k < 14; k++) if (near(a, (k * TAU) / 14 + sway, 0.13)) return d > 17.6 ? 'w' : k % 2 === 0 ? 'q' : 'U';
      return '.';
    }
    if (d > 15) return '.';
    // The lip: ridged coral.
    if (d > 10.5) {
      // Fleshy folds: a dark crease between each, lit from the top left.
      if (near((a + TAU / 24) % (TAU / 12), 0, 0.07)) return 'x';
      return lit(x, y, M, M, 13, ['q', 'Q', 'x']);
    }
    // Teeth: a ring of white fangs pointing in.
    if (d > 6.5) {
      const tooth = (a / (TAU / 16)) % 1;
      const depth = (10.5 - d) / 4;
      if (Math.abs(tooth - 0.5) < 0.42 * (1 - depth)) return depth < 0.35 ? 'Y' : 'w';
      return 'z';
    }
    // The throat: a spiral of drunk light that turns between frames.
    const spin = f === 0 ? 0 : 0.9;
    const arm = (a + d * 0.55 + spin) % (TAU / 3);
    if (d < 1.6) return 'w';
    if (arm < 0.7) return d < 4 ? 'c' : 'j';
    return d < 4.5 ? 'J' : 'z';
  });

// ——— El Yunque ———

/** El Martinete: a power hammer in its frame. The head is up in one frame and down on the glowing ingot in the other. */
const anvilHammer = (f: number) =>
  draw(N, N, (x, y) => {
    const headTop = f === 0 ? 9 : 15;
    // The crossbeam and the two pillars.
    if (y >= 2 && y <= 6 && x >= 3 && x <= 36) return y === 2 ? 'Y' : lit(x, y, M, 4, 20, ['Y', 'T', 't']);
    if (y > 6 && y <= 33 && ((x >= 4 && x <= 8) || (x >= 31 && x <= 35))) {
      if ((y + (x > 20 ? 2 : 0)) % 6 === 0) return 't';
      return x === 4 || x === 31 ? 'Y' : x === 8 || x === 35 ? 't' : 'T';
    }
    // The piston rod.
    if (y > 6 && y < headTop && x >= 18 && x <= 21) return x === 18 ? 'Y' : 'y';
    // The head: a heavy block with hazard stripes.
    if (y >= headTop && y <= headTop + 7 && x >= 11 && x <= 28) {
      if (y === headTop + 7) return 't';
      if (y >= headTop + 2 && y <= headTop + 4) return (x + y) % 4 < 2 ? 's' : 'k';
      // The Static's two red eyes, like the Yunque's.
      if (y === headTop + 5 && (x === 15 || x === 24)) return 'm';
      return lit(x, y, M, headTop + 3, 8, ['Y', 'T', 't']);
    }
    // The ingot on the block: hotter when struck.
    if (y >= 24 && y <= 26 && x >= 14 && x <= 25) {
      if (f === 1) return y === 24 ? 'w' : 's';
      return y === 24 ? 's' : 'o';
    }
    // The anvil block and its feet.
    if (y >= 27 && y <= 32 && x >= 10 && x <= 29) return y === 27 ? 'Y' : lit(x, y, M, 29, 10, ['T', 't', 't']);
    if (y >= 33 && y <= 37 && x >= 2 && x <= 37) {
      if (y === 33) return 'Y';
      return (x - y) % 5 === 0 ? 'l' : lit(x, y, M, 35, 18, ['T', 't', 'L']);
    }
    // Sparks when it lands.
    if (f === 1 && ((x === 10 && y === 22) || (x === 29 && y === 21) || (x === 12 && y === 19) || (x === 27 && y === 18))) return 's';
    return '.';
  });

/** La Fragua Ciega: a furnace dome with no eyes, only a grated mouth of fire; its chimneys spit embers. */
const anvilFurnace = (f: number) =>
  draw(N, N, (x, y) => {
    // Embers over the chimneys.
    const embers = f === 0 ? [[11, 1], [28, 2], [13, 4]] : [[12, 0], [27, 0], [26, 3]];
    for (const [ex, ey] of embers) if (x === ex && y === ey) return 'o';
    // Two chimneys.
    for (const cx of [11.5, 27.5]) {
      if (y >= 4 && y <= 12 && Math.abs(x + 0.5 - cx) <= 2.5) {
        if (y === 4) return 'l';
        return x + 0.5 < cx ? 'T' : 't';
      }
    }
    // The dome and the body.
    const dome = inEllipse(x, y, M, 21, 16.5, 12.5) && y <= 21;
    const body = y > 21 && y <= 34 && x >= 3 && x <= 36;
    const foot = y > 34 && y <= 37 && x >= 1 && x <= 38;
    if (!dome && !body && !foot) return '.';
    if (foot) return y === 35 ? 'T' : 't';
    // The mouth: an arch with grate bars and the fire behind.
    const mouth = (inEllipse(x, y, M, 26, 8, 6.5) && y <= 26) || (y > 26 && y <= 32 && x >= 12 && x <= 27);
    if (mouth) {
      if (x % 4 === 1) return 't';
      const heat = (y - 20) / 12 + (f === 0 ? 0 : -0.12);
      return heat < 0.35 ? 'l' : heat < 0.7 ? 'o' : x % 4 === 3 ? 'w' : 's';
    }
    // A band of rivets where the dome meets the body.
    if (y === 21 || y === 22) return y === 21 ? 'Y' : x % 3 === 0 ? 's' : 't';
    // Two seams of lava running down the plates.
    const seam = (y > 8 && Math.abs(x + 0.5 - (8 + (y - 8) * 0.25)) < 0.6) || (y > 10 && Math.abs(x + 0.5 - (31 - (y - 10) * 0.3)) < 0.6);
    if (seam && !mouth) return (y + f) % 3 === 0 ? 's' : 'l';
    // Plates: lit on the upper left, a rim of slag on the right, rivets across.
    if (x >= 34 || (body && y >= 33)) return 'L';
    const l = -(x + 0.5 - 12 + (y + 0.5 - 12)) / 22;
    if (l > 0.35) return 'T';
    return (x + y * 3) % 11 === 0 ? 'T' : 't';
  });

// ——— El Eco Profundo ———

/** El Coro Abisal: three dark spheres of the Eco singing together, joined by a ring; their eyes take turns to open. */
const echoChoir = (f: number) =>
  draw(N, N, (x, y) => {
    const spheres = [
      { cx: M, cy: 11, r: 8.5 },
      { cx: 10.5, cy: 27, r: 8.5 },
      { cx: 28.5, cy: 27, r: 8.5 },
    ];
    for (let k = 0; k < spheres.length; k++) {
      const s = spheres[k]!;
      const d = dist(x, y, s.cx, s.cy);
      if (d > s.r) continue;
      // One eye open per frame and sphere: the top one in frame 0, the lower ones in frame 1.
      const open = (k === 0) === (f === 0);
      if (open && inEllipse(x, y, s.cx, s.cy, 3.2, 2.4)) return inEllipse(x, y, s.cx, s.cy, 0.9, 2) ? 'k' : d < 1.8 ? 'w' : 'c';
      if (!open && Math.abs(y + 0.5 - s.cy) < 0.6 && Math.abs(x + 0.5 - s.cx) < 3) return 'c';
      if (Math.abs(d - 6.2) < 0.5) return 'u';
      return lit(x, y, s.cx, s.cy, 7, ['a', 'p', 'z']);
    }
    // The ring that binds them, broken in three places.
    const d = dist(x, y, M, 21.5);
    if (Math.abs(d - 13.5) < 0.7 && Math.floor(angleAt(x, y, M, 21.5) / (TAU / 12) + (f === 0 ? 0 : 0.5)) % 4 !== 0) return 'c';
    return '.';
  });

/** El Reflejo Profundo: a hexagonal mirror holding one eye, half lit and half void, with shards circling it. */
const echoMirror = (f: number) =>
  draw(N, N, (x, y) => {
    const ox = x + 0.5 - M;
    const oy = y + 0.5 - M;
    // Four shards around the mirror that turn between frames.
    for (let k = 0; k < 4; k++) {
      const a = (k * TAU) / 4 + Math.PI / 4 + (f === 0 ? 0 : 0.35);
      const sx = M + Math.cos(a) * 16;
      const sy = M + Math.sin(a) * 16;
      if (Math.abs(x + 0.5 - sx) + Math.abs(y + 0.5 - sy) * 0.7 < 2.6) return x + 0.5 < sx ? 'w' : 'y';
    }
    // The hexagon (pointy top), with a frame of steel.
    const hx = Math.abs(ox);
    const hy = Math.abs(oy);
    const inside = (k: number) => hx <= 11.5 - k && hy <= 14.5 - k - hx * 0.55;
    if (!inside(0)) return '.';
    if (!inside(1.6)) return lit(x, y, M, M, 12, ['Y', 'y', 'T']);
    // The eye in the middle: its pupil slides between frames.
    if (inEllipse(x, y, M, M, 5.5, 3.6)) {
      const px = M + (f === 0 ? -1 : 1);
      if (inEllipse(x, y, px, M, 1.1, 2.6)) return 'k';
      return inEllipse(x, y, M, M, 3.6, 2.4) ? 'c' : 'w';
    }
    // Half the mirror is lit glass, the other half the void it reflects.
    if (ox < -oy * 0.2) {
      const streak = Math.abs(ox + oy * 0.6 + 4) < 0.8 || Math.abs(ox + oy * 0.6 + 7.5) < 0.5;
      return streak ? 'w' : checker(x, y) && hy > 9 ? 'Y' : 'i';
    }
    return lit(x, y, M + 4, M + 4, 9, ['u', 'a', 'p']);
  });

// ——— La Señal ———

/** La Onda Portadora: a dish turned to the sky on its tripod; rings of the carrier wave leave its horn and widen. */
const signalCarrier = (f: number) =>
  draw(N, N, (x, y) => {
    // The dish faces up and to the right: its rim is tilted, its focus out along the normal.
    const turn = 0.6;
    const nx = Math.sin(turn);
    const ny = -Math.cos(turn);
    const rimX = 15.5;
    const rimY = 19;
    const fx = rimX + nx * 10;
    const fy = rimY + ny * 10;
    // The carrier wave: arcs around the horn, towards where the dish looks, that widen between frames.
    const hd = dist(x, y, fx, fy);
    const ha = angleAt(x, y, fx, fy);
    const look = Math.atan2(ny, nx);
    for (const r of f === 0 ? [5, 9, 13] : [6.8, 10.8, 14.8]) {
      if (Math.abs(hd - r) < 0.6 && near(ha, (look + TAU) % TAU, 0.75 - r * 0.02)) return r < 10 ? 'g' : 'G';
    }
    // The horn at the focus, and the arm that holds it.
    if (hd < 2) return f === 0 ? 'w' : 'g';
    const along = ((x + 0.5 - rimX) * nx + (y + 0.5 - rimY) * ny) / 10;
    if (along > 0 && along < 1) {
      const px = rimX + nx * 10 * along;
      const py = rimY + ny * 10 * along;
      if (Math.hypot(x + 0.5 - px, y + 0.5 - py) < 0.75) return 'Y';
    }
    // The dish face: concave, lit, with rings that show its depth.
    if (inTurned(x, y, rimX, rimY, 14, 6.4, turn)) {
      if (!inTurned(x, y, rimX, rimY, 12.8, 5.3, turn)) return 'w';
      const ring = [0.35, 0.68].some((k) => inTurned(x, y, rimX, rimY, 14 * k + 0.6, 6.4 * k + 0.6, turn) && !inTurned(x, y, rimX, rimY, 14 * k - 0.4, 6.4 * k - 0.4, turn));
      if (ring) return 'V';
      return lit(x, y, rimX - 4, rimY - 2, 10, ['U', 'v', 'V']);
    }
    // The back of the dish, behind the rim: dark panels.
    if (inTurned(x, y, rimX - nx * 3.6, rimY - ny * 3.6, 13.4, 6.4, turn)) return Math.floor((x + 0.5 - rimX) / 3 + 10) % 2 === 0 ? 'p' : 'V';
    // The tripod and its base plate.
    for (const foot of [7, 15.5, 25]) {
      if (y >= 25 && y <= 35) {
        const lx = 15.5 + ((foot - 15.5) * (y - 25)) / 10;
        if (Math.abs(x + 0.5 - lx) < 0.95) return x + 0.5 < lx ? 'Y' : 'T';
      }
    }
    if (y >= 35 && y <= 37 && x >= 4 && x <= 28) return y === 35 ? 'y' : 't';
    return '.';
  });

/** La Respuesta: a monolith carved with one braille letter that glows, under a halo, a glitch running over it. */
const signalAnswer = (f: number) =>
  draw(N, N, (x, y) => {
    // The halo: a ring floating over the stone.
    if (inEllipse(x, y, M, 3.6, 8.5, 2.6) && !inEllipse(x, y, M, 3.6, 7, 1.4)) return x < 18 ? (f === 0 ? 'w' : 's') : f === 0 ? 's' : 'o';
    // The pedestal.
    if (y >= 35 && y <= 38 && x >= 6 && x <= 33) return y === 35 ? 'Y' : y === 38 ? 't' : x < 10 || x > 29 ? 't' : 'T';
    // The stone: rounded shoulders.
    const body = x >= 10 && x <= 29 && y >= 9 && y <= 34;
    const cap = inEllipse(x, y, M, 11.5, 10.4, 5.5) && y < 12;
    if (!body && !cap) {
      // Glitch shards slipping off its sides.
      if (f === 0 && y === 19 && (x === 6 || x === 7)) return 'v';
      if (f === 1 && y === 27 && (x === 32 || x === 33)) return 'v';
      return '.';
    }
    // The braille cell: two columns of three; the letter's dots raised and glowing, the others carved pits.
    const raised = [
      [true, true, false],
      [false, true, true],
    ];
    for (let col = 0; col < 2; col++) {
      for (let row = 0; row < 3; row++) {
        const cx = col === 0 ? 15.5 : 24.5;
        const cy = 15.5 + row * 7;
        const d = dist(x, y, cx, cy);
        if (raised[col]![row]) {
          if (d < 2.4) {
            const lt = -(x + 0.5 - cx + (y + 0.5 - cy));
            if (lt > 1.6) return 'w';
            return lt < -1.5 ? (f === 0 ? 'o' : 'r') : 's';
          }
          if (d < 3.1) return f === 0 ? 'r' : 'L';
        } else if (d < 1.8) return 'p';
      }
    }
    // A scanline of glitch that runs over it between frames.
    if (y === (f === 0 ? 31 : 11) && x >= 11 && x <= 28) return x % 2 === 0 ? 'v' : 'V';
    // Bevel: lit on the left and top, dark on the right.
    if (x === 10 || (cap && !inEllipse(x, y, M, 11.5, 9.4, 4.5))) return 'Y';
    if (x === 29) return 't';
    // Fine cracks in the stone.
    if ((x === 13 && y > 30) || (y === 26 && x > 26)) return 't';
    return checker(x, y) && y > 30 ? 't' : 'T';
  });

const core = (fn: (f: number) => string[], fps: number): SpriteDef => ({ w: N, h: N, fps, anchor: C, palette: P, frames: [fn(0), fn(1)] });

/** The second and third forms of the six Cores, by sprite id (the content's `sprite`). */
export const FORMS: Record<string, SpriteDef> = {
  'hive-swarm': core(hiveSwarm, 4),
  'hive-queen': core(hiveQueen, 4),
  'glacier-egg': core(glacierEgg, 2),
  'glacier-daughter': core(glacierDaughter, 3),
  'anemone-spore': core(anemoneSpore, 2),
  'anemone-maw': core(anemoneMaw, 3),
  'anvil-hammer': core(anvilHammer, 2),
  'anvil-furnace': core(anvilFurnace, 3),
  'echo-choir': core(echoChoir, 2),
  'echo-mirror': core(echoMirror, 2),
  'signal-carrier': core(signalCarrier, 3),
  'signal-answer': core(signalAnswer, 2),
};
