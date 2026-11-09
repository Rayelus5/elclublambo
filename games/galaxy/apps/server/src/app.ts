import cookie from '@fastify/cookie';
import websocket from '@fastify/websocket';
import Fastify, { type FastifyInstance } from 'fastify';
import type { Kysely } from 'kysely';
import { ZodError } from 'zod';
import { clearSessionCookie, registerSessionReader } from './auth/guards';
import { registerAuthRoutes } from './auth/routes';
import { registerConfigRoutes } from './config/routes';
import { registerCollectionRoutes } from './collection/routes';
import { registerGachaRoutes } from './gacha/routes';
import { registerRunRoutes } from './runs/routes';
import { registerStationRoutes } from './station/routes';
import { registerLabRoutes } from './lab/routes';
import { registerPlanetariumRoutes } from './planetarium/routes';
import { registerSocialRoutes } from './social/routes';
import { registerClanRoutes } from './clans/routes';
import { ChatHub } from './chat/hub';
import { LiveHub } from './realtime/live-hub';
import { createRooms, registerRoomRoutes } from './coop/room-routes';
import { registerCoopPlayRoutes } from './coop/play-routes';
import { CoopService } from './coop/service';
import { registerFriendRoutes } from './social/friend-routes';
import { friendIdsOf, prefsOf } from './social/friends';
import { registerChatRoutes } from './chat/routes';
import { registerMarketRoutes } from './market/routes';
import { registerTradeRoutes } from './market/trade-routes';
import { registerAdminRoutes } from './admin/routes';
import { registerModerationRoutes } from './admin/moderation-routes';
import { registerAdminMarketRoutes } from './admin/market-routes';
import { registerCommunicationRoutes } from './admin/communication-routes';
import { registerStatsRoutes } from './admin/stats-routes';
import { registerAdminRunRoutes } from './admin/runs-routes';
import { registerAdminProgressRoutes } from './admin/progress-routes';
import { registerMailRoutes } from './mail/routes';
import { registerMissionRoutes } from './missions/routes';
import { registerCatalogRoutes } from './catalog/routes';
import { registerCodexRoutes } from './codex/routes';
import { registerOnboardingRoutes } from './onboarding/routes';
import { registerTutorialRoutes } from './onboarding/tutorial';
import { registerSeasonRoutes } from './season/routes';
import { type ConfigService, createConfigService } from './config/service';
import type { DB } from './db/schema';
import type { Env } from './env';
import { HttpError } from './errors';
import { registerHealth } from './health';
import { registerMaintenanceGate } from './maintenance';
import { RateLimitedError } from './ratelimit';
import { registerSecurityHeaders } from './security/headers';
import { registerOriginGuard } from './security/origin';
import { registerStatic, sendSpaShell, wantsSpaShell } from './static';

export type AppDeps = { env: Env; db: Kysely<DB>; now?: () => Date; config?: ConfigService };

/**
 * The game server. Logs carry codes and request lines only: bodies (passwords), cookies and tokens are never logged.
 */
export async function buildApp(deps: AppDeps): Promise<FastifyInstance> {
  const app = Fastify({
    logger:
      process.env.NODE_ENV === 'test'
        ? false
        : { level: 'info', redact: ['req.headers.cookie', 'req.headers.authorization', 'res.headers["set-cookie"]'] },
    bodyLimit: 64 * 1024,
  });

  await app.register(cookie);
  // The chats' socket (M5b-2): small frames only (it pushes; clients send nothing but pongs).
  await app.register(websocket, { options: { maxPayload: 4096 } });
  registerSecurityHeaders(app);
  registerOriginGuard(app, deps.env.GALAXY_PUBLIC_ORIGINS);

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof HttpError) {
      if (err.code === 'unauthenticated') clearSessionCookie(reply);
      return reply.code(err.status).send({ error: err.code, ...err.details });
    }
    if (err instanceof ZodError) return reply.code(400).send({ error: 'invalid_input' });
    if (err instanceof RateLimitedError) return reply.code(429).send({ error: 'rate_limited' });
    const status = (err as { statusCode?: number }).statusCode;
    if (typeof status === 'number' && status >= 400 && status < 500) {
      return reply.code(400).send({ error: 'invalid_input' });
    }
    req.log.error({ err: { name: (err as Error).name, code: (err as { code?: unknown }).code } }, 'unhandled');
    return reply.code(500).send({ error: 'internal' });
  });
  const hasWeb = await registerStatic(app, deps.env.WEB_DIST);
  app.setNotFoundHandler((req, reply) => {
    if (hasWeb && wantsSpaShell(req)) return sendSpaShell(reply);
    return reply.code(404).send({ error: 'not_found' });
  });

  const now = deps.now ?? (() => new Date());
  const config =
    deps.config ??
    createConfigService(deps.db, {
      onInvalid: (key, err) => app.log.error({ key, err: (err as Error).name }, 'config_invalid_stored_row'),
    });
  // Plan phase 6: the co-op runs (their clock, logs and pay); tests reach it as app.galaxyCoop.
  const coop = new CoopService({ db: deps.db, config, now, log: app.log, autoRecover: process.env.NODE_ENV !== 'test' });
  app.decorate('galaxyCoop', coop);
  app.addHook('onClose', async () => coop.close());
  // The API lives in its own encapsulated plugin: its hooks (session, maintenance) run only for MATCHED API routes,
  // whatever the raw URL spelling (%-encoded paths included), and static files never touch the database.
  await app.register(async (api) => {
    // Hook order matters: the session must be known before the maintenance gate decides.
    registerSessionReader(api, deps.db, now);
    registerMaintenanceGate(api, config);
    registerHealth(api, deps.db);
    // The live hub is made further down; a logout only happens once the app is up.
    registerAuthRoutes(api, { env: deps.env, db: deps.db, config, now, onLogout: (id) => live.dropSession(id) });
    registerConfigRoutes(api, { env: deps.env, config, db: deps.db });
    registerGachaRoutes(api, { db: deps.db, config, now });
    registerCollectionRoutes(api, { db: deps.db, config });
    registerRunRoutes(api, { db: deps.db, config, now });
    registerStationRoutes(api, { db: deps.db, config, now });
    registerLabRoutes(api, { db: deps.db, config, now });
    registerPlanetariumRoutes(api, { db: deps.db, config });
    registerSocialRoutes(api, { db: deps.db, config, now });
    registerClanRoutes(api, { db: deps.db, config, now });
    // Plan phase 5: the rooms, which the presence reads («in a room, 2/4», and its code when friends may join), and
    // (phase 6c) the room chat, which reaches who is in the room now.
    const rooms = createRooms(config);
    const hub = new ChatHub(deps.db, (id) => rooms.manager.byId(id)?.members.map((m) => m.accountId) ?? []);
    api.addHook('onClose', async () => hub.close());
    // Plan phase 3: the live socket (friends, presence, later rooms), beside the chat's.
    const live = new LiveHub({
      friendsOf: (id) => friendIdsOf(deps.db, id),
      showsStatus: async (id) => (await prefsOf(deps.db, id)).showStatus,
      roomOf: (id) => {
        const r = rooms.manager.roomOf(id);
        return r && r.state === 'lobby' ? { size: r.members.length, max: 4, ...(r.kind !== 'private' ? { code: r.code } : {}) } : null;
      },
    });
    api.addHook('onClose', async () => live.close());
    // Phase 6c: who left a group run hears its result on the live socket when it ends.
    coop.notify = (id, event) => live.send(id, event);
    registerFriendRoutes(api, { db: deps.db, config, live, now, origins: deps.env.GALAXY_PUBLIC_ORIGINS });
    registerRoomRoutes(api, { db: deps.db, config, live, rooms, coop, trustCfIp: deps.env.TRUST_CF_IP });
    registerCoopPlayRoutes(api, { coop, origins: deps.env.GALAXY_PUBLIC_ORIGINS });
    // A ban or closed sessions drop both kinds of socket; the statistics count both.
    const sockets = { dropAccount: (id: string) => (hub.dropAccount(id), live.dropAccount(id)), size: () => hub.size() + live.size() };
    registerChatRoutes(api, { db: deps.db, config, now, hub, roomOf: (id) => rooms.manager.roomOf(id)?.id ?? null, origins: deps.env.GALAXY_PUBLIC_ORIGINS, trustCfIp: deps.env.TRUST_CF_IP });
    registerMarketRoutes(api, { db: deps.db, config, now });
    registerTradeRoutes(api, { db: deps.db, config, now });
    registerAdminRoutes(api, { db: deps.db, config, env: deps.env, hub: sockets });
    registerModerationRoutes(api, { db: deps.db, config, env: deps.env, hub, now });
    registerAdminMarketRoutes(api, { db: deps.db, env: deps.env, now });
    registerMailRoutes(api, { db: deps.db, config, now });
    registerMissionRoutes(api, { db: deps.db, config, now });
    registerCatalogRoutes(api, { db: deps.db, config });
    registerCodexRoutes(api, { db: deps.db, config });
    registerOnboardingRoutes(api, { db: deps.db });
    registerTutorialRoutes(api, { db: deps.db, config });
    registerSeasonRoutes(api, { db: deps.db, config, now });
    registerCommunicationRoutes(api, { db: deps.db, config, env: deps.env, now });
    registerStatsRoutes(api, { db: deps.db, config, hub: sockets, now });
    registerAdminRunRoutes(api, { db: deps.db, env: deps.env });
    registerAdminProgressRoutes(api, { db: deps.db, config, env: deps.env });
  });
  return app;
}
