import type { PlayerLook } from './cosmetics';
import { z } from 'zod';
import { usernameSchema } from '../account';

// Rooms for co-op runs (multiplayer plan, phase 5). A room gathers up to four players before a run: public (listed,
// and «Entrar rápido» finds one), private (by code or invite) or friends-only (the leader's friends). The leader picks
// the sector among the ones they have unlocked, can kick and hand the lead over, and launches when everyone is ready.
// Actions are HTTP; the live socket pushes the room to its members and invites to whoever is invited.

export const ROOM_KINDS = ['public', 'private', 'friends'] as const;
export type RoomKind = (typeof ROOM_KINDS)[number];
export const ROOM_MAX = 4;
/** A group run needs company (2026-11-17, the owner): alone in a room, the player is sent to solo mode instead. */
export const ROOM_MIN = 2;

/**
 * Why a room cannot launch yet, or null: `alone` while it has fewer than two players, `ready` while a mate has not
 * said «Listo» (the leader launches, it needs none). A mate whose connection drops still counts: a blip must not block
 * the launch, the lobby sweep takes out whoever stays gone, and the run's start waits for everyone to connect.
 * `adminAlone`: the leader is an admin (with TOTP), who may launch alone to try changes (the owner, 2026-11-27); the run
 * pays and counts like any group run.
 */
export function roomStartBlock(members: readonly { ready: boolean; leader: boolean }[], opts: { adminAlone?: boolean } = {}): 'alone' | 'ready' | null {
  if (members.length < ROOM_MIN && !(opts.adminAlone && members.length === 1)) return 'alone';
  if (!members.every((m) => m.ready || m.leader)) return 'ready';
  return null;
}

/** A room code: six letters and digits without the ones that look alike (0/O, 1/I/L). */
export const ROOM_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const code = z
  .string()
  .transform((s) => s.trim().toUpperCase())
  .pipe(z.string().regex(/^[A-HJ-KM-NP-Z2-9]{6}$/));
const sector = z.string().regex(/^[a-z0-9-]{1,32}$/);

export const roomCreateSchema = z.object({ kind: z.enum(ROOM_KINDS), sector }).strict();
export const roomCodeSchema = z.object({ code }).strict();
export const roomSectorSchema = z.object({ sector }).strict();
export const roomKindSchema = z.object({ kind: z.enum(ROOM_KINDS) }).strict();
export const roomReadySchema = z.object({ ready: z.boolean() }).strict();
export const roomTargetSchema = z.object({ username: usernameSchema }).strict();

export type RoomState = 'lobby' | 'starting' | 'running' | 'ended';

export interface RoomMember extends PlayerLook {
  username: string;
  level: number;
  /** The probe it will fly (its hangar's choice), and the skin it wears (null: the base drawing). */
  probe: string;
  skin: string | null;
  ready: boolean;
  /** Its live socket is open. */
  connected: boolean;
  leader: boolean;
}

export interface RoomView {
  id: string;
  code: string;
  kind: RoomKind;
  leader: string;
  sector: string;
  state: RoomState;
  members: RoomMember[];
  max: number;
  createdAt: string;
  /** Whether the leader may launch now (two or more connected, everyone ready, co-op runs open). */
  canStart: boolean;
  /** The run it is playing (phase 6), while it lasts. */
  run: { id: string } | null;
}

/** A public room in the list. */
export interface PublicRoom {
  code: string;
  sector: string;
  leader: string;
  size: number;
  max: number;
  /** Levels of the players in it (lowest, highest). */
  levels: [number, number];
  createdAt: string;
}

export interface RoomsView {
  /** The room I am in, if any. */
  mine: RoomView | null;
  /** Rooms open now on the server (waiting or playing) and how many fit at once (live config `coop.maxRooms`). */
  rooms: { count: number; max: number };
  open: PublicRoom[];
  /** Co-op is open to me (the switch, and the tutorial done) and why not. */
  allowed: boolean;
  reason: 'disabled' | 'tutorial' | 'level' | 'abandons' | null;
  minLevel: number;
  /** Left too many group runs lately (phase 6c): when they may play in a group again (ISO), else null. */
  waitUntil: string | null;
}

/** An invite to a room, pushed to the one invited. */
export interface RoomInvite {
  from: string;
  code: string;
  sector: string;
  kind: RoomKind;
  size: number;
}
