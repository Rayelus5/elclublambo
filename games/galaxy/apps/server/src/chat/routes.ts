import {
  type ChatHistory,
  chatChannelParamSchema,
  chatHistoryQuerySchema,
  type ChatMessage,
  chatMessageParamSchema,
  chatMuteSchema,
  chatReportSchema,
  chatSendSchema,
} from '@galaxy/shared';
import type { FastifyInstance } from 'fastify';
import { requireSession } from '../auth/guards';
import { hitRateLimit } from '../ratelimit';
import { isAllowedOrigin } from '../security/origin';
import { type ChatDeps, chatHistory, hideMessage, muteAccount, reportMessage, sendMessage } from './service';

// The chats' routes (GDD §14.4; M5b-2). Reading and sending are plain HTTP; the socket only pushes. It opens with the
// session cookie from one of our own origins, or closes at once: 4401 without a session, 4403 from another origin.

export function registerChatRoutes(api: FastifyInstance, deps: ChatDeps & { origins: string[] }): void {
  api.get('/galaxy/api/chat/ws', { websocket: true }, (socket, req) => {
    if (!isAllowedOrigin(req.headers.origin, deps.origins)) return socket.close(4403, 'origin');
    if (!req.session) return socket.close(4401, 'session');
    deps.hub.add(socket, req.session.accountId);
  });

  api.get('/galaxy/api/chat/:channel', async (req): Promise<ChatHistory> => {
    const s = requireSession(req);
    const { channel } = chatChannelParamSchema.parse(req.params);
    const { before } = chatHistoryQuerySchema.parse(req.query);
    return chatHistory(deps, s, channel, before);
  });

  api.post('/galaxy/api/chat/:channel/messages', async (req): Promise<ChatMessage> => {
    const s = requireSession(req);
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
    return hideMessage(deps, s, id);
  });

  api.post('/galaxy/api/chat/mutes', async (req): Promise<{ until: string }> => {
    const s = requireSession(req);
    const body = chatMuteSchema.parse(req.body);
    return muteAccount(deps, s, body);
  });
}
