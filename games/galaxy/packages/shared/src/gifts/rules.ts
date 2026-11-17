import { TRAITS } from '@galaxy/engine';
import type { CosmeticsConfig } from '../cosmetics/catalog';
import { generateGalaxy } from '../gacha/generate';
import { TIERS } from '../gacha/types';
import type { MailLimits } from './limits';
import { type Gift, mailContentsSchema, type MailContents } from './schema';

// Reading, checking and weighing gifts (mail v2, 2026-11-16). Pure: the panel shows the same problems and the same
// «needs a superadmin» the server enforces.

/** The legacy gift of a message sent before (coins, dust and signals as numbers). */
const LEGACY_KEYS = ['coins', 'dust', 'signal'] as const;

export function legacyToGifts(old: Partial<Record<(typeof LEGACY_KEYS)[number], number>>): Gift[] {
  return LEGACY_KEYS.filter((k) => (old[k] ?? 0) > 0).map((k) => ({ kind: 'currency', currency: k, amount: old[k]! }));
}

/** A message's gifts, whatever version wrote them; `legacy` keeps the old claim keys (`mail:<id>:<currency>`). */
export function readContents(raw: unknown): { contents: MailContents; legacy: boolean } {
  if (raw && typeof raw === 'object' && (raw as { v?: unknown }).v === 2) return { contents: mailContentsSchema.parse(raw), legacy: false };
  const old = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const nums = Object.fromEntries(LEGACY_KEYS.map((k) => [k, typeof old[k] === 'number' ? (old[k] as number) : 0]));
  return { contents: { v: 2, items: legacyToGifts(nums), packs: [] }, legacy: true };
}

/** Every gift of a message: its loose ones and its packs'. */
export function allGifts(c: MailContents): Gift[] {
  return [...c.items, ...c.packs.flatMap((p) => p.items)];
}

export const hasAnyGift = (c: MailContents) => allGifts(c).length > 0;

/** The currencies of some gifts, summed by currency, in the order they first appear. */
export function mergeCurrencies(gifts: readonly Gift[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const g of gifts) if (g.kind === 'currency') out.set(g.currency, (out.get(g.currency) ?? 0) + g.amount);
  return out;
}

/** What is live when a gift is checked. */
export interface GiftLive {
  cosmetics: CosmeticsConfig;
  probes: readonly string[];
  events: readonly { id: string; endsAt: string }[];
  season: { id: string; open: boolean };
  now: Date;
}

export type GiftIssueCode = 'cosmetic_unknown' | 'cosmetic_default' | 'probe_unknown' | 'event_closed' | 'season_closed' | 'galaxy_unreachable';
export interface GiftIssue {
  index: number;
  code: GiftIssueCode;
}

/** Seeds a galaxy gift is tried on before it is sent: one that fails on all would fail at the claim too. */
const REACH_SEEDS = [7919n, 15838n, 23757n];

/** Whether a trait has that value at all (checked before any seed is tried: an unknown one never comes out). */
export function traitKnown(key: string, value: string): boolean {
  const def = (TRAITS.traits as Readonly<Record<string, { values: readonly { value: string }[] } | undefined>>)[key];
  return !!def && def.values.some((v) => v.value === value);
}

/** At most this many galaxies in one message (each one is made, in the claim's transaction, when it is claimed). */
export const MAX_GALAXIES = 10;

/** How many galaxies some gifts make. */
export function galaxyCount(gifts: readonly Gift[]): number {
  return gifts.reduce((n, g) => n + (g.kind === 'galaxy' ? g.count : 0), 0);
}

// The generator is deterministic: whether a tier with a trait can be made never changes, so it is found once.
const REACHABLE = new Map<string, boolean>();

/**
 * How many candidates a gifted galaxy may take to come out (the security review, 2026-11-16): each one is made, on the
 * live server, when it is claimed. A plain mythic or a legendary with a trait come out well within it; a mythic with
 * a trait, so rare it takes most of a second each, does not and cannot be given.
 */
export const GIFT_CANDIDATES = 20_000;

/** Whether a galaxy of that tier with that trait can be made within the gift's budget (a plain one below mythic always can). */
export function galaxyReachable(tier: number, trait: { key: string; value: string } | null): boolean {
  if (!trait && tier < TIERS.indexOf('mythic')) return true;
  if (trait && !traitKnown(trait.key, trait.value)) return false;
  const key = `${tier}|${trait?.key ?? ''}|${trait?.value ?? ''}`;
  const known = REACHABLE.get(key);
  if (known !== undefined) return known;
  let ok = true;
  try {
    for (const seed of REACH_SEEDS) generateGalaxy(seed, tier, trait ? { trait: trait.key as never, value: trait.value } : undefined, GIFT_CANDIDATES);
  } catch {
    ok = false;
  }
  REACHABLE.set(key, ok);
  return ok;
}

/** What would make each gift fail: a piece, probe or event that does not exist or is over, a galaxy that cannot be made. */
export function giftIssues(gifts: readonly Gift[], live: GiftLive): GiftIssue[] {
  const out: GiftIssue[] = [];
  const pieces = (piece: string) =>
    (piece === 'avatar' ? live.cosmetics.avatars : piece === 'frame' ? live.cosmetics.frames : piece === 'skin' ? live.cosmetics.skins : live.cosmetics.titles.map((t) => ({ ...t, id: t.text }))) as readonly {
      id: string;
      source: string;
      enabled: boolean;
    }[];
  gifts.forEach((g, index) => {
    const add = (code: GiftIssueCode) => out.push({ index, code });
    if (g.kind === 'cosmetic') {
      const item = pieces(g.piece).find((p) => p.id === g.id);
      if (!item || !item.enabled) add('cosmetic_unknown');
      else if (item.source === 'default') add('cosmetic_default');
    } else if (g.kind === 'probe') {
      if (!live.probes.includes(g.probe)) add('probe_unknown');
    } else if (g.kind === 'currency') {
      if (g.currency.startsWith('signal:')) {
        const event = live.events.find((e) => `signal:${e.id}` === g.currency);
        if (!event || Date.parse(event.endsAt) <= live.now.getTime()) add('event_closed');
      } else if (g.currency.startsWith('season:') && (!live.season.open || g.currency !== `season:${live.season.id}`)) add('season_closed');
    } else if (g.kind === 'seasonPoints') {
      if (!live.season.open) add('season_closed');
    } else if (g.kind === 'galaxy') {
      if (!galaxyReachable(TIERS.indexOf(g.tier), g.trait)) add('galaxy_unreachable');
    }
  });
  return out;
}

export type BigGiftReason =
  | 'galaxy_count'
  | 'galaxy_tier'
  | 'galaxy_finish'
  | 'cosmetic_shop'
  | 'probe'
  | 'xp'
  | 'season_points'
  | 'recipients'
  | `currency_${'coins' | 'dust' | 'signal' | 'material' | 'components' | 'season'}`;

/** The currency family a limit counts it in (event signals are signals; a season's own currency is `season`). */
function family(currency: string): keyof MailLimits['currency'] {
  if (currency.startsWith('signal')) return 'signal';
  if (currency.startsWith('season:')) return 'season';
  return currency as keyof MailLimits['currency'];
}

/** Why some gifts to `recipients` players need a superadmin (none: any admin with their password may send them). */
export function bigGiftReasons(gifts: readonly Gift[], recipients: number, limits: MailLimits, cosmetics: CosmeticsConfig): BigGiftReason[] {
  const out = new Set<BigGiftReason>();
  const sources = new Map<string, string>([
    ...cosmetics.avatars.map((a) => [`avatar:${a.id}`, a.source] as const),
    ...cosmetics.frames.map((f) => [`frame:${f.id}`, f.source] as const),
    ...cosmetics.skins.map((k) => [`skin:${k.id}`, k.source] as const),
    ...cosmetics.titles.map((t) => [`title:${t.text}`, t.source] as const),
  ]);
  const totals = new Map<keyof MailLimits['currency'], number>();
  for (const [currency, amount] of mergeCurrencies(gifts)) totals.set(family(currency), (totals.get(family(currency)) ?? 0) + amount);
  for (const [fam, amount] of totals) if (amount > limits.currency[fam]) out.add(`currency_${fam}`);
  let xp = 0;
  let points = 0;
  for (const g of gifts) {
    if (g.kind === 'galaxy') {
      if (TIERS.indexOf(g.tier) >= TIERS.indexOf(limits.galaxyTier)) out.add('galaxy_tier');
      if (limits.finishes.includes(g.finish)) out.add('galaxy_finish');
    } else if (g.kind === 'cosmetic') {
      const source = sources.get(`${g.piece}:${g.id}`);
      if (source && (limits.cosmeticSources as readonly string[]).includes(source)) out.add('cosmetic_shop');
    } else if (g.kind === 'probe') {
      if (limits.probes) out.add('probe');
    } else if (g.kind === 'xp') xp += g.amount;
    else if (g.kind === 'seasonPoints') points += g.amount;
  }
  if (galaxyCount(gifts) > limits.galaxies) out.add('galaxy_count');
  if (xp > limits.xp) out.add('xp');
  if (points > limits.seasonPoints) out.add('season_points');
  if (gifts.length > 0 && limits.recipients !== null && recipients > limits.recipients) out.add('recipients');
  return [...out];
}
