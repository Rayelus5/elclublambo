import { botInput, botPick, createSim, DEFAULT_CONTENT, type Sim, type SimOptions, stateHash, step } from '../src/index';

// Golden runs of the solo game (multiplayer plan): fixed seeds and bot inputs, their state hash every 20 s. The same
// table is checked in Node (golden.test.ts) and in real browsers (test/browser/determinism.browser.test.ts): the
// co-op lockstep needs every engine to play a run the same. A change that moves these hashes changes how runs play:
// it needs a SIM_VERSION bump (and new goldens). The co-op mode must leave them untouched.

export function playGolden(sim: Sim, until = 3600 * 2, every = 1200): string[] {
  const out: string[] = [];
  while (sim.tick < until && (sim.status === 'running' || sim.status === 'choosing')) {
    if (sim.status === 'choosing') step(sim, sim.probes.map((p) => ({ mx: 0, my: 0, aim: -1, pick: p.offer ? botPick(p.offer) : -1 })));
    else step(sim, sim.probes.map((p) => botInput(sim, p.index)));
    if (sim.status === 'running' && sim.tick % every === 0) out.push(`${sim.tick}:${stateHash(sim)}`);
  }
  return out;
}

const C = DEFAULT_CONTENT;

export const GOLDEN_RUNS: { name: string; options: () => SimOptions; hashes: string[] }[] = [
  {
    name: 'una sonda en el primer sector',
    options: () => ({ seed: '9001', content: C, sector: C.sectors[0]!.id, probes: [{ probe: C.probes[0]!.id, relics: [] }] }),
    hashes: ['1200:c553fda4655b3d64', '2400:72972e212b501d1c', '3600:6cbe888dc1ce4f75', '4800:c6a0476e2baa7bdf', '6000:1abe6ea2f0b17633', '7200:6d226846f17699f2'],
  },
  {
    name: 'otra sonda en otro sector',
    options: () => ({ seed: '31337', content: C, sector: C.sectors[2]!.id, probes: [{ probe: C.probes[2]!.id, relics: [] }] }),
    hashes: ['1200:9632f19b12af5cef', '2400:16641bd6e347ab95', '3600:61230a36e98405dc', '4800:75dd503206851565', '6000:936da7d3bf18be90', '7200:74115620e1fa3fa5'],
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
    hashes: ['1200:1727cb9933412a4c', '2400:b68cd56edf3de66c', '3600:aaf71c5b8fd92c4c', '4800:72a2caf20e28d786', '6000:f8efdbb15c6226c7', '7200:0ff8210bb04323e9'],
  },
];

export const goldenSim = (run: (typeof GOLDEN_RUNS)[number]) => createSim(run.options());
