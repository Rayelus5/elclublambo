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
