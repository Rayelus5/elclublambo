import {
  type BigGiftReason,
  type ConfigKey,
  type ConfigValue,
  type CosmeticPiece,
  type CosmeticsConfig,
  type Gift,
  type GiftIssueCode,
  type GiftLive,
  type MailLimits,
  type MailPack,
  parseConfig,
  seasonOpen,
} from '@galaxy/shared';
import { copy } from '../copy/es';
import type { IconName } from '../ui/Icon';

// What the panel knows and says of gifts (mail v2, P3): the catalog a message's gifts come from — the live config's
// pieces, probes, open events, season and pack library, and the limits that make one big — and each gift's words. The
// same checks the server runs (`giftIssues`, `bigGiftReasons`) run here on `live`, so the form warns before sending.

const g = copy.gifts;

export interface GiftProbe {
  id: string;
  name: string;
  sprite: string;
}

export interface GiftCatalog {
  cosmetics: CosmeticsConfig;
  probes: readonly GiftProbe[];
  /** The events still open (their signals can be given). */
  events: readonly { id: string; name: string; endsAt: string }[];
  season: { id: string; open: boolean; currencyName: string; endsAt: string };
  packs: readonly MailPack[];
  limits: MailLimits;
  /** What the shared checks read. */
  live: GiftLive;
}

type Row = { key: string; data?: unknown };

/** The catalog from the panel's config rows (what is live, or each key's default) and the run content's probes. */
export function giftCatalog(rows: readonly Row[], probes: readonly GiftProbe[], now: Date): GiftCatalog {
  // A key that does not read (it should not: it is what is live) falls back to its default rather than breaking the form.
  const read = <K extends ConfigKey>(key: K): ConfigValue<K> => {
    try {
      return parseConfig(key, rows.find((r) => r.key === key)?.data ?? {});
    } catch {
      return parseConfig(key, {});
    }
  };
  const cosmetics = read('cosmetics');
  const events = read('events').list.filter((e) => Date.parse(e.endsAt) > now.getTime());
  const season = read('season');
  const route = read('seasonRoute');
  const open = seasonOpen(season, now);
  const list = probes.map((p) => ({ id: p.id, name: p.name, sprite: p.sprite }));
  return {
    cosmetics,
    probes: list,
    events: events.map((e) => ({ id: e.id, name: e.name, endsAt: e.endsAt })),
    season: { id: season.id, open, currencyName: route.currency.name, endsAt: season.endsAt },
    packs: read('mail').packs,
    limits: read('mailLimits'),
    live: { cosmetics, probes: list.map((p) => p.id), events: events.map((e) => ({ id: e.id, endsAt: e.endsAt })), season: { id: season.id, open }, now },
  };
}

const BASE: Record<string, { icon: IconName; name: string; amount: (n: number) => string; tone: string }> = {
  coins: { icon: 'coin', name: g.currency.coins, amount: g.amount.coins, tone: 'solar' },
  dust: { icon: 'dust', name: g.currency.dust, amount: g.amount.dust, tone: 'uv' },
  signal: { icon: 'ticket', name: g.currency.signal, amount: g.amount.signal, tone: 'ice' },
  material: { icon: 'cube', name: g.currency.material, amount: g.amount.material, tone: 'terminal' },
  components: { icon: 'wrench', name: g.currency.components, amount: g.amount.components, tone: 'terminal' },
};

/** A currency's icon, name, words for an amount and colour: the base five, an event's signals or the season's own. */
export function currencyLook(currency: string, cat: Pick<GiftCatalog, 'events' | 'season'>): { icon: IconName; name: string; amount: (n: number) => string; tone: string } {
  const base = BASE[currency];
  if (base) return base;
  if (currency.startsWith('signal:')) {
    const id = currency.slice('signal:'.length);
    const event = cat.events.find((e) => e.id === id)?.name ?? id;
    return { icon: 'ticket', name: g.currency.eventSignal(event), amount: (n) => g.amount.eventSignal(n, event), tone: 'nova' };
  }
  const name = cat.season.currencyName;
  return { icon: 'starOn', name, amount: (n) => g.amount.season(n, name), tone: 'sky' };
}

/** A cosmetic piece's name in the catalog (a title is its own text). */
export function pieceName(piece: CosmeticPiece, id: string, cosmetics: CosmeticsConfig): string {
  if (piece === 'title') return id;
  const list: readonly { id: string; name: string }[] = piece === 'avatar' ? cosmetics.avatars : piece === 'frame' ? cosmetics.frames : cosmetics.skins;
  return list.find((x) => x.id === id)?.name ?? id;
}

const traitWords = (trait: { key: string; value: string }) =>
  g.galaxyTrait(copy.traitNames[trait.key] ?? trait.key, (copy.traitValues as Record<string, Record<string, string>>)[trait.key]?.[trait.value] ?? trait.value);

/** A gift in words: «2.500 monedas», «Marco Oro», «2 galaxias épicas holo, tipo espiral», «Sonda Bastión». */
export function giftWords(gift: Gift, cat: Pick<GiftCatalog, 'events' | 'season' | 'cosmetics' | 'probes'>): string {
  switch (gift.kind) {
    case 'currency':
      return currencyLook(gift.currency, cat).amount(gift.amount);
    case 'cosmetic':
      return g.cosmetic(gift.piece, pieceName(gift.piece, gift.id, cat.cosmetics));
    case 'galaxy': {
      const words = g.galaxyWords(gift.count, copy.tiers[gift.tier], gift.finish === 'normal' ? null : copy.finishes[gift.finish]);
      return gift.trait ? `${words}, ${traitWords(gift.trait)}` : words;
    }
    case 'probe':
      return g.probe(cat.probes.find((p) => p.id === gift.probe)?.name ?? gift.probe);
    case 'xp':
      return g.xp(gift.amount);
    case 'seasonPoints':
      return g.seasonPoints(gift.amount);
  }
}

/** Why a gift is big, with the limit the config sets. */
export function bigReasonText(reason: BigGiftReason, cat: Pick<GiftCatalog, 'limits' | 'events' | 'season'>): string {
  const r = g.big.reasons;
  const l = cat.limits;
  switch (reason) {
    case 'galaxy_count':
      return r.galaxy_count(l.galaxies);
    case 'galaxy_tier':
      return r.galaxy_tier(copy.tiers[l.galaxyTier]);
    case 'galaxy_finish':
      return r.galaxy_finish;
    case 'cosmetic_shop':
      return r.cosmetic_shop;
    case 'probe':
      return r.probe;
    case 'xp':
      return r.xp(l.xp);
    case 'season_points':
      return r.season_points(l.seasonPoints);
    case 'recipients':
      return r.recipients(l.recipients ?? 0);
    default: {
      const family = reason.slice('currency_'.length) as keyof MailLimits['currency'];
      const name = family === 'season' ? cat.season.currencyName : currencyLook(family, cat).name;
      return r.currency(name, l.currency[family]);
    }
  }
}

export const issueText = (code: GiftIssueCode): string => g.issues[code];
