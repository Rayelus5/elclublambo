import { coopClientMessageSchema } from '@galaxy/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { Buckets } from '../realtime/bucket';
import { isAllowedOrigin } from '../security/origin';
import type { CoopService } from './service';

// The play socket of a co-op run (multiplayer plan, phase 6): only the run's players, from the game's origins, with a
// session. It says hello with the run and its log so far, then carries the sealed inputs; the player sends its own
// inputs (only when they change), its cards, a ping, or that it leaves. Too many messages close it (4429).

const query = z.object({ run: z.uuid() });

export function registerCoopPlayRoutes(api: FastifyInstance, deps: { coop: CoopService; origins: string[] }): void {
  const buckets = new Buckets();
  api.get('/galaxy/api/coop/play/ws', { websocket: true }, (socket, req) => {
    if (!isAllowedOrigin(req.headers.origin, deps.origins)) return socket.close(4403, 'origin');
    const s = req.session;
    if (!s) return socket.close(4401, 'session');
    const q = query.safeParse(req.query);
    if (!q.success) return socket.close(4400, 'run');
    const joined = deps.coop.connect(q.data.run, s.accountId, socket);
    if (!joined) return socket.close(deps.coop.get(q.data.run) ? 4403 : 4404, 'run');
    const { run, slot } = joined;
    let strikes = 0;
    socket.on('message', (data: Buffer) => {
      if (!buckets.take(`play:${s.accountId}`, 120, 240)) {
        if (++strikes > 30) socket.close(4429, 'rate');
        return;
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(String(data));
      } catch {
        return;
      }
      const msg = coopClientMessageSchema.safeParse(parsed);
      if (msg.success) deps.coop.message(run, slot, msg.data, socket);
    });
    socket.on('close', () => deps.coop.disconnect(run, slot, socket));
  });
}
