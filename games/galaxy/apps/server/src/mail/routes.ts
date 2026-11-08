import { mailIdParamSchema, type MyMailbox, type TitleNotice } from '@galaxy/shared';
import type { FastifyInstance } from 'fastify';
import { requireSession } from '../auth/guards';
import { hitRateLimit } from '../ratelimit';
import { claimMail, liveNotices, type MailDeps, myMailbox, readMail } from './service';

// The mailbox and the title notices (GDD §16.5; M6d-1), for signed-in players. Claiming is rate limited.

export function registerMailRoutes(api: FastifyInstance, deps: MailDeps): void {
  api.get('/galaxy/api/mailbox', async (req): Promise<MyMailbox> => {
    const s = requireSession(req);
    return myMailbox(deps, s.accountId);
  });

  api.post('/galaxy/api/mailbox/:id/read', async (req) => {
    const s = requireSession(req);
    return readMail(deps, s.accountId, mailIdParamSchema.parse(req.params).id);
  });

  api.post('/galaxy/api/mailbox/:id/claim', async (req) => {
    const s = requireSession(req);
    await hitRateLimit(deps.db, `a:${s.accountId}`, 'mail_claim', 30, 60);
    return claimMail(deps, s.accountId, mailIdParamSchema.parse(req.params).id);
  });

  api.get('/galaxy/api/notices', async (req): Promise<TitleNotice[]> => {
    requireSession(req);
    return liveNotices(deps.db, deps.now());
  });
}
