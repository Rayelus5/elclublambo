import cookie from '@fastify/cookie';
import Fastify, { type FastifyInstance } from 'fastify';
import type { Kysely } from 'kysely';
import { ZodError } from 'zod';
import { clearSessionCookie, registerSessionReader } from './auth/guards';
import { registerAuthRoutes } from './auth/routes';
import { registerConfigRoutes } from './config/routes';
import { type ConfigService, createConfigService } from './config/service';
import type { DB } from './db/schema';
import type { Env } from './env';
import { HttpError } from './errors';
import { registerHealth } from './health';
import { registerMaintenanceGate } from './maintenance';
import { RateLimitedError } from './ratelimit';
import { registerSecurityHeaders } from './security/headers';
import { registerOriginGuard } from './security/origin';

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
  app.setNotFoundHandler((_req, reply) => reply.code(404).send({ error: 'not_found' }));

  const now = deps.now ?? (() => new Date());
  const config =
    deps.config ??
    createConfigService(deps.db, {
      onInvalid: (key, err) => app.log.error({ key, err: (err as Error).name }, 'config_invalid_stored_row'),
    });
  // Hook order matters: the session must be known before the maintenance gate decides.
  registerSessionReader(app, deps.db, now);
  registerMaintenanceGate(app, config);
  registerHealth(app, deps.db);
  registerAuthRoutes(app, { env: deps.env, db: deps.db, config, now });
  registerConfigRoutes(app, { env: deps.env, config });
  return app;
}
