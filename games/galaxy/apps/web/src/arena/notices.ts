import type { Content, SimEvent } from '@galaxy/sim';
import { copy } from '../copy/es';

// Centre-screen notices in a run (2026-11-16): what happens says so in the middle of the screen, one at a time, so the
// player knows the run's moments — a new layer, a Núcleo, the beacon, a satellite and its signal, the Static. Only my
// own pickups and my own Static speak (in a group, the others' are theirs). A player turns them off in the run's
// settings (`runNotices`); the screen reader's live region keeps reading them either way.

export type NoticeTone = 'info' | 'reward' | 'danger';
export interface RunNotice {
  text: string;
  tone: NoticeTone;
}

const t = copy.arena.notices;

export function noticesFor(events: readonly SimEvent[], me: number, content: Content): RunNotice[] {
  const out: RunNotice[] = [];
  for (const e of events) {
    if (e.t === 'layer') out.push({ text: t.layer(e.layer), tone: 'info' });
    else if (e.t === 'bossSpawn') out.push({ text: t.boss(content.bosses.find((b) => b.id === e.boss)?.name ?? ''), tone: 'danger' });
    else if (e.t === 'beaconOpen') out.push({ text: t.beacon, tone: 'info' });
    else if (e.t === 'satellite' && e.what === 'appear') out.push({ text: t.satellite, tone: 'info' });
    else if (e.t === 'pickup' && e.probe === me && e.kind === 'signal') out.push({ text: t.signal(e.value), tone: 'reward' });
    else if (e.t === 'static' && e.probe === me && e.what === 'warn') out.push({ text: t.staticWarn, tone: 'danger' });
    else if (e.t === 'static' && e.probe === me && e.what === 'start') out.push({ text: t.staticStart, tone: 'danger' });
  }
  return out;
}

export interface NoticeQueue {
  push(notices: readonly RunNotice[], now: number): void;
  /** The notice on screen at `now`, or null. */
  current(now: number): RunNotice | null;
}

/**
 * One at a time, `ms` each. The same text again within `ms` of itself is dropped (it can come back later: the Static
 * warns again after the player stopped again), and when too many pile up only the last `keep` wait: a notice says what
 * is happening now, not a minute ago.
 */
export function createNoticeQueue(ms = 2800, keep = 4): NoticeQueue {
  const waiting: RunNotice[] = [];
  let shown: RunNotice | null = null;
  let since = 0;
  let last: string | null = null;
  let lastAt = -Infinity;
  const advance = (now: number) => {
    if (shown && now - since < ms) return;
    shown = waiting.shift() ?? null;
    since = now;
  };
  return {
    push(notices, now) {
      for (const n of notices) {
        if (n.text === last && now - lastAt < ms) continue;
        last = n.text;
        lastAt = now;
        waiting.push(n);
      }
      while (waiting.length > keep) waiting.shift();
      advance(now);
    },
    current(now) {
      advance(now);
      return shown;
    },
  };
}
