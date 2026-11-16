import { describe, expect, test } from 'vitest';
import { SIM_VERSION } from '../../src/index';
import { DEEP_RUNS, GOLDEN_RUNS, goldenSim, playDeep, playGolden } from '../golden-runs';

// The golden runs in a real browser (multiplayer plan, spike S2): the co-op lockstep simulates the same run on every
// player's machine and on the server, so a browser must reach the very hashes Node reaches (golden-runs.ts).

describe(`partidas de referencia en el navegador (SIM ${SIM_VERSION})`, () => {
  for (const run of GOLDEN_RUNS) {
    test(run.name, () => {
      expect(playGolden(goldenSim(run))).toEqual(run.hashes);
    }, 60_000);
  }
});

// The deep ones (2026-11-16): layers 5–6, a full pool and the Núcleos' rise, which the 2-minute ones never reach.
describe(`partidas de referencia profundas en el navegador (SIM ${SIM_VERSION})`, () => {
  for (const run of DEEP_RUNS) {
    test(run.name, () => {
      expect(playDeep(run)).toEqual(run.hashes);
    }, 180_000);
  }
});

