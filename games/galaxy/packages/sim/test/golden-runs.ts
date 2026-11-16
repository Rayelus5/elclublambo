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
    hashes: ['1200:098628be7f6c9058', '2400:e8e8c863b8ae1583', '3600:eb3e1ff007a2342f', '4800:79df75c6649cc01b', '6000:a4bb67d860115af8', '7200:e664d41f286d67d9'],
  },
  {
    name: 'otra sonda en otro sector',
    options: () => ({ seed: '31337', content: C, sector: C.sectors[2]!.id, probes: [{ probe: C.probes[2]!.id, relics: [] }] }),
    hashes: ['1200:1ee539d39f695ba8', '2400:23730d80f3483696', '3600:389f517354330333', '4800:ad3ef582df25a0ad', '6000:50981915177b7d9f', '7200:8fd96af61bb8e1bd'],
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
    hashes: ['1200:ade68739f20af487', '2400:c2bd512271265438', '3600:1559049bfe08c9ba', '4800:ea69151d93c7fc04', '6000:1ac26247847f5c52', '7200:0e4a482061d4986b'],
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
    hashes: ['3600:7784660155a76981', '7200:169e82d2a4b5c1f0', '10800:1ea8a5b53aec77c1', '14400:2cd7e4ee9607d35e', '18000:90d59fdc67c6fdfb', '21600:143414cca0d0aa0d', '25200:94b5f03f3e02ace3', '28800:c65775de4e859ede', '32400:d686a07fd87b04bd', '36000:dbc009cb7f4c2885'],
  },
  {
    name: 'cuatro sondas en grupo hasta las capas profundas',
    options: () => {
      const c = deepContent();
      return { seed: '2718', content: c, sector: c.sectors[1]!.id, coop: DEFAULT_COOP_RULES, probes: [0, 1, 2, 3].map((i) => ({ probe: c.probes[i]!.id, relics: [], bonuses: STRONG })) };
    },
    hashes: ['3600:67afa639a8380132', '7200:0db486d828c2dc05', '10800:938fd9f775ad2d63', '14400:dd2c547224992bb5', '18000:550b6bf3c0a1aa79', '21600:51b4e604158d7940', '25200:9339650b37208417', '28800:7284cca68c4df542', '32400:68039979f48becbb', '36000:bbf66dfd15838df5'],
  },
];

export const playDeep = (run: (typeof DEEP_RUNS)[number]) => playGolden(createSim(run.options()), DEEP_UNTIL, DEEP_EVERY, 99);

