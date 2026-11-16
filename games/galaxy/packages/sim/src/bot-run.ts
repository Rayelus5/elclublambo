import { botInput, botPick } from './bot';
import type { Content } from './content/types';
import { createSim, step } from './sim';

// A run played by the bot (the content editor's quick check, 2026-11-16, P7): the same bot the calibration uses, alone,
// with no relics nor bonuses, to the end or a time limit. Deterministic: the same content and seed tell the same.

export interface BotRunOptions {
  sector: string;
  probe: string;
  /** A run seed: digits (a 64-bit number, like every run's). */
  seed: string;
  /** Stops here if the run has not ended (minutes of play). */
  maxMinutes: number;
  /** The first layer whose beacon the bot goes for (99: never leaves). */
  extractFrom?: number;
}

export interface BotRun {
  minutes: number;
  layer: number;
  level: number;
  /** Beat the first Núcleo. */
  beatBoss: boolean;
  end: 'died' | 'extracted' | 'time';
}

export function playBot(content: Content, o: BotRunOptions): BotRun {
  const sim = createSim({ seed: o.seed, content, sector: o.sector, probes: [{ probe: o.probe, relics: [] }] });
  let beatBoss = false;
  while (sim.tick < o.maxMinutes * 3600 && (sim.status === 'running' || sim.status === 'choosing')) {
    const probe = sim.probes[0]!;
    if (sim.status === 'choosing') step(sim, [{ mx: 0, my: 0, aim: -1, pick: probe.offer ? botPick(probe.offer) : -1 }]);
    else step(sim, [botInput(sim, 0, o.extractFrom ?? 99)]);
    for (const e of sim.events) if (e.t === 'bossDown' && sim.layer === 1) beatBoss = true;
  }
  const end = sim.status === 'dead' ? 'died' : sim.status === 'extracted' ? 'extracted' : 'time';
  return { minutes: sim.tick / 3600, layer: sim.layer, level: Math.max(...sim.probes.map((q) => q.level)), beatBoss, end };
}
