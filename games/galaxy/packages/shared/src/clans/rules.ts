import type { ConfigValue } from '../config/registry';

// Clans (GDD §14.3; M5b-1): who can do what, and who leads when the leader leaves. A clan always has one leader while
// it has members; the leader can do everything but act on themself; an officer removes members and answers requests.

export type ClansConfig = ConfigValue<'clans'>;
export const CLAN_ROLES = ['leader', 'officer', 'member'] as const;
export type ClanRole = (typeof CLAN_ROLES)[number];
export const CLAN_EMBLEMS = ['shield', 'comet', 'nebula', 'star', 'ring', 'crown', 'eye', 'bolt'] as const;
export type ClanEmblem = (typeof CLAN_EMBLEMS)[number];
export const CLAN_COLORS = ['solar', 'nova', 'terminal', 'ice', 'uv', 'coral'] as const;
export type ClanColor = (typeof CLAN_COLORS)[number];
export type ClanAction = 'kick' | 'promote' | 'demote' | 'accept' | 'edit' | 'transfer';

/** Whether `actor` may do `action` on someone of role `target` (for accept and edit the target does not matter). */
export function canManage(actor: ClanRole, target: ClanRole, action: ClanAction): boolean {
  if (actor === 'leader') {
    if (action === 'accept' || action === 'edit') return true;
    if (target === 'leader') return false;
    if (action === 'promote') return target === 'member';
    if (action === 'demote') return target === 'officer';
    return true;
  }
  if (actor === 'officer') return action === 'accept' || (action === 'kick' && target === 'member');
  return false;
}

/** Who leads after the leader: the oldest officer, else the oldest member; null when nobody is left. */
export function successor(members: readonly { role: ClanRole; joinedAt: string }[]): number | null {
  let best: number | null = null;
  const rank = (r: ClanRole) => (r === 'officer' ? 0 : r === 'member' ? 1 : 2);
  members.forEach((m, i) => {
    if (m.role === 'leader') return;
    const b = best === null ? null : members[best]!;
    if (b === null || rank(m.role) < rank(b.role) || (rank(m.role) === rank(b.role) && Date.parse(m.joinedAt) < Date.parse(b.joinedAt))) best = i;
  });
  return best;
}
