import { botInput, botPick, type Content, createSim, DEFAULT_CONTENT, DEFAULT_COOP_RULES, type Sim, type SimOptions, stateHash, step, type StatBonus } from '../src/index';

// Golden runs of the solo game (multiplayer plan): fixed seeds and bot inputs, their state hash every 20 s. The same
// table is checked in Node (golden.test.ts) and in real browsers (test/browser/determinism.browser.test.ts): the
// co-op lockstep needs every engine to play a run the same. A CODE change that moves these hashes changes how runs
// play: it needs a SIM_VERSION bump (and new goldens). They play DEFAULT_CONTENT, so new or retuned content data moves
// them too: that needs only new goldens (published runs carry their own content version; docs/CONTENIDO.md A3). The
// co-op mode must leave them untouched.

/** `extractFrom`: the layer the bot starts going for the beacon (99: never, so it goes deep). */
export function playGolden(sim: Sim, until = 3600 * 2, every = 1200, extractFrom = 1): string[] {
  const out: string[] = [];
  while (sim.tick < until && (sim.status === 'running' || sim.status === 'choosing')) {
    if (sim.status === 'choosing') step(sim, sim.probes.map((p) => ({ mx: 0, my: 0, aim: -1, pick: p.offer ? botPick(p.offer) : -1 })));
    else step(sim, sim.probes.map((p) => botInput(sim, p.index, extractFrom)));
    if (sim.status === 'running' && sim.tick % every === 0) out.push(`${sim.tick}:${stateHash(sim)}`);
  }
  return out;
}

const C = DEFAULT_CONTENT;

export const GOLDEN_RUNS: { name: string; options: () => SimOptions; hashes: string[] }[] = [
  {
    name: 'una sonda en el primer sector',
    options: () => ({ seed: '9001', content: C, sector: C.sectors[0]!.id, probes: [{ probe: C.probes[0]!.id, relics: [] }] }),
    hashes: ['1200:79e101fd9d80264e', '2400:aa4bf028ddb691de', '3600:c145d009f4c4d728', '4800:71d3b58f1e5fba07', '6000:05976280a4139160', '7200:464c44405bf038f9'],
  },
  {
    name: 'otra sonda en otro sector',
    options: () => ({ seed: '31337', content: C, sector: C.sectors[2]!.id, probes: [{ probe: C.probes[2]!.id, relics: [] }] }),
    hashes: ['1200:a1c7c0dd31f99ffc', '2400:e9c2ee6344bd15cc', '3600:303abe1d5f50c80d', '4800:b3b3962abcefd1bb', '6000:38686e5bdbf6894c', '7200:71080c24a8df33e7'],
  },
  {
    name: 'dos sondas',
    options: () => ({
      seed: '271828',
      content: C,
      sector: C.sectors[0]!.id,
      probes: [
        { probe: C.probes[1]!.id, relics: [] },
        { probe: C.probes[3]!.id, relics: [] },
      ],
    }),
    hashes: ['1200:b517e75db9d591d8', '2400:6fc886601ba66ced', '3600:a76b107264a7e12f', '4800:9a4492075b3e9e84', '6000:c6c01513b875329e', '7200:6c70155d372cd799'],
  },
];

export const goldenSim = (run: (typeof GOLDEN_RUNS)[number]) => createSim(run.options());

/**
 * Deep golden runs (pending minor, 2026-11-16): the ones above stop at 2 minutes, before any deep layer. These play the
 * default content with 30-second layers, a 5-second beacon, a 30-enemy pool and strong probes that never extract, so in
 * 10 minutes they reach layers 5–6 with the pool full (the Núcleo's `makeRoom`), the crowd per layer, the Núcleos'
 * rise and the life per level. Checked in Node and in browsers like the others.
 */
export function deepContent(): Content {
  const c = structuredClone(DEFAULT_CONTENT);
  for (const s of c.sectors) {
    s.layerSeconds = 30;
    s.beacon = { ...s.beacon, seconds: 5 };
  }
  c.limits = { ...c.limits, enemies: 30 };
  return c;
}

const STRONG: StatBonus[] = [
  { stat: 'maxHp', value: 3 },
  { stat: 'damage', value: 12 },
  { stat: 'armor', value: 0.4 },
  { stat: 'regen', value: 3 },
];

export const DEEP_UNTIL = 3600 * 10;
export const DEEP_EVERY = 3600;

export const DEEP_RUNS: { name: string; options: () => SimOptions; hashes: string[] }[] = [
  {
    name: 'una sonda hasta las capas profundas',
    options: () => {
      const c = deepContent();
      return { seed: '1618', content: c, sector: c.sectors[0]!.id, probes: [{ probe: c.probes[0]!.id, relics: [], bonuses: STRONG }] };
    },
    hashes: ['3600:bd75547670636c3b', '7200:6b83e4b5f6248ee7', '10800:00f6e6aa85abb960', '14400:a94a3eb6ce807aed', '18000:d57697a5250e4a82', '21600:97fe5a2d8cc4e970', '25200:6f0b5162f0b40089', '28800:fc6e019fda5fbf2c', '32400:4db6d86c09225628', '36000:b086ef682141cf7a'],
  },
  {
    name: 'cuatro sondas en grupo hasta las capas profundas',
    options: () => {
      const c = deepContent();
      return { seed: '2718', content: c, sector: c.sectors[1]!.id, coop: DEFAULT_COOP_RULES, probes: [0, 1, 2, 3].map((i) => ({ probe: c.probes[i]!.id, relics: [], bonuses: STRONG })) };
    },
    hashes: ['3600:0d790423d51c1f6e', '7200:a623df3c88199591', '10800:01f550c81e8281ee', '14400:4286a1e7d126b3ed', '18000:6e7284704b44c670', '21600:f237ca2213f0832e', '25200:962e0c828825e01c', '28800:19cc2e2d40e00338', '32400:9bde0cc508d87935', '36000:dfe942eac9a57ca1'],
  },
];

export const playDeep = (run: (typeof DEEP_RUNS)[number]) => playGolden(createSim(run.options()), DEEP_UNTIL, DEEP_EVERY, 99);

