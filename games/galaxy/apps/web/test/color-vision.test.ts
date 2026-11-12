import { TIERS } from '@galaxy/shared';
import { afterEach, expect, test } from 'vitest';
import { contrast, deltaE, PALETTES, simulate, tierHex, type ColorVisionMode } from '../src/a11y/color-vision';
import { stagePalette, teamTint } from '../src/arena/stage/palette';
import { applyPrefs, resetPrefs, setPrefs } from '../src/settings/prefs';

// The colour-blind palettes (plan «escáner pro», part C): for each kind of colour blindness, the colours that mean
// something — rarity, the four players, good against danger — stay clearly apart once simulated (Machado 2009, full
// severity) and readable on the game's dark background. The galaxies' art never changes.

const BG = '#070a1c';
const MODES: Exclude<ColorVisionMode, 'none'>[] = ['protan', 'deutan', 'tritan'];
const pairs = <T,>(xs: T[]) => xs.flatMap((a, i) => xs.slice(i + 1).map((b) => [a, b] as const));

afterEach(() => {
  resetPrefs();
  localStorage.clear();
  document.documentElement.removeAttribute('style');
});

test('la simulación deja igual un color gris y ΔE2000 da 0 entre iguales', () => {
  expect(simulate('#808080', 'deutan')).toBe('#808080');
  expect(deltaE('#6fb7ff', '#6fb7ff')).toBeCloseTo(0, 6);
  expect(deltaE('#000000', '#ffffff')).toBeGreaterThan(90);
  expect(contrast('#000000', '#ffffff')).toBeCloseTo(21, 0);
});

test('hoy, con deuteranopía, rara y épica casi no se distinguen: por eso hacen falta paletas', () => {
  expect(deltaE(simulate(PALETTES.none.tier.rare, 'deutan'), simulate(PALETTES.none.tier.epic, 'deutan'))).toBeLessThan(5);
});

for (const mode of MODES) {
  test(`${mode}: rarezas, jugadores y bien/peligro se distinguen y se leen sobre el fondo`, () => {
    const p = PALETTES[mode];
    const groups: [string, string[]][] = [
      ['rarezas', TIERS.map((t) => p.tier[t])],
      ['jugadores', [...p.team]],
      ['bien y peligro', [p.terminal[0], p.nova[0]]],
      ['bien y estática', [p.terminal[0], p.static]],
    ];
    for (const [name, colors] of groups) {
      for (const [a, b] of pairs(colors)) {
        const d = deltaE(simulate(a, mode), simulate(b, mode));
        expect(d, `${name} ${a}/${b}`).toBeGreaterThanOrEqual(12);
      }
      for (const c of colors) expect(contrast(simulate(c, mode), BG), `${name} ${c}`).toBeGreaterThanOrEqual(3);
    }
  });
}

test('la paleta normal es la de siempre (los tokens del diseño)', () => {
  expect(PALETTES.none.tier).toEqual({ common: '#c9d0ea', uncommon: '#45e3a6', rare: '#6fb7ff', epic: '#b39dff', legendary: '#ffc94a' });
  expect(PALETTES.none.team).toEqual(['#ffc94a', '#45e3a6', '#bfe3ff', '#ff6b7a']);
  expect(tierHex('rare', 'none')).toBe('#6fb7ff');
  expect(tierHex('rare', 'deutan')).toBe(PALETTES.deutan.tier.rare);
});

test('al elegir un modo, <html> lleva sus colores; al volver a Normal, los de siempre', () => {
  const stop = applyPrefs();
  const root = document.documentElement;
  setPrefs({ colorVision: 'deutan' });
  expect(root.style.getPropertyValue('--color-tier-epic')).toBe(PALETTES.deutan.tier.epic);
  expect(root.style.getPropertyValue('--color-terminal')).toBe(PALETTES.deutan.terminal[0]);
  expect(root.style.getPropertyValue('--color-static')).toBe(PALETTES.deutan.static);
  setPrefs({ colorVision: 'none' });
  expect(root.style.getPropertyValue('--color-tier-epic')).toBe('');
  stop();
});

test('el escenario de la incursión usa la paleta elegida', () => {
  const none = stagePalette('none');
  const deutan = stagePalette('deutan');
  expect(none.team[1]).toBe(0x45e3a6);
  expect(deutan.team[1]).toBe(Number.parseInt(PALETTES.deutan.team[1].slice(1), 16));
  expect(deutan.good).not.toBe(none.good);
  expect(teamTint(1, 'deutan')).toBe(deutan.team[1]);
  // Every element has a colour and a glyph (shape, not only colour).
  for (const [id, color] of Object.entries(deutan.element)) {
    expect(typeof color).toBe('number');
    expect(deutan.glyph[id]).toHaveLength(9);
  }
});
