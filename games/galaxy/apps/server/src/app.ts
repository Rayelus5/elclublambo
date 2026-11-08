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
import { registerChatRoutes } from './chat/routes';
import { registerMarketRoutes } from './market/routes';
import { registerTradeRoutes } from './market/trade-routes';
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
      return reply.code(err.status).send({ error: err.code });
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
  // The API lives in its own encapsulated plugin: its hooks (session, maintenance) run only for MATCHED API routes,
  // whatever the raw URL spelling (%-encoded paths included), and static files never touch the database.
  await app.register(async (api) => {
    // Hook order matters: the session must be known before the maintenance gate decides.
    registerSessionReader(api, deps.db, now);
    registerMaintenanceGate(api, config);
    registerHealth(api, deps.db);
    registerAuthRoutes(api, { env: deps.env, db: deps.db, config, now });
    registerConfigRoutes(api, { env: deps.env, config });
    registerGachaRoutes(api, { db: deps.db, config, now });
    registerCollectionRoutes(api, { db: deps.db, config });
    registerRunRoutes(api, { db: deps.db, config, now });
    registerStationRoutes(api, { db: deps.db, config, now });
    registerLabRoutes(api, { db: deps.db, config, now });
    registerPlanetariumRoutes(api, { db: deps.db, config });
    registerSocialRoutes(api, { db: deps.db, config, now });
    registerClanRoutes(api, { db: deps.db, config, now });
    const hub = new ChatHub(deps.db);
    api.addHook('onClose', async () => hub.close());
    registerChatRoutes(api, { db: deps.db, config, now, hub, origins: deps.env.GALAXY_PUBLIC_ORIGINS });
    registerMarketRoutes(api, { db: deps.db, config, now });
    registerTradeRoutes(api, { db: deps.db, config, now });
  });
  return app;
}
