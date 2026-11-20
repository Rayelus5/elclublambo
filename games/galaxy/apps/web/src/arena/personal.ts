import type { SimEvent } from '@galaxy/sim';

// In a group run each player's own moments are theirs (Nov plan A2): a teammate's hit, level-up, pickup, dash or
// relic anomaly never flashes, shakes or sounds on my screen. The world's events (kills, the boss, the beacon) are
// everyone's.
const PERSONAL = new Set<SimEvent['t']>(['hurt', 'levelUp', 'pickup', 'dash', 'anomaly']);

/** Whether `e` belongs on the screen of the player whose probe is `me`. */
export function isPersonal(e: SimEvent, me: number): boolean {
  return !PERSONAL.has(e.t) || !('probe' in e) || e.probe === me;
}
