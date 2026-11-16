import { parseConfig } from '@galaxy/shared';
import { DEFAULT_CONTENT } from '@galaxy/sim';
import { expect, test } from 'vitest';
import { copy } from '../src/copy/es';
import { bigReasonText, currencyLook, giftCatalog, giftWords } from '../src/gifts/words';

// What the panel says of each gift (mail v2, P3): its words, from the live config (the event's and the season's own
// names, the probe's and the piece's), and why a gift is big, with the limit the config sets.

const now = new Date('2026-11-16T12:00:00.000Z');
const rows = [
  { key: 'events', data: { list: [{ id: 'cometas', name: 'Lluvia de cometas', description: 'x', startsAt: '2026-11-10T00:00:00.000Z', endsAt: '2026-11-20T00:00:00.000Z', goals: [{ id: 'cazar', name: 'Caza 100', stat: 'kills', target: 100, reward: {} }] }] } },
  { key: 'season', data: { id: 's1', startsAt: '2026-11-01T00:00:00.000Z', endsAt: '2026-12-13T00:00:00.000Z' } },
  { key: 'seasonRoute', data: { currency: { name: 'Esquirlas' } } },
  { key: 'mail', data: { packs: [{ id: 'bienvenida', name: 'Bienvenida', art: 'chest', items: [{ kind: 'xp', amount: 10 }] }] } },
];
const cat = giftCatalog(rows, DEFAULT_CONTENT.probes, now);
const g = copy.gifts;

test('el catálogo sale de lo vivo: eventos abiertos, la temporada, las sondas y la biblioteca', () => {
  expect(cat.events.map((e) => e.id)).toEqual(['cometas']);
  expect(cat.season).toMatchObject({ id: 's1', open: true, currencyName: 'Esquirlas' });
  expect(cat.probes.length).toBe(DEFAULT_CONTENT.probes.length);
  expect(cat.packs.map((p) => p.id)).toEqual(['bienvenida']);
  expect(cat.limits.galaxyTier).toBe('legendary');
  expect(cat.live.events).toEqual([{ id: 'cometas', endsAt: '2026-11-20T00:00:00.000Z' }]);
});

test('cada moneda tiene su nombre e icono, también las de un evento y la temporada', () => {
  expect(currencyLook('coins', cat)).toMatchObject({ icon: 'coin', name: g.currency.coins });
  expect(currencyLook('signal:cometas', cat).name).toBe(g.currency.eventSignal('Lluvia de cometas'));
  expect(currencyLook('season:s1', cat).name).toBe('Esquirlas');
});

test('las palabras de cada regalo', () => {
  const frame = parseConfig('cosmetics', {}).frames.find((f) => f.id === 'gold')!;
  const probe = DEFAULT_CONTENT.probes[1]!;
  expect(giftWords({ kind: 'currency', currency: 'components', amount: 20 }, cat)).toBe(g.amount.components(20));
  expect(giftWords({ kind: 'cosmetic', piece: 'frame', id: 'gold' }, cat)).toBe(g.cosmetic('frame', frame.name));
  expect(giftWords({ kind: 'galaxy', tier: 'epic', finish: 'holo', trait: null, count: 2 }, cat)).toBe(g.galaxyWords(2, copy.tiers.epic, copy.finishes.holo));
  expect(giftWords({ kind: 'probe', probe: probe.id }, cat)).toBe(g.probe(probe.name));
  expect(giftWords({ kind: 'xp', amount: 300 }, cat)).toBe(g.xp(300));
  expect(giftWords({ kind: 'seasonPoints', amount: 40 }, cat)).toBe(g.seasonPoints(40));
});

test('por qué es grande, con el límite de la configuración', () => {
  expect(bigReasonText('galaxy_tier', cat)).toBe(g.big.reasons.galaxy_tier(copy.tiers.legendary));
  expect(bigReasonText('currency_coins', cat)).toBe(g.big.reasons.currency(g.currency.coins, cat.limits.currency.coins));
  expect(bigReasonText('xp', cat)).toBe(g.big.reasons.xp(cat.limits.xp));
});

test('demasiadas galaxias en un mensaje también se explica (revisión de P3)', () => {
  expect(bigReasonText('galaxy_count', cat)).toBe(g.big.reasons.galaxy_count(cat.limits.galaxies));
});
