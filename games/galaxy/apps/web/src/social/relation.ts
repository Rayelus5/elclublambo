import type { FriendsView } from '@galaxy/shared';

// Who someone is to me, read from my cached friends view (Nov plan A3): the room's cards and the team results ask
// it for every player without one request each. Usernames are lowercase on the server; a stray capital still matches.

export type KnownRelation = 'none' | 'friends' | 'incoming' | 'outgoing' | 'blocked';

export function relationOf(view: FriendsView | undefined, username: string): KnownRelation {
  if (!view) return 'none';
  const u = username.toLowerCase();
  const has = (list: readonly { username: string }[]) => list.some((x) => x.username.toLowerCase() === u);
  if (has(view.friends)) return 'friends';
  if (has(view.blocked)) return 'blocked';
  if (has(view.incoming)) return 'incoming';
  if (has(view.outgoing)) return 'outgoing';
  return 'none';
}
