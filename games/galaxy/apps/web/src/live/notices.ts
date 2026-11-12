import type { LiveNotice } from '@galaxy/shared';
import type { QueryClient, QueryKey } from '@tanstack/react-query';
import { CLANS_KEY } from '../api/clans';
import { COLLECTION_KEY } from '../api/economy';
import { MAILBOX_KEY } from '../api/mail';
import { MARKET_KEY } from '../api/market';
import { MISSIONS_KEY } from '../api/missions';
import { LEADERBOARD_KEY, PROFILE_KEY } from '../api/social';
import { TRADES_KEY } from '../api/trades';
import { syncWallet } from '../api/wallet';

// What a real-time notice touches (plan of 2026-11-12), read again at once: `hidden` lists are refetched even when no
// screen shows them (one exact key each), so they are right the moment one opens; the rest (prefixes with many pages
// and filters) refetch where they show and are marked stale elsewhere.

export type Refresh = { key: QueryKey; hidden?: true };

export function refreshFor(n: LiveNotice): Refresh[] {
  switch (n.kind) {
    case 'trade':
      return [{ key: TRADES_KEY, hidden: true }, { key: COLLECTION_KEY }];
    case 'sale':
      return [{ key: [...MARKET_KEY, 'mine'], hidden: true }, { key: COLLECTION_KEY }];
    case 'mail':
      return [{ key: MAILBOX_KEY, hidden: true }];
    case 'clan': {
      const clan: Refresh[] = [
        { key: [...CLANS_KEY, 'mine'], hidden: true },
        { key: [...CLANS_KEY, 'view', n.clan.tag], hidden: true },
      ];
      return n.event === 'accepted' || n.event === 'kicked' ? [...clan, { key: PROFILE_KEY }, { key: LEADERBOARD_KEY }] : clan;
    }
    case 'achievement':
      return [{ key: MISSIONS_KEY, hidden: true }];
  }
}

/** What a notice brings goes into the caches: a sale's wallet everywhere, and everything it touches read again. */
export function applyNotice(qc: QueryClient, n: LiveNotice): void {
  if (n.kind === 'sale') syncWallet(qc, n.wallet);
  for (const r of refreshFor(n)) void qc.invalidateQueries({ queryKey: r.key, refetchType: r.hidden ? 'all' : 'active' });
}
