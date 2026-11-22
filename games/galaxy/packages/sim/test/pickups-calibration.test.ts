import { appendFileSync } from 'node:fs';
import { drawTraits, subRng } from '@galaxy/engine';
import { describe, expect, test } from 'vitest';
import { botInput, botPick, type Content, createSim, DEFAULT_CONTENT, type RelicInput, type StatBonus, step } from '../src/index';
import { VETERAN } from './proving';

// Loose items that expire (the owner, 2026-11-22; SIM 1.21.0): how full the ground gets over long bot runs that never
// extract, with data fragments and kits expiring after `pickups.lifeSeconds` and a pool of `limits.pickups`, against the
// ground before it (nothing expires, a pool of 1500). The share of ticks with the pool full should stay under 5 %.
// GALAXY_CALIBRATE=1 runs it; it is slow, so run it a few at a time and at low priority. GALAXY_PROFILE narrows the
// profiles (comma separated) and GALAXY_SEEDS the number of seeds (8 by default); GALAXY_PICKUPS_OUT=<file> appends
// every measurement as a JSON line.

const LONG = process.env['GALAXY_CALIBRATE'] === '1';
const OUT = process.env['GALAXY_PICKUPS_OUT'];
const SEEDS = Array.from({ length: Number(process.env['GALAXY_SEEDS'] ?? 8) }, (_, i) => String(11 + i));
/** The minutes the ground is counted at. */
const AT = [10, 20, 30, 40];
/** The most of the run the pool may spend full. */
const FULL_MAX = 0.05;

function relic(seed: string, j: number, tier: number, level: number): RelicInput {
  const s = BigInt(seed) * 31n + BigInt(j);
  return { id: `${seed}-${j}`, seed: s.toString(), tier, level, traits: drawTraits(subRng(s, 'traits')) as unknown as Record<string, string> };
}

/** The same four players as the difficulty curve (difficulty.test.ts): from a new account to six top relics. */
const PROFILES: Record<string, { relics: (seed: string) => RelicInput[]; bonuses: StatBonus[] }> = {
  novato: { relics: () => [], bonuses: [] },
  medio: { relics: (seed) => [relic(seed, 0, 4, 1), relic(seed, 1, 1, 1)], bonuses: VETERAN.map((b) => ({ ...b, value: b.value / 2 })) },
  veterano: { relics: (seed) => [relic(seed, 0, 4, 5), relic(seed, 1, 3, 5), relic(seed, 2, 2, 4), relic(seed, 3, 2, 3)], bonuses: VETERAN },
  avanzado: { relics: (seed) => [0, 1, 2, 3, 4, 5].map((j) => relic(seed, j, j < 2 ? 5 : 4, 10)), bonuses: VETERAN },
};

interface Ground {
  minutes: number;
  /** Pickups on the ground at minutes 10, 20, 30 and 40 (null: the run had ended). */
  at: (number | null)[];
  peak: number;
  mean: number;
  /** Share of the run's ticks that ended with the pool full. */
  full: number;
}

function measure(content: Content, profile: string, seed: string, maxMinutes = 50): Ground {
  const who = PROFILES[profile]!;
  const sim = createSim({ seed, content, sector: 'outer-nebula', probes: [{ probe: 'lumen', relics: who.relics(seed), bonuses: who.bonuses }] });
  const at: (number | null)[] = AT.map(() => null);
  let peak = 0;
  let sum = 0;
  let full = 0;
  let n = 0;
  while (sim.tick < maxMinutes * 3600 && (sim.status === 'running' || sim.status === 'choosing')) {
    const p = sim.probes[0]!;
    if (sim.status === 'choosing') {
      step(sim, [{ mx: 0, my: 0, aim: -1, pick: p.offer ? botPick(p.offer) : -1 }]);
      continue;
    }
    step(sim, [botInput(sim, 0, 99)]);
    const c = sim.pickups.count;
    peak = Math.max(peak, c);
    sum += c;
    n++;
    if (c >= sim.pickups.cap) full++;
    const k = AT.indexOf(sim.tick / 3600);
    if (k >= 0) at[k] = c;
  }
  return { minutes: sim.tick / 3600, at, peak, mean: sum / Math.max(1, n), full: full / Math.max(1, n) };
}

/** The ground before SIM 1.21.0: nothing expires and the pool holds 1500. */
function before(): Content {
  const c = structuredClone(DEFAULT_CONTENT);
  c.pickups = { lifeSeconds: 0, fadeSeconds: 0 };
  c.limits = { ...c.limits, pickups: 1500 };
  return c;
}

const avg = (xs: readonly number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : Number.NaN);

describe.skipIf(!LONG)('objetos en el suelo en incursiones largas (GALAXY_CALIBRATE=1)', () => {
  const only = process.env['GALAXY_PROFILE'];
  const profiles = Object.keys(PROFILES).filter((id) => !only || only.split(',').includes(id));

  test('con la experiencia y los kits caducando, el suelo casi nunca se llena', () => {
    for (const profile of profiles) {
      for (const [name, content] of [
        ['antes', before()],
        ['ahora', DEFAULT_CONTENT],
      ] as const) {
        const runs = SEEDS.map((seed) => measure(content, profile, seed));
        const at = AT.map((_, k) => runs.map((r) => r.at[k]).filter((c): c is number => c !== null));
        const full = avg(runs.map((r) => r.full));
        if (OUT) appendFileSync(OUT, JSON.stringify({ profile, name, runs }) + String.fromCharCode(10));
        console.log(
          `suelo ${profile} ${name}: min ${avg(runs.map((r) => r.minutes)).toFixed(1)} · en los min ${AT.join('/')} ${at.map((xs) => (xs.length ? `${avg(xs).toFixed(0)} (${xs.length})` : '-')).join(' / ')} · media ${avg(runs.map((r) => r.mean)).toFixed(0)} · pico ${Math.max(...runs.map((r) => r.peak))} · lleno ${(full * 100).toFixed(1)} % (máx ${(Math.max(...runs.map((r) => r.full)) * 100).toFixed(1)} %)`,
        );
        if (name === 'ahora') expect.soft(full, `${profile}: el suelo lleno menos del 5 % del tiempo`).toBeLessThan(FULL_MAX);
      }
    }
  }, 3_600_000);
});
