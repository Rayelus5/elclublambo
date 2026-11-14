import { z } from 'zod';
import { usernameSchema } from '../account';

// The chats' API (GDD §14.4; M5b-2): the history of a channel and whether the viewer can write in it, sending,
// reporting, and what the socket pushes (a new message or one taken down). Moderators hide messages and mute accounts.

export const CHAT_CHANNELS = ['global', 'clan', 'room'] as const;
export type ChatChannel = (typeof CHAT_CHANNELS)[number];

export interface ChatMessage {
  id: string;
  channel: ChatChannel;
  author: { username: string; level: number; clan: string | null; avatar?: string | null; frame?: string | null };
  body: string;
  /** When it was sent (ISO). */
  at: string;
}

export interface ChatHistory {
  channel: ChatChannel;
  /** Oldest first. */
  messages: ChatMessage[];
  canWrite: boolean;
  /** Why not: the account level, or a mute until `mutedUntil`. */
  reason: 'level' | 'muted' | null;
  mutedUntil?: string;
  /** The level writing needs. */
  minLevel: number;
  /** The most characters a message keeps. */
  maxLength: number;
  /** The viewer can hide messages and mute accounts. */
  moderator: boolean;
}

export type ChatEvent = { type: 'message'; message: ChatMessage } | { type: 'deleted'; channel: ChatChannel; id: string };

/** What is sent; the server cleans it and checks it against `chat.maxLength`. */
export const chatSendSchema = z.object({ body: z.string().max(2000) }).strict();
export const chatChannelParamSchema = z.object({ channel: z.enum(CHAT_CHANNELS) }).strict();
export const chatHistoryQuerySchema = z.object({ before: z.string().regex(/^\d{1,18}$/).optional() }).strict();
export const chatMessageParamSchema = z.object({ id: z.string().regex(/^\d{1,18}$/) }).strict();
export const chatReportSchema = z.object({ reason: z.string().max(140).optional() }).strict();
export const chatMuteSchema = z
  .object({ username: usernameSchema, minutes: z.number().int().min(1).max(43_200), reason: z.string().trim().min(1).max(140) })
  .strict();

/** The most a channel's unread count says (the badge shows «99+» beyond). */
export const CHAT_UNREAD_CAP = 99;

/**
 * GET /chat/unread (the owner's chat asks, 2026-11-14): the messages by others in each of my channels since I last read
 * it, 99 at most, and how many of them name me. `clan` and `room` are null when I am in none.
 */
export interface ChatUnread {
  global: number;
  clan: number | null;
  room: number | null;
  mentions: Record<ChatChannel, number>;
}

/** POST /chat/read: I have read a channel up to this message (it only moves forward). */
export const chatReadSchema = z.object({ channel: z.enum(CHAT_CHANNELS), id: z.string().regex(/^\d{1,18}$/) }).strict();

/** GET /chat/mentions?q=: players whose name starts like this (two letters at least), for the mention box. */
export const chatMentionQuerySchema = z
  .object({
    q: z
      .string()
      .transform((s) => s.trim().toLowerCase())
      .pipe(z.string().regex(/^[a-z0-9_]{2,20}$/)),
  })
  .strict();
export interface ChatMentionCandidate {
  username: string;
  avatar?: string | null;
  frame?: string | null;
}
