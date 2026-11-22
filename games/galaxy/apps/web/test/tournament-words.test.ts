import { expect, test } from 'vitest';
import { copy } from '../src/copy/es';
import { blockText, exclusiveClashes, feeWords, rewardOf, runGains } from '../src/tournaments/words';
import { at, card, DAY, list, me } from './tournament-fixtures';

// What the tournaments say in words and work out on their own (plan «temporadas como fichas», part 5): why you cannot
// sign up, which exclusive tournaments signing up keeps you out of, the fee, what a prize gives to the flight and the
// sound, and what a run added in each tournament you are in.

const t = copy.tournaments;

test('cada motivo para no poder inscribirte se dice en claro, con el nivel y el torneo que lo impide', () => {
  expect(blockText(card({ join: { open: true, block: null } }))).toBeNull();
  expect(blockText(card({ join: { open: false, block: 'joined' } }))).toBeNull();
  expect(blockText(card({ join: { open: false, block: 'left' } }))).toBe(t.block.left);
  expect(blockText(card({ join: { open: false, block: 'disqualified' } }))).toBe(t.block.disqualified);
  expect(blockText(card({ join: { open: false, block: 'closed' } }))).toBe(t.block.closed);
  expect(blockText(card({ join: { open: false, block: 'full' } }))).toBe(t.block.full);
  expect(blockText(card({ join: { open: false, block: 'excluded' } }))).toBe(t.block.excluded);
  expect(blockText(card({ join: { open: false, block: 'level' }, filters: { sector: null, probe: null, mode: 'any', minLevel: 12 } }))).toBe('Necesitas nivel 12 para inscribirte');
  expect(blockText(card({ join: { open: false, block: 'exclusive' }, exclusiveWith: { slug: 'copa-de-fuego', title: 'Copa de fuego' } }))).toBe('Ya estás en «Copa de fuego», que coincide en fechas');
});

test('inscribirte en un exclusivo te deja fuera de los otros exclusivos abiertos que coinciden en fechas', () => {
  const ice = card();
  const fire = card({ id: '22222222-2222-4222-8222-222222222222', slug: 'copa-de-fuego', title: 'Copa de fuego', state: 'scheduled', startsAt: at(2 * DAY), endsAt: at(6 * DAY) });
  const later = card({ id: '33333333-3333-4333-8333-333333333333', slug: 'copa-lejana', title: 'Copa lejana', state: 'scheduled', startsAt: at(9 * DAY), endsAt: at(12 * DAY) });
  const open = card({ id: '44444444-4444-4444-8444-444444444444', slug: 'copa-libre', title: 'Copa libre', exclusive: false });
  expect(exclusiveClashes(ice, [ice, fire, later, open])).toEqual(['Copa de fuego']);
  expect(exclusiveClashes({ ...ice, exclusive: false }, [ice, fire, later, open])).toEqual([]);
  expect(copy.tournaments.joinDialog.exclusive(['Copa de fuego'])).toBe('Es exclusivo. No podrás estar en «Copa de fuego» a la vez');
});

test('la entrada se dice con su moneda', () => {
  expect(feeWords({ currency: 'coins', amount: 500 })).toBe('500 monedas');
  expect(feeWords({ currency: 'dust', amount: 12000 })).toBe('12.000 de polvo estelar');
  expect(feeWords({ currency: 'signal', amount: 1 })).toBe('1 señal de galaxia');
});

test('un premio vuela y suena por lo que da: monedas, polvo, señales y piezas', () => {
  expect(
    rewardOf([
      { kind: 'currency', currency: 'coins', amount: 5000 },
      { kind: 'currency', currency: 'coins', amount: 500 },
      { kind: 'currency', currency: 'dust', amount: 800 },
      { kind: 'currency', currency: 'signal', amount: 2 },
      { kind: 'cosmetic', piece: 'title', id: 'Campeón de hielo' },
      { kind: 'cosmetic', piece: 'frame', id: 'crown' },
      { kind: 'galaxy', tier: 'epic', finish: 'holo', trait: null, count: 1 },
    ]),
  ).toEqual(expect.objectContaining({ coins: 5500, dust: 800, signal: 2, title: 'Campeón de hielo', frame: 'crown' }));
});

test('lo que sumó una partida: lo que crece tu puntuación y los puestos que subes en cada torneo en curso en el que estás', () => {
  const before = list({ running: [card({ me: me({ score: 1240, rank: 8 }) })], upcoming: [card({ id: 'x', slug: 'otra', title: 'Otra', state: 'scheduled', me: me({ score: 0, rank: null }) })] });
  const after = list({ running: [card({ me: me({ score: 1560, rank: 5 }) })], upcoming: [card({ id: 'x', slug: 'otra', title: 'Otra', state: 'scheduled', me: me({ score: 0, rank: null }) })] });
  expect(runGains(before, after)).toEqual([{ slug: 'copa-de-hielo', title: 'Copa de hielo', metric: 'points', gain: 320, score: 1560, rank: 5, climbed: 3 }]);
  // The first score climbs from nowhere: no arrow.
  const first = list({ running: [card({ me: me({ score: 0, rank: null }) })] });
  expect(runGains(first, after)[0]).toMatchObject({ gain: 1560, climbed: 0 });
  // Nothing added (the run did not count), not in it, or no list from before: nothing to say.
  expect(runGains(after, after)).toEqual([]);
  expect(runGains(list({ running: [card()] }), list({ running: [card()] }))).toEqual([]);
  expect(runGains(undefined, after)).toEqual([]);
  expect(copy.tournaments.runGain(t.value.points(320), 'Copa de hielo', 5)).toBe('+320 puntos en Copa de hielo, ahora 5.º');
});
