import { friendParamSchema, friendRequestSchema, type FriendRelation, type FriendsView, type LiveEvent, liveMessageSchema, socialPrefsSchema } from '@galaxy/shared';
import type { FastifyInstance } from 'fastify';
import type { Kysely } from 'kysely';
import { requireSession } from '../auth/guards';
import type { ConfigReader } from '../config/reader';
import { requireFeature } from '../config/features';
import type { DB } from '../db/schema';
import { inTransaction } from '../db/tx';
import { hitRateLimit } from '../ratelimit';
import type { LiveHub } from '../realtime/live-hub';
import { isAllowedOrigin } from '../security/origin';
import { acceptFriend, blockAccount, endFriendship, type FriendChange, friendsView, relationWith, requestFriend, setPrefs, unblockAccount } from './friends';

// Friends' routes and the live socket (multiplayer plan, phase 3). Every change answers with my whole friends view,
// and the other account learns it through its live socket (a block reads as a removal, never as a block). The socket
// opens with the session cookie from one of our origins (4403 / 4401 otherwise), says hello with the friends view,
// and takes «what I am doing» messages; the rest is HTTP.

export type FriendDeps = { db: Kysely<DB>; config: ConfigReader; live: LiveHub; now: () => Date; origins: string[] };

export function registerFriendRoutes(api: FastifyInstance, deps: FriendDeps): void {
  const view = async (accountId: string): Promise<FriendsView> => {
    const [social, account] = await Promise.all([deps.config.get('social'), deps.config.get('account')]);
    return friendsView(deps.db, { social, account }, accountId, (id) => deps.live.presenceOf(id));
  };

  /** After a change: the other account reads its list again, and both see each other's presence when now friends. */
  const tell = async (me: { accountId: string; username: string }, change: FriendChange): Promise<void> => {
    const event: LiveEvent = { type: 'friends', reason: change.reason === 'blocked' ? 'removed' : change.reason, username: me.username };
    deps.live.send(change.other, event);
    if (change.reason === 'accepted') {
      await Promise.all([deps.live.announce(me.accountId), deps.live.announce(change.other)]);
    }
  };

  api.get('/galaxy/api/live/ws', { websocket: true }, (socket, req) => {
    if (!isAllowedOrigin(req.headers.origin, deps.origins)) return socket.close(4403, 'origin');
    const s = req.session;
    if (!s) return socket.close(4401, 'session');
    deps.live.add(socket, { accountId: s.accountId, username: s.username, sessionId: s.sessionId }, (raw) => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch {
        return;
      }
      const msg = liveMessageSchema.safeParse(parsed);
      if (!msg.success) return;
      if (msg.data.type === 'activity') deps.live.setActivity(s.accountId, { activity: msg.data.activity, ...(msg.data.layer ? { layer: msg.data.layer } : {}) });
      else if (msg.data.type === 'chat') deps.live.setChatOpen(s.accountId, msg.data.open);
    });
    void view(s.accountId)
      .then((friends) => {
        if (socket.readyState === socket.OPEN) socket.send(JSON.stringify({ type: 'hello', friends } satisfies LiveEvent));
      })
      .catch(() => socket.close(1011, 'hello'));
  });

  api.get('/galaxy/api/friends', async (req): Promise<FriendsView> => {
    const s = requireSession(req);
    return view(s.accountId);
  });

  api.get('/galaxy/api/friends/relation/:username', async (req): Promise<{ relation: FriendRelation }> => {
    const s = requireSession(req);
    const { username } = friendParamSchema.parse(req.params);
    return { relation: await relationWith(deps.db, s.accountId, username) };
  });

  api.post('/galaxy/api/friends/requests', async (req): Promise<FriendsView> => {
    const s = requireSession(req);
    await requireFeature(deps.config, 'friends');
    const { username } = friendRequestSchema.parse(req.body);
    const cfg = await deps.config.get('social');
    await hitRateLimit(deps.db, `a:${s.accountId}`, 'friend_request', cfg.requestsPerHour, 3600);
    const change = await inTransaction(deps.db, (trx) => requestFriend(trx, cfg, s.accountId, username, deps.now()));
    await tell(s, change);
    return view(s.accountId);
  });

  api.post('/galaxy/api/friends/:username/accept', async (req): Promise<FriendsView> => {
    const s = requireSession(req);
    await requireFeature(deps.config, 'friends');
    const { username } = friendParamSchema.parse(req.params);
    const cfg = await deps.config.get('social');
    const change = await inTransaction(deps.db, (trx) => acceptFriend(trx, cfg, s.accountId, username, deps.now()));
    await tell(s, change);
    return view(s.accountId);
  });

  // Declines a request, cancels mine or removes a friend: the same pair, the same row.
  api.post('/galaxy/api/friends/:username/remove', async (req): Promise<FriendsView> => {
    const s = requireSession(req);
    const { username } = friendParamSchema.parse(req.params);
    const change = await inTransaction(deps.db, (trx) => endFriendship(trx, s.accountId, username));
    await tell(s, change);
    return view(s.accountId);
  });

  api.post('/galaxy/api/friends/:username/block', async (req): Promise<FriendsView> => {
    const s = requireSession(req);
    const { username } = friendParamSchema.parse(req.params);
    await hitRateLimit(deps.db, `a:${s.accountId}`, 'friend_block', 60, 3600);
    const change = await inTransaction(deps.db, (trx) => blockAccount(trx, s.accountId, username, deps.now()));
    await tell(s, change);
    return view(s.accountId);
  });

  api.post('/galaxy/api/friends/:username/unblock', async (req): Promise<FriendsView> => {
    const s = requireSession(req);
    const { username } = friendParamSchema.parse(req.params);
    await unblockAccount(deps.db, s.accountId, username);
    return view(s.accountId);
  });

  api.put('/galaxy/api/friends/prefs', async (req): Promise<FriendsView> => {
    const s = requireSession(req);
    const prefs = socialPrefsSchema.parse(req.body);
    await setPrefs(deps.db, s.accountId, prefs, deps.now());
    // Showing or hiding the status changes what the friends see at once.
    await deps.live.announce(s.accountId);
    return view(s.accountId);
  });
}
