import { z } from 'zod';
import type { AdminRunReplay } from './admin-runs';

// Watching a solo run live (plan «escáner pro», part G; the owner: «los admins deberían de poder ver partidas
// individuales en directo»). A solo run always streams its input log to the server while it is played (often when
// someone watches, rarely when nobody does), on its own socket; the server checks each piece and hands it to the staff
// watching, whose browser replays the run as it comes. It is only for watching: the reward still comes from the finish.

/** How the player's run is going, as its client says. */
export const SOLO_STATES = ['run', 'pick', 'pause'] as const;
export type SoloPlayState = (typeof SOLO_STATES)[number];
/** What a viewer is told: the player's own state, its connection lost (for a while), or done (its result on the way). */
export type SoloFeedState = SoloPlayState | 'lost' | 'done';

/** A piece of the log as base64, at most (under the socket's 4096-character messages with the rest of the frame). */
export const SOLO_CHUNK_MAX = 3400;

const tick = z.number().int().min(0).max(100_000_000);

/** What the player's client sends on `/galaxy/api/runs/stream/ws?run=`. */
export const soloStreamMessageSchema = z.discriminatedUnion('t', [
  /**
   * A piece of the log (sim encodeEvents, base64): the events from number `at` on, counting ticks from the last one the
   * server has; `to` is the tick the run had reached, `s` how it is.
   */
  z
    .object({
      t: z.literal('f'),
      at: z.number().int().min(0).max(100_000_000),
      b: z.string().max(SOLO_CHUNK_MAX).regex(/^[A-Za-z0-9+/]*={0,2}$/),
      to: tick,
      s: z.enum(SOLO_STATES),
    })
    .strict(),
  /** The run is over on the player's side (the finish follows). */
  z.object({ t: z.literal('end') }).strict(),
]);
export type SoloStreamMessage = z.infer<typeof soloStreamMessageSchema>;

/** What the server sends the player. */
export type SoloStreamServerMessage =
  /** On connecting, and when a piece does not follow: how many events it has, the tick they reach, and if anyone watches. */
  | { t: 'hello'; have: number; tick: number; watched: boolean }
  /** Somebody started watching, or the last one stopped. */
  | { t: 'watch'; on: boolean };

/** What the server sends a viewer on `/galaxy/api/admin/solo/watch/ws?run=`. */
export type SoloWatchMessage =
  /** On connecting: the run, its start, the whole log so far (sim encodeLog, base64), the tick it had reached and how it is. */
  | {
      t: 'hello';
      run: { id: string; player: string; startedAt: string };
      start: AdminRunReplay['start'];
      contentFallback: boolean;
      log: string;
      to: number;
      s: SoloFeedState;
    }
  /** More of the log (sim encodeEvents, base64, counting from the last tick so far). */
  | { t: 'f'; b: string; to: number; s: SoloFeedState }
  /** Only the state changed. */
  | { t: 'st'; s: SoloFeedState }
  /** The run ended (its result is saved) or its feed was dropped. */
  | { t: 'end' };

/** A solo run being played now, for «Moderación › Salas en vivo». */
export interface SoloLiveRow {
  runId: string;
  player: string;
  sector: string;
  probe: string;
  startedAt: string;
  /** The tick the run had reached. */
  tick: number;
  state: SoloFeedState;
  watchers: number;
}

export interface SoloLiveList {
  runs: SoloLiveRow[];
}
