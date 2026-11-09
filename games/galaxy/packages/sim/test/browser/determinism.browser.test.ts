import { describe, expect, test } from 'vitest';
import { SIM_VERSION } from '../../src/index';
import { GOLDEN_RUNS, goldenSim, playGolden } from '../golden-runs';

// The golden runs in a real browser (multiplayer plan, spike S2): the co-op lockstep simulates the same run on every
// player's machine and on the server, so a browser must reach the very hashes Node reaches (golden-runs.ts).

describe(`partidas de referencia en el navegador (SIM ${SIM_VERSION})`, () => {
  for (const run of GOLDEN_RUNS) {
    test(run.name, () => {
      expect(playGolden(goldenSim(run))).toEqual(run.hashes);
    }, 60_000);
  }
});
