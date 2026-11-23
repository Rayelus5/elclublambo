import { describe, expect, test } from 'vitest';
import {
  awardPlaces,
  type Gift,
  parseConfig,
  prizeForPlace,
  SKIN_PROBES,
  TOURNAMENT_MAX_DAYS,
  tournamentBigReasons,
  tournamentFitsSeason,
  tournamentIssues,
  tournamentRecordSchema,
  tournamentRewardsFor,
} from '../src';

// Tournaments (plan «temporadas como fichas», part 5; GDD §13.3): the record an admin saves, its checks (ranges from 1
// without overlaps, never a fee with money, 31 days at most, inside its season), the prize of each place and who takes
// it when an account cannot win prizes, and the skins a place lets its winner choose (plan «Torneo Navideño», C1).

const coins = (amount: number): Gift => ({ kind: 'currency', currency: 'coins', amount });
const BASE = {
  slug: 'copa-de-invierno',
  seasonId: 'season-2',
  title: 'Copa de invierno',
  startsAt: '2026-12-04T17:00:00.000Z',
  endsAt: '2026-12-06T23:00:00.000Z',
  metric: 'points',
  prizes: [
    { from: 1, to: 1, gifts: [coins(5000)] },
    { from: 2, to: 3, gifts: [coins(2000)] },
  ],
};
const SEASON = { id: 'season-2', state: 'scheduled' as const, startsAt: '2026-11-22T23:00:00.000Z', endsAt: '2026-12-30T23:00:00.000Z' };
const messages = (input: unknown, ctx = {}) => tournamentIssues(input, ctx).map((i) => i.message);

describe('la ficha de un torneo', () => {
  test('una ficha mínima se completa con los valores por defecto', () => {
    const t = tournamentRecordSchema.parse(BASE);
    expect(t).toMatchObject({ exclusive: true, entry: null, participation: null, reviewHours: 24, maxEntrants: null, summary: '', rules: '', bannerMedia: null, detailsMedia: null });
    expect(t.filters).toEqual({ sector: null, probe: null, mode: 'any', minLevel: null });
    expect(t.prizes[1]).toEqual({ from: 2, to: 3, gifts: [coins(2000)], cash: null });
  });

  test('acaba después de empezar y dura 31 días como mucho', () => {
    expect(TOURNAMENT_MAX_DAYS).toBe(31);
    expect(messages({ ...BASE, endsAt: BASE.startsAt })).toContain('tournament_dates');
    // Exactly 31 days (all of December, Madrid time) is fine; one second more is not.
    expect(messages({ ...BASE, startsAt: '2026-11-30T23:00:00.000Z', endsAt: '2026-12-31T23:00:00.000Z' })).toEqual([]);
    expect(messages({ ...BASE, startsAt: '2026-11-30T23:00:00.000Z', endsAt: '2026-12-31T23:00:01.000Z' })).toContain('tournament_too_long');
  });

  test('los puestos con premio empiezan en 1, van en orden y no se solapan', () => {
    expect(messages({ ...BASE, prizes: [{ from: 2, to: 3, gifts: [coins(1)] }] })).toContain('prizes_start');
    expect(messages({ ...BASE, prizes: [{ from: 1, to: 3, gifts: [coins(1)] }, { from: 3, to: 4, gifts: [coins(1)] }] })).toContain('prizes_overlap');
    expect(messages({ ...BASE, prizes: [{ from: 1, to: 1, gifts: [coins(1)] }, { from: 5, to: 6, gifts: [coins(1)] }, { from: 2, to: 4, gifts: [coins(1)] }] })).toContain('prizes_order');
    expect(messages({ ...BASE, prizes: [{ from: 3, to: 1, gifts: [coins(1)] }] })).toContain('prize_range');
    // A gap between ranges is allowed: places without a prize.
    expect(messages({ ...BASE, prizes: [{ from: 1, to: 1, gifts: [coins(1)] }, { from: 4, to: 10, gifts: [coins(1)] }] })).toEqual([]);
  });

  test('cada puesto con premio da algo', () => {
    expect(messages({ ...BASE, prizes: [{ from: 1, to: 1, gifts: [] }] })).toContain('prize_empty');
    expect(messages({ ...BASE, prizes: [{ from: 1, to: 1, gifts: [], cash: { amountEur: 50 } }] })).toEqual([]);
  });

  test('una entrada nunca va junto a un premio en dinero', () => {
    const cash = { ...BASE, prizes: [{ from: 1, to: 1, gifts: [], cash: { amountEur: 25.5, note: 'Tarjeta regalo' } }] };
    expect(messages(cash)).toEqual([]);
    expect(messages({ ...cash, entry: { currency: 'coins', amount: 500 } })).toContain('entry_with_cash');
    expect(messages({ ...BASE, entry: { currency: 'dust', amount: 100 } })).toEqual([]);
  });

  test('el dinero va en euros con céntimos y la entrada en una moneda del juego', () => {
    expect(messages({ ...BASE, prizes: [{ from: 1, to: 1, cash: { amountEur: 10.005 } }] }).length).toBeGreaterThan(0);
    expect(messages({ ...BASE, entry: { currency: 'season:season-2', amount: 5 } }).length).toBeGreaterThan(0);
  });

  test('el premio de participación pide al menos una partida y algún regalo', () => {
    expect(messages({ ...BASE, participation: { minRuns: 3, gifts: [coins(100)] } })).toEqual([]);
    expect(messages({ ...BASE, participation: { minRuns: 0, gifts: [coins(100)] } }).length).toBeGreaterThan(0);
    expect(messages({ ...BASE, participation: { minRuns: 2, gifts: [] } }).length).toBeGreaterThan(0);
  });

  test('cabe en su temporada, que tiene que estar programada', () => {
    expect(messages(BASE, { season: SEASON })).toEqual([]);
    expect(messages(BASE, { season: null })).toContain('tournament_season_unknown');
    expect(messages(BASE, { season: { ...SEASON, state: 'closed' } })).toContain('tournament_season_closed');
    expect(messages(BASE, { season: { ...SEASON, state: 'draft' } })).toContain('tournament_season_closed');
    expect(messages({ ...BASE, endsAt: '2026-12-31T00:00:00.000Z' }, { season: SEASON })).toContain('tournament_outside_season');
    expect(messages({ ...BASE, startsAt: '2026-11-20T00:00:00.000Z' }, { season: SEASON })).toContain('tournament_outside_season');
  });

  test('caber en la temporada es empezar y acabar dentro de sus fechas, con sus dos bordes incluidos', () => {
    expect(tournamentFitsSeason(BASE, SEASON)).toBe(true);
    expect(tournamentFitsSeason({ startsAt: SEASON.startsAt, endsAt: SEASON.endsAt }, SEASON)).toBe(true);
    expect(tournamentFitsSeason({ ...BASE, endsAt: '2026-12-31T00:00:00.000Z' }, SEASON)).toBe(false);
    expect(tournamentFitsSeason({ ...BASE, startsAt: '2026-11-20T00:00:00.000Z' }, SEASON)).toBe(false);
  });

  test('los filtros nombran un sector y una sonda que existen', () => {
    const ctx = { sectors: ['outer-nebula'], probes: ['lumen'] };
    expect(messages({ ...BASE, filters: { sector: 'outer-nebula', probe: 'lumen', mode: 'solo', minLevel: 5 } }, ctx)).toEqual([]);
    expect(messages({ ...BASE, filters: { sector: 'nowhere' } }, ctx)).toContain('tournament_sector_unknown');
    expect(messages({ ...BASE, filters: { probe: 'ghost' } }, ctx)).toContain('tournament_probe_unknown');
  });

  test('los premios no llevan nada que caduque con la temporada o un evento (se recogen sin fecha)', () => {
    const seasonal = { ...BASE, prizes: [{ from: 1, to: 1, gifts: [{ kind: 'seasonPoints', amount: 100 }] }] };
    expect(tournamentIssues(seasonal, {})).toContainEqual({ path: 'prizes.0.gifts.0', message: 'prize_gift_seasonal' });
    const shards = { ...BASE, participation: { minRuns: 1, gifts: [{ kind: 'currency', currency: 'season:season-2', amount: 10 }] } };
    expect(tournamentIssues(shards, {})).toContainEqual({ path: 'participation.gifts.0', message: 'prize_gift_seasonal' });
    const event = { ...BASE, prizes: [{ from: 1, to: 1, gifts: [{ kind: 'currency', currency: 'signal:frost', amount: 10 }] }] };
    expect(messages(event)).toContain('prize_gift_event');
  });
});

describe('quién gana qué', () => {
  const t = tournamentRecordSchema.parse({ ...BASE, prizes: [...BASE.prizes, { from: 4, to: 4, gifts: [], cash: { amountEur: 20, note: '' } }], participation: { minRuns: 2, gifts: [coins(50)] } });

  test('el premio de cada puesto', () => {
    expect(prizeForPlace(t.prizes, 1)?.gifts).toEqual([coins(5000)]);
    expect(prizeForPlace(t.prizes, 3)?.gifts).toEqual([coins(2000)]);
    expect(prizeForPlace(t.prizes, 4)?.cash).toEqual({ amountEur: 20, note: '' });
    expect(prizeForPlace(t.prizes, 5)).toBeNull();
  });

  test('quien no puede ganar premios conserva su puesto y su premio pasa al siguiente', () => {
    const rows = [
      { accountId: 'admin', eligible: false },
      { accountId: 'b', eligible: true },
      { accountId: 'c', eligible: true },
      { accountId: 'd', eligible: true },
      { accountId: 'e', eligible: true },
      { accountId: 'f', eligible: true },
    ];
    const places = awardPlaces(rows, t.prizes);
    expect([...places.entries()]).toEqual([
      ['b', 1],
      ['c', 2],
      ['d', 3],
      ['e', 4],
    ]);
    expect(awardPlaces([], t.prizes).size).toBe(0);
    expect(awardPlaces(rows, []).size).toBe(0);
  });

  test('lo que se lleva cada uno: su puesto, el dinero aparte y el premio de participación si jugó lo bastante', () => {
    expect(tournamentRewardsFor(t, { place: 1, runs: 5, eligible: true })).toEqual({ place: 1, gifts: [coins(5000), coins(50)], cash: null, participation: true });
    expect(tournamentRewardsFor(t, { place: 4, runs: 1, eligible: true })).toEqual({ place: 4, gifts: [], cash: { amountEur: 20, note: '' }, participation: false });
    expect(tournamentRewardsFor(t, { place: null, runs: 2, eligible: true })).toEqual({ place: null, gifts: [coins(50)], cash: null, participation: true });
    expect(tournamentRewardsFor(t, { place: null, runs: 1, eligible: true })).toBeNull();
    // Who cannot win prizes gets nothing, not even for taking part.
    expect(tournamentRewardsFor(t, { place: null, runs: 9, eligible: false })).toBeNull();
  });
});

describe('quién puede programarlo', () => {
  const limits = parseConfig('mailLimits', {});
  const cosmetics = parseConfig('cosmetics', {});

  test('premios pequeños sin dinero los programa cualquier admin', () => {
    expect(tournamentBigReasons(tournamentRecordSchema.parse(BASE), limits, cosmetics)).toEqual([]);
  });

  test('premios por encima de los límites del buzón o con dinero piden un superadmin', () => {
    const big = tournamentRecordSchema.parse({ ...BASE, prizes: [{ from: 1, to: 1, gifts: [coins(limits.currency.coins + 1)] }] });
    expect(tournamentBigReasons(big, limits, cosmetics)).toEqual(['currency_coins']);
    const cash = tournamentRecordSchema.parse({ ...BASE, prizes: [{ from: 1, to: 1, gifts: [], cash: { amountEur: 5 } }] });
    expect(tournamentBigReasons(cash, limits, cosmetics)).toEqual(['cash']);
  });

  test('cada ganador se lleva su puesto y la participación juntos: se suman contra los límites', () => {
    const half = Math.floor(limits.currency.coins / 2) + 1;
    const both = tournamentRecordSchema.parse({ ...BASE, prizes: [{ from: 1, to: 1, gifts: [coins(half)] }], participation: { minRuns: 1, gifts: [coins(half)] }, maxEntrants: 1 });
    expect(tournamentBigReasons(both, limits, cosmetics)).toEqual(['currency_coins']);
  });

  test('el límite de destinatarios cuenta los puestos del rango y, en la participación, el cupo', () => {
    const few = { ...limits, recipients: 5 };
    const wide = tournamentRecordSchema.parse({ ...BASE, prizes: [{ from: 1, to: 10, gifts: [coins(10)] }] });
    expect(tournamentBigReasons(wide, few, cosmetics)).toEqual(['recipients']);
    const open = tournamentRecordSchema.parse({ ...BASE, participation: { minRuns: 1, gifts: [coins(10)] } });
    expect(tournamentBigReasons(open, few, cosmetics)).toEqual(['recipients']);
    expect(tournamentBigReasons({ ...open, maxEntrants: 5 }, few, cosmetics)).toEqual([]);
  });
});

describe('las skins a elegir (plan «Torneo Navideño», C1)', () => {
  const NAVIDAD = SKIN_PROBES.map((p) => `skin-${p}-navidad`);
  const signal = (amount: number): Gift => ({ kind: 'currency', currency: 'signal', amount });
  const choice = (count: number, over: object = {}) => ({ piece: 'skin', options: NAVIDAD, count, perMissing: { currency: 'signal', amount: 10 }, ...over });
  const withChoice = (c: object, gifts: Gift[] = []) => ({ ...BASE, prizes: [{ from: 1, to: 1, gifts, choice: c }] });
  const cosmetics = parseConfig('cosmetics', {});
  const live = (over: Partial<typeof cosmetics> = {}) => ({ cosmetics: { ...cosmetics, ...over }, probes: ['lumen'], events: [], season: { id: 'season-2', open: false }, now: new Date('2026-11-23T12:00:00.000Z') });

  test('un tramo que solo da skins a elegir no está vacío', () => {
    expect(messages(withChoice(choice(3)))).toEqual([]);
    expect(messages(withChoice(choice(8, { perMissing: null })))).toEqual([]);
    expect(tournamentRecordSchema.parse(withChoice(choice(1))).prizes[0]!.choice).toEqual({ piece: 'skin', options: NAVIDAD, count: 1, perMissing: { currency: 'signal', amount: 10 } });
  });

  test('no da más skins de las que hay para elegir ni repite opciones', () => {
    expect(tournamentIssues(withChoice(choice(9)))).toContainEqual({ path: 'prizes.0.choice.count', message: 'prize_choice_count' });
    expect(tournamentIssues(withChoice(choice(1, { options: [NAVIDAD[0], NAVIDAD[1], NAVIDAD[0]] })))).toContainEqual({ path: 'prizes.0.choice.options.2', message: 'prize_choice_twice' });
    // Shapes the schema refuses: no options, a count of 0, a fee currency that is not the wallet's, more than 12.
    expect(messages(withChoice(choice(1, { options: [] }))).length).toBeGreaterThan(0);
    expect(messages(withChoice(choice(0))).length).toBeGreaterThan(0);
    expect(messages(withChoice(choice(1, { perMissing: { currency: 'season:season-2', amount: 10 } }))).length).toBeGreaterThan(0);
    expect(messages(withChoice(choice(1, { perMissing: { currency: 'signal', amount: 0 } }))).length).toBeGreaterThan(0);
    expect(messages(withChoice(choice(1, { options: Array.from({ length: 13 }, (_, i) => `skin-${i}`) }))).length).toBeGreaterThan(0);
    expect(messages(withChoice(choice(1, { piece: 'frame' }))).length).toBeGreaterThan(0);
  });

  test('una skin que no existe se ve siempre; una desactivada, con lo vivo', () => {
    const unknown = withChoice(choice(1, { options: [NAVIDAD[0], 'skin-lumen-plata'] }));
    // The schema keeps it (a stored tournament never stops reading); the check finds it.
    expect(tournamentRecordSchema.safeParse(unknown).success).toBe(true);
    expect(tournamentIssues(unknown)).toEqual([{ path: 'prizes.0.choice.options.1', message: 'gift_cosmetic_unknown' }]);
    const off = live({ skins: cosmetics.skins.map((s) => (s.id === NAVIDAD[3] ? { ...s, enabled: false } : s)) });
    expect(tournamentIssues(withChoice(choice(2)), { gifts: off })).toEqual([{ path: 'prizes.0.choice.options.3', message: 'gift_cosmetic_unknown' }]);
    expect(tournamentIssues(withChoice(choice(2)), { gifts: live() })).toEqual([]);
  });

  test('las skins de tienda y la compensación pesan: el Torneo Navideño lo programa un superadmin', () => {
    const limits = parseConfig('mailLimits', {});
    const first = tournamentRecordSchema.parse(withChoice(choice(8), [signal(30)]));
    expect(tournamentBigReasons(first, limits, cosmetics).sort()).toEqual(['cosmetic_shop', 'currency_signal']);
    // The compensation alone, at its most (every option owned), is weighed too.
    const reward = cosmetics.skins.find((s) => s.source === 'reward')!.id;
    const cheap = tournamentRecordSchema.parse(withChoice(choice(1, { options: [reward], perMissing: { currency: 'signal', amount: limits.currency.signal + 1 } })));
    expect(tournamentBigReasons(cheap, limits, cosmetics)).toEqual(['currency_signal']);
    const fine = tournamentRecordSchema.parse(withChoice(choice(1, { options: [reward], perMissing: { currency: 'signal', amount: 10 } })));
    expect(tournamentBigReasons(fine, limits, cosmetics)).toEqual([]);
  });

  test('el premio congelado lleva la elección; sin ella, el de antes, igual', () => {
    const t = tournamentRecordSchema.parse({ ...BASE, prizes: [{ from: 1, to: 1, gifts: [signal(30)], choice: choice(8) }, { from: 2, to: 2, gifts: [], choice: choice(3) }, { from: 3, to: 3, gifts: [signal(20)] }] });
    expect(tournamentRewardsFor(t, { place: 1, runs: 4, eligible: true })).toEqual({ place: 1, gifts: [signal(30)], cash: null, participation: false, choice: t.prizes[0]!.choice });
    expect(tournamentRewardsFor(t, { place: 2, runs: 4, eligible: true })).toEqual({ place: 2, gifts: [], cash: null, participation: false, choice: t.prizes[1]!.choice });
    // A range without one keeps the exact shape it had (no `choice` key at all).
    expect(tournamentRewardsFor(t, { place: 3, runs: 4, eligible: true })).toStrictEqual({ place: 3, gifts: [signal(20)], cash: null, participation: false });
  });

  test('los registros guardados antes se leen igual que antes', () => {
    const t = tournamentRecordSchema.parse(BASE);
    expect(t.prizes).toStrictEqual([
      { from: 1, to: 1, gifts: [coins(5000)], cash: null },
      { from: 2, to: 3, gifts: [coins(2000)], cash: null },
    ]);
    expect(tournamentRecordSchema.parse(JSON.parse(JSON.stringify(t)))).toStrictEqual(t);
  });
});
