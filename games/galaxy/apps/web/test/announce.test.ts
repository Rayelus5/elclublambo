import { DEFAULT_CONTENT, type SimEvent } from '@galaxy/sim';
import { expect, test } from 'vitest';
import { announceFor } from '../src/arena/announce';
import { copy } from '../src/copy/es';

// What the run screen reads aloud from the simulation's events (DESIGN_SYSTEM §8 quinquies): an evolution, and the
// first time each reaction goes off in the run; never a flood.

test('anuncia una evolución con el nombre del arma nueva', () => {
  const seen = new Set<string>();
  const events: SimEvent[] = [{ t: 'evolve', probe: 0, from: 'pulse', to: 'pulse-storm' }];
  expect(announceFor(events, DEFAULT_CONTENT, seen)).toBe(copy.arena.announce.evolved('Tormenta de pulsos'));
});

test('cada reacción se anuncia solo la primera vez en la partida', () => {
  const seen = new Set<string>();
  const once: SimEvent[] = [{ t: 'reaction', id: 'short-circuit', x: 0, y: 0 }];
  expect(announceFor(once, DEFAULT_CONTENT, seen)).toBe(copy.arena.announce.reaction('Cortocircuito'));
  expect(announceFor(once, DEFAULT_CONTENT, seen)).toBeNull();
  expect(announceFor([{ t: 'reaction', id: 'overload', x: 0, y: 0 }], DEFAULT_CONTENT, seen)).toBe(copy.arena.announce.reaction('Sobrecarga'));
});

test('sin nada que anunciar, nada', () => {
  expect(announceFor([{ t: 'kill', x: 0, y: 0, enemy: 'mite', elite: false }], DEFAULT_CONTENT, new Set())).toBeNull();
});

test('en grupo solo se anuncia mi evolución, no la de un compañero (plan de noviembre A2)', () => {
  const evolve = { t: 'evolve', probe: 1, from: 'pulse', to: 'pulse-storm' } as const;
  expect(announceFor([evolve], DEFAULT_CONTENT, new Set(), 0)).toBeNull();
  expect(announceFor([evolve], DEFAULT_CONTENT, new Set(), 1)).not.toBeNull();
});
