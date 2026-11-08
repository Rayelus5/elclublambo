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

const publishBody = z.object({ data: z.unknown(), reason: z.string().trim().min(3).max(500), password: z.string().min(1).max(200), baseVersion: z.number().int().min(0).optional() });
const validateBody = z.object({ data: z.unknown() });

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

  app.get('/galaxy/api/admin/config/keys', async (req) => {
    requireAdmin(req);
    const rows = await Promise.all(
      CONFIG_KEYS.map(async (key) => {
        const versions = await deps.config.versions(key);
        const latest = versions.reduce<(typeof versions)[number] | undefined>((a, b) => (!a || b.version > a.version ? b : a), undefined);
        return { key, version: latest?.version ?? 0, data: await deps.config.get(key), createdAt: latest?.createdAt ?? null, createdBy: latest?.createdBy ?? null, note: latest?.note ?? null };
      }),
    );
    const ids = [...new Set(rows.flatMap((r) => (r.createdBy ? [r.createdBy] : [])))];
    const names = ids.length ? await deps.db.selectFrom('galaxy.accounts').select(['id', 'username']).where('id', 'in', ids).execute() : [];
    const nameOf = new Map(names.map((n) => [n.id, n.username]));
    return rows.map(({ createdBy, ...r }) => ({ ...r, author: createdBy ? (nameOf.get(createdBy) ?? null) : null }));
  });

  app.get<{ Params: { key: string } }>('/galaxy/api/admin/config/:key/versions', async (req) => {
    requireAdmin(req);
    const versions = await deps.config.versions(keyOf(req.params.key));
    const ids = [...new Set(versions.flatMap((v) => (v.createdBy ? [v.createdBy] : [])))];
    const names = ids.length ? await deps.db.selectFrom('galaxy.accounts').select(['id', 'username']).where('id', 'in', ids).execute() : [];
    const nameOf = new Map(names.map((n) => [n.id, n.username]));
    return versions.map((v) => ({ ...v, author: v.createdBy ? (nameOf.get(v.createdBy) ?? null) : null }));
  });

  app.post<{ Params: { key: string } }>('/galaxy/api/admin/config/:key/validate', async (req) => {
    requireAdmin(req);
    const key = keyOf(req.params.key);
    // The draft over what is live, exactly as a publish would see it.
    const { data: active } = (await deps.config.active()).find((r) => r.key === key) ?? { data: {} };
    const issues = configIssues(key, mergeDraft(key, active, validateBody.parse(req.body).data));
    return { ok: issues.length === 0, issues };
  });

  app.post<{ Params: { key: string } }>('/galaxy/api/admin/config/:key', async (req, reply) => {
    const admin = requireAdmin(req);
    const key = keyOf(req.params.key);
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
