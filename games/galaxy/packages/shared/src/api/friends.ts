import type { PlayerLook } from './cosmetics';
import { z } from 'zod';
import { usernameSchema } from '../account';
import type { CoopOutcome } from './coop';
import type { RoomInvite, RoomView } from './rooms';
import type { RunResult } from './runs';
import type { ShopPurchaseView } from './shop';

// Friends, blocks, presence and the live socket (multiplayer plan, phase 3). Friendship is mutual and starts as a
// request; a block works both ways for everything social. Presence is what an account is doing now, shown to its
// friends only (and not at all when it hides its status). The live socket pushes what changes; reading and acting
// are plain HTTP.

export const friendRequestSchema = z.object({ username: usernameSchema }).strict();
export const friendParamSchema = z.object({ username: usernameSchema }).strict();

export const INVITE_POLICIES = ['everyone', 'friends', 'nobody'] as const;
export type InvitePolicy = (typeof INVITE_POLICIES)[number];

export const socialPrefsSchema = z.object({ invites: z.enum(INVITE_POLICIES), showStatus: z.boolean() }).strict();
export type SocialPrefs = z.infer<typeof socialPrefsSchema>;

/** What an account is doing, as its friends see it. */
export const ACTIVITIES = ['hub', 'hangar', 'room', 'run'] as const;
export type Activity = (typeof ACTIVITIES)[number];

export type Presence =
  | { status: 'offline' }
  | { status: 'online'; activity: Activity; room?: { size: number; max: number; code?: string }; layer?: number };

export interface FriendEntry extends PlayerLook {
  username: string;
  level: number;
  /** Its clan's tag, if any. */
  clan: string | null;
  presence: Presence;
  since: string;
}

export interface FriendRequestEntry {
  username: string;
  level: number;
  at: string;
}

export interface FriendsView {
  friends: FriendEntry[];
  /** Requests to me, and mine waiting for an answer. */
  incoming: FriendRequestEntry[];
  outgoing: FriendRequestEntry[];
  blocked: { username: string; at: string }[];
  prefs: SocialPrefs;
  /** How many friends an account may have (live config `social.maxFriends`). */
  max: number;
}

/** Between me and someone else (a profile's buttons). */
export type FriendRelation = 'none' | 'friends' | 'incoming' | 'outgoing' | 'blocked' | 'blocked_by';

/** The live socket, server → client. */
export type LiveEvent =
  | { type: 'hello'; friends: FriendsView }
  /** A friend's presence changed. */
  | { type: 'presence'; username: string; presence: Presence }
  /** Something in my friends changed (a request, an answer, a removal, a block): read the list again. */
  | { type: 'friends'; reason: 'request' | 'accepted' | 'removed' | 'declined' | 'blocked'; username: string }
  /** My room as it is now (plan phase 5), or null when I am out of it (left, kicked, closed: `why`). */
  | { type: 'room'; room: RoomView | null; why?: 'kicked' | 'closed' }
  /** Someone invites me to their room. */
  | { type: 'invite'; invite: RoomInvite }
  /** A group run I had left (or lost) ended: what it paid me (phase 6c). */
  | { type: 'coopResult'; outcome: CoopOutcome; result: RunResult }
  /** A purchase of the resource shop was delivered (shop and lab plan, F4): the celebration starts. */
  | { type: 'purchase'; purchase: ShopPurchaseView };

/** The live socket, client → server: what I am doing now. */
export const liveMessageSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('activity'), activity: z.enum(ACTIVITIES), layer: z.number().int().min(1).max(999).optional() }).strict(),
]);
export type LiveMessage = z.infer<typeof liveMessageSchema>;
