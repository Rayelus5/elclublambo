import { describe, expect, test } from 'vitest';
import { SIM_VERSION } from '../src/index';
import { GOLDEN_RUNS, goldenSim, playGolden } from './golden-runs';

// Golden runs of the solo game in Node (the table and why: golden-runs.ts).

describe(`partidas de referencia (SIM ${SIM_VERSION})`, () => {
  for (const run of GOLDEN_RUNS) {
    test(run.name, () => {
      expect(playGolden(goldenSim(run))).toEqual(run.hashes);
    });
  }
});
