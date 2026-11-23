import { expect, test } from 'vitest';
import { type PrizeChoice, SKIN_PROBES } from '@galaxy/shared';
import { copy } from '../src/copy/es';
import { toCollect } from '../src/tournaments/parts';
import { blockText, choiceWords, exclusiveClashes, featuredOf, feeWords, rewardOf, runGains } from '../src/tournaments/words';
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

test('el inicio enseña el torneo que más te importa: premios, el que juegas, uno abierto, el tuyo en revisión o por empezar', () => {
  const id = (n: number) => `${String(n).repeat(8)}-${String(n).repeat(4)}-4${String(n).repeat(3)}-8${String(n).repeat(3)}-${String(n).repeat(12)}`;
  const prize = card({ id: id(1), slug: 'premio', state: 'finished', endsAt: at(-2 * DAY), join: { open: false, block: 'closed' }, me: me({ rewards: { place: 3, gifts: [{ kind: 'currency', currency: 'coins', amount: 500 }], cash: null, participation: false } }) });
  const collected = card({ id: id(2), slug: 'recogido', state: 'finished', endsAt: at(-DAY), join: { open: false, block: 'closed' }, me: me({ claimed: true, rewards: { place: 1, gifts: [{ kind: 'currency', currency: 'coins', amount: 900 }], cash: null, participation: false } }) });
  const playingLate = card({ id: id(3), slug: 'juego-tarde', endsAt: at(6 * DAY), join: { open: false, block: 'joined' }, me: me() });
  const playingSoon = card({ id: id(4), slug: 'juego-pronto', endsAt: at(2 * DAY), join: { open: false, block: 'joined' }, me: me() });
  const open = card({ id: id(5), slug: 'abierto', join: { open: true, block: null } });
  const review = card({ id: id(6), slug: 'revision', state: 'review', endsAt: at(-3_600_000), join: { open: false, block: 'closed' }, me: me() });
  const soon = card({ id: id(7), slug: 'pronto', state: 'scheduled', startsAt: at(2 * DAY), endsAt: at(5 * DAY), join: { open: false, block: 'joined' }, me: me({ rank: null }) });
  const blocked = card({ id: id(8), slug: 'bloqueado', join: { open: false, block: 'exclusive' } });
  const cancelled = card({ id: id(9), slug: 'cancelado', state: 'cancelled', join: { open: false, block: 'closed' } });
  const pick = (l: Parameters<typeof list>[0]) => {
    const f = featuredOf(list(l));
    return f ? [f.card.slug, f.pick] : null;
  };
  expect(pick({ running: [playingSoon, open], finished: [collected, prize] })).toEqual(['premio', 'collect']);
  expect(pick({ running: [open, playingLate, playingSoon], finished: [collected] })).toEqual(['juego-pronto', 'playing']);
  expect(pick({ running: [blocked, open], finished: [review], upcoming: [soon] })).toEqual(['abierto', 'open']);
  expect(pick({ running: [blocked], finished: [review], upcoming: [soon] })).toEqual(['revision', 'results']);
  expect(pick({ running: [blocked], upcoming: [soon] })).toEqual(['pronto', 'joined']);
  expect(pick({ running: [blocked] })).toEqual(['bloqueado', 'live']);
  expect(pick({ finished: [cancelled, collected] })).toEqual(['recogido', 'past']);
  expect(pick({ finished: [cancelled] })).toBeNull();
  expect(featuredOf(undefined)).toBeNull();
});

// Skins to choose as a prize (plan «Torneo Navideño», C2): a prize that is only skins to choose is still something to
// collect, and it reads as its pack.
const NAVIDAD = SKIN_PROBES.map((p) => `skin-${p}-navidad`);
const choice = (count: number, over: Partial<PrizeChoice> = {}): PrizeChoice => ({ piece: 'skin', options: NAVIDAD, count, perMissing: { currency: 'signal', amount: 10 }, ...over });

test('un premio que solo son skins a elegir también se recoge, y el inicio lo destaca', () => {
  const rewards = { place: 3, gifts: [], cash: null, participation: false, choice: choice(1) };
  const finished = card({ state: 'finished', endsAt: at(-DAY), join: { open: false, block: 'closed' }, me: me({ rank: 3, rewards }) });
  expect(toCollect(finished)).toBe(true);
  expect(toCollect({ ...finished, me: me({ rank: 3, rewards, claimed: true }) })).toBe(false);
  expect(toCollect({ ...finished, me: me({ rank: 3, rewards: { ...rewards, choice: undefined } }) })).toBe(false);
  expect(featuredOf(list({ finished: [finished] }))).toEqual({ card: finished, pick: 'collect' });
});

test('las skins a elegir se dicen con su pack: completo, o cuántas eliges, y lo que vale cada una que falte', () => {
  expect(choiceWords(choice(8))).toEqual({ title: 'Pack Navidad completo', rule: 'Cada una que ya tengas se cambia por 10 señales de galaxia' });
  expect(choiceWords(choice(3))).toEqual({ title: 'Elige 3 skins del Pack Navidad', rule: 'Eliges entre las que no tienes. Si no quedan bastantes, 10 señales de galaxia por cada una que falte' });
  expect(choiceWords(choice(1)).title).toBe('Elige 1 skin del Pack Navidad');
  // In any order, the eight of a line are its pack.
  expect(choiceWords(choice(8, { options: [...NAVIDAD].reverse() })).title).toBe('Pack Navidad completo');
  // Skins that are not a whole pack: how many, of how many.
  const loose = ['skin-lumen-fuego', 'skin-spark-agua', 'skin-echo-rubi'];
  expect(choiceWords(choice(3, { options: loose })).title).toBe('3 skins');
  expect(choiceWords(choice(2, { options: loose })).title).toBe('Elige 2 skins de 3');
  expect(choiceWords(choice(1, { options: ['skin-lumen-fuego'] })).title).toBe('1 skin');
  // Nothing for the missing ones: no line.
  expect(choiceWords(choice(3, { perMissing: null })).rule).toBeNull();
});
