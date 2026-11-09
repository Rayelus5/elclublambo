import { z } from 'zod';
import { usernameSchema } from '../account';

// Rooms for co-op runs (multiplayer plan, phase 5). A room gathers up to four players before a run: public (listed,
// and «Entrar rápido» finds one), private (by code or invite) or friends-only (the leader's friends). The leader picks
// the sector among the ones they have unlocked, can kick and hand the lead over, and launches when everyone is ready.
// Actions are HTTP; the live socket pushes the room to its members and invites to whoever is invited.

export const ROOM_KINDS = ['public', 'private', 'friends'] as const;
export type RoomKind = (typeof ROOM_KINDS)[number];
export const ROOM_MAX = 4;

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

export interface RoomMember {
  username: string;
  level: number;
  /** The probe it will fly (its hangar's choice). */
  probe: string;
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
  /** Whether the leader may launch now (everyone ready, co-op runs open). */
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
  open: PublicRoom[];
  /** Co-op is open to me (the switch, and the tutorial done) and why not. */
  allowed: boolean;
  reason: 'disabled' | 'tutorial' | 'level' | null;
  minLevel: number;
}

/** An invite to a room, pushed to the one invited. */
export interface RoomInvite {
  from: string;
  code: string;
  sector: string;
  kind: RoomKind;
  size: number;
}
