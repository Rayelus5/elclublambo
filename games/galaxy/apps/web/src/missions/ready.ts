import type { MissionsView } from '@galaxy/shared';

// What waits to be collected (open beta): per tab, what «Recoger todo» collects in order, and where the screen opens.

export type MissionTab = 'daily' | 'weekly' | 'season' | 'events' | 'achievements';
export const MISSION_TABS: MissionTab[] = ['daily', 'weekly', 'season', 'events', 'achievements'];

export type Reward = { coins?: number; dust?: number; signal?: number; xp?: number; points?: number; eventSignals?: number; title?: string | null; frame?: string | null };

/** One reward ready to collect: how to claim it, its name and what it gives; `big` ones (achievements, the season's missions) celebrate. */
export type ClaimTarget =
  | { kind: 'mission'; period: string; id: string; name: string; reward: Reward; big: boolean }
  | { kind: 'achievement'; id: string; name: string; reward: Reward; big: true };

/** The rewards ready in a tab, in the order the tab shows them. */
export function readyIn(v: MissionsView, tab: MissionTab): ClaimTarget[] {
  if (tab === 'achievements') {
    return v.achievements.filter((a) => a.unlocked && !a.claimed).map((a) => ({ kind: 'achievement', id: a.id, name: a.name, reward: a.reward, big: true }));
  }
  if (tab === 'events') {
    return v.events.flatMap((e) =>
      e.goals
        .filter((g) => !g.claimed && g.progress >= g.target && (g.scope === 'personal' || e.inClan))
        .map((g) => ({ kind: 'mission' as const, period: e.period, id: g.id, name: g.name, reward: g.reward, big: false })),
    );
  }
  const period = tab === 'daily' ? v.daily : tab === 'weekly' ? v.weekly : v.season;
  if (!period) return [];
  return period.missions
    .filter((m) => !m.claimed && m.progress >= m.target)
    .map((m) => ({ kind: 'mission' as const, period: period.period, id: m.id, name: m.name, reward: m.reward, big: tab === 'season' }));
}

export function readyByTab(v: MissionsView): Record<MissionTab, number> {
  return Object.fromEntries(MISSION_TABS.map((k) => [k, readyIn(v, k).length])) as Record<MissionTab, number>;
}

/** The first tab with something to collect, or null. */
export function firstReadyTab(v: MissionsView): MissionTab | null {
  const ready = readyByTab(v);
  return MISSION_TABS.find((k) => ready[k] > 0) ?? null;
}

/** What several rewards add up to (title and frame are not summed: the last one kept). */
export function addRewards(a: Reward, b: Reward): Reward {
  const n = (x?: number) => x ?? 0;
  return {
    coins: n(a.coins) + n(b.coins),
    dust: n(a.dust) + n(b.dust),
    signal: n(a.signal) + n(b.signal),
    xp: n(a.xp) + n(b.xp),
    points: n(a.points) + n(b.points),
    eventSignals: n(a.eventSignals) + n(b.eventSignals),
    title: b.title ?? a.title ?? null,
    frame: b.frame ?? a.frame ?? null,
  };
}
