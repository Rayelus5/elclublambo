import { DEFAULT_CONTENT } from '@galaxy/sim';
import { describe, expect, test } from 'vitest';
import {
  allGifts,
  bigGiftReasons,
  type Gift,
  galaxyReachable,
  giftIssues,
  type GiftLive,
  giftSchema,
  mailContentsSchema,
  mailLimitsSchema,
  mergeCurrencies,
  parseConfig,
  readContents,
  traitKnown,
} from '../src/index';

// Gifts of every kind (mail v2, 2026-11-16): resources, cosmetics, galaxies, probes, XP and season points; what makes
// one invalid before it is sent, and what makes one big enough to need a superadmin.

const cosmetics = parseConfig('cosmetics', {});
const live: GiftLive = {
  cosmetics,
  probes: DEFAULT_CONTENT.probes.map((p) => p.id),
  events: [{ id: 'fisura', endsAt: '2026-12-01T00:00:00.000Z' }],
  season: { id: 's1', open: true },
  now: new Date('2026-11-16T12:00:00.000Z'),
};
const shopSkin = cosmetics.skins.find((s) => s.source === 'shop')!.id;
const rewardSkin = cosmetics.skins.find((s) => s.source === 'reward')!.id;
const defaultAvatar = cosmetics.avatars.find((a) => a.source === 'default')!.id;

describe('cada tipo de regalo', () => {
  test('se acepta con su forma', () => {
    const ok: Gift[] = [
      { kind: 'currency', currency: 'components', amount: 50 },
      { kind: 'currency', currency: 'signal:fisura', amount: 10 },
      { kind: 'currency', currency: 'season:s1', amount: 200 },
      { kind: 'cosmetic', piece: 'skin', id: rewardSkin },
      { kind: 'galaxy', tier: 'epic', finish: 'holo', trait: { key: 'palette', value: 'solar_gold' }, count: 2 },
      { kind: 'probe', probe: DEFAULT_CONTENT.probes[1]!.id },
      { kind: 'xp', amount: 500 },
      { kind: 'seasonPoints', amount: 100 },
    ];
    for (const g of ok) expect(giftSchema.safeParse(g).success, JSON.stringify(g)).toBe(true);
  });

  test('una mítica sin acabado especial, una moneda que no existe o una cantidad de cero no valen', () => {
    expect(giftSchema.safeParse({ kind: 'galaxy', tier: 'mythic', finish: 'normal', trait: null, count: 1 }).success).toBe(false);
    expect(giftSchema.safeParse({ kind: 'currency', currency: 'gems', amount: 5 }).success).toBe(false);
    expect(giftSchema.safeParse({ kind: 'currency', currency: 'coins', amount: 0 }).success).toBe(false);
  });
});

describe('lo que guarda un mensaje', () => {
  test('un mensaje de antes ({coins, dust, signal}) se lee como regalos y se marca como antiguo', () => {
    const r = readContents({ coins: 100, signal: 2 });
    expect(r.legacy).toBe(true);
    expect(allGifts(r.contents)).toEqual([
      { kind: 'currency', currency: 'coins', amount: 100 },
      { kind: 'currency', currency: 'signal', amount: 2 },
    ]);
  });

  test('uno nuevo trae sus regalos sueltos y la copia de sus packs', () => {
    const contents = mailContentsSchema.parse({
      v: 2,
      items: [{ kind: 'currency', currency: 'coins', amount: 50 }],
      packs: [{ id: 'bienvenida', name: 'Pack de bienvenida', art: 'parcel', items: [{ kind: 'currency', currency: 'coins', amount: 25 }, { kind: 'xp', amount: 100 }] }],
    });
    const r = readContents(contents);
    expect(r.legacy).toBe(false);
    expect(allGifts(r.contents)).toHaveLength(3);
    expect(mergeCurrencies(allGifts(r.contents))).toEqual(new Map([['coins', 75]]));
  });
});

describe('lo que no se puede enviar', () => {
  test('un regalo de lo que no existe o ya no se puede dar', () => {
    const codes = giftIssues(
      [
        { kind: 'cosmetic', piece: 'skin', id: 'skin-nadie' },
        { kind: 'cosmetic', piece: 'avatar', id: defaultAvatar },
        { kind: 'probe', probe: 'no-existe' },
        { kind: 'currency', currency: 'signal:pasado', amount: 5 },
        { kind: 'galaxy', tier: 'legendary', finish: 'normal', trait: { key: 'galaxy_type', value: 'no-es-un-tipo' }, count: 1 },
      ],
      live,
    ).map((i) => `${i.index}:${i.code}`);
    expect(codes).toEqual(['0:cosmetic_unknown', '1:cosmetic_default', '2:probe_unknown', '3:event_closed', '4:galaxy_unreachable']);
  });

  test('la moneda y los puntos de una temporada cerrada', () => {
    const closed = { ...live, season: { id: 's1', open: false } };
    expect(giftIssues([{ kind: 'seasonPoints', amount: 5 }, { kind: 'currency', currency: 'season:s1', amount: 5 }], closed).map((i) => i.code)).toEqual(['season_closed', 'season_closed']);
    expect(giftIssues([{ kind: 'currency', currency: 'season:otra', amount: 5 }], live).map((i) => i.code)).toEqual(['season_closed']);
  });

  test('lo que existe y está abierto se puede enviar', () => {
    expect(
      giftIssues(
        [
          { kind: 'cosmetic', piece: 'skin', id: rewardSkin },
          { kind: 'currency', currency: 'signal:fisura', amount: 5 },
          { kind: 'galaxy', tier: 'rare', finish: 'normal', trait: null, count: 1 },
        ],
        live,
      ),
    ).toEqual([]);
  });
});

describe('lo que solo envía un superadmin', () => {
  const limits = mailLimitsSchema.parse({});

  test('una galaxia legendaria, un acabado especial, una skin de tienda, una sonda, mucho de algo o muchísima gente', () => {
    const reasons = bigGiftReasons(
      [
        { kind: 'galaxy', tier: 'legendary', finish: 'rift', trait: null, count: 1 },
        { kind: 'cosmetic', piece: 'skin', id: shopSkin },
        { kind: 'probe', probe: DEFAULT_CONTENT.probes[1]!.id },
        { kind: 'currency', currency: 'coins', amount: limits.currency.coins + 1 },
        { kind: 'xp', amount: limits.xp + 1 },
      ],
      1,
      limits,
      cosmetics,
    );
    expect(reasons).toEqual(expect.arrayContaining(['galaxy_tier', 'galaxy_finish', 'cosmetic_shop', 'probe', 'currency_coins', 'xp']));
  });

  test('un regalo corriente lo envía cualquier admin', () => {
    expect(
      bigGiftReasons(
        [
          { kind: 'currency', currency: 'coins', amount: 500 },
          { kind: 'cosmetic', piece: 'skin', id: rewardSkin },
          { kind: 'galaxy', tier: 'rare', finish: 'normal', trait: null, count: 1 },
        ],
        1000,
        limits,
        cosmetics,
      ),
    ).toEqual([]);
  });

  test('con un tope de destinatarios, enviar a más gente pide superadmin', () => {
    const capped = mailLimitsSchema.parse({ recipients: 50 });
    expect(bigGiftReasons([{ kind: 'currency', currency: 'coins', amount: 10 }], 51, capped, cosmetics)).toEqual(['recipients']);
  });
});

describe('rasgos de una galaxia regalada', () => {
  test('un valor que no existe se descarta al momento, sin buscar semillas', () => {
    expect(traitKnown('galaxy_type', 'spiral')).toBe(true);
    expect(traitKnown('galaxy_type', 'no-es-un-tipo')).toBe(false);
    const t0 = performance.now();
    expect(galaxyReachable(4, { key: 'galaxy_type', value: 'no-es-un-tipo' })).toBe(false);
    expect(performance.now() - t0).toBeLessThan(50);
  });
});
