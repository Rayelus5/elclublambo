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
]);

function isAdmin(req: FastifyRequest): boolean {
  const s = req.session;
  return !!s && s.mfa && s.roles.some((r) => r === 'admin' || r === 'superadmin');
}

/**
 * features.maintenance on → every other API call from a non-admin answers 503 { error: 'maintenance' }. Static files
 * keep loading so the web can show its maintenance screen. Must run after the session reader.
 */
export function registerMaintenanceGate(app: FastifyInstance, config: ConfigReader): void {
  app.addHook('preHandler', async (req) => {
    const path = req.url.split('?')[0] ?? '';
    if (!path.startsWith('/galaxy/api/')) return;
    if (ALWAYS_OPEN.has(`${req.method} ${req.routeOptions.url ?? path}`)) return;
    if (!(await config.get('features')).maintenance) return;
    if (isAdmin(req)) return;
    throw new HttpError(503, 'maintenance');
  });
}
