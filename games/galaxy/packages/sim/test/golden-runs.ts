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
    hashes: ['1200:37da867e6f378d62', '2400:195a4cdf9487229c', '3600:3337806048cde56e', '4800:4575c6e4b2b917ec', '6000:37e8028b8ba7cce9', '7200:325c52fe60747952'],
  },
  {
    name: 'otra sonda en otro sector',
    options: () => ({ seed: '31337', content: C, sector: C.sectors[2]!.id, probes: [{ probe: C.probes[2]!.id, relics: [] }] }),
    hashes: ['1200:f9ecafc4a3ff2273', '2400:782adaabb5be479f', '3600:bae16040ae840574', '4800:43759b5f29e88c77'],
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
    hashes: ['1200:e346a9a72c66e6a9', '2400:61b585c41d5d821a', '3600:61d3ea23b1b1fbb4', '4800:df4e9cb31139c140', '6000:096b3e01e18dd25a', '7200:e956afb9a57ed2cd'],
  },
];

export const goldenSim = (run: (typeof GOLDEN_RUNS)[number]) => createSim(run.options());
