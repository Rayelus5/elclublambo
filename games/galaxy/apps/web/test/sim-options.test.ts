import type { RunStart } from '@galaxy/shared';
import { DEFAULT_CONTENT } from '@galaxy/sim';
import { expect, test } from 'vitest';
import { simOptions } from '../src/arena/sim-options';

// The arena builds its simulation from the run the server started (M4b-1): the probe with its relics, its level's
// bonuses and its starting weapon, recorded for the replay.

test('la simulación sale con las reliquias, los bonos, la variante y la anomalía de la incursión', () => {
  const run: RunStart = {
    id: 'r1',
    seed: '42',
    sector: 'outer-nebula',
    probe: 'lumen',
    relics: [],
    bonuses: [{ stat: 'maxHp', value: 0.09 }],
    variant: 'pulse-twin',
    anomaly: 'contagion',
    content: DEFAULT_CONTENT,
    contentVersion: 3,
    startedAt: '2026-11-07T10:00:00Z',
  };
  expect(simOptions(run)).toEqual({
    seed: '42',
    content: DEFAULT_CONTENT,
    sector: 'outer-nebula',
    probes: [{ probe: 'lumen', relics: [], bonuses: [{ stat: 'maxHp', value: 0.09 }], variant: 'pulse-twin' }],
    anomaly: 'contagion',
    record: true,
  });
});
