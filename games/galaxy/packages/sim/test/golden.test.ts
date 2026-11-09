import { describe, expect, test } from 'vitest';
import { botInput, botPick, createSim, DEFAULT_CONTENT, type Sim, SIM_VERSION, stateHash, step } from '../src/index';

// Golden runs of the solo game: fixed seeds and bot inputs, their state hash every 20 s. A change that moves these
// hashes changes how runs play: it needs a SIM_VERSION bump (and new goldens). The co-op mode (plan phase 4) must
// leave them untouched.

function play(sim: Sim, until: number, every: number): string[] {
  const out: string[] = [];
  while (sim.tick < until && (sim.status === 'running' || sim.status === 'choosing')) {
    if (sim.status === 'choosing') step(sim, sim.probes.map((p) => ({ mx: 0, my: 0, aim: -1, pick: p.offer ? botPick(p.offer) : -1 })));
    else step(sim, sim.probes.map((p) => botInput(sim, p.index)));
    if (sim.status === 'running' && sim.tick % every === 0) out.push(`${sim.tick}:${stateHash(sim)}`);
  }
  return out;
}

describe(`partidas de referencia (SIM ${SIM_VERSION})`, () => {
  test('una sonda en el primer sector', () => {
    const sim = createSim({ seed: '9001', content: DEFAULT_CONTENT, sector: DEFAULT_CONTENT.sectors[0]!.id, probes: [{ probe: DEFAULT_CONTENT.probes[0]!.id, relics: [] }] });
    expect(play(sim, 3600 * 2, 1200)).toMatchInlineSnapshot(`
      [
        "1200:c553fda4655b3d64",
        "2400:53b42622ba80aaae",
        "3600:8e74d166608848f1",
        "4800:980b441c5d798d0a",
        "6000:85d792422895f2c6",
        "7200:9e560505601aa663",
      ]
    `);
  });

  test('otra sonda en otro sector', () => {
    const sim = createSim({ seed: '31337', content: DEFAULT_CONTENT, sector: DEFAULT_CONTENT.sectors[2]!.id, probes: [{ probe: DEFAULT_CONTENT.probes[2]!.id, relics: [] }] });
    expect(play(sim, 3600 * 2, 1200)).toMatchInlineSnapshot(`
      [
        "1200:9632f19b12af5cef",
        "2400:16641bd6e347ab95",
        "3600:61230a36e98405dc",
        "4800:75dd503206851565",
        "6000:936da7d3bf18be90",
        "7200:836ee664103d650d",
      ]
    `);
  });

  test('dos sondas', () => {
    const sim = createSim({
      seed: '271828',
      content: DEFAULT_CONTENT,
      sector: DEFAULT_CONTENT.sectors[0]!.id,
      probes: [
        { probe: DEFAULT_CONTENT.probes[1]!.id, relics: [] },
        { probe: DEFAULT_CONTENT.probes[3]!.id, relics: [] },
      ],
    });
    expect(play(sim, 3600 * 2, 1200)).toMatchInlineSnapshot(`
      [
        "1200:825727d615990bb6",
        "2400:fb7e5961cebd5e57",
        "3600:5fe0273359683aff",
        "4800:bdb9c01a9713b0e6",
        "6000:5364611d10a7da04",
        "7200:1f55b14ffe43af76",
      ]
    `);
  });
});
