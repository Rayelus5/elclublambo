import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { ConfigReader } from './config/reader';
import { HttpError } from './errors';

/** What stays reachable for everyone during maintenance: the health probe and the way in and out for admins. */
const ALWAYS_OPEN = new Set([
  'GET /galaxy/api/health',
  'POST /galaxy/api/auth/login',
  'POST /galaxy/api/auth/totp',
  'GET /galaxy/api/auth/me',
  'POST /galaxy/api/auth/logout',
  // Stripe's webhook: a payment taken during maintenance is still delivered.
  'POST /galaxy/api/shop/webhook',
]);

function isAdmin(req: FastifyRequest): boolean {
  const s = req.session;
  return !!s && s.mfa && s.roles.some((r) => r === 'admin' || r === 'superadmin');
}

/**
 * features.maintenance on → every other API call from a non-admin answers 503 { error: 'maintenance' }. Register it in
 * the API plugin only (static files keep loading so the web can show its maintenance screen), after the session
 * reader. It decides by the MATCHED route pattern, never by the raw URL (which may be %-encoded).
 */
export function registerMaintenanceGate(app: FastifyInstance, config: ConfigReader): void {
  app.addHook('preHandler', async (req) => {
    if (ALWAYS_OPEN.has(`${req.method} ${req.routeOptions.url}`)) return;
    if (!(await config.get('features')).maintenance) return;
    if (isAdmin(req)) return;
    throw new HttpError(503, 'maintenance');
  });
}
