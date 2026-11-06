import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { MASTER_SEED, PALETTES, POSTFX, RENDER, TRAITS, VISUALS } from '../src/index';
// @ts-expect-error plain ESM script without type declarations
import { generate } from '../scripts/gen-config.mjs';
import { loadGolden } from './golden';

// ENGINE_PORT §2.6 and §4: the YAML lives in packages/engine/config; generated.ts is its ordered, frozen image.
type PyConfig = {
  traits: { draw_order: string[]; traits: Record<string, unknown>; rules: unknown[] };
  palettes: Record<string, unknown>;
  visuals: Record<string, unknown>;
  render: Record<string, unknown>;
  postfx: Record<string, unknown>;
  master_seed: number;
  orders: Record<string, string[]>;
};
const py = loadGolden<PyConfig>('config.json');

/** TRAITS back in the shape PyYAML gives (values as a mapping). */
function traitsAsPython() {
  return {
    draw_order: TRAITS.drawOrder,
    traits: Object.fromEntries(
      Object.entries(TRAITS.traits).map(([key, spec]) => [
        key,
        {
          label: spec.label,
          ...(spec.requires ? { requires: spec.requires } : {}),
          values: Object.fromEntries(
            spec.values.map(({ value, name, weight, requires }) => [
              value,
              { name, weight, ...(requires ? { requires } : {}) },
            ]),
          ),
        },
      ]),
    ),
    rules: TRAITS.rules,
  };
}

describe('configuración generada', () => {
  test('coincide con lo que PyYAML lee de los mismos YAML', () => {
    expect(traitsAsPython()).toEqual(py.traits);
    expect(Object.fromEntries(PALETTES)).toEqual(py.palettes);
    expect(VISUALS).toEqual(py.visuals);
    expect(RENDER).toEqual(py.render);
    expect(POSTFX).toEqual(py.postfx);
    expect(MASTER_SEED).toBe(py.master_seed);
  });

  test('conserva el orden del YAML en rasgos, valores y paletas', () => {
    expect(TRAITS.drawOrder).toEqual(py.traits.draw_order);
    expect(Object.keys(TRAITS.traits)).toEqual(py.orders['traits']);
    expect([...PALETTES.keys()]).toEqual(py.orders['palettes']);
    for (const [key, spec] of Object.entries(TRAITS.traits)) {
      expect(
        spec.values.map((v) => v.value),
        key,
      ).toEqual(py.orders[`traits.${key}.values`]);
    }
    expect(TRAITS.traits.galaxy_type.values.map((v) => v.value)).toEqual([
      'spiral',
      'barred_spiral',
      'elliptical',
      'lenticular',
      'irregular',
      'ring',
      'dwarf',
      'merger',
    ]);
    expect([...PALETTES.keys()]).toEqual([
      'andromeda_blue',
      'terminal_green',
      'solar_gold',
      'crimson_nebula',
      'emerald_void',
      'amber_crt',
      'ultraviolet',
      'neon_synapse',
      'monochrome',
      'prismatic',
      'antimatter',
    ]);
  });

  test('generated.ts está al día con los YAML', () => {
    const onDisk = readFileSync(new URL('../src/config/generated.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
    expect(onDisk, 'run `pnpm -C packages/engine gen:config`').toBe(generate());
  });

  test('es inmutable', () => {
    expect(Object.isFrozen(TRAITS.traits.galaxy_type.values[0])).toBe(true);
    expect(Object.isFrozen(VISUALS.size)).toBe(true);
    expect(Object.isFrozen(PALETTES.get('antimatter'))).toBe(true);
  });
});
