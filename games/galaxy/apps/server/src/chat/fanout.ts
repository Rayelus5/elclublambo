import type { ChatChannel, ChatMessage, LiveEvent } from '@galaxy/shared';

// Who hears a chat message on the live socket (the owner's chat asks, 2026-11-14: notices with the chat closed, unread
// dots and counts, mentions). The clan's and the room's messages reach their members in full (a handful of players).
// Comunidad's reach in full only who has it open, its author and whoever it names; everyone else online learns, every
// few seconds, how many came and the latest (`chatHead`), so a busy Comunidad never floods thousands of sockets. Who
// blocked the author hears nothing of it.

/** What the live hub offers the chat. */
export interface ChatLive {
  onlineIds(): Set<string>;
  sendMany(accountIds: Iterable<string>, event: LiveEvent): void;
  chatOpenOf(accountId: string): ChatChannel | null;
}

export interface Fanout {
  /** The message in full. */
  full: string[];
  /** The message in full, saying it names them. */
  mentioned: string[];
  /** Only counted, in the next head (Comunidad, closed). */
  counted: string[];
}

/**
 * Splits the readers of a message: `readers` can read its channel now (Comunidad: everyone online; a clan's or a
 * room's: its members), `open` says what each has open, `blockers` blocked the author, `named` are the accounts it
 * names (only those who can read it count).
 */
export function fanout(m: { channel: ChatChannel; authorId: string }, readers: Iterable<string>, open: (id: string) => ChatChannel | null, blockers: ReadonlySet<string>, named: ReadonlySet<string>): Fanout {
  const out: Fanout = { full: [], mentioned: [], counted: [] };
  for (const id of new Set(readers)) {
    if (blockers.has(id)) continue;
    if (named.has(id) && id !== m.authorId) out.mentioned.push(id);
    else if (m.channel !== 'global' || id === m.authorId || open(id) === 'global') out.full.push(id);
    else out.counted.push(id);
  }
  return out;
}

/** Comunidad's heads: what came while it was closed, sent at most every `everyMs` to whoever does not have it open. */
export class HeadBatch {
  private n = 0;
  private last: string | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly live: ChatLive,
    private readonly everyMs = 3000,
  ) {}

  add(message: ChatMessage): void {
    this.n += 1;
    this.last = message.id;
    if (this.timer) return;
    this.timer = setTimeout(() => this.flush(), this.everyMs);
    this.timer.unref?.();
  }

  flush(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    if (!this.last || this.n === 0) return;
    const event: LiveEvent = { type: 'chatHead', channel: 'global', last: this.last, n: this.n };
    this.n = 0;
    this.last = null;
    const to = [...this.live.onlineIds()].filter((id) => this.live.chatOpenOf(id) !== 'global');
    this.live.sendMany(to, event);
  }

  close(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }
}
