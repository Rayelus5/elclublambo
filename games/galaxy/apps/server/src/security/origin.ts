import type { FastifyInstance } from 'fastify';
import { HttpError } from '../errors';

const UNSAFE = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/** Exact match against the configured origins: no prefixes, no trailing slash, no scheme downgrade. */
export function isAllowedOrigin(origin: string | undefined, allowed: string[]): boolean {
  return typeof origin === 'string' && origin.length > 0 && allowed.includes(origin);
}

declare module 'fastify' {
  interface FastifyContextConfig {
    /** A route called by a server, never by a browser (Stripe's webhook): it proves itself another way (a signature). */
    originExempt?: boolean;
  }
}

/**
 * CSRF guard (GDD §18.2): state-changing requests must come from one of our own origins. Only a route marked
 * `originExempt` (decided by the matched route, never by the raw URL) skips it.
 */
export function registerOriginGuard(app: FastifyInstance, allowed: string[]): void {
  app.addHook('onRequest', async (req) => {
    if (req.routeOptions.config?.originExempt === true) return;
    if (UNSAFE.has(req.method) && !isAllowedOrigin(req.headers.origin, allowed)) {
      throw new HttpError(403, 'origin_rejected');
    }
  });
}
