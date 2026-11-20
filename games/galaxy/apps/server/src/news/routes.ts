import { createHash } from 'node:crypto';
import { adminMediaUploadSchema, adminNewsCreateSchema, adminNewsOrderSchema, adminNewsSaveSchema, adminReasonSchema, newsIdParamSchema } from '@galaxy/shared';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { AuditActor } from '../audit';
import { requireAdmin } from '../auth/guards';
import type { Env } from '../env';
import { hitRateLimit } from '../ratelimit';
import { clientIp } from '../security/client-ip';
import { adminNews, createNews, deleteMedia, deleteNews, listMedia, listNews, mediaFile, type NewsDeps, orderNews, saveNews, setNewsHidden, uploadMedia } from './service';

// The news board's routes (the owner, 2026-11-14). Public: the cards on now (with an ETag) and the uploaded images
// (same origin, cached for good: an image never changes under its id). Admin with TOTP: everything else, rate limited
// like the rest of the panel and audited with the admin's IP. An upload may be up to 3 MB of JSON (2 MB of image).

const UPLOAD_LIMIT = 3 * 1024 * 1024;

export function registerNewsRoutes(api: FastifyInstance, deps: NewsDeps & { env: Env }): void {
  const actorOf = async (req: FastifyRequest): Promise<AuditActor> => {
    const s = requireAdmin(req);
    await hitRateLimit(deps.db, `a:${s.accountId}`, 'admin', 60, 60);
    return { id: s.accountId, label: s.username, ip: clientIp(req, deps.env.TRUST_CF_IP) };
  };
  const id = (req: FastifyRequest) => newsIdParamSchema.parse(req.params).id;

  api.get('/galaxy/api/news', async (req, reply) => {
    const view = await listNews(deps);
    const tag = `"${createHash('sha1').update(JSON.stringify(view)).digest('base64url')}"`;
    reply.header('etag', tag).header('cache-control', 'no-cache');
    if (req.headers['if-none-match'] === tag) return reply.code(304).send();
    return view;
  });

  api.get('/galaxy/api/media/:id', async (req, reply) => {
    const file = await mediaFile(deps, id(req));
    const tag = `"${file.sha256}"`;
    reply.header('etag', tag).header('cache-control', 'public, max-age=31536000, immutable').header('x-content-type-options', 'nosniff');
    if (req.headers['if-none-match'] === tag) return reply.code(304).send();
    return reply.type(file.mime).send(file.data);
  });

  api.get('/galaxy/api/admin/news', async (req) => {
    requireAdmin(req);
    return adminNews(deps);
  });
  api.post('/galaxy/api/admin/news', async (req) => createNews(deps, await actorOf(req), adminNewsCreateSchema.parse(req.body)));
  api.put('/galaxy/api/admin/news/:id', async (req) => saveNews(deps, await actorOf(req), id(req), adminNewsSaveSchema.parse(req.body)));
  api.post('/galaxy/api/admin/news/:id/hide', async (req) => setNewsHidden(deps, await actorOf(req), id(req), true, adminReasonSchema.parse(req.body).reason));
  api.post('/galaxy/api/admin/news/:id/show', async (req) => setNewsHidden(deps, await actorOf(req), id(req), false, adminReasonSchema.parse(req.body).reason));
  api.post('/galaxy/api/admin/news/:id/delete', async (req) => deleteNews(deps, await actorOf(req), id(req), adminReasonSchema.parse(req.body).reason));
  api.post('/galaxy/api/admin/news/order', async (req) => {
    const body = adminNewsOrderSchema.parse(req.body);
    return orderNews(deps, await actorOf(req), body.section, body.ids);
  });

  api.get('/galaxy/api/admin/media', async (req) => {
    requireAdmin(req);
    return listMedia(deps);
  });
  api.post('/galaxy/api/admin/media', { bodyLimit: UPLOAD_LIMIT }, async (req) => uploadMedia(deps, await actorOf(req), adminMediaUploadSchema.parse(req.body)));
  api.post('/galaxy/api/admin/media/:id/delete', async (req) => deleteMedia(deps, await actorOf(req), id(req), adminReasonSchema.parse(req.body).reason));
}
