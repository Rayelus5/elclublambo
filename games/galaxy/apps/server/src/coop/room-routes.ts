import {
  type LiveEvent,
  roomCodeSchema,
  roomCreateSchema,
  roomKindSchema,
  roomReadySchema,
  roomSectorSchema,
  type RoomsView,
  roomTargetSchema,
  type RoomView,
  sectorStatus,
} from '@galaxy/shared';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { type Kysely, sql } from 'kysely';
import { type AuditActor, writeAudit } from '../audit';
import { requireSession, requireStaff } from '../auth/guards';
import type { ConfigReader } from '../config/reader';
import type { DB } from '../db/schema';
import { inTransaction } from '../db/tx';
import { HttpError } from '../errors';
import type { LiveHub } from '../realtime/live-hub';
import { Buckets } from '../realtime/bucket';
import { ensureHangar, sectorStats } from '../runs/hangar';
import { clientIp } from '../security/client-ip';
import { areFriends, blockedBetween, prefsOf } from '../social/friends';
import { accountLevel } from '../social/progress';
import { type MemberInit, type Room, RoomManager } from './rooms';
import type { CoopService } from './service';

// Rooms' routes (multiplayer plan, phase 5). Every action is HTTP and answers with my room as it is now; every member
// learns the change through its live socket, and so do the friends watching their presence («in a room, 2/4»). Who
// may play together is checked here: co-op open (switch, tutorial done, level), the leader's sectors, friends-only
// rooms, blocks both ways with anyone in the room, and the invitee's privacy. Launching starts the room's co-op run
// (phase 6, coop/service.ts); when it ends the room waits again, nobody ready.

export type RoomDeps = { db: Kysely<DB>; config: ConfigReader; live: LiveHub; rooms: Rooms; coop: CoopService; trustCfIp: boolean };

/**
 * The rooms and how their limits follow the live config (read again on every sweep, every 30 s). `memberChanged` is
 * for the rest of the API: a member's probe changed in the hangar, so the room (if any) shows it to everyone in it.
 */
export type Rooms = { manager: RoomManager; refresh: () => Promise<void>; memberChanged: (accountId: string, patch: Partial<Pick<MemberInit, 'probe' | 'level'>>) => Promise<void> };

export function createRooms(config: ConfigReader): Rooms {
  const cfg = { maxRooms: 500, idleMs: 30 * 60_000 };
  const refresh = async () => {
    const c = await config.get('coop');
    cfg.maxRooms = c.maxRooms;
    cfg.idleMs = c.lobbyIdleMinutes * 60_000;
  };
  void refresh().catch(() => {});
  // Nobody to tell until the routes are registered (registerRoomRoutes sets it).
  return { manager: new RoomManager({ maxRooms: () => cfg.maxRooms, idleMs: () => cfg.idleMs }), refresh, memberChanged: async () => {} };
}

export function registerRoomRoutes(api: FastifyInstance, deps: RoomDeps): void {
  const { db, live } = deps;
  const rooms = deps.rooms.manager;
  const buckets = new Buckets();
  const online = (id: string) => live.isOnline(id);

  const coopOpen = async () => (await deps.config.get('features')).coop;

  /**
   * Whoever left `abandonLimit` group runs on purpose within the window waits `abandonWaitMinutes` after the last one
   * (phase 6c): until when, or null.
   */
  async function abandonWait(accountId: string, coop: { abandonLimit: number; abandonWindowMinutes: number; abandonWaitMinutes: number }): Promise<Date | null> {
    if (coop.abandonLimit <= 0) return null;
    const r = await db
      .selectFrom('galaxy.runs')
      .select([sql<number>`count(*)::int`.as('n'), sql<Date | null>`max(left_at)`.as('last')])
      .where('account_id', '=', accountId)
      .where('left_at', '>', sql<Date>`now() - make_interval(mins => ${coop.abandonWindowMinutes}::int)`)
      .executeTakeFirst();
    if (!r || r.n < coop.abandonLimit || !r.last) return null;
    const until = new Date(new Date(r.last).getTime() + coop.abandonWaitMinutes * 60_000);
    return until.getTime() > Date.now() ? until : null;
  }

  /** Whether an account may play in a group, and why not. */
  async function allowance(accountId: string): Promise<{ allowed: boolean; reason: RoomsView['reason']; minLevel: number; waitUntil: string | null }> {
    const [features, coop, account] = await Promise.all([deps.config.get('features'), deps.config.get('coop'), deps.config.get('account')]);
    if (!features.coop) return { allowed: false, reason: 'disabled', minLevel: coop.minLevel, waitUntil: null };
    const t = await db.selectFrom('galaxy.tutorial').select(['done_at', 'skipped_at']).where('account_id', '=', accountId).executeTakeFirst();
    const played = t ? null : await db.selectFrom('galaxy.runs').select('id').where('account_id', '=', accountId).where('finished_at', 'is not', null).limit(1).executeTakeFirst();
    const tutorialDone = t ? t.done_at !== null || t.skipped_at !== null : played !== undefined;
    if (!tutorialDone) return { allowed: false, reason: 'tutorial', minLevel: coop.minLevel, waitUntil: null };
    if ((await accountLevel(db, accountId, account)) < coop.minLevel) return { allowed: false, reason: 'level', minLevel: coop.minLevel, waitUntil: null };
    const wait = await abandonWait(accountId, coop);
    if (wait) return { allowed: false, reason: 'abandons', minLevel: coop.minLevel, waitUntil: wait.toISOString() };
    return { allowed: true, reason: null, minLevel: coop.minLevel, waitUntil: null };
  }

  async function mustPlay(accountId: string): Promise<void> {
    const a = await allowance(accountId);
    if (a.allowed) return;
    if (a.reason === 'abandons') throw new HttpError(403, 'coop_wait', { until: a.waitUntil });
    throw new HttpError(403, a.reason === 'disabled' ? 'coop_disabled' : a.reason === 'tutorial' ? 'coop_tutorial' : 'coop_level', a.reason === 'level' ? { minLevel: a.minLevel } : {});
  }

  async function memberOf(s: { accountId: string; username: string }): Promise<MemberInit> {
    const [level, hangar] = await Promise.all([accountLevel(db, s.accountId, await deps.config.get('account')), ensureHangar(db, s.accountId)]);
    return { accountId: s.accountId, username: s.username, level, probe: hangar.probe };
  }

  async function sectorOpenTo(accountId: string, sector: string): Promise<boolean> {
    const [content, sectors] = await Promise.all([deps.config.get('content'), deps.config.get('sectors')]);
    const def = content.sectors.find((x) => x.id === sector);
    if (!def) return false;
    return sectorStatus(def, await sectorStats(db, accountId), sectors).unlocked;
  }

  async function blockedWithRoom(accountId: string, room: Room): Promise<boolean> {
    for (const m of room.members) {
      const b = await blockedBetween(db, accountId, m.accountId);
      if (b.mine || b.theirs) return true;
    }
    return false;
  }

  /** Everyone in the room sees it as it is now; friends see their presence change. */
  async function tell(room: Room, extra: { accountId: string; why?: 'kicked' | 'closed' }[] = []): Promise<void> {
    const open = await coopOpen();
    // A closed room only reaches its members through `extra` (with why it closed).
    if (room.state !== 'ended') {
      const view = rooms.view(room, online, open);
      for (const m of room.members) live.send(m.accountId, { type: 'room', room: view } satisfies LiveEvent);
    }
    for (const x of extra) live.send(x.accountId, { type: 'room', room: null, ...(x.why ? { why: x.why } : {}) } satisfies LiveEvent);
    await Promise.all([...room.members.map((m) => live.announce(m.accountId)), ...extra.map((x) => live.announce(x.accountId))]);
  }

  // A member chose another probe in the hangar: the room's waiting players see it now, not at the next Listo.
  deps.rooms.memberChanged = async (accountId, patch) => {
    const room = rooms.refresh(accountId, patch);
    if (room && room.state === 'lobby') await tell(room);
  };

  // A run ended: its room waits again (if it is still open) and its members learn it.
  deps.coop.onRunEnded = async (roomId, runId) => {
    const room = rooms.byId(roomId);
    // Only the room's own run sends it back to waiting (an older one ending late changes nothing).
    if (!room || room.runId !== runId) return;
    rooms.backToLobby(room);
    await tell(room);
  };

  const mine = async (accountId: string): Promise<RoomView | null> => {
    const room = rooms.roomOf(accountId);
    return room ? rooms.view(room, online, await coopOpen()) : null;
  };

  /** Room actions: a few per second per account. */
  function pace(req: FastifyRequest, accountId: string): void {
    if (!buckets.take(`room:${accountId}`, 5, 10)) throw new HttpError(429, 'rate_limited');
    void req;
  }

  // The lobbies sweep: idle lobbies close, members long offline leave.
  const sweep = setInterval(() => {
    void (async () => {
      await deps.rooms.refresh();
      const r = rooms.sweep(online);
      for (const room of r.closed) await tell(room, room.members.map((m) => ({ accountId: m.accountId, why: 'closed' as const })));
      for (const d of r.dropped) await tell(d.room, [{ accountId: d.accountId }]);
    })().catch(() => {});
  }, 30_000);
  sweep.unref();
  api.addHook('onClose', async () => clearInterval(sweep));

  api.get('/galaxy/api/rooms', async (req): Promise<RoomsView> => {
    const s = requireSession(req);
    const [a, me] = await Promise.all([allowance(s.accountId), mine(s.accountId)]);
    const open: RoomsView['open'] = [];
    for (const room of rooms.open()) {
      if (open.length >= 30) break;
      if (await blockedWithRoom(s.accountId, room)) continue;
      open.push(rooms.publicView(room));
    }
    return { mine: me, open, allowed: a.allowed, reason: a.reason, minLevel: a.minLevel, waitUntil: a.waitUntil };
  });

  api.post('/galaxy/api/rooms', async (req): Promise<RoomView> => {
    const s = requireSession(req);
    pace(req, s.accountId);
    const { kind, sector } = roomCreateSchema.parse(req.body);
    await mustPlay(s.accountId);
    if (!(await sectorOpenTo(s.accountId, sector))) throw new HttpError(409, 'sector_locked');
    const room = rooms.create(await memberOf(s), kind, sector);
    await tell(room);
    return (await mine(s.accountId))!;
  });

  api.post('/galaxy/api/rooms/join', async (req): Promise<RoomView> => {
    const s = requireSession(req);
    pace(req, s.accountId);
    const { code } = roomCodeSchema.parse(req.body);
    await mustPlay(s.accountId);
    if (!buckets.take(`room-code:${s.accountId}`, 10 / 60, 10)) throw new HttpError(429, 'rate_limited');
    const room = rooms.byCodeOf(code);
    if (!room) throw new HttpError(404, 'room_not_found');
    if (room.kind === 'friends' && !(await areFriends(db, s.accountId, room.leader))) throw new HttpError(403, 'room_forbidden');
    if (await blockedWithRoom(s.accountId, room)) throw new HttpError(403, 'room_forbidden');
    rooms.join(room, await memberOf(s));
    await tell(room);
    return (await mine(s.accountId))!;
  });

  // Entrar rápido: the fullest public lobby I may join, or a new public room with my hangar's sector.
  api.post('/galaxy/api/rooms/quick', async (req): Promise<RoomView> => {
    const s = requireSession(req);
    pace(req, s.accountId);
    await mustPlay(s.accountId);
    if (rooms.roomOf(s.accountId)) throw new HttpError(409, 'room_already');
    const me = await memberOf(s);
    for (const room of rooms.open()) {
      if (await blockedWithRoom(s.accountId, room)) continue;
      rooms.join(room, me);
      await tell(room);
      return (await mine(s.accountId))!;
    }
    const hangar = await ensureHangar(db, s.accountId);
    const content = await deps.config.get('content');
    const sector = (await sectorOpenTo(s.accountId, hangar.sector)) ? hangar.sector : content.sectors[0]!.id;
    const room = rooms.create(me, 'public', sector);
    await tell(room);
    return (await mine(s.accountId))!;
  });

  api.post('/galaxy/api/rooms/leave', async (req): Promise<{ left: true }> => {
    const s = requireSession(req);
    const runId = rooms.roomOf(s.accountId)?.runId;
    const r = rooms.leave(s.accountId);
    // Out of the room while its run plays: out of the run for good.
    if (runId) deps.coop.leaveRun(runId, s.accountId);
    if (r) await tell(r.room, [{ accountId: s.accountId }]);
    return { left: true };
  });

  api.post('/galaxy/api/rooms/ready', async (req): Promise<RoomView> => {
    const s = requireSession(req);
    pace(req, s.accountId);
    const { ready } = roomReadySchema.parse(req.body);
    // The probe may have changed in the hangar since joining.
    rooms.refresh(s.accountId, { probe: (await ensureHangar(db, s.accountId)).probe });
    const room = rooms.setReady(s.accountId, ready);
    await tell(room);
    return (await mine(s.accountId))!;
  });

  api.post('/galaxy/api/rooms/sector', async (req): Promise<RoomView> => {
    const s = requireSession(req);
    pace(req, s.accountId);
    const { sector } = roomSectorSchema.parse(req.body);
    if (!(await sectorOpenTo(s.accountId, sector))) throw new HttpError(409, 'sector_locked');
    const room = rooms.setSector(s.accountId, sector);
    await tell(room);
    return (await mine(s.accountId))!;
  });

  api.post('/galaxy/api/rooms/kind', async (req): Promise<RoomView> => {
    const s = requireSession(req);
    pace(req, s.accountId);
    const { kind } = roomKindSchema.parse(req.body);
    const room = rooms.setKind(s.accountId, kind);
    await tell(room);
    return (await mine(s.accountId))!;
  });

  api.post('/galaxy/api/rooms/kick', async (req): Promise<RoomView> => {
    const s = requireSession(req);
    pace(req, s.accountId);
    const { username } = roomTargetSchema.parse(req.body);
    const { room, kicked } = rooms.kick(s.accountId, username);
    await tell(room, [{ accountId: kicked.accountId, why: 'kicked' }]);
    return (await mine(s.accountId))!;
  });

  api.post('/galaxy/api/rooms/lead', async (req): Promise<RoomView> => {
    const s = requireSession(req);
    pace(req, s.accountId);
    const { username } = roomTargetSchema.parse(req.body);
    const room = rooms.lead(s.accountId, username);
    await tell(room);
    return (await mine(s.accountId))!;
  });

  // An invite reaches the one invited only if it is online, accepts invites from me (its privacy) and nobody blocked
  // the other; otherwise it is refused without saying which.
  api.post('/galaxy/api/rooms/invite', async (req): Promise<{ sent: true }> => {
    const s = requireSession(req);
    const { username } = roomTargetSchema.parse(req.body);
    const room = rooms.roomOf(s.accountId);
    if (!room) throw new HttpError(404, 'room_not_found');
    const cfg = await deps.config.get('coop');
    if (!buckets.take(`invite:${s.accountId}`, cfg.invitesPerMinute / 60, cfg.invitesPerMinute)) throw new HttpError(429, 'rate_limited');
    const target = await db.selectFrom('galaxy.accounts').select(['id', 'username']).where('username', '=', username).executeTakeFirst();
    if (!target || target.id === s.accountId) throw new HttpError(404, 'player_not_found');
    if (!buckets.take(`invite:${s.accountId}:${target.id}`, 3 / 600, 3)) throw new HttpError(429, 'rate_limited');
    const blocks = await blockedBetween(db, s.accountId, target.id);
    const prefs = await prefsOf(db, target.id);
    let accepts = prefs.invites === 'everyone';
    if (prefs.invites === 'friends') {
      const sameClan = await db
        .selectFrom('galaxy.clan_members as a')
        .innerJoin('galaxy.clan_members as b', 'a.clan_id', 'b.clan_id')
        .select('a.clan_id')
        .where('a.account_id', '=', s.accountId)
        .where('b.account_id', '=', target.id)
        .executeTakeFirst();
      accepts = (await areFriends(db, s.accountId, target.id)) || sameClan !== undefined;
    }
    if (blocks.mine || blocks.theirs || !accepts) throw new HttpError(409, 'invite_refused');
    if (!live.isOnline(target.id)) throw new HttpError(409, 'invite_offline');
    live.send(target.id, { type: 'invite', invite: { from: s.username, code: room.code, sector: room.sector, kind: room.kind, size: room.members.length } });
    return { sent: true };
  });

  // Launching (phase 6): the leader, everyone ready, the sector still open to the leader; the room plays its run.
  // The room is marked at once, so a second press (or a second tab) never launches twice.
  api.post('/galaxy/api/rooms/start', async (req): Promise<RoomView> => {
    const s = requireSession(req);
    pace(req, s.accountId);
    const room = rooms.roomOf(s.accountId);
    if (!room) throw new HttpError(404, 'room_not_found');
    if (room.leader !== s.accountId) throw new HttpError(403, 'room_not_leader');
    if (room.state !== 'lobby') throw new HttpError(409, 'room_started');
    if (!rooms.view(room, online, true).canStart) throw new HttpError(409, 'room_not_ready');
    // Marked before anything waits: a second press (or tab) meanwhile is refused, never launched twice.
    room.state = 'starting';
    try {
      await mustPlay(s.accountId);
      if (!(await sectorOpenTo(s.accountId, room.sector))) throw new HttpError(409, 'sector_locked');
      const runId = await deps.coop.launch(room);
      rooms.launch(room, runId);
    } catch (err) {
      if (room.state === 'starting') room.state = 'lobby';
      throw err;
    }
    await tell(room);
    return (await mine(s.accountId))!;
  });

  // The admin's live rooms (plan phase 5): every room now, and closing one (audited).
  api.get('/galaxy/api/admin/rooms', async (req) => {
    requireStaff(req);
    return {
      rooms: rooms.all().map((r) => ({
        ...rooms.view(r, online, true),
        idleSeconds: Math.round((Date.now() - r.touchedAt) / 1000),
      })),
    };
  });

  api.post('/galaxy/api/admin/rooms/:code/close', async (req): Promise<{ closed: true }> => {
    const staff = requireStaff(req);
    const { code } = roomCodeSchema.parse(req.params);
    const reason = String((req.body as { reason?: unknown } | undefined)?.reason ?? '').trim().slice(0, 500);
    if (reason.length < 3) throw new HttpError(400, 'invalid_input');
    const room = rooms.byCodeOf(code);
    if (!room) throw new HttpError(404, 'room_not_found');
    const actor: AuditActor = { id: staff.accountId, label: staff.username, ip: clientIp(req, deps.trustCfIp) };
    const members = room.members.map((m) => m.username);
    // Closing a room that plays ends its run: everyone leaves it (and is paid as abandoned).
    if (room.runId) for (const m of room.members) deps.coop.leaveRun(room.runId, m.accountId);
    rooms.close(room);
    await inTransaction(db, (trx) => writeAudit(trx, { actor, action: 'room.close', targetType: 'room', targetId: code, before: { members, sector: room.sector, kind: room.kind }, reason }));
    await tell(room, room.members.map((m) => ({ accountId: m.accountId, why: 'closed' as const })));
    return { closed: true };
  });
}
