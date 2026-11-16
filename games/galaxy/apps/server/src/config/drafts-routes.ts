import { createDraftSchema, publishDraftSchema, rebaseDraftSchema, renameDraftSchema, setDraftFieldSchema } from '@galaxy/shared';
import type { FastifyInstance } from 'fastify';
import type { Kysely } from 'kysely';
import { z } from 'zod';
import { confirmPassword } from '../admin/players';
import { requireAdmin } from '../auth/guards';
import type { DB } from '../db/schema';
import type { Env } from '../env';
import { hitRateLimit } from '../ratelimit';
import { clientIp } from '../security/client-ip';
import type { DraftService } from './drafts';

// Config drafts (the content editor, 2026-11-16, P2): every route needs an admin with TOTP. A save takes up to 1 MiB
// (one field of the run content can be most of its 180 KB); publishing asks for a reason and the admin's password.

const BODY_LIMIT = 1024 * 1024;
const idParam = z.object({ id: z.uuid() }).strict();
const BASE = '/galaxy/api/admin/config-drafts';

export function registerDraftRoutes(app: FastifyInstance, deps: { env: Env; drafts: DraftService; db: Kysely<DB> }): void {
  const actorOf = (req: Parameters<typeof requireAdmin>[0]) => {
    const admin = requireAdmin(req);
    return { admin, actor: { id: admin.accountId, label: admin.username, ip: clientIp(req, deps.env.TRUST_CF_IP) } };
  };

  app.get(BASE, async (req) => {
    requireAdmin(req);
    return deps.drafts.list();
  });

  app.post(BASE, async (req, reply) => {
    const { actor } = actorOf(req);
    const { title } = createDraftSchema.parse(req.body);
    return reply.code(201).send(await deps.drafts.create(actor, title));
  });

  app.get(`${BASE}/:id`, async (req) => {
    requireAdmin(req);
    return deps.drafts.get(idParam.parse(req.params).id);
  });

  app.put(`${BASE}/:id/field`, { bodyLimit: BODY_LIMIT }, async (req) => {
    const { actor } = actorOf(req);
    return deps.drafts.setField(actor, idParam.parse(req.params).id, setDraftFieldSchema.parse(req.body));
  });

  app.patch(`${BASE}/:id`, async (req) => {
    const { actor } = actorOf(req);
    return deps.drafts.rename(actor, idParam.parse(req.params).id, renameDraftSchema.parse(req.body));
  });

  app.get(`${BASE}/:id/check`, async (req) => {
    requireAdmin(req);
    return deps.drafts.check(idParam.parse(req.params).id);
  });

  app.post(`${BASE}/:id/rebase`, async (req) => {
    const { actor } = actorOf(req);
    return deps.drafts.rebase(actor, idParam.parse(req.params).id, rebaseDraftSchema.parse(req.body ?? {}).resolutions);
  });

  app.post(`${BASE}/:id/publish`, async (req, reply) => {
    const { admin, actor } = actorOf(req);
    const { reason, password } = publishDraftSchema.parse(req.body);
    await hitRateLimit(deps.db, `a:${admin.accountId}`, 'admin', 60, 60);
    await confirmPassword(deps.db, admin, password);
    return reply.code(201).send(await deps.drafts.publish(actor, idParam.parse(req.params).id, reason));
  });

  app.delete(`${BASE}/:id`, async (req, reply) => {
    const { actor } = actorOf(req);
    await deps.drafts.discard(actor, idParam.parse(req.params).id);
    return reply.code(204).send();
  });
}
