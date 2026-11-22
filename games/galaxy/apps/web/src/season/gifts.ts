import { type Gift, parseConfig, type SeasonPrize, type SeasonReward, seasonRewardToGifts } from '@galaxy/shared';
import { useMemo } from 'react';
import { useLiveContent } from '../api/content';
import { useCosmeticsView } from '../api/cosmetics';
import { pieceName, type GiftCatalog, giftWords } from '../gifts/words';
import type { Reward } from '../missions/ready';

// A season's prizes as gifts (plan «temporadas como fichas», PR 4, 2026-11-22): a step's, an item's or a closing
// prize's old reward is shown as the gifts it gives, next to its own gifts, so every prize is drawn the same way
// (GiftArt); and what gifts give, as the reward the flight and the sound read: the wallet's currencies fly to the bar,
// the rest (pieces, galaxies, probes, other resources) pops as a card where it was collected.

export type GiftView = Pick<GiftCatalog, 'events' | 'season' | 'cosmetics' | 'probes'>;

const DEFAULT_COSMETICS = parseConfig('cosmetics', {});

/** Everything a step or an item gives: its old reward, as gifts, then its gifts. */
export function stepGifts(reward: SeasonReward, gifts: readonly Gift[] | undefined, seasonId: string): Gift[] {
  return [...seasonRewardToGifts(reward, seasonId), ...(gifts ?? [])];
}

/** Everything a closing prize gives (its season is over: its currency was never paid). */
export function prizeGifts(prize: SeasonPrize): Gift[] {
  return [...seasonRewardToGifts(prize, null), ...(prize.gifts ?? [])];
}

/** What some gifts give, for the flight and the sound (`addRewards` adds it to an old reward). */
export function giftsReward(gifts: readonly Gift[], view: GiftView): Reward {
  const out: Required<Pick<Reward, 'coins' | 'dust' | 'signal' | 'eventSignals' | 'shards' | 'xp' | 'points'>> & Pick<Reward, 'cards'> = { coins: 0, dust: 0, signal: 0, eventSignals: 0, shards: 0, xp: 0, points: 0, cards: [] };
  for (const g of gifts) {
    if (g.kind === 'currency') {
      if (g.currency === 'coins' || g.currency === 'dust' || g.currency === 'signal') out[g.currency] += g.amount;
      else if (g.currency.startsWith('signal:')) out.eventSignals += g.amount;
      else if (g.currency.startsWith('season:')) out.shards += g.amount;
      else out.cards!.push({ kind: 'resource', name: giftWords(g, view) });
    } else if (g.kind === 'cosmetic') out.cards!.push({ kind: g.piece, name: pieceName(g.piece, g.id, view.cosmetics) });
    else if (g.kind === 'galaxy') out.cards!.push({ kind: 'galaxy', name: giftWords(g, view), tier: g.tier });
    else if (g.kind === 'probe') out.cards!.push({ kind: 'probe', name: view.probes.find((p) => p.id === g.probe)?.name ?? g.probe });
    else if (g.kind === 'xp') out.xp += g.amount;
    else out.points += g.amount;
  }
  return out;
}

/** A list of gifts in words for a sentence («30 Esquirlas, galaxia épica»): each currency summed once. */
export function giftsSentence(gifts: readonly Gift[], view: GiftView): string {
  const merged: Gift[] = [];
  for (const g of gifts) {
    const same = g.kind === 'currency' ? merged.find((x) => x.kind === 'currency' && x.currency === g.currency) : undefined;
    if (same && same.kind === 'currency' && g.kind === 'currency') same.amount += g.amount;
    else merged.push({ ...g });
  }
  return merged.map((g, i) => (i === 0 ? giftWords(g, view) : lower(giftWords(g, view)))).join(', ');
}

const lower = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);

/**
 * What a player's season screen knows to name and draw gifts: the pieces' catalog and the probes (asked for only when
 * some gift needs them; the defaults until they arrive), and the season's currency.
 */
export function useGiftView(gifts: readonly Gift[], season: { id: string; currencyName: string; endsAt?: string }): GiftView {
  const needPieces = gifts.some((g) => g.kind === 'cosmetic');
  const needProbes = gifts.some((g) => g.kind === 'probe');
  const cosmetics = useCosmeticsView(needPieces).data?.catalog ?? DEFAULT_COSMETICS;
  const content = useLiveContent(needProbes);
  return useMemo(
    () => ({
      cosmetics,
      probes: content.probes.map((p) => ({ id: p.id, name: p.name, sprite: p.sprite })),
      events: [],
      season: { id: season.id, open: true, currencyName: season.currencyName, endsAt: season.endsAt ?? '' },
    }),
    [cosmetics, content, season.id, season.currencyName, season.endsAt],
  );
}
