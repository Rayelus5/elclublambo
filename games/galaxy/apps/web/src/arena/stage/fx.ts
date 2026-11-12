import type { Content } from '@galaxy/sim';

// Combat juice as plain state (DESIGN_SYSTEM §8 quater): screen shake, rising damage numbers, particles, reaction
// labels and evolution rings. The renderer draws them; this module only moves and ages them, so it is testable
// without a GPU.

export interface FxNumber {
  x: number;
  y: number;
  value: number;
  crit: boolean;
  age: number;
  alpha: number;
}

export interface FxParticle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  color: number;
  age: number;
  life: number;
  size: number;
}

export interface FxLabel {
  x: number;
  y: number;
  text: string;
  color: number;
  age: number;
  alpha: number;
}

export interface FxRing {
  x: number;
  y: number;
  color: number;
  age: number;
  radius: number;
  alpha: number;
}

export interface Fx {
  numbers: FxNumber[];
  particles: FxParticle[];
  labels: FxLabel[];
  rings: FxRing[];
  /** A reaction's name over the enemy (world units). */
  label(x: number, y: number, text: string, color: number): void;
  /** An expanding ring (an evolution, around the probe). */
  ring(x: number, y: number, color: number): void;
  shake(amount: number): void;
  number(x: number, y: number, value: number, crit: boolean): void;
  burst(x: number, y: number, color: number, count: number, speed?: number): void;
  /**
   * A probe's thruster while it moves (open beta): hot puffs out of the nozzle behind it (`angle` is where it heads),
   * flying back against its course and fading fast, at a steady rate over `dt` seconds. `key` keeps each probe's own;
   * `rear` is how far behind the centre its drawing's nozzle is (sprites' probeNozzle).
   */
  thrust(key: number, x: number, y: number, angle: number, dt: number, rear?: number): void;
  /**
   * A shot's wake (Nov plan B3: a mortar shell's smoke, a thrown body's pull): slow motes left where it passes, at a
   * steady rate over `dt` seconds, fading fast. `key` keeps each shot's own rate.
   */
  trail(key: number, x: number, y: number, color: number, dt: number): void;
  /** Advances by `dt` seconds; returns the shake offset (screen pixels) for this frame. */
  update(dt: number): { x: number; y: number };
  /** Ajustes → Movimiento changed mid-run (plan «escáner pro», part A): applies from the next frame. */
  setReduced(on: boolean): void;
}

const NUMBER_LIFE = 0.6;
const NUMBER_RISE = 18;
const MAX_NUMBERS = 60;
const MAX_PARTICLES = 600;
const SHAKE_DECAY = 0.85;
const LABEL_LIFE = 0.9;
const LABEL_RISE = 14;
const MAX_LABELS = 6;
const RING_LIFE = 0.6;
const RING_RADIUS = 36;
/** Thruster puffs per second (a third with reduced motion), how far behind the centre the nozzle is by default, how fast. */
const THRUST_RATE = 80;
const THRUST_REAR = 8;
const THRUST_SPEED = 34;
/** The flame at the nozzle (white-hot, slow, brief) and the embers it sheds behind (orange to red, longer). */
const FLAME_COLORS = [0xffffff, 0xfff3c4, 0xffd36e];
const EMBER_COLORS = [0xffd36e, 0xff9d2e, 0xff9d2e, 0xff6b3d, 0xe8453c];
/** A shot's wake: motes per second (a third with reduced motion). */
const TRAIL_RATE = 40;

/** Reaction colours by what they do (the name is always shown too: never colour alone). */
const REACTION_COLOR: Record<string, number> = {
  chain: 0x6fe3ff,
  explode: 0xff9a3c,
  shatter: 0xbfe3ff,
  stun: 0xffc94a,
  spread: 0x45e3a6,
  drain: 0xff4d6d,
};

/** What the arena writes over an enemy when a reaction goes off. */
export function reactionLabel(content: Content, id: string): { text: string; color: number } {
  const r = content.elements.reactions.find((x) => x.id === id);
  return r ? { text: r.name, color: REACTION_COLOR[r.effect.kind] ?? 0xffffff } : { text: '', color: 0xffffff };
}

export function createFx(startReduced: boolean): Fx {
  let reduced = startReduced;
  let trauma = 0;
  let phase = 0;
  const numbers: FxNumber[] = [];
  const particles: FxParticle[] = [];
  const labels: FxLabel[] = [];
  const rings: FxRing[] = [];
  const thrusters = new Map<number, number>();
  const trails = new Map<number, number>();
  // A small deterministic wobble (no Math.random: frames stay comparable in screenshots and tests).
  let seed = 1;
  const rand = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
  return {
    numbers,
    particles,
    labels,
    rings,
    label(x, y, text, color) {
      if (labels.length >= MAX_LABELS) labels.shift();
      labels.push({ x, y, text, color, age: 0, alpha: 1 });
    },
    ring(x, y, color) {
      rings.push({ x, y, color, age: 0, radius: 0, alpha: 1 });
    },
    shake(amount) {
      if (!reduced) trauma = Math.max(trauma, amount);
    },
    number(x, y, value, crit) {
      if (numbers.length >= MAX_NUMBERS) {
        numbers[numbers.length - 1]!.value += value;
        return;
      }
      numbers.push({ x, y, value, crit, age: 0, alpha: 1 });
    },
    burst(x, y, color, count, speed = 60) {
      const n = reduced ? Math.floor(count / 2) : count;
      for (let k = 0; k < n && particles.length < MAX_PARTICLES; k++) {
        const a = rand() * Math.PI * 2;
        const v = speed * (0.4 + rand() * 0.8);
        particles.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, color, age: 0, life: 0.35 + rand() * 0.35, size: rand() < 0.3 ? 2 : 1 });
      }
    },
    thrust(key, x, y, angle, dt, rear = THRUST_REAR) {
      // Whole puffs due by now, the fraction carried to the next frame.
      let due = (thrusters.get(key) ?? 0) + dt * (reduced ? THRUST_RATE / 3 : THRUST_RATE);
      const back = angle + Math.PI;
      const cos = Math.cos(back);
      const sin = Math.sin(back);
      while (due >= 1 && particles.length < MAX_PARTICLES) {
        due -= 1;
        const flame = rand() < 0.45;
        const side = (rand() - 0.5) * (flame ? 1.6 : 2.6);
        const spread = reduced ? 0 : (rand() - 0.5) * (flame ? 0.3 : 0.7);
        const v = THRUST_SPEED * (flame ? 0.35 + rand() * 0.3 : 0.8 + rand() * 0.8);
        const colors = flame ? FLAME_COLORS : EMBER_COLORS;
        particles.push({
          x: x + cos * rear - sin * side,
          y: y + sin * rear + cos * side,
          vx: Math.cos(back + spread) * v,
          vy: Math.sin(back + spread) * v,
          color: colors[Math.floor(rand() * colors.length)]!,
          age: 0,
          life: flame ? 0.07 + rand() * 0.07 : 0.18 + rand() * 0.2,
          size: flame ? 2 : rand() < 0.4 ? 2 : 1,
        });
      }
      thrusters.set(key, Math.min(due, 1));
    },
    trail(key, x, y, color, dt) {
      let due = (trails.get(key) ?? 0) + dt * (reduced ? TRAIL_RATE / 3 : TRAIL_RATE);
      while (due >= 1 && particles.length < MAX_PARTICLES) {
        due -= 1;
        particles.push({
          x: x + (rand() - 0.5) * 2,
          y: y + (rand() - 0.5) * 2,
          vx: (rand() - 0.5) * 6,
          vy: (rand() - 0.5) * 6,
          color,
          age: 0,
          life: 0.25 + rand() * 0.2,
          size: rand() < 0.3 ? 2 : 1,
        });
      }
      trails.set(key, Math.min(due, 1));
    },
    setReduced(on) {
      reduced = on;
      if (on) trauma = 0;
    },
    update(dt) {
      for (let i = numbers.length - 1; i >= 0; i--) {
        const n = numbers[i]!;
        n.age += dt;
        if (n.age >= NUMBER_LIFE) {
          numbers.splice(i, 1);
          continue;
        }
        if (!reduced) n.y -= (NUMBER_RISE / NUMBER_LIFE) * dt;
        n.alpha = 1 - (n.age / NUMBER_LIFE) * (n.age / NUMBER_LIFE);
      }
      for (let i = labels.length - 1; i >= 0; i--) {
        const l = labels[i]!;
        l.age += dt;
        if (l.age >= LABEL_LIFE) {
          labels.splice(i, 1);
          continue;
        }
        if (!reduced) l.y -= (LABEL_RISE / LABEL_LIFE) * dt;
        l.alpha = 1 - (l.age / LABEL_LIFE) ** 3;
      }
      for (let i = rings.length - 1; i >= 0; i--) {
        const r = rings[i]!;
        r.age += dt;
        if (r.age >= RING_LIFE) {
          rings.splice(i, 1);
          continue;
        }
        r.radius = RING_RADIUS * (r.age / RING_LIFE);
        r.alpha = 1 - r.age / RING_LIFE;
      }
      for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i]!;
        p.age += dt;
        if (p.age >= p.life) {
          particles.splice(i, 1);
          continue;
        }
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.vx *= 0.9;
        p.vy *= 0.9;
      }
      if (trauma < 0.25) {
        trauma = 0;
        return { x: 0, y: 0 };
      }
      phase += 1.7;
      // Each axis at most 70 % of the trauma, so the offset never exceeds it.
      const out = { x: Math.round(Math.cos(phase * 2.3) * trauma * 0.7), y: Math.round(Math.sin(phase * 3.1) * trauma * 0.7) };
      trauma *= SHAKE_DECAY;
      return out;
    },
  };
}
