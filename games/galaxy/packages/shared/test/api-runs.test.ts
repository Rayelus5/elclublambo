import { describe, expect, test } from 'vitest';
import { finishRunRequestSchema, loadoutRequestSchema, startRunRequestSchema } from '../src/index';

// Requests of the hangar and run API: strict, bounded and well formed before the server looks at them.

const finish = {
  outcome: 'died',
  ticks: 3600,
  depth: 2,
  kills: 120,
  bossKills: 1,
  level: 9,
  loot: [
    { coins: 4, dust: 2 },
    { coins: 1, dust: 0 },
  ],
  hash: '0123456789abcdef',
  inputs: 'AQEA',
};

describe('fin de partida', () => {
  test('acepta un final bien formado', () => {
    expect(finishRunRequestSchema.parse(finish)).toEqual(finish);
  });

  test('rechaza un botín de otra longitud que la profundidad, un hash mal formado y entradas que no son base64', () => {
    expect(() => finishRunRequestSchema.parse({ ...finish, loot: [{ coins: 1, dust: 1 }] })).toThrow(/loot_depth/);
    expect(() => finishRunRequestSchema.parse({ ...finish, hash: 'XYZ' })).toThrow();
    expect(() => finishRunRequestSchema.parse({ ...finish, inputs: 'no es base64!' })).toThrow();
    expect(() => finishRunRequestSchema.parse({ ...finish, outcome: 'won' })).toThrow();
    expect(() => finishRunRequestSchema.parse({ ...finish, ticks: -1 })).toThrow();
    expect(() => finishRunRequestSchema.parse({ ...finish, extra: 1 })).toThrow();
    expect(() => finishRunRequestSchema.parse({ ...finish, inputs: 'A'.repeat(2_800_004) })).toThrow();
  });
});

describe('inicio y equipo', () => {
  test('inicio: sector, sonda y versión de la simulación', () => {
    expect(startRunRequestSchema.parse({ sector: 'outer-nebula', probe: 'lumen', simVersion: '1.0.0' })).toBeTruthy();
    expect(() => startRunRequestSchema.parse({ sector: 'Outer Nebula', probe: 'lumen', simVersion: '1.0.0' })).toThrow();
  });

  test('equipo: hasta 6 huecos, vacíos permitidos, sin repetir galaxia', () => {
    const a = '00000000-0000-4000-8000-000000000001';
    const b = '00000000-0000-4000-8000-000000000002';
    expect(loadoutRequestSchema.parse({ relics: [a, null, b] })).toEqual({ relics: [a, null, b] });
    expect(() => loadoutRequestSchema.parse({ relics: [a, a] })).toThrow(/duplicate_ids/);
    expect(() => loadoutRequestSchema.parse({ relics: [a, null, null, null, null, null, b] })).toThrow();
  });
});
