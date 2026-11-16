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
    hashes: ['1200:85b31e95c9fb0731', '2400:d36c46c0725b7225', '3600:3fd13bd1d610b2df', '4800:015558a7aef37498', '6000:4b9fb237653f7ee9', '7200:bcfda5e432565717'],
  },
  {
    name: 'otra sonda en otro sector',
    options: () => ({ seed: '31337', content: C, sector: C.sectors[2]!.id, probes: [{ probe: C.probes[2]!.id, relics: [] }] }),
    hashes: ['1200:73b28e285bbaf867', '2400:ed06547631595086', '3600:2da904d8d981f702', '4800:1e073be731281233', '6000:90a85b7c05a71a20', '7200:92649e3853a9384b'],
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
    hashes: ['1200:1ee3c7d8151aeb38', '2400:e4624a45d73965fc', '3600:b9b08fdbd13c5208', '4800:ce81e7f70ec25f43', '6000:1874cdeb9e5c0de7', '7200:fe47a9916f2e4e34'],
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
    hashes: ['3600:ec77053ef7ea5235', '7200:99eceb39d764cb16', '10800:6fae632cef2a06d0', '14400:d9ab99002eb336d0', '18000:1027698a0a5f277f', '21600:87d16d629ef0f2df', '25200:e60f6c53231532f1', '28800:adbd6468e850c787', '32400:f5c0c3c753f14f5d', '36000:ee5de90cfe085ea9'],
  },
  {
    name: 'cuatro sondas en grupo hasta las capas profundas',
    options: () => {
      const c = deepContent();
      return { seed: '2718', content: c, sector: c.sectors[1]!.id, coop: DEFAULT_COOP_RULES, probes: [0, 1, 2, 3].map((i) => ({ probe: c.probes[i]!.id, relics: [], bonuses: STRONG })) };
    },
    hashes: ['3600:c84ad2cd0288e25a', '7200:93ffe41d1d85fd70', '10800:651dec48522d1fb5', '14400:3d23d5593e740c70', '18000:2b47589278f9b6ee', '21600:f747adf72c393c4a', '25200:26ee2b3bf9021cc1', '28800:16aedab502428fb4', '32400:e0360b8ae567dedf', '36000:adaee1dc2c1acb85'],
  },
];

export const playDeep = (run: (typeof DEEP_RUNS)[number]) => playGolden(createSim(run.options()), DEEP_UNTIL, DEEP_EVERY, 99);

