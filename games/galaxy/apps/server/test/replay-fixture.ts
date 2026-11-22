import type { AdminRunReplay } from '@galaxy/shared';
import { botInput, botPick, createSim, DEFAULT_CONTENT, encodeLog, runSummary, SIM_VERSION, step, toBase64 } from '@galaxy/sim';

// A real solo run for the tournaments' review (plan «temporadas como fichas», part 5): played by the bot for `ticks`
// ticks with the default content, its log recorded, and kept the way the server keeps it (what `runReplay` answers).

export const FIXTURE_SEED = '20261122';

export function playedRun(ticks = 900): AdminRunReplay & { summary: ReturnType<typeof runSummary>; bytes: Uint8Array } {
  const sim = createSim({ seed: FIXTURE_SEED, content: DEFAULT_CONTENT, sector: 'outer-nebula', probes: [{ probe: 'lumen', relics: [], bonuses: [], variant: null }], record: true });
  while (sim.tick < ticks && (sim.status === 'running' || sim.status === 'choosing')) {
    if (sim.status === 'choosing') step(sim, sim.probes.map((p) => ({ mx: 0, my: 0, aim: -1, pick: p.offer ? botPick(p.offer) : -1 })));
    else step(sim, sim.probes.map((p) => botInput(sim, p.index)));
  }
  const s = runSummary(sim);
  const bytes = encodeLog(sim.log!);
  const outcome = s.outcome === 'extracted' ? 'extracted' : s.outcome === 'dead' ? 'died' : 'abandoned';
  return {
    summary: s,
    bytes,
    run: {
      id: '00000000-0000-4000-8000-0000000000b1',
      player: 'vega',
      startedAt: '2026-12-05T10:00:00.000Z',
      finishedAt: '2026-12-05T10:01:00.000Z',
      sector: 'outer-nebula',
      probe: 'lumen',
      outcome,
      seconds: Math.round(s.ticks / 60),
      depth: s.depth,
      kills: s.kills,
      level: s.level,
      bossKills: s.bossKills,
      ticks: s.ticks,
      hash: s.hash,
      suspicious: false,
      flags: [],
      party: null,
      simVersion: SIM_VERSION,
      contentVersion: 0,
      claimed: { ticks: s.ticks, depth: s.depth, kills: s.kills, bossKills: s.bossKills, level: s.level },
    },
    contentFallback: false,
    start: { seed: FIXTURE_SEED, sector: 'outer-nebula', probe: 'lumen', relics: [], bonuses: [], variant: null, anomaly: null, content: DEFAULT_CONTENT },
    inputs: toBase64(bytes),
    coop: null,
  };
}
