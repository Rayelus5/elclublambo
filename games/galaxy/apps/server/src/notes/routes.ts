import { createHash } from 'node:crypto';
import { adminNoteSaveSchema, type AdminReleaseNotesView, noteIdParamSchema, type ReleaseNotesView } from '@galaxy/shared';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { Kysely } from 'kysely';
import type { AuditActor } from '../audit';
import { requireAdmin, requireSession } from '../auth/guards';
import type { DB } from '../db/schema';
import type { Env } from '../env';
import { hitRateLimit } from '../ratelimit';
import { clientIp } from '../security/client-ip';
import { adminNotes, deleteNote, hideNote, releaseNotes, restoreNote, saveNote } from './service';

// «Notas de versión»'s routes (plan «notas de versión»): every signed-in player reads them (with an ETag of their
// contents: an unchanged copy is a 304); only admins signed in with TOTP edit them, at the panel's pace and audited.

export function registerNotesRoutes(api: FastifyInstance, deps: { db: Kysely<DB>; env: Env }): void {
  const actorOf = async (req: FastifyRequest): Promise<AuditActor> => {
    const s = requireAdmin(req);
    await hitRateLimit(deps.db, `a:${s.accountId}`, 'admin', 60, 60);
    return { id: s.accountId, label: s.username, ip: clientIp(req, deps.env.TRUST_CF_IP) };
  };
  const id = (req: FastifyRequest) => noteIdParamSchema.parse(req.params).id;

  api.get('/galaxy/api/notes', async (req, reply) => {
    requireSession(req);
    const view: ReleaseNotesView = { notes: await releaseNotes(deps.db) };
    const etag = `"notes-${createHash('sha1').update(JSON.stringify(view)).digest('hex').slice(0, 16)}"`;
    reply.header('etag', etag).header('cache-control', 'private, max-age=60');
    if (req.headers['if-none-match'] === etag) return reply.code(304).send();
    return view;
  });

  api.get('/galaxy/api/admin/notes', async (req): Promise<AdminReleaseNotesView> => {
    requireAdmin(req);
    return { notes: await adminNotes(deps.db) };
  });

  api.put('/galaxy/api/admin/notes/:id', async (req) => {
    const note = id(req);
    const body = adminNoteSaveSchema.parse(req.body);
    return saveNote(deps.db, await actorOf(req), note, body);
  });

  api.post('/galaxy/api/admin/notes/:id/hide', async (req) => hideNote(deps.db, await actorOf(req), id(req)));
  api.post('/galaxy/api/admin/notes/:id/restore', async (req) => restoreNote(deps.db, await actorOf(req), id(req)));
  api.post('/galaxy/api/admin/notes/:id/delete', async (req) => deleteNote(deps.db, await actorOf(req), id(req)));
}
