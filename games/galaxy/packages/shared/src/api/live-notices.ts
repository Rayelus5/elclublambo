import type { Tier, Wallet } from '../gacha/types';
import type { MailType } from '../gifts/library';
import type { PlayerLook } from './cosmetics';

// What the live socket tells a player happened to them elsewhere (real-time notices plan, 2026-11-12): a trade, a
// sale of their listing, a mail, their clan, an achievement. Each comes after the change was saved; the client shows
// it (unless the player silenced notices) and reads again what it touches.

/** The other player in a notice, as they show next to their name. */
export interface NoticePlayer extends PlayerLook {
  username: string;
}

export type TradeNoticeEvent = 'proposed' | 'countered' | 'confirmed' | 'done' | 'cancelled';
export type ClanNoticeEvent = 'request' | 'accepted' | 'rejected' | 'kicked' | 'promoted' | 'demoted' | 'leader';

export type LiveNotice =
  /** A trade with me: proposed, changed, confirmed by the other side (my turn), done or cancelled. */
  | { kind: 'trade'; event: TradeNoticeEvent; trade: string; from: NoticePlayer }
  /** My market listing sold: what it fetched, what I got and my wallet now. */
  | { kind: 'sale'; listing: string; galaxy: { id: string; name: string; tier: Tier }; price: number; net: number; buyer: NoticePlayer; wallet: Wallet }
  /** A new mail in my box (mail v2: its kind and whether it brings a gift; absent from an older server). */
  | { kind: 'mail'; id: string; title: string; type?: MailType; gift?: boolean }
  /** My clan: a request to join it (to its leader and officers), or what was done to me (`who`: by whom; null when automatic). */
  | { kind: 'clan'; event: ClanNoticeEvent; clan: { tag: string; name: string }; who: NoticePlayer | null }
  /** An achievement unlocked, waiting to be collected. */
  | { kind: 'achievement'; id: string; name: string; tier: 'bronze' | 'silver' | 'gold' }
  /**
   * An offer (the owner, 2026-11-14): one on my listing (`received`), or what happened to mine (accepted: the galaxy is
   * mine; rejected, outbid, expired or closed: my coins are back).
   */
  | { kind: 'offer'; event: OfferNoticeEvent; offer: string; galaxy: { id: string; name: string; tier: Tier }; amount: number; from: NoticePlayer | null }
  /** A season started (plan «temporadas como fichas»): told once to everyone online, so the client reads it again. */
  | { kind: 'season'; event: 'started'; id: string; name: string }
  /**
   * A tournament I am in (plan «temporadas como fichas», part 5): it started (my runs count), it ended (its review
   * begins), its results are out (my prizes wait on its page) or it was cancelled (my fee is back). Its page is
   * `tournamentPath(slug)`.
   */
  | { kind: 'tournament'; event: TournamentNoticeEvent; id: string; slug: string; title: string };

export type TournamentNoticeEvent = 'started' | 'ended' | 'finished' | 'cancelled';

export type OfferNoticeEvent = 'received' | 'accepted' | 'rejected' | 'outbid' | 'expired' | 'closed';
