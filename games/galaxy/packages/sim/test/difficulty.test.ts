import { appendFileSync, readFileSync } from 'node:fs';
import { drawTraits, subRng } from '@galaxy/engine';
import { describe, expect, test } from 'vitest';
import { botInput, botPick, type Content, createSim, DEFAULT_CONTENT, IDLE, type RelicInput, type StatBonus, step } from '../src/index';
import { VETERAN } from './proving';

// The difficulty curve (enemy life plan, 2026-11-15, after Nov plan B1). In the Nebula a beginner reaches layer 2, almost
// 3 (≈ 10–14 min) and beats the first Núcleo in most runs; a medium player reaches layer 3; a veteran layer 3–4; an
// advanced player (six top relics) layer 4, almost 5 (≈ 22–30 min). Standing still is no way to farm: the advanced
// player who stands still 80 % of the time lasts at most 60 % of what they last playing. A Núcleo fight lasts about 45 s for the medium
// player on layer 1 and at most 90 s for the advanced one on any layer. Every next sector shortens the times by 2–30 %
// (aimed at 10–15 %), the season's sector the hardest. The bot never extracts: it measures how long a run lasts. Soft
// checks: every sector and profile is measured before the verdict. GALAXY_CALIBRATE=1 runs it; GALAXY_SECTOR /
// GALAXY_PROFILE narrow it while tuning.

const LONG = process.env['GALAXY_CALIBRATE'] === '1';
// While tuning: GALAXY_CURVE_TRY=<json> merges trial values into the content before measuring:
// { sectors: { id: {...} }, bosses: { id: {...} }, enemies: { id: {...} }, enemyHpScale: n, bossHpScale: n, hitCap: n }
// (the two scales multiply the life of every enemy and every Núcleo). GALAXY_CURVE_OUT=<file> appends every measurement as a JSON line.
const TRY = process.env['GALAXY_CURVE_TRY'];
const OUT = process.env['GALAXY_CURVE_OUT'];
interface Trial {
  sectors?: Record<string, object>;
  bosses?: Record<string, object>;
  enemies?: Record<string, object>;
  enemyHpScale?: number;
  bossHpScale?: number;
  hitCap?: number;
}
function contentToMeasure(): Content {
  if (!TRY) return DEFAULT_CONTENT;
  const t = JSON.parse(readFileSync(TRY, 'utf8')) as Trial;
  const c = structuredClone(DEFAULT_CONTENT);
  for (const s of c.sectors) {
    const over = structuredClone(t.sectors?.[s.id] ?? {}) as Partial<typeof s>;
    // `scaling` and `density` merge field by field, so a trial can name just the knob it tries.
    if (over.scaling) over.scaling = { ...s.scaling, ...over.scaling };
    if (over.density) over.density = { ...s.density, ...over.density };
    Object.assign(s, over);
  }
  for (const b of c.bosses) {
    Object.assign(b, structuredClone(t.bosses?.[b.id] ?? {}));
    b.hp *= t.bossHpScale ?? 1;
  }
  for (const e of c.enemies) {
    Object.assign(e, structuredClone(t.enemies?.[e.id] ?? {}));
    e.hp *= t.enemyHpScale ?? 1;
  }
  if (t.hitCap !== undefined) c.hitCap = t.hitCap;
  return c;
}
// 16 seeds and the mean of the middle half: 8 seeds and a median moved ±20 % between runs of the same settings.
const SEEDS = Array.from({ length: 16 }, (_, i) => String(11 + i));

function relic(seed: string, j: number, tier: number, level: number): RelicInput {
  const s = BigInt(seed) * 31n + BigInt(j);
  return { id: `${seed}-${j}`, seed: s.toString(), tier, level, traits: drawTraits(subRng(s, 'traits')) as unknown as Record<string, string> };
}

/** Six top relics at level 10: two Mythic and four Legendary, every slot open. */
const TOP = (seed: string) => [relic(seed, 0, 5, 10), relic(seed, 1, 5, 10), relic(seed, 2, 4, 10), relic(seed, 3, 4, 10), relic(seed, 4, 4, 10), relic(seed, 5, 4, 10)];

interface Profile {
  relics: (seed: string) => RelicInput[];
  bonuses: StatBonus[];
  /** Minutes the run should last in the Nebula, ± band (none: judged against another profile). */
  target?: number;
  band?: number;
  /** Stands still (no moving, no dash) this share of the time: the bot plays 1 second and idles the rest. */
  still?: number;
}

/** Who plays: their relics and their permanent bonuses (probe level and Laboratorio). */
export const PROFILES = {
  /** A new account: the starting probe, nothing equipped, no Laboratorio. */
  novato: { relics: (_seed: string): RelicInput[] => [], bonuses: [] as StatBonus[], target: 12, band: 2 },
  /** A few weeks in: the welcome Legendary and an Uncommon at level 1, half the Laboratorio and probe levels. */
  medio: { relics: (seed: string) => [relic(seed, 0, 4, 1), relic(seed, 1, 1, 1)], bonuses: VETERAN.map((b) => ({ ...b, value: b.value / 2 })), target: 16.5, band: 2.5 },
  /** Months in: four levelled relics (Legendary, Epic, two Rare) and the whole Laboratorio at probe level 10. */
  veterano: { relics: (seed: string) => [relic(seed, 0, 4, 5), relic(seed, 1, 3, 5), relic(seed, 2, 2, 4), relic(seed, 3, 2, 3)], bonuses: VETERAN, target: 21.5, band: 3.5 },
  /** The strongest account: six top relics at level 10 and the whole Laboratorio. */
  avanzado: { relics: TOP, bonuses: VETERAN, target: 26, band: 4 },
  /** The same account standing still 80 % of the run (the farm the owner reported): it moves 1 second out of 5. */
  quieto: { relics: TOP, bonuses: VETERAN, still: 0.8 },
} satisfies Record<string, Profile>;
export type ProfileId = keyof typeof PROFILES;

/** The standing-still advanced player lasts at most this share of the moving one. */
const STILL_SHARE = 0.6;

export interface Outcome {
  minutes: number;
  layer: number;
  /** The team's level at the end. */
  level: number;
  /** Lived to see the first Núcleo, and beat it. */
  sawBoss: boolean;
  beatBoss: boolean;
  /** Seconds each Núcleo took to fall, by its layer (a fight the probe did not survive is not here). */
  fights: { layer: number; seconds: number }[];
  /** Reached the time limit in a Núcleo fight that had lasted over 5 minutes: neither side could win it. */
  stuck: boolean;
}

/** True while a profile that stands still part of the time is idling: it plays the first second of each window. */
function idles(p: Profile, tick: number): boolean {
  if (!p.still) return false;
  const window = Math.round(60 / (1 - p.still));
  return tick % window >= 60;
}

export function botOutcome(content: Content, sector: string, profile: ProfileId, seed: string, maxMinutes = 50): Outcome {
  const p: Profile = PROFILES[profile];
  const sim = createSim({ seed, content, sector, probes: [{ probe: 'lumen', relics: p.relics(seed), bonuses: p.bonuses }] });
  let sawBoss = false;
  let beatBoss = false;
  let bossAt = -1;
  const fights: Outcome['fights'] = [];
  while (sim.tick < maxMinutes * 3600 && (sim.status === 'running' || sim.status === 'choosing')) {
    const probe = sim.probes[0]!;
    if (sim.status === 'choosing') step(sim, [{ mx: 0, my: 0, aim: -1, pick: probe.offer ? botPick(probe.offer) : -1 }]);
    else step(sim, [idles(p, sim.tick) ? IDLE : botInput(sim, 0, 99)]);
    for (const e of sim.events) {
      if (e.t === 'bossSpawn') {
        bossAt = sim.tick;
        if (e.layer === 1) sawBoss = true;
      }
      if (e.t === 'bossDown') {
        fights.push({ layer: sim.layer, seconds: (sim.tick - bossAt) / 60 });
        if (sim.layer === 1) beatBoss = true;
      }
    }
  }
  const stuck = sim.status !== 'dead' && sim.phase === 'boss' && bossAt >= 0 && sim.tick - bossAt > 300 * 60;
  return { minutes: sim.tick / 3600, layer: sim.layer, level: Math.max(...sim.probes.map((q) => q.level)), sawBoss, beatBoss, fights, stuck };
}

/** The mean of the middle half (a trimmed mean): steadier than a median with the bot's long tails. */
export const median = (xs: readonly number[]) => {
  if (xs.length === 0) return Number.NaN;
  const s = [...xs].sort((a, b) => a - b);
  const q = Math.floor(s.length / 4);
  const mid = s.slice(q, s.length - q);
  return mid.reduce((a, b) => a + b, 0) / mid.length;
};

/** The median fight of each layer reached by at least a quarter of the runs. */
function fightsByLayer(runs: readonly Outcome[]): Record<number, number> {
  const out: Record<number, number> = {};
  const all = runs.flatMap((r) => r.fights);
  for (const layer of new Set(all.map((f) => f.layer))) {
    const xs = all.filter((f) => f.layer === layer).map((f) => f.seconds);
    if (xs.length >= runs.length / 4) out[layer] = median(xs);
  }
  return out;
}

describe.skipIf(!LONG)('curva de dificultad (GALAXY_CALIBRATE=1)', () => {
  const onlySector = process.env['GALAXY_SECTOR'];
  const onlyProfile = process.env['GALAXY_PROFILE'];
  const sectors = DEFAULT_CONTENT.sectors.map((s) => s.id).filter((id) => !onlySector || id === onlySector);
  const profiles = (Object.keys(PROFILES) as ProfileId[]).filter((id) => !onlyProfile || onlyProfile.split(',').includes(id));

  test('cada jugador dura lo que debe, quedarse quieto no compensa y cada sector es más difícil que el anterior', () => {
    const medians: Record<string, Record<string, number>> = {};
    for (const profile of profiles) {
      medians[profile] = {};
      for (const sector of sectors) {
        const content = contentToMeasure();
        const runs = SEEDS.map((seed) => botOutcome(content, sector, profile, seed));
        const m = median(runs.map((r) => r.minutes));
        medians[profile]![sector] = m;
        const saw = runs.filter((r) => r.sawBoss).length;
        const beat = runs.filter((r) => r.beatBoss).length;
        const fights = fightsByLayer(runs);
        const levels = runs.map((r) => r.level);
        const stuck = runs.filter((r) => r.stuck).length;
        if (OUT) appendFileSync(OUT, JSON.stringify({ profile, sector, median: m, minutes: runs.map((r) => +r.minutes.toFixed(2)), layers: runs.map((r) => r.layer), levels, saw, beat, fights, stuck }) + String.fromCharCode(10));
        console.log(
          `curva ${profile} ${sector}: mediana ${m.toFixed(1)} min · capas ${runs.map((r) => r.layer).join(',')} · niveles ${levels.join(',')} · ven el Núcleo ${saw}/${SEEDS.length}, lo vencen ${beat}/${SEEDS.length} · combates ${Object.entries(fights)
            .map(([l, s]) => `c${l} ${s.toFixed(0)} s`)
            .join(', ')}`,
        );
        expect.soft(stuck, `${profile} en ${sector}: ningún combate contra un Núcleo queda en tablas hasta el límite`).toBe(0);
        if (sector !== 'outer-nebula') continue;
        const p: Profile = PROFILES[profile];
        if (p.target !== undefined && p.band !== undefined) {
          expect.soft(m, `${profile} en la Nebulosa`).toBeGreaterThanOrEqual(p.target - p.band);
          expect.soft(m, `${profile} en la Nebulosa`).toBeLessThanOrEqual(p.target + p.band);
        }
        if (profile === 'novato') {
          expect.soft(beat, 'quien empieza vence al primer Núcleo en la mayoría de las partidas').toBeGreaterThanOrEqual(10);
          if (fights[1] !== undefined) expect.soft(fights[1], 'su primer Núcleo cae en 90 s como mucho').toBeLessThanOrEqual(90);
        }
        if (profile === 'medio' && fights[1] !== undefined) {
          expect.soft(fights[1], 'el medio tarda unos 45 s con el primer Núcleo').toBeGreaterThanOrEqual(30);
          expect.soft(fights[1], 'el medio tarda unos 45 s con el primer Núcleo').toBeLessThanOrEqual(60);
        }
        if (profile === 'avanzado') {
          for (const [layer, s] of Object.entries(fights)) expect.soft(s, `el avanzado vence al Núcleo de la capa ${layer} en 90 s como mucho`).toBeLessThanOrEqual(90);
        }
        if (profile === 'quieto' && medians['avanzado']?.[sector] !== undefined) {
          expect.soft(m, 'quedarse quieto el 80 % del tiempo dura como mucho el 60 % de lo que dura jugando').toBeLessThanOrEqual(medians['avanzado'][sector]! * STILL_SHARE);
        }
      }
      // Each sector shorter than the one before (aimed at 10–15 %; with the bot's noise, between 2 and 30 % passes). Not
      // for a beginner, who only ever plays the Nebula first (the next sector opens by beating its Núcleo), nor for the
      // one standing still, measured against the moving one.
      if (profile === 'novato' || profile === 'quieto') continue;
      const order = sectors.filter((s) => s !== 'signal-rift');
      for (let k = 1; k < order.length; k++) {
        const ratio = medians[profile]![order[k]!]! / medians[profile]![order[k - 1]!]!;
        expect.soft(ratio, `${profile}: ${order[k]} frente a ${order[k - 1]}`).toBeLessThanOrEqual(0.98);
        expect.soft(ratio, `${profile}: ${order[k]} frente a ${order[k - 1]}`).toBeGreaterThanOrEqual(0.7);
      }
      if (medians[profile]!['signal-rift'] !== undefined && order.length > 0) {
        expect.soft(medians[profile]!['signal-rift']!, `${profile}: la Fisura es la más difícil`).toBeLessThanOrEqual(Math.min(...order.map((s) => medians[profile]![s]!)));
      }
    }
  }, 14_400_000);
});
