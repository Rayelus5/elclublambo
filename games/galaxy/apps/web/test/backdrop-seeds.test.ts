import { expect, test } from 'vitest';
import { backdropSeeds, seedFor, shuffledLaps } from '../src/scene/backdrop-seeds';

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

// Plan «escáner pro», part E (the owner: «que no se mostraran de forma ordenada, sino aleatoria»): the sky takes its
// galaxies in a shuffled order, lap after lap, and never shows the same one twice in a row.
test('las galaxias del fondo salen barajadas, todas en cada vuelta y nunca la misma dos veces seguidas', () => {
  let s = 1;
  const rand = () => ((s = (s * 48271) % 2147483647) / 2147483647);
  const seeds = ['1', '2', '3', '4', '5'];
  const order = shuffledLaps(seeds, 6, rand);
  expect(order).toHaveLength(30);
  for (let lap = 0; lap < 6; lap++) expect([...order.slice(lap * 5, lap * 5 + 5)].sort()).toEqual(seeds);
  for (let i = 1; i < order.length; i++) expect(order[i]).not.toBe(order[i - 1]);
  // Not just the collection's order.
  expect(order.slice(0, 5)).not.toEqual(seeds);
  expect(shuffledLaps(['7'], 3, rand)).toEqual(['7', '7', '7']);
  expect(shuffledLaps([], 3, rand)).toEqual([]);
});
