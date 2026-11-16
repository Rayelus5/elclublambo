import { CONFIG_KEYS, configIssues, isConfigKey, mergeDraft } from '@galaxy/shared';
import type { FastifyInstance } from 'fastify';
import type { Kysely } from 'kysely';
import { z } from 'zod';
import { confirmPassword } from '../admin/players';
import { requireAdmin } from '../auth/guards';
import type { DB } from '../db/schema';
import type { Env } from '../env';
import { HttpError } from '../errors';
import { hitRateLimit } from '../ratelimit';
import { clientIp } from '../security/client-ip';
import { closeDue } from '../season/close';
import { seasonConfigs } from '../season/service';
import type { ConfigService } from './service';

/** The run content is about 180 KB (2026-11-16): the config routes take up to 1 MiB, not the app's 64 KiB. */
const CONFIG_BODY_LIMIT = 1024 * 1024;
/** The keys the list leaves out (too big to send every time): the panel asks for them with GET /admin/config/:key. */
const LAZY_KEYS = new Set<string>(['content']);
const publishBody = z.object({ data: z.unknown(), reason: z.string().trim().min(3).max(500), password: z.string().min(1).max(200), baseVersion: z.number().int().min(0).optional() });
const validateBody = z.object({ data: z.unknown() });
/** The keys a batch may carry (polish phase 4): an event, its scanner, a boost, its missions. The season has its own route (it archives). */
const BATCH_KEYS = ['events', 'gacha', 'boosts', 'missions'] as const;
const batchBody = z.object({
  items: z
    .array(z.object({ key: z.enum(BATCH_KEYS), data: z.unknown(), baseVersion: z.number().int().min(0).optional() }))
    .min(1)
    .max(BATCH_KEYS.length)
    .refine((list) => new Set(list.map((i) => i.key)).size === list.length, 'duplicate_key'),
  reason: z.string().trim().min(3).max(500),
  password: z.string().min(1).max(200),
});

/**
 * Admin API over the live configuration (GDD §16.3; M6b). Every route needs an admin session opened with TOTP. Every
 * key with what is live (or its default), a draft checked against its schema, the history, and publishing a new version
 * with a reason and the admin's password (an invalid draft answers its issues).
 */
export function registerConfigRoutes(app: FastifyInstance, deps: { env: Env; config: ConfigService; db: Kysely<DB> }): void {
  const keyOf = (raw: string) => {
    if (!isConfigKey(raw)) throw new HttpError(404, 'not_found');
    return raw;
  };

  app.get('/galaxy/api/admin/config', async (req) => {
    requireAdmin(req);
    return deps.config.active();
  });

  const authors = async (ids: (string | null)[]) => {
    const wanted = [...new Set(ids.filter((id): id is string => !!id))];
    const names = wanted.length ? await deps.db.selectFrom('galaxy.accounts').select(['id', 'username']).where('id', 'in', wanted).execute() : [];
    const nameOf = new Map(names.map((n) => [n.id, n.username]));
    return (id: string | null) => (id ? (nameOf.get(id) ?? null) : null);
  };

  // Every key with its newest version; the big ones (the run content) without their data, marked `lazy`.
  app.get('/galaxy/api/admin/config/keys', async (req) => {
    requireAdmin(req);
    const latest = new Map((await deps.config.latest()).map((r) => [r.key, r]));
    const authorOf = await authors([...latest.values()].map((r) => r.createdBy));
    return Promise.all(
      CONFIG_KEYS.map(async (key) => {
        const l = latest.get(key);
        const meta = { key, version: l?.version ?? 0, createdAt: l?.createdAt ?? null, author: authorOf(l?.createdBy ?? null), note: l?.note ?? null };
        return LAZY_KEYS.has(key) ? { ...meta, lazy: true } : { ...meta, data: await deps.config.get(key) };
      }),
    );
  });

  // One key with what is live (or its defaults), and its newest version.
  app.get<{ Params: { key: string } }>('/galaxy/api/admin/config/:key', async (req) => {
    requireAdmin(req);
    const key = keyOf(req.params.key);
    const l = (await deps.config.latest()).find((r) => r.key === key);
    const authorOf = await authors([l?.createdBy ?? null]);
    return { key, version: l?.version ?? 0, data: await deps.config.get(key), createdAt: l?.createdAt ?? null, author: authorOf(l?.createdBy ?? null), note: l?.note ?? null };
  });

  // The history without the data; each version's data on its own.
  app.get<{ Params: { key: string } }>('/galaxy/api/admin/config/:key/versions', async (req) => {
    requireAdmin(req);
    const versions = await deps.config.summaries(keyOf(req.params.key));
    const authorOf = await authors(versions.map((v) => v.createdBy));
    return versions.map(({ createdBy, ...v }) => ({ ...v, author: authorOf(createdBy) }));
  });

  app.get<{ Params: { key: string; version: string } }>('/galaxy/api/admin/config/:key/versions/:version', async (req) => {
    requireAdmin(req);
    const key = keyOf(req.params.key);
    const n = Number(req.params.version);
    const v = Number.isInteger(n) && n >= 1 ? await deps.config.version(key, n) : null;
    if (!v) throw new HttpError(404, 'not_found');
    const authorOf = await authors([v.createdBy]);
    const { createdBy, ...rest } = v;
    return { ...rest, author: authorOf(createdBy) };
  });

  app.post<{ Params: { key: string } }>('/galaxy/api/admin/config/:key/validate', { bodyLimit: CONFIG_BODY_LIMIT }, async (req) => {
    requireAdmin(req);
    const key = keyOf(req.params.key);
    // The draft over what is live, exactly as a publish would see it.
    const { data: active } = (await deps.config.active()).find((r) => r.key === key) ?? { data: {} };
    const issues = configIssues(key, mergeDraft(key, active, validateBody.parse(req.body).data));
    return { ok: issues.length === 0, issues };
  });

  app.post('/galaxy/api/admin/config/batch', { bodyLimit: CONFIG_BODY_LIMIT }, async (req, reply) => {
    const admin = requireAdmin(req);
    const { items, reason, password } = batchBody.parse(req.body);
    await hitRateLimit(deps.db, `a:${admin.accountId}`, 'admin', 60, 60);
    await confirmPassword(deps.db, admin, password);
    const { versions } = await deps.config.publishMany(items, { id: admin.accountId, label: admin.username, ip: clientIp(req, deps.env.TRUST_CF_IP) }, reason);
    return reply.code(201).send({ versions });
  });

  app.post<{ Params: { key: string } }>('/galaxy/api/admin/config/:key', { bodyLimit: CONFIG_BODY_LIMIT }, async (req, reply) => {
    const admin = requireAdmin(req);
    const key = keyOf(req.params.key);
    // Mail v2: what makes a gift a superadmin's is a superadmin's to change (an admin cannot raise their own limit).
    if (key === 'mailLimits' && !admin.roles.includes('superadmin')) throw new HttpError(403, 'superadmin_only');
    const { data, reason, password, baseVersion } = publishBody.parse(req.body);
    await hitRateLimit(deps.db, `a:${admin.accountId}`, 'admin', 60, 60);
    await confirmPassword(deps.db, admin, password);
    // Opening another season (M7d-3): the one it replaces is archived with its final ranking, ended or not.
    const before = key === 'season' ? await seasonConfigs(deps.config) : null;
    const { version } = await deps.config.publish(key, data, { id: admin.accountId, label: admin.username, ip: clientIp(req, deps.env.TRUST_CF_IP) }, reason, { baseVersion });
    if (before && (await deps.config.get('season')).id !== before.season.id) await closeDue(deps.db, before, new Date(), { force: true });
    return reply.code(201).send({ version });
  });
}
