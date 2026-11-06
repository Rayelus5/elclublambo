import { isConfigKey } from '@galaxy/shared';
import type { FastifyInstance } from 'fastify';
import { ZodError, z } from 'zod';
import { requireAdmin } from '../auth/guards';
import type { Env } from '../env';
import { HttpError } from '../errors';
import { clientIp } from '../security/client-ip';
import type { ConfigService } from './service';

const publishBody = z.object({ data: z.unknown(), reason: z.string().trim().min(3).max(500) });

/** Admin API over the live configuration (GDD §16.3). Every route needs an admin session opened with TOTP. */
export function registerConfigRoutes(app: FastifyInstance, deps: { env: Env; config: ConfigService }): void {
  app.get('/galaxy/api/admin/config', async (req) => {
    requireAdmin(req);
    return deps.config.active();
  });

  app.get<{ Params: { key: string } }>('/galaxy/api/admin/config/:key/versions', async (req) => {
    requireAdmin(req);
    if (!isConfigKey(req.params.key)) throw new HttpError(404, 'not_found');
    return deps.config.versions(req.params.key);
  });

  app.post<{ Params: { key: string } }>('/galaxy/api/admin/config/:key', async (req, reply) => {
    const admin = requireAdmin(req);
    if (!isConfigKey(req.params.key)) throw new HttpError(404, 'not_found');
    const { data, reason } = publishBody.parse(req.body);
    try {
      const { version } = await deps.config.publish(
        req.params.key,
        data,
        { id: admin.accountId, label: admin.username, ip: clientIp(req, deps.env.TRUST_CF_IP) },
        reason,
      );
      return reply.code(201).send({ version });
    } catch (err) {
      if (err instanceof ZodError) throw new HttpError(400, 'config_invalid');
      throw err;
    }
  });
}
