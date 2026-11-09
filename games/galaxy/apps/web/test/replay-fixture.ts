import type { AdminRunReplay } from '@galaxy/shared';
import { botInput, botPick, createSim, DEFAULT_CONTENT, encodeLog, runSummary, SIM_VERSION, type SimOptions, step, toBase64 } from '@galaxy/sim';

/** The options of the fixture run (what the panel rebuilds from a replay's `start`). */
export const replayOptions = (): SimOptions => ({
  seed: '20261108',
  content: DEFAULT_CONTENT,
  sector: 'outer-nebula',
  probes: [{ probe: 'lumen', relics: [], bonuses: [], variant: null }],
  record: true,
});

/** A run played by the bot for `ticks` ticks and kept as the server keeps it, as the panel's API answers it. */
export function playedRun(ticks = 900): AdminRunReplay {
  const sim = createSim(replayOptions());
  while (sim.tick < ticks && (sim.status === 'running' || sim.status === 'choosing')) {
    if (sim.status === 'choosing') step(sim, sim.probes.map((p) => ({ mx: 0, my: 0, aim: -1, pick: p.offer ? botPick(p.offer) : -1 })));
    else step(sim, sim.probes.map((p) => botInput(sim, p.index)));
  }
  const s = runSummary(sim);
  return {
    run: {
      id: '00000000-0000-4000-8000-0000000000a1',
      player: 'vega',
      startedAt: '2026-11-08T10:00:00.000Z',
      finishedAt: '2026-11-08T10:01:00.000Z',
      sector: 'outer-nebula',
      probe: 'lumen',
      outcome: 'abandoned',
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
    start: { seed: '20261108', sector: 'outer-nebula', probe: 'lumen', relics: [], bonuses: [], variant: null, anomaly: null, content: DEFAULT_CONTENT },
    inputs: toBase64(encodeLog(sim.log!)),
    coop: null,
  };
}
