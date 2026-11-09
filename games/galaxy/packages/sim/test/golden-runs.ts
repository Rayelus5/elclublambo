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
    hashes: ['1200:b799ffab7a36dfe5', '2400:da4dd62cf1360a02', '3600:90d5ec0f028537e7', '4800:27a39eb622cbd603', '6000:c5ad21d9985903e5', '7200:c4fc24c056ea1e61'],
  },
  {
    name: 'otra sonda en otro sector',
    options: () => ({ seed: '31337', content: C, sector: C.sectors[2]!.id, probes: [{ probe: C.probes[2]!.id, relics: [] }] }),
    hashes: ['1200:bccc100b9c9b4fef', '2400:1a81218bcdf6a776', '3600:54555cfb3d8d8cb6', '4800:648e96b6c1080f0a', '6000:f2ea11695f52f43e', '7200:9f2ef2f020e4dffa'],
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
    hashes: ['1200:2bf6e008de4570dc', '2400:87bdc6600ad1bc17', '3600:1987fe4d7fa6333e', '4800:6824407654b5599a', '6000:bcb9b98392488b4c', '7200:81cb6bc0da8d25db'],
  },
];

export const goldenSim = (run: (typeof GOLDEN_RUNS)[number]) => createSim(run.options());
