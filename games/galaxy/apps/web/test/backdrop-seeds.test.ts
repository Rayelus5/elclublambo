import { expect, test } from 'vitest';
import { backdropSeeds, seedFor } from '../src/scene/backdrop-seeds';

// The title screen's sky shows the player's own galaxies (rarest first), but never the paper-white Antimatter or the
// Anomaly glitch, which would look like a broken screen behind the menu.
const g = (seed: string, palette: string, phenomenon = 'none') => ({ seed, traits: { palette, phenomenon } });

test('el fondo usa las galaxias de la colección en su orden y descarta Antimatter y Anomaly', () => {
  const seeds = backdropSeeds([
    g('1', 'andromeda_blue', 'pulsar'),
    g('2', 'antimatter'),
    g('3', 'solar_gold', 'anomaly'),
    g('4', 'terminal_green'),
  ]);
  expect(seeds).toEqual(['1', '4']);
});

test('sin galaxias de la colección el fondo vuelve a semillas al azar', () => {
  expect(backdropSeeds([])).toEqual([]);
  expect(seedFor([], 1)).toBeNull();
});

test('las galaxias de la colección se turnan una tras otra', () => {
  const seeds = ['10', '20', '30'];
  expect([1, 2, 3, 4, 5].map((id) => seedFor(seeds, id))).toEqual([10n, 20n, 30n, 10n, 20n]);
});
