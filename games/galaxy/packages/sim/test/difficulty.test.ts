import { appendFileSync, readFileSync } from 'node:fs';
import { drawTraits, subRng } from '@galaxy/engine';
import { describe, expect, test } from 'vitest';
import { botInput, botPick, type Content, createSim, DEFAULT_CONTENT, type RelicInput, type StatBonus, step } from '../src/index';
import { VETERAN } from './proving';

// The difficulty curve (Nov plan B1, spec §5 B1): in the Nebula a beginner dies around minute 5, a medium player around
// 15 and a veteran around 30; every next sector shortens those times by 10–15 %, the season's sector the hardest. A
// beginner reaches the first Núcleo in half the runs and beats it in one of four (ruling 14). The bot never extracts:
// it measures how long a run lasts. Soft checks: every sector and profile is measured before the verdict. GALAXY_CALIBRATE=1 runs it; GALAXY_SECTOR / GALAXY_PROFILE narrow it while tuning.

const LONG = process.env['GALAXY_CALIBRATE'] === '1';
// While tuning: GALAXY_CURVE_TRY=<json> merges trial values into the sectors and bosses ({ sectors: { id: {...} },
// bosses: { id: {...} } }), and GALAXY_CURVE_OUT=<file> appends every measurement as a JSON line.
const TRY = process.env['GALAXY_CURVE_TRY'];
const OUT = process.env['GALAXY_CURVE_OUT'];
function contentToMeasure(): Content {
  if (!TRY) return DEFAULT_CONTENT;
  const t = JSON.parse(readFileSync(TRY, 'utf8')) as { sectors?: Record<string, object>; bosses?: Record<string, object> };
  const c = structuredClone(DEFAULT_CONTENT);
  for (const s of c.sectors) Object.assign(s, structuredClone(t.sectors?.[s.id] ?? {}));
  for (const b of c.bosses) Object.assign(b, structuredClone(t.bosses?.[b.id] ?? {}));
  return c;
}
// 16 seeds and the mean of the middle half: 8 seeds and a median moved ±20 % between runs of the same settings.
const SEEDS = Array.from({ length: 16 }, (_, i) => String(11 + i));

function relic(seed: string, j: number, tier: number, level: number): RelicInput {
  const s = BigInt(seed) * 31n + BigInt(j);
  return { id: `${seed}-${j}`, seed: s.toString(), tier, level, traits: drawTraits(subRng(s, 'traits')) as unknown as Record<string, string> };
}

/** Who plays: their relics and their permanent bonuses (probe level and Laboratorio). */
export const PROFILES = {
  /** A new account: the starting probe, nothing equipped, no Laboratorio. */
  novato: { relics: (_seed: string): RelicInput[] => [], bonuses: [] as StatBonus[], target: 5, band: 1.5 },
  /** A few weeks in: the welcome Legendary and an Uncommon at level 1, half the Laboratorio and probe levels. */
  medio: { relics: (seed: string) => [relic(seed, 0, 4, 1), relic(seed, 1, 1, 1)], bonuses: VETERAN.map((b) => ({ ...b, value: b.value / 2 })), target: 15, band: 3 },
  /** Months in: four levelled relics (Legendary, Epic, two Rare) and the whole Laboratorio at probe level 10. */
  veterano: { relics: (seed: string) => [relic(seed, 0, 4, 5), relic(seed, 1, 3, 5), relic(seed, 2, 2, 4), relic(seed, 3, 2, 3)], bonuses: VETERAN, target: 30, band: 5 },
} as const;
export type ProfileId = keyof typeof PROFILES;

export interface Outcome {
  minutes: number;
  layer: number;
  /** Lived to see the first Núcleo, and beat it. */
  sawBoss: boolean;
  beatBoss: boolean;
}

export function botOutcome(content: Content, sector: string, profile: ProfileId, seed: string, maxMinutes = 50): Outcome {
  const p = PROFILES[profile];
  const sim = createSim({ seed, content, sector, probes: [{ probe: 'lumen', relics: p.relics(seed), bonuses: p.bonuses }] });
  let sawBoss = false;
  let beatBoss = false;
  while (sim.tick < maxMinutes * 3600 && (sim.status === 'running' || sim.status === 'choosing')) {
    const probe = sim.probes[0]!;
    if (sim.status === 'choosing') step(sim, [{ mx: 0, my: 0, aim: -1, pick: probe.offer ? botPick(probe.offer) : -1 }]);
    else step(sim, [botInput(sim, 0, 99)]);
    for (const e of sim.events) {
      if (e.t === 'bossSpawn' && e.layer === 1) sawBoss = true;
      if (e.t === 'bossDown' && sim.layer === 1) beatBoss = true;
    }
  }
  return { minutes: sim.tick / 3600, layer: sim.layer, sawBoss, beatBoss };
}

/** The mean of the middle half (a trimmed mean): steadier than a median with the bot's long tails. */
export const median = (xs: readonly number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const q = Math.floor(s.length / 4);
  const mid = s.slice(q, s.length - q);
  return mid.reduce((a, b) => a + b, 0) / mid.length;
};

describe.skipIf(!LONG)('curva de dificultad (GALAXY_CALIBRATE=1)', () => {
  const onlySector = process.env['GALAXY_SECTOR'];
  const onlyProfile = process.env['GALAXY_PROFILE'] as ProfileId | undefined;
  const sectors = DEFAULT_CONTENT.sectors.map((s) => s.id).filter((id) => !onlySector || id === onlySector);
  const profiles = (Object.keys(PROFILES) as ProfileId[]).filter((id) => !onlyProfile || id === onlyProfile);

  test('cada jugador dura lo que debe y cada sector es más difícil que el anterior', () => {
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
        if (OUT) appendFileSync(OUT, JSON.stringify({ profile, sector, median: m, minutes: runs.map((r) => +r.minutes.toFixed(2)), layers: runs.map((r) => r.layer), saw, beat }) + String.fromCharCode(10));
        console.log(`curva ${profile} ${sector}: mediana ${m.toFixed(1)} min · capas ${runs.map((r) => r.layer).join(',')} · minutos ${runs.map((r) => r.minutes.toFixed(1)).join(',')} · ven el Núcleo ${saw}/${SEEDS.length}, lo vencen ${beat}/${SEEDS.length}`);
        if (sector === 'outer-nebula') {
          const p = PROFILES[profile];
          expect.soft(m, `${profile} en la Nebulosa`).toBeGreaterThanOrEqual(p.target - p.band);
          expect.soft(m, `${profile} en la Nebulosa`).toBeLessThanOrEqual(p.target + p.band);
          if (profile === 'novato') {
            expect.soft(saw, 'quien empieza llega al primer Núcleo en la mitad de las partidas').toBeGreaterThanOrEqual(SEEDS.length / 2);
            expect.soft(beat, 'y lo vence en una de cada cuatro').toBeGreaterThanOrEqual(SEEDS.length / 4);
          }
        }
      }
      // Each sector shorter than the one before (aimed at 10–15 %; with the bot's noise, between 2 and 30 % passes). Not for a beginner:
      // the first Núcleo at minute 5 ends their run in any sector, and they only ever play the Nebula (the next sector
      // opens by beating its Núcleo), so their curve is the Nebula's band and the Núcleo rule above.
      if (profile === 'novato') continue;
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
  }, 7_200_000);
});
