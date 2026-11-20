import {
  type ChatHistory,
  type ChatMentionCandidate,
  chatChannelParamSchema,
  chatHistoryQuerySchema,
  chatMentionQuerySchema,
  type ChatMessage,
  chatMessageParamSchema,
  chatMuteSchema,
  chatReadSchema,
  chatReportSchema,
  chatSendSchema,
  type ChatUnread,
} from '@galaxy/shared';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { AuditActor } from '../audit';
import { requireSession } from '../auth/guards';
import { requireFeature } from '../config/features';
import { hitRateLimit } from '../ratelimit';
import { clientIp } from '../security/client-ip';
import { type ChatDeps, chatHistory, chatUnread, hideMessage, markRead, muteAccount, reportMessage, searchMentions, sendMessage } from './service';

// The chats' routes (GDD §14.4; M5b-2). Reading and sending are plain HTTP; what is new arrives on the live socket
// (realtime/live-hub.ts; its own socket was retired on 2026-11-14).

export function registerChatRoutes(api: FastifyInstance, deps: ChatDeps & { origins: string[]; trustCfIp: boolean }): void {
  /** Who acts, for the audit of a moderator's hide or mute. */
  const actorOf = (req: FastifyRequest, s: { accountId: string; username: string }): AuditActor => ({ id: s.accountId, label: s.username, ip: clientIp(req, deps.trustCfIp) });

  // The owner's chat asks (2026-11-14): what is new in my channels, what I read, and names for the mention box. These
  // fixed paths go before `/chat/:channel`.
  api.get('/galaxy/api/chat/unread', async (req): Promise<ChatUnread> => {
    const s = requireSession(req);
    return chatUnread(deps, s);
  });

  api.post('/galaxy/api/chat/read', async (req): Promise<{ id: string }> => {
    const s = requireSession(req);
    const { channel, id } = chatReadSchema.parse(req.body);
    return markRead(deps, s, channel, id);
  });

  api.get('/galaxy/api/chat/mentions', async (req): Promise<{ players: ChatMentionCandidate[] }> => {
    const s = requireSession(req);
    const { q } = chatMentionQuerySchema.parse(req.query);
    await hitRateLimit(deps.db, `a:${s.accountId}`, 'chat_mention', 30, 60);
    return searchMentions(deps, s, q);
  });

  api.get('/galaxy/api/chat/:channel', async (req): Promise<ChatHistory> => {
    const s = requireSession(req);
    const { channel } = chatChannelParamSchema.parse(req.params);
    const { before } = chatHistoryQuerySchema.parse(req.query);
    return chatHistory(deps, s, channel, before);
  });

  api.post('/galaxy/api/chat/:channel/messages', async (req): Promise<ChatMessage> => {
    const s = requireSession(req);
    await requireFeature(deps.config, 'chat');
    const { channel } = chatChannelParamSchema.parse(req.params);
    const { body } = chatSendSchema.parse(req.body);
    return sendMessage(deps, s, channel, body);
  });

  api.post('/galaxy/api/chat/messages/:id/report', async (req): Promise<{ hidden: boolean }> => {
    const s = requireSession(req);
    const { id } = chatMessageParamSchema.parse(req.params);
    const { reason } = chatReportSchema.parse(req.body ?? {});
    await hitRateLimit(deps.db, `a:${s.accountId}`, 'chat_report', 30, 60);
    return reportMessage(deps, s, id, reason);
  });

  api.post('/galaxy/api/chat/messages/:id/hide', async (req): Promise<{ hidden: true }> => {
    const s = requireSession(req);
    const { id } = chatMessageParamSchema.parse(req.params);
    return hideMessage(deps, s, actorOf(req, s), id);
  });

  api.post('/galaxy/api/chat/mutes', async (req): Promise<{ until: string }> => {
    const s = requireSession(req);
    const body = chatMuteSchema.parse(req.body);
    return muteAccount(deps, s, actorOf(req, s), body);
  });
}
