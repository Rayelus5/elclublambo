import { botInput, botPick, createSim, DEFAULT_CONTENT, type Sim, type SimOptions, stateHash, step } from '../src/index';

// Golden runs of the solo game (multiplayer plan): fixed seeds and bot inputs, their state hash every 20 s. The same
// table is checked in Node (golden.test.ts) and in real browsers (test/browser/determinism.browser.test.ts): the
// co-op lockstep needs every engine to play a run the same. A CODE change that moves these hashes changes how runs
// play: it needs a SIM_VERSION bump (and new goldens). They play DEFAULT_CONTENT, so new or retuned content data moves
// them too: that needs only new goldens (published runs carry their own content version; docs/CONTENIDO.md A3). The
// co-op mode must leave them untouched.

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
    hashes: ['1200:af8e0d91b2c8f3e6', '2400:3b34cd089a97e539', '3600:8743cf3f109f9c38', '4800:97c1fa4f0f02affa', '6000:198391d88a60de2f', '7200:f117849d65ac900d'],
  },
  {
    name: 'otra sonda en otro sector',
    options: () => ({ seed: '31337', content: C, sector: C.sectors[2]!.id, probes: [{ probe: C.probes[2]!.id, relics: [] }] }),
    hashes: ['1200:d16da6a432210738', '2400:453e541167a19510', '3600:f20c1c99f8af3638', '4800:823879db40ac7a81', '6000:69e40ee16d5ac477', '7200:9f6d76413566fb02'],
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
    hashes: ['1200:6fd8566b664dfde7', '2400:b199e03c11af0f83', '3600:7446418fd47188bc', '4800:74ba7b07f8c7bf1e', '6000:61a2be9c08c16b82', '7200:5fd4b6f38d00fe40'],
  },
];

export const goldenSim = (run: (typeof GOLDEN_RUNS)[number]) => createSim(run.options());
