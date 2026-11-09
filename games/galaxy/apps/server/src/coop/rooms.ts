import { randomBytes, randomUUID } from 'node:crypto';
import { type PublicRoom, ROOM_CODE_ALPHABET, ROOM_MAX, type RoomKind, type RoomState, type RoomView } from '@galaxy/shared';
import { HttpError } from '../errors';

// The rooms of co-op runs (multiplayer plan, phase 5), in memory like the live hub: the beta runs one container, and
// a deploy closes the lobbies (their players are told by the live socket going down, and make a new one). This is
// the rooms' state and their rules only; who may join (friends, blocks, levels, sectors) is checked by the service
// against the database before calling in. An account is in one room at most. The leader is the oldest member; when it
// leaves, the next oldest leads. A lobby nobody touched in a while, or left empty, closes.

export interface MemberInit {
  accountId: string;
  username: string;
  level: number;
  probe: string;
}

interface Member extends MemberInit {
  ready: boolean;
  joinedAt: number;
  /** Last time its live socket was seen open (the sweep drops the long gone). */
  seenAt: number;
}

export interface Room {
  id: string;
  code: string;
  kind: RoomKind;
  leader: string;
  sector: string;
  state: RoomState;
  members: Member[];
  createdAt: number;
  touchedAt: number;
  /** The co-op run it is playing (phase 6), while it lasts. */
  runId: string | null;
}

export interface RoomManagerOptions {
  now?: () => number;
  maxRooms: () => number;
  idleMs: () => number;
  /** How long a member may stay offline before the sweep takes it out of a lobby. */
  offlineMs?: number;
}

function newCode(): string {
  const bytes = randomBytes(6);
  let s = '';
  for (let k = 0; k < 6; k++) s += ROOM_CODE_ALPHABET[bytes[k]! % ROOM_CODE_ALPHABET.length];
  return s;
}

export class RoomManager {
  private readonly rooms = new Map<string, Room>();
  private readonly byCode = new Map<string, string>();
  private readonly byAccount = new Map<string, string>();
  private readonly now: () => number;

  constructor(private readonly opts: RoomManagerOptions) {
    this.now = opts.now ?? Date.now;
  }

  roomOf(accountId: string): Room | null {
    const id = this.byAccount.get(accountId);
    return id ? (this.rooms.get(id) ?? null) : null;
  }

  byId(id: string): Room | null {
    return this.rooms.get(id) ?? null;
  }

  byCodeOf(code: string): Room | null {
    const id = this.byCode.get(code.toUpperCase());
    return id ? (this.rooms.get(id) ?? null) : null;
  }

  all(): Room[] {
    return [...this.rooms.values()];
  }

  private touch(room: Room): void {
    room.touchedAt = this.now();
  }

  private member(init: MemberInit): Member {
    const t = this.now();
    return { ...init, ready: false, joinedAt: t, seenAt: t };
  }

  create(owner: MemberInit, kind: RoomKind, sector: string): Room {
    if (this.byAccount.has(owner.accountId)) throw new HttpError(409, 'room_already');
    if (this.rooms.size >= this.opts.maxRooms()) throw new HttpError(503, 'room_limit');
    let code = newCode();
    while (this.byCode.has(code)) code = newCode();
    const t = this.now();
    const room: Room = { id: randomUUID(), code, kind, leader: owner.accountId, sector, state: 'lobby', members: [this.member(owner)], createdAt: t, touchedAt: t, runId: null };
    this.rooms.set(room.id, room);
    this.byCode.set(code, room.id);
    this.byAccount.set(owner.accountId, room.id);
    return room;
  }

  join(room: Room, who: MemberInit): Room {
    if (this.byAccount.has(who.accountId)) throw new HttpError(409, 'room_already');
    if (room.state !== 'lobby') throw new HttpError(409, 'room_started');
    if (room.members.length >= ROOM_MAX) throw new HttpError(409, 'room_full');
    room.members.push(this.member(who));
    this.byAccount.set(who.accountId, room.id);
    this.touch(room);
    return room;
  }

  /** Takes an account out of its room; the room closes when it empties. Returns the room (closed or not). */
  leave(accountId: string): { room: Room; closed: boolean } | null {
    const room = this.roomOf(accountId);
    if (!room) return null;
    room.members = room.members.filter((m) => m.accountId !== accountId);
    this.byAccount.delete(accountId);
    if (room.members.length === 0) {
      this.close(room);
      return { room, closed: true };
    }
    if (room.leader === accountId) room.leader = [...room.members].sort((a, b) => a.joinedAt - b.joinedAt)[0]!.accountId;
    this.touch(room);
    return { room, closed: false };
  }

  close(room: Room): void {
    this.rooms.delete(room.id);
    this.byCode.delete(room.code);
    for (const m of room.members) if (this.byAccount.get(m.accountId) === room.id) this.byAccount.delete(m.accountId);
    room.state = 'ended';
  }

  private led(accountId: string): Room {
    const room = this.roomOf(accountId);
    if (!room) throw new HttpError(404, 'room_not_found');
    if (room.leader !== accountId) throw new HttpError(403, 'room_not_leader');
    if (room.state !== 'lobby') throw new HttpError(409, 'room_started');
    return room;
  }

  setReady(accountId: string, ready: boolean): Room {
    const room = this.roomOf(accountId);
    if (!room) throw new HttpError(404, 'room_not_found');
    const m = room.members.find((x) => x.accountId === accountId)!;
    m.ready = ready;
    this.touch(room);
    return room;
  }

  /** The leader changes the sector: everyone's «ready» goes back to waiting. */
  setSector(leader: string, sector: string): Room {
    const room = this.led(leader);
    room.sector = sector;
    for (const m of room.members) m.ready = false;
    this.touch(room);
    return room;
  }

  setKind(leader: string, kind: RoomKind): Room {
    const room = this.led(leader);
    room.kind = kind;
    this.touch(room);
    return room;
  }

  kick(leader: string, username: string): { room: Room; kicked: Member } {
    const room = this.led(leader);
    const kicked = room.members.find((m) => m.username === username && m.accountId !== leader);
    if (!kicked) throw new HttpError(404, 'player_not_found');
    room.members = room.members.filter((m) => m !== kicked);
    this.byAccount.delete(kicked.accountId);
    this.touch(room);
    return { room, kicked };
  }

  lead(leader: string, username: string): Room {
    const room = this.led(leader);
    const next = room.members.find((m) => m.username === username);
    if (!next) throw new HttpError(404, 'player_not_found');
    room.leader = next.accountId;
    this.touch(room);
    return room;
  }

  /** The leader launched (phase 6): the room plays that run; nobody joins until it is over. */
  launch(room: Room, runId: string): void {
    room.state = 'running';
    room.runId = runId;
    this.touch(room);
  }

  /** The run is over: the room waits again, nobody ready (Volver a la sala). */
  backToLobby(room: Room): void {
    if (!this.rooms.has(room.id)) return;
    room.state = 'lobby';
    room.runId = null;
    for (const m of room.members) m.ready = false;
    this.touch(room);
  }

  /** A member's hangar changed (its probe), or its level: the room shows it. */
  refresh(accountId: string, patch: Partial<Pick<Member, 'probe' | 'level'>>): Room | null {
    const room = this.roomOf(accountId);
    if (!room) return null;
    Object.assign(room.members.find((m) => m.accountId === accountId)!, patch);
    return room;
  }

  /** Public lobbies with room left, fullest first, then the oldest (Entrar rápido takes the first allowed). */
  open(): Room[] {
    return this.all()
      .filter((r) => r.kind === 'public' && r.state === 'lobby' && r.members.length < ROOM_MAX)
      .sort((a, b) => b.members.length - a.members.length || a.createdAt - b.createdAt);
  }

  /**
   * Closes lobbies idle for too long and drops members offline for too long (`online` says who has a live socket now).
   * Returns what changed, for the service to tell the members.
   */
  sweep(online: (accountId: string) => boolean): { closed: Room[]; dropped: { room: Room; accountId: string }[] } {
    const t = this.now();
    const offlineMs = this.opts.offlineMs ?? 120_000;
    const closed: Room[] = [];
    const dropped: { room: Room; accountId: string }[] = [];
    for (const room of this.all()) {
      if (room.state !== 'lobby') continue;
      if (t - room.touchedAt > this.opts.idleMs()) {
        closed.push(room);
        this.close(room);
        continue;
      }
      for (const m of [...room.members]) {
        if (online(m.accountId)) m.seenAt = t;
        else if (t - m.seenAt > offlineMs) {
          this.leave(m.accountId);
          dropped.push({ room, accountId: m.accountId });
        }
      }
    }
    return { closed, dropped };
  }

  view(room: Room, online: (accountId: string) => boolean, coopOpen: boolean): RoomView {
    const members = [...room.members].sort((a, b) => a.joinedAt - b.joinedAt);
    return {
      id: room.id,
      code: room.code,
      kind: room.kind,
      leader: members.find((m) => m.accountId === room.leader)?.username ?? '',
      sector: room.sector,
      state: room.state,
      members: members.map((m) => ({ username: m.username, level: m.level, probe: m.probe, ready: m.ready, connected: online(m.accountId), leader: m.accountId === room.leader })),
      max: ROOM_MAX,
      createdAt: new Date(room.createdAt).toISOString(),
      canStart: coopOpen && room.state === 'lobby' && members.length >= 1 && members.every((m) => m.ready || m.accountId === room.leader),
      run: room.runId ? { id: room.runId } : null,
    };
  }

  publicView(room: Room): PublicRoom {
    const levels = room.members.map((m) => m.level);
    return {
      code: room.code,
      sector: room.sector,
      leader: room.members.find((m) => m.accountId === room.leader)?.username ?? '',
      size: room.members.length,
      max: ROOM_MAX,
      levels: [Math.min(...levels), Math.max(...levels)],
      createdAt: new Date(room.createdAt).toISOString(),
    };
  }
}
