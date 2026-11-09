import { TIERS, type Tier } from '@galaxy/shared';

// The reveal's burst (open beta), as pure data so it is tested and the stage only draws it: sparks from the card,
// confetti from rare up (raining from the top on epic and legendary), rings of light, a flash for epic and
// legendary, and a shake for legendary. The same pull always bursts the same way: a seeded generator, no Math.random.

export interface Particle {
  kind: 'spark' | 'confetti';
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Seconds lived, and how many it lives. */
  life: number;
  max: number;
  size: number;
  color: string;
  rot: number;
  vr: number;
}

export interface Ring {
  x: number;
  y: number;
  /** Seconds after the burst it starts, and how long it grows. */
  delay: number;
  max: number;
  color: string;
}

export interface Burst {
  particles: Particle[];
  rings: Ring[];
  /** Opacity of the flash over the screen (0: none). */
  flash: number;
  shake: boolean;
  /** Light beams turning behind the card. */
  beams: boolean;
}

/** Each rarity's colours, from the tier tokens of the design system (and white). */
export const TIER_COLORS: Record<Tier, string[]> = {
  common: ['#c9d0ea', '#ffffff'],
  uncommon: ['#45e3a6', '#bfffe6', '#ffffff'],
  rare: ['#6fb7ff', '#bfe3ff', '#ffffff', '#45e3a6'],
  epic: ['#b39dff', '#e3d9ff', '#ff6b7a', '#ffffff'],
  legendary: ['#ffc94a', '#fff1b8', '#ff9d2e', '#ffffff', '#ff6b7a'],
};

const SPEC: { sparks: number; confetti: number; rings: number; flash: number }[] = [
  { sparks: 24, confetti: 0, rings: 0, flash: 0 },
  { sparks: 40, confetti: 0, rings: 1, flash: 0 },
  { sparks: 60, confetti: 40, rings: 1, flash: 0 },
  { sparks: 90, confetti: 90, rings: 2, flash: 0.35 },
  { sparks: 140, confetti: 170, rings: 3, flash: 0.7 },
];

/** mulberry32 seeded from a string (FNV-1a). */
function seeded(seed: string): () => number {
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 0x01000193) >>> 0;
  let a = h || 1;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The burst of a pull of `tier` (seeded by the pull), for a screen of `w`×`h`, centred where the card lands. */
export function burstFor(tier: Tier, seed: string, w: number, h: number): Burst {
  const t = TIERS.indexOf(tier);
  const spec = SPEC[t] ?? SPEC[0]!;
  const r = seeded(`${seed}:${tier}`);
  const colors = TIER_COLORS[tier];
  const pick = () => colors[Math.floor(r() * colors.length)]!;
  const cx = w / 2;
  const cy = h * 0.46;
  const particles: Particle[] = [];
  for (let i = 0; i < spec.sparks; i++) {
    const a = r() * Math.PI * 2;
    const speed = (180 + r() * 420) * (1 + t * 0.25);
    particles.push({ kind: 'spark', x: cx, y: cy, vx: Math.cos(a) * speed, vy: Math.sin(a) * speed - 140, life: 0, max: 0.6 + r() * 0.8, size: 2 + Math.floor(r() * 3), color: pick(), rot: 0, vr: 0 });
  }
  for (let i = 0; i < spec.confetti; i++) {
    // Rare: a fountain from the card. Epic and legendary: half of it rains from above the whole screen.
    const rain = t >= 3 && i % 2 === 1;
    const a = -Math.PI / 2 + (r() - 0.5) * 1.6;
    const speed = 380 + r() * 420;
    particles.push({
      kind: 'confetti',
      x: rain ? r() * w : cx + (r() - 0.5) * 40,
      y: rain ? -20 - r() * h * 0.4 : cy,
      vx: rain ? (r() - 0.5) * 80 : Math.cos(a) * speed,
      vy: rain ? 120 + r() * 160 : Math.sin(a) * speed,
      life: 0,
      max: 2.2 + r() * 1.2,
      size: 6 + Math.floor(r() * 5),
      color: pick(),
      rot: r() * Math.PI,
      vr: (r() - 0.5) * 10,
    });
  }
  const rings: Ring[] = Array.from({ length: spec.rings }, (_, i) => ({ x: cx, y: cy, delay: i * 0.12, max: 0.8, color: colors[0]! }));
  return { particles, rings, flash: spec.flash, shake: t === TIERS.length - 1, beams: t >= 3 };
}

/** `dt` seconds later: everything moves, sparks fall fast and slow down, confetti drifts and turns; the spent go. */
export function stepParticles(ps: readonly Particle[], dt: number): Particle[] {
  const out: Particle[] = [];
  for (const p of ps) {
    const spark = p.kind === 'spark';
    const drag = (spark ? 0.985 : 0.99) ** (dt * 60);
    const q: Particle = {
      ...p,
      life: p.life + dt,
      x: p.x + p.vx * dt,
      y: p.y + p.vy * dt,
      vx: p.vx * drag,
      vy: p.vy * (spark ? 1 : drag) + (spark ? 520 : 140) * dt,
      rot: p.rot + p.vr * dt,
    };
    if (q.life < q.max) out.push(q);
  }
  return out;
}
