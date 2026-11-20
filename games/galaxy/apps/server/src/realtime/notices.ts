import type { LiveEvent, LiveNotice, NoticePlayer } from '@galaxy/shared';
import type { Kysely } from 'kysely';
import type { DB } from '../db/schema';

// Real-time notices (plan of 2026-11-12): what a player should hear about happened to them elsewhere (a trade, a sale
// of their listing, a mail, their clan, an achievement). A change collects its notices while its transaction runs and
// they go out only once it is saved: a rollback sends nothing, and a replayed operation (same idempotency key, the
// stored answer) never runs the change again, so it sends nothing twice. Without a live hub (the CLI, some tests)
// nothing is sent.

/** Where notices go: the live hub, or anything with its `send`. */
export interface LiveSink {
  send(accountId: string, event: LiveEvent): void;
}
/** The live hub's broadcast, for a notice to many accounts at once (a mail to a segment). */
export interface LiveBroadcast extends LiveSink {
  sendMany(accountIds: Iterable<string>, event: LiveEvent): void;
}
export type WithLive = { live?: LiveSink };

export class Notices {
  private readonly pending: { to: string; notice: LiveNotice }[] = [];

  add(to: string, notice: LiveNotice): void {
    this.pending.push({ to, notice });
  }

  /** Sends what was collected, once. */
  flush(live: LiveSink | undefined): void {
    for (const { to, notice } of this.pending.splice(0)) live?.send(to, { type: 'notice', notice });
  }
}

/** Runs a change with a collector and sends its notices after it resolved (a throw sends nothing). */
export async function withNotices<T>(live: LiveSink | undefined, run: (out: Notices) => Promise<T>): Promise<T> {
  const out = new Notices();
  const result = await run(out);
  out.flush(live);
  return result;
}

/** The other player in a notice, as they show next to their name (read with the change's own transaction). */
export async function noticePlayer(db: Kysely<DB>, accountId: string): Promise<NoticePlayer> {
  const a = await db.selectFrom('galaxy.accounts').select(['username', 'avatar', 'frame']).where('id', '=', accountId).executeTakeFirstOrThrow();
  return { username: a.username, avatar: a.avatar, frame: a.frame };
}
