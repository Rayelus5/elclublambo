import type { CosmeticsConfig } from '../cosmetics/catalog';
import type { Gift } from '../gifts/schema';
import type { PrizeChoice, TournamentFee, TournamentRewards } from './record';

// Skins to choose as a tournament prize (plan «Torneo Navideño», C1; GDD §13.3). A prize range may let its winner pick
// `count` skins among some options when they collect it; what they already have, or what was switched off since, cannot
// be given, and each skin missing from `count` is paid with `perMissing`. Pure: the page shows the same window and the
// same outcome the server enforces. Only types come from record.ts (which imports this file), so there is no cycle.

/** The options a winner cannot be given: the skins they already have and the ones that are no longer live. */
export interface ChoiceBlocked {
  owned: readonly string[];
  unavailable: readonly string[];
}

/** What collecting a choice gives: the skins (in the options' order), how many are missing and what pays for them. */
export type PrizeChoiceResolution = { skins: string[]; missing: number; compensation: TournamentFee | null } | { error: 'tournament_choice_invalid' | 'tournament_choice_owned' };

const NOTHING: ChoiceBlocked = { owned: [], unavailable: [] };

/** The options that can still be given (neither owned nor off), in their order. */
function available(choice: PrizeChoice, blocked: ChoiceBlocked): string[] {
  const out = new Set([...blocked.owned, ...blocked.unavailable]);
  return choice.options.filter((id) => !out.has(id));
}

/** Each option as the cosmetic gift it gives (what the prize is weighed and checked as). */
export function choiceGifts(choice: PrizeChoice): Gift[] {
  return choice.options.map((id) => ({ kind: 'cosmetic', piece: choice.piece, id }));
}

/** The options the live catalog cannot give: switched off, or gone from it. */
export function choiceUnavailable(options: readonly string[], cosmetics: Pick<CosmeticsConfig, 'skins'>): string[] {
  return options.filter((id) => !cosmetics.skins.some((s) => s.id === id && s.enabled));
}

/** Whether the winner has to pick: more options can be given than the prize's count (otherwise they all go on their own). */
export function choiceNeedsPick(choice: PrizeChoice, blocked: ChoiceBlocked = NOTHING): boolean {
  return available(choice, blocked).length > choice.count;
}

/**
 * What collecting a choice gives. As many skins as `count` allows among the options that can be given; when that is all
 * of them they go on their own and `picked` is ignored. Otherwise `picked` must name exactly that many different options
 * that can be given: one the winner already has is `tournament_choice_owned` (their window was out of date), anything
 * else `tournament_choice_invalid`. Each skin short of `count` is paid with `perMissing`.
 */
export function resolvePrizeChoice(choice: PrizeChoice, blocked: ChoiceBlocked, picked?: readonly string[]): PrizeChoiceResolution {
  const free = available(choice, blocked);
  const give = Math.min(choice.count, free.length);
  let skins: string[];
  if (give === free.length) skins = free;
  else {
    if (!picked) return { error: 'tournament_choice_invalid' };
    if (picked.some((id) => blocked.owned.includes(id))) return { error: 'tournament_choice_owned' };
    const set = new Set(picked);
    if (set.size !== picked.length || picked.length !== give || picked.some((id) => !free.includes(id))) return { error: 'tournament_choice_invalid' };
    skins = free.filter((id) => set.has(id));
  }
  const missing = choice.count - skins.length;
  const compensation = choice.perMissing && missing > 0 ? { currency: choice.perMissing.currency, amount: choice.perMissing.amount * missing } : null;
  return { skins, missing, compensation };
}

/** Whether a finished tournament left something to collect in the game: gifts or skins to choose (money is paid outside). */
export function hasPrizeToCollect(rewards: TournamentRewards | null | undefined): boolean {
  return !!rewards && (rewards.gifts.length > 0 || !!rewards.choice);
}
