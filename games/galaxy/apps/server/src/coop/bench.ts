import { botInput, botPick, createSim, DEFAULT_CONTENT, DEFAULT_COOP_RULES, step } from '@galaxy/sim';
import { createStepTimes, type StepSummary } from './step-times';

// A bench of the co-op referee (2026-11-16): a group of `players` in a deep layer with the enemy pool full (400 by
// default), stepped like the server steps it, timing each step. Pure CPU, no database: `node dist/cli.js bench-referee`
// runs it on the homelab to see how many groups the referee can hold.

export interface BenchResult {
  players: number;
  ticks: number;
  /** The most enemies alive at once (the pool's limit is the content's `limits.enemies`). */
  maxAlive: number;
  layer: number;
  times: StepSummary;
}

export function benchReferee(opts: { ticks: number; players: number }): BenchResult {
  const c = structuredClone(DEFAULT_CONTENT);
  // Crowded on purpose: the pool fills within seconds and stays full.
  for (const s of c.sectors) s.density = { ...s.density, base: 60, max: 60, perMinute: 0, cap: c.limits.enemies, perLayer: 0 };
  const sim = createSim({
    seed: '20261116',
    content: c,
    sector: c.sectors[0]!.id,
    coop: DEFAULT_COOP_RULES,
    probes: Array.from({ length: opts.players }, (_, i) => ({ probe: c.probes[i % c.probes.length]!.id, relics: [] })),
  });
  // Nobody falls: the bench measures the crowd, not a wipe (the debug helpers refuse co-op; this is no real run).
  sim.debug = { god: true };
  const times = createStepTimes(Math.max(1, opts.ticks));
  let maxAlive = 0;
  for (let t = 0; t < opts.ticks && sim.status !== 'dead' && sim.status !== 'extracted'; t++) {
    const inputs = sim.probes.map((p) => (p.offer ? { mx: 0, my: 0, aim: -1, pick: botPick(p.offer) } : botInput(sim, p.index, 99)));
    const t0 = performance.now();
    step(sim, inputs);
    times.record(performance.now() - t0);
    if (sim.enemies.count > maxAlive) maxAlive = sim.enemies.count;
  }
  return { players: opts.players, ticks: opts.ticks, maxAlive, layer: sim.layer, times: times.summary() };
}
