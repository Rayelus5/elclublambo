import type { ChatEvent } from '@galaxy/shared';
import type { Kysely } from 'kysely';
import type { DB } from '../db/schema';
import { type ChatLive, fanout, HeadBatch } from './fanout';

// The chats' live side (GDD §14.4; M5b-2): who gets each event, on the live socket that is open anywhere in the game
// (since the owner's chat asks, 2026-11-14; the chats' own socket was retired then). A clan's events go to whoever is
// in that clan when they are sent (read then), so leaving a clan stops them at once; a room's, to who is in it now.
// Who hears what in full and who only counts it is chat/fanout.ts. Moderation open on screen hears that something
// came (a message, a report).

export class ChatHub {
  private readonly heads: HeadBatch | null;

  /** `roomMembers`: who is in a room now (the room chat reaches them, phase 6c); `live`: the live socket's hub. */
  constructor(
    private readonly db: Kysely<DB>,
    private readonly roomMembers: (roomId: string) => string[] = () => [],
    private readonly live: ChatLive | null = null,
  ) {
    this.heads = live ? new HeadBatch(live) : null;
  }

  /**
   * Sends an event of `channelKey` ('global', 'clan:<id>' or 'room:<id>') to whoever may read it (`from`: a new
   * message's author and the accounts it names).
   */
  async broadcast(channelKey: string, event: ChatEvent, from?: { authorId: string; named?: readonly string[] }): Promise<void> {
    if (!this.live) return;
    let allowed: Set<string> | null = null;
    if (channelKey.startsWith('room:')) allowed = new Set(this.roomMembers(channelKey.slice(5)));
    else if (channelKey.startsWith('clan:')) {
      const rows = await this.db.selectFrom('galaxy.clan_members').select('account_id').where('clan_id', '=', channelKey.slice(5)).execute();
      allowed = new Set(rows.map((r) => r.account_id));
    }
    await this.toLive(channelKey, allowed, event, from);
  }

  /** A message to its readers (chat/fanout.ts), a take-down to who may have it on screen. */
  private async toLive(channelKey: string, allowed: Set<string> | null, event: ChatEvent, from?: { authorId: string; named?: readonly string[] }): Promise<void> {
    const live = this.live!;
    const readers = allowed ?? live.onlineIds();
    if (event.type === 'deleted') {
      const to = allowed ? [...allowed] : [...readers].filter((id) => live.chatOpenOf(id) === 'global');
      live.sendMany(to, { type: 'chatDeleted', channel: event.channel, id: event.id });
      return;
    }
    const m = event.message;
    // Moderation open on screen hears that the chat has something new (it reads it when the moderator asks).
    const staff = live.modWatchers?.() ?? [];
    if (staff.length > 0) live.sendMany(staff, { type: 'modChat', channel: channelKey });
    const authorId = from?.authorId ?? '';
    const blockers = authorId
      ? new Set((await this.db.selectFrom('galaxy.blocks').select('blocker').where('blocked', '=', authorId).execute()).map((r) => r.blocker))
      : new Set<string>();
    const split = fanout({ channel: m.channel, authorId }, readers, (id) => live.chatOpenOf(id), blockers, new Set(from?.named ?? []));
    live.sendMany(split.full, { type: 'chat', message: m });
    live.sendMany(split.mentioned, { type: 'chat', message: m, mention: true });
    if (split.counted.length > 0) this.heads?.add(m);
  }

  /** A new report: moderation open on screen reads its queue again. */
  reported(): void {
    const staff = this.live?.modWatchers?.() ?? [];
    if (staff.length > 0) this.live!.sendMany(staff, { type: 'modReport' });
  }

  close(): void {
    this.heads?.close();
  }
}
