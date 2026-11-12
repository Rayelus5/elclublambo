import { type SoloLiveList, soloStreamMessageSchema } from '@galaxy/shared';
import type { FastifyInstance } from 'fastify';
import type { Kysely } from 'kysely';
import { z } from 'zod';
import { runReplay } from '../admin/runs';
import { isStaff, requireStaff } from '../auth/guards';
import type { DB } from '../db/schema';
import { Buckets } from '../realtime/bucket';
import { isAllowedOrigin } from '../security/origin';
import type { SoloFeeds } from './solo-feeds';

// The live feed of a solo run (plan «escáner pro», part G). The player's socket streams the open solo run it owns,
// from the game's origins with a session; staff (moderators too, as for group runs) watch one from the panel and list
// the runs being played. Nothing a viewer sends reaches the run.

const query = z.object({ run: z.uuid() });

export function registerSoloStreamRoutes(api: FastifyInstance, deps: { db: Kysely<DB>; feeds: SoloFeeds; origins: string[] }): void {
  const buckets = new Buckets();

  api.get('/galaxy/api/runs/stream/ws', { websocket: true }, (socket, req) => {
    if (!isAllowedOrigin(req.headers.origin, deps.origins)) return socket.close(4403, 'origin');
    const s = req.session;
    if (!s) return socket.close(4401, 'session');
    const q = query.safeParse(req.query);
    if (!q.success) return socket.close(4400, 'run');
    const runId = q.data.run;
    // The client waits for the hello before it sends anything, so nothing is lost while the run is looked up.
    let attached = false;
    let strikes = 0;
    socket.on('message', (data: Buffer) => {
      if (!attached) return;
      if (!buckets.take(`stream:${s.accountId}`, 20, 60)) {
        if (++strikes > 30) socket.close(4429, 'rate');
        return;
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(String(data));
      } catch {
        return;
      }
      const msg = soloStreamMessageSchema.safeParse(parsed);
      if (msg.success) deps.feeds.message(runId, socket, msg.data);
    });
    socket.on('close', () => {
      if (attached) deps.feeds.disconnect(runId, socket);
    });
    void (async () => {
      const run = await deps.db
        .selectFrom('galaxy.runs')
        .select(['id', 'sector', 'probe', 'started_at'])
        .where('id', '=', runId)
        .where('account_id', '=', s.accountId)
        .where('finished_at', 'is', null)
        .where('coop_run_id', 'is', null)
        .executeTakeFirst();
      if (socket.readyState !== socket.OPEN) return;
      if (!run) return socket.close(4404, 'run');
      if (!deps.feeds.connect({ id: run.id, accountId: s.accountId, player: s.username, sector: run.sector, probe: run.probe, startedAt: new Date(run.started_at).toISOString() }, socket)) {
        return socket.close(1013, 'busy');
      }
      attached = true;
    })().catch((err: unknown) => {
      req.log.error({ err, run: runId }, 'solo_stream');
      socket.close(1011, 'error');
    });
  });

  api.get('/galaxy/api/admin/solo/watch/ws', { websocket: true }, (socket, req) => {
    if (!isAllowedOrigin(req.headers.origin, deps.origins)) return socket.close(4403, 'origin');
    const s = req.session;
    if (!s) return socket.close(4401, 'session');
    if (!isStaff(s)) return socket.close(4403, 'staff');
    const q = query.safeParse(req.query);
    if (!q.success) return socket.close(4400, 'run');
    const runId = q.data.run;
    if (!deps.feeds.has(runId)) return socket.close(4404, 'run');
    socket.on('close', () => deps.feeds.unwatch(runId, socket));
    void (async () => {
      // The start as the panel's replay builds it (the run's content version), sent here because moderators may watch.
      const replay = await runReplay(deps.db, runId);
      if (socket.readyState !== socket.OPEN) return;
      if (!deps.feeds.watch(runId, socket, { start: replay.start, contentFallback: replay.contentFallback })) return socket.close(4404, 'run');
      req.log.info({ run: runId, staff: s.username }, 'solo_watch');
    })().catch((err: unknown) => {
      req.log.error({ err, run: runId }, 'solo_watch');
      socket.close(1011, 'error');
    });
  });

  api.get('/galaxy/api/admin/solo/live', async (req): Promise<SoloLiveList> => {
    requireStaff(req);
    return { runs: deps.feeds.list() };
  });
}
