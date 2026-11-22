import { datesOverlap, type Gift, type TournamentCard, type TournamentFee, type TournamentList, type TournamentMetric } from '@galaxy/shared';
import { listOf } from '../api/tournaments';
import { copy } from '../copy/es';
import type { Reward } from '../missions/ready';

// What the tournaments say and work out on their own (plan «temporadas como fichas», part 5; GDD §13.3): why a player
// cannot sign up, which exclusive tournaments signing up keeps them out of, the fee in words, a prize as the reward
// that flies and sounds, and what a run added in each tournament they are in (the list before it against the list
// after it: the server says nothing of tournaments in a run's results).

const t = copy.tournaments;

/** The measures where one run's figure counts (the best one), not a sum. */
export const isBest = (m: TournamentMetric) => m === 'best_run' || m === 'depth';

/** The fee in words: «500 monedas». */
export function feeWords(fee: TournamentFee): string {
  return copy.gifts.amount[fee.currency](fee.amount);
}

/** Why the viewer cannot sign up, in words; null when they can, or when they are in it (they get «Salir»). */
export function blockText(card: Pick<TournamentCard, 'join' | 'filters' | 'exclusiveWith'>): string | null {
  switch (card.join.block) {
    case null:
    case 'joined':
      return null;
    case 'level':
      return t.block.level(card.filters.minLevel);
    case 'exclusive':
      return t.block.exclusive(card.exclusiveWith?.title ?? null);
    default:
      return t.block[card.join.block];
  }
}

/**
 * The other exclusive tournaments still to play whose dates overlap this one's, where the viewer is not: signing up
 * for this one keeps them out of those (the server's own rule, `datesOverlap`).
 */
export function exclusiveClashes(card: TournamentCard, all: readonly TournamentCard[]): string[] {
  if (!card.exclusive) return [];
  const out = all.filter((o) => o.id !== card.id && o.exclusive && (o.state === 'running' || o.state === 'scheduled') && o.me?.status !== 'joined' && datesOverlap(o, card)).map((o) => o.title);
  return [...new Set(out)];
}

/** What a prize gives, as the reward that flies to the wallet and sounds: coins, dust, signals and the pieces. */
export function rewardOf(gifts: readonly Gift[]): Reward {
  const r: Reward = {};
  for (const g of gifts) {
    if (g.kind === 'currency') {
      if (g.currency === 'coins') r.coins = (r.coins ?? 0) + g.amount;
      else if (g.currency === 'dust') r.dust = (r.dust ?? 0) + g.amount;
      else if (g.currency === 'signal') r.signal = (r.signal ?? 0) + g.amount;
    } else if (g.kind === 'cosmetic') r[g.piece] = g.id;
    else if (g.kind === 'xp') r.xp = (r.xp ?? 0) + g.amount;
  }
  return r;
}

/** What one run added in a tournament: how much the score grew, where the player is now and how many places up. */
export interface RunGain {
  slug: string;
  title: string;
  metric: TournamentMetric;
  gain: number;
  score: number;
  rank: number;
  climbed: number;
}

/**
 * What a run added in each running tournament the player is in: the list read before the run against the one read
 * after it. Only where the score grew (a run that did not count, by the filters or the window, says nothing); without
 * the list from before there is nothing to compare.
 */
export function runGains(before: TournamentList | undefined, after: TournamentList | undefined): RunGain[] {
  const prev = new Map(listOf(before).map((c) => [c.id, c]));
  if (prev.size === 0 || !after || !Array.isArray(after.running)) return [];
  return after.running.flatMap((c) => {
    const now = c.me;
    const was = prev.get(c.id)?.me;
    if (!now || now.status !== 'joined' || now.rank === null || !was || was.status !== 'joined') return [];
    const gain = now.score - was.score;
    if (gain <= 0) return [];
    const climbed = was.rank !== null ? Math.max(0, was.rank - now.rank) : 0;
    return [{ slug: c.slug, title: c.title, metric: c.metric, gain, score: now.score, rank: now.rank, climbed }];
  });
}

/** Whether the list says the player is in a tournament still to play (only then a run's results ask for it again). */
export function inPlay(data: TournamentList | undefined): boolean {
  return listOf(data).some((c) => (c.state === 'running' || c.state === 'scheduled') && c.me?.status === 'joined');
}

/** A date and time as players read it: «23 de noviembre a las 18:00». */
export function dateTime(iso: string): string {
  const d = new Date(iso);
  const day = new Intl.DateTimeFormat('es-ES', { day: 'numeric', month: 'long' }).format(d);
  const time = new Intl.DateTimeFormat('es-ES', { hour: '2-digit', minute: '2-digit' }).format(d);
  return `${day} a las ${time}`;
}

/**
 * Why the title screen's panel shows a tournament: prizes of mine waiting, one I am playing, one open to sign up, the
 * results of mine on their way, one I am in that starts soon, any other still alive, or the last one that ended.
 */
export type HubPick = 'collect' | 'playing' | 'open' | 'results' | 'joined' | 'live' | 'past';

const byEnd = (a: TournamentCard, b: TournamentCard) => Date.parse(a.endsAt) - Date.parse(b.endsAt);
const byStart = (a: TournamentCard, b: TournamentCard) => Date.parse(a.startsAt) - Date.parse(b.startsAt);
const latest = (a: TournamentCard, b: TournamentCard) => Date.parse(b.endsAt) - Date.parse(a.endsAt);

/**
 * The tournament that matters most to the viewer now (the title screen's panel), in this order: prizes waiting (the
 * newest first), one they are playing (the one ending first), one taking sign-ups, theirs in review, theirs still to
 * start, any other alive, and the last one finished. Cancelled ones never; none at all: null.
 */
export function featuredOf(data: TournamentList | undefined): { card: TournamentCard; pick: HubPick } | null {
  const all = listOf(data);
  const joined = (c: TournamentCard) => c.me?.status === 'joined';
  const of = (state: TournamentCard['state']) => all.filter((c) => c.state === state);
  const finished = of('finished').sort(latest);
  const running = of('running').sort(byEnd);
  const review = of('review').sort(byEnd);
  const scheduled = of('scheduled').sort(byStart);
  const steps: [HubPick, TournamentCard | undefined][] = [
    ['collect', finished.find((c) => !!c.me?.rewards && c.me.rewards.gifts.length > 0 && !c.me.claimed)],
    ['playing', running.find(joined)],
    ['open', running.find((c) => c.join.open)],
    ['results', review.find(joined)],
    ['joined', scheduled.find(joined)],
    ['open', scheduled.find((c) => c.join.open)],
    ['live', running[0] ?? review[0] ?? scheduled[0]],
    ['past', finished[0]],
  ];
  for (const [pick, card] of steps) if (card) return { card, pick };
  return null;
}

/** A day as players read it: «23 de noviembre». */
export function dayOf(iso: string): string {
  return new Intl.DateTimeFormat('es-ES', { day: 'numeric', month: 'long' }).format(new Date(iso));
}
