import { describe, expect, test } from 'vitest';
import {
  closingInfo,
  type Gift,
  MAX_GALAXIES,
  mailLimitsSchema,
  parseConfig,
  retargetSeasonGifts,
  seasonBigGifts,
  seasonPlaceOf,
  seasonPrizePlaces,
  seasonRecordIssues,
  seasonRecordSchema,
  seasonRewardToGifts,
} from '../src';

// Season prizes of every kind (plan «temporadas como fichas», PR 4, 2026-11-22): the route's steps, the shop's items and
// the closing prizes carry gifts (galaxies, skins, probes…) next to their old reward, which still holds and is still
// paid; the close also pays by place, in ranges, to those who can win prizes for their place.

const T3 = { id: 'season-3', name: 'Temporada 3', startsAt: '2026-12-30T23:00:00.000Z', endsAt: '2027-01-27T23:00:00.000Z', rules: { anomaly: null } };
const empty = { coins: 0, dust: 0, signal: 0, shards: 0, title: null, frame: null, avatar: null, skin: null };
const probe: Gift = { kind: 'probe', probe: 'bastion' };
const galaxy = (count: number): Gift => ({ kind: 'galaxy', tier: 'epic', finish: 'normal', trait: null, count });
const closing = (over: object) => ({ ...parseConfig('seasonRoute', {}).closing, ...over });
const messages = (input: unknown, ctx?: Parameters<typeof seasonRecordIssues>[1]) => seasonRecordIssues(input, ctx).map((i) => `${i.path} ${i.message}`);

describe('los regalos junto a la recompensa de siempre', () => {
  test('una ruta de antes se lee igual y gana listas de regalos vacías', () => {
    const route = parseConfig('seasonRoute', {});
    expect(route.steps[0]).toEqual({ at: 100, reward: { ...empty, coins: 300 }, gifts: [] });
    expect(route.shop[0]).toMatchObject({ id: 'signal', reward: { ...empty, signal: 1 }, gifts: [] });
    expect(route.closing).toMatchObject({ tierGifts: [[], [], [], [], []], podiumGifts: [], places: [] });
  });

  test('un escalón o un artículo puede dar solo regalos (su recompensa de siempre queda vacía)', () => {
    const r = seasonRecordSchema.parse({ ...T3, route: { steps: [{ at: 100, gifts: [probe] }], shop: [{ id: 'gx', name: 'Galaxia', price: 10, limit: 1, gifts: [galaxy(1)] }] } });
    expect(r.route.steps[0]).toEqual({ at: 100, reward: empty, gifts: [probe] });
    expect(r.route.shop[0]!.reward).toEqual(empty);
  });

  test('lo de antes se ve como regalos: monedas, polvo y señales, la moneda de su temporada y cada pieza', () => {
    const reward = { ...empty, coins: 300, dust: 50, signal: 2, shards: 30, title: 'Pionero', avatar: 'crew-pilot' as const, skin: 'skin-lumen-coral' as const, frame: 'nebula' as const };
    expect(seasonRewardToGifts(reward, 'season-3')).toEqual([
      { kind: 'currency', currency: 'coins', amount: 300 },
      { kind: 'currency', currency: 'dust', amount: 50 },
      { kind: 'currency', currency: 'signal', amount: 2 },
      { kind: 'currency', currency: 'season:season-3', amount: 30 },
      { kind: 'cosmetic', piece: 'title', id: 'Pionero' },
      { kind: 'cosmetic', piece: 'frame', id: 'nebula' },
      { kind: 'cosmetic', piece: 'avatar', id: 'crew-pilot' },
      { kind: 'cosmetic', piece: 'skin', id: 'skin-lumen-coral' },
    ]);
    // A closing prize never paid the season's currency: without a season it is left out.
    expect(seasonRewardToGifts({ ...empty, shards: 30, coins: 1 }, null)).toEqual([{ kind: 'currency', currency: 'coins', amount: 1 }]);
  });

  test('un escalón o un artículo que no da nada es un problema', () => {
    expect(messages({ ...T3, route: { steps: [{ at: 100 }], shop: [{ id: 'nada', name: 'Nada', price: 1, limit: 1 }] } })).toEqual(['route.steps.0 season_reward_empty', 'route.shop.0 season_reward_empty']);
  });
});

describe('qué regalos caben en una temporada', () => {
  test('la ruta y la tienda pueden dar la moneda de su temporada, nunca la de otra ni puntos de temporada', () => {
    const own: Gift = { kind: 'currency', currency: 'season:season-3', amount: 50 };
    const other: Gift = { kind: 'currency', currency: 'season:season-2', amount: 50 };
    const points: Gift = { kind: 'seasonPoints', amount: 100 };
    expect(messages({ ...T3, route: { steps: [{ at: 100, gifts: [own] }], shop: [] } })).toEqual([]);
    expect(messages({ ...T3, route: { steps: [{ at: 100, gifts: [other, points] }], shop: [] } })).toEqual(['route.steps.0.gifts.0 season_gift_other', 'route.steps.0.gifts.1 season_gift_points']);
  });

  test('los premios de cierre no pueden dar moneda ni puntos de temporada: se recogen con la temporada cerrada', () => {
    const own: Gift = { kind: 'currency', currency: 'season:season-3', amount: 50 };
    const issues = messages({ ...T3, route: { closing: closing({ podiumGifts: [own], places: [{ from: 1, to: 1, gifts: [{ kind: 'seasonPoints', amount: 5 }] }] }) } });
    expect(issues).toEqual(['route.closing.podiumGifts.0 season_gift_closed', 'route.closing.places.0.gifts.0 season_gift_closed']);
  });

  test('cada lista da como mucho las galaxias de un mensaje', () => {
    const many = [galaxy(5), galaxy(5), galaxy(1)];
    expect(MAX_GALAXIES).toBe(10);
    expect(messages({ ...T3, route: { steps: [{ at: 100, gifts: many }] } })).toContain('route.steps.0.gifts season_gift_galaxies');
  });

  test('con lo vivo, cada regalo se comprueba como en el buzón, a la fecha de inicio (y el cierre a la de fin)', () => {
    const cosmetics = parseConfig('cosmetics', {});
    const events = [{ id: 'navidad', endsAt: '2027-01-10T23:00:00.000Z' }];
    const ctx = { gifts: { cosmetics, probes: ['lumen'], events } };
    const signal: Gift = { kind: 'currency', currency: 'signal:navidad', amount: 3 };
    const issues = messages({ ...T3, route: { steps: [{ at: 100, gifts: [probe, signal] }], closing: closing({ tierGifts: [[signal], [], [], [], []] }) } }, ctx);
    // The event is still open when the season starts, but over when it ends.
    expect(issues).toEqual(['route.steps.0.gifts.0 gift_probe_unknown', 'route.closing.tierGifts.0.0 gift_event_closed']);
  });
});

describe('premios de cierre por puestos', () => {
  test('los rangos empiezan en el 1, van en orden, sin solaparse, y cada uno da algo', () => {
    const p = (from: number, to: number, gifts: Gift[] = [probe]) => ({ from, to, gifts });
    expect(messages({ ...T3, route: { closing: closing({ places: [p(1, 1), p(2, 5), p(10, 20)] }) } })).toEqual([]);
    expect(messages({ ...T3, route: { closing: closing({ places: [p(2, 3)] }) } })).toEqual(['route.closing.places.0.from prizes_start']);
    expect(messages({ ...T3, route: { closing: closing({ places: [p(1, 3), p(3, 4)] }) } })).toEqual(['route.closing.places.1.from prizes_overlap']);
    expect(messages({ ...T3, route: { closing: closing({ places: [p(1, 3), p(5, 4)] }) } })).toEqual(['route.closing.places.1.to prize_range']);
    expect(messages({ ...T3, route: { closing: closing({ places: [p(4, 5), p(1, 3)] }) } })).toContain('route.closing.places.1.from prizes_order');
    expect(messages({ ...T3, route: { closing: closing({ places: [p(1, 1, [])] }) } })).toEqual(['route.closing.places.0 prize_empty']);
  });

  test('los puestos con premio son para quien puede ganarlos: quien no, conserva su puesto y el suyo pasa al siguiente', () => {
    const rows = ['admin', 'a', 'b', 'c', 'd'].map((accountId) => ({ accountId }));
    const places = seasonPrizePlaces(rows, new Set(['admin']), 3);
    expect([...places]).toEqual([
      ['a', 1],
      ['b', 2],
      ['c', 3],
    ]);
    const ranges = [{ from: 1, to: 1, gifts: [probe] }, { from: 2, to: 3, gifts: [galaxy(1)] }];
    expect(seasonPlaceOf(ranges, 1)).toBe(ranges[0]);
    expect(seasonPlaceOf(ranges, 3)).toBe(ranges[1]);
    expect(seasonPlaceOf(ranges, 4)).toBeNull();
  });

  test('lo que enseña la clasificación del cierre lleva los regalos y los puestos', () => {
    const c = parseConfig('seasonRoute', { closing: closing({ podiumGifts: [probe], places: [{ from: 1, to: 1, gifts: [galaxy(1)] }] }) }).closing;
    expect(closingInfo(c)).toEqual({ tiers: c.tiers, podium: c.podium, podiumSize: 3, tierGifts: [[], [], [], [], []], podiumGifts: [probe], places: [{ from: 1, to: 1, gifts: [galaxy(1)] }] });
  });
});

describe('regalos grandes en una temporada', () => {
  const limits = mailLimitsSchema.parse({});
  const cosmetics = parseConfig('cosmetics', {});

  test('cada escalón, artículo o premio se pesa como un mensaje: un artículo por todas las veces que se compra', () => {
    const route = parseConfig('seasonRoute', {
      steps: [{ at: 100, gifts: [probe] }],
      shop: [{ id: 'bolsa', name: 'Bolsa', price: 1, limit: 3, gifts: [{ kind: 'currency', currency: 'coins', amount: 20_000 }] }],
      closing: closing({ places: [{ from: 1, to: 3, gifts: [{ kind: 'galaxy', tier: 'legendary', finish: 'normal', trait: null, count: 1 }] }] }),
    });
    expect(seasonBigGifts(route, limits, cosmetics)).toEqual([
      { path: 'route.steps.0', reasons: ['probe'] },
      { path: 'route.shop.0', reasons: ['currency_coins'] },
      { path: 'route.closing.places.0', reasons: ['galaxy_tier'] },
    ]);
  });

  test('con un tope de destinatarios, la ruta llega a todos y un rango de puestos a tantos como puestos tiene', () => {
    const route = parseConfig('seasonRoute', { steps: [{ at: 100, gifts: [{ kind: 'currency', currency: 'coins', amount: 1 }] }], shop: [], closing: closing({ places: [{ from: 1, to: 2, gifts: [{ kind: 'currency', currency: 'coins', amount: 1 }] }] }) });
    const capped = { ...limits, recipients: 5 };
    expect(seasonBigGifts(route, capped, cosmetics).map((b) => b.path)).toEqual(['route.steps.0', 'route.closing.tiers.0', 'route.closing.tiers.1', 'route.closing.tiers.2', 'route.closing.tiers.3', 'route.closing.tiers.4']);
  });
});

test('copiar una temporada lleva su moneda a la nueva', () => {
  const route = parseConfig('seasonRoute', { steps: [{ at: 100, gifts: [{ kind: 'currency', currency: 'season:season-2', amount: 5 }, probe] }], shop: [{ id: 'x', name: 'X', price: 1, limit: 1, gifts: [{ kind: 'currency', currency: 'season:season-2', amount: 1 }] }] });
  const moved = retargetSeasonGifts(route, 'season-3');
  expect(moved.steps[0]!.gifts).toEqual([{ kind: 'currency', currency: 'season:season-3', amount: 5 }, probe]);
  expect(moved.shop[0]!.gifts[0]).toEqual({ kind: 'currency', currency: 'season:season-3', amount: 1 });
  // Nothing to move to without a valid id.
  expect(retargetSeasonGifts(route, '')).toBe(route);
  expect(retargetSeasonGifts(moved, 'season-3')).toBe(moved);
});
