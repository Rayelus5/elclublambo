import type { Activity, ChatChannel, LiveEvent, Presence } from '@galaxy/shared';
import type { WebSocket } from 'ws';

// The live socket's side on the server (multiplayer plan, phase 3): who is connected right now, what each account is
// doing (its presence) and pushing what changes to the accounts it concerns. The beta runs one container, so this is
// memory (a deploy drops every socket and the clients reconnect). An account is online while it has a socket; it
// goes offline a few seconds after its last one closes (a reload does not flicker). Its friends learn each change;
// whom to tell and whether the account hides its status are asked of the database through `deps`.

const MAX_BUFFERED = 1_000_000;
const PING_MS = 25_000;
/** A reload or a dropped connection inside this window does not tell the friends "offline". */
const OFFLINE_GRACE_MS = 8_000;
export const LIVE_SOCKETS_PER_ACCOUNT = 3;
const SOCKETS_TOTAL = 5000;
/** Messages a socket may send per second (activity changes): more closes it with 4429. */
const MESSAGES_PER_SECOND = 10;

interface Client {
  socket: WebSocket;
  accountId: string;
  username: string;
  sessionId: string;
  /** A token bucket for incoming messages. */
  tokens: number;
  at: number;
}

export interface LiveHubDeps {
  /** The accepted friends of an account. */
  friendsOf: (accountId: string) => Promise<string[]>;
  /** Whether an account shows its status to its friends. */
  showsStatus: (accountId: string) => Promise<boolean>;
  /** The room an account is in (plan phase 5): its size, and its code when friends may join it. */
  roomOf?: (accountId: string) => { size: number; max: number; code?: string } | null;
  now?: () => number;
}

type Doing = { activity: Activity; layer?: number; room?: { size: number; max: number } };

export class LiveHub {
  private readonly clients = new Set<Client>();
  private readonly doing = new Map<string, Doing>();
  /** The chat channel each account has open on screen (the owner's chat asks, 2026-11-14). */
  private readonly chatOpen = new Map<string, ChatChannel>();
  private readonly names = new Map<string, string>();
  private readonly leaving = new Map<string, NodeJS.Timeout>();
  private readonly ping: NodeJS.Timeout;
  private readonly now: () => number;

  constructor(private readonly deps: LiveHubDeps) {
    this.now = deps.now ?? Date.now;
    this.ping = setInterval(() => {
      for (const c of this.clients) if (c.socket.readyState === c.socket.OPEN) c.socket.ping();
    }, PING_MS);
    this.ping.unref();
  }

  /** A new socket of a signed-in account. `onMessage` receives its messages once the rate allows them. */
  add(socket: WebSocket, who: { accountId: string; username: string; sessionId: string }, onMessage: (raw: string) => void): void {
    if (this.clients.size >= SOCKETS_TOTAL) {
      socket.close(1013, 'busy');
      return;
    }
    const mine = [...this.clients].filter((c) => c.accountId === who.accountId);
    if (mine.length >= LIVE_SOCKETS_PER_ACCOUNT) {
      this.clients.delete(mine[0]!);
      mine[0]!.socket.close(4008, 'too many');
    }
    const wasOnline = this.isOnline(who.accountId);
    const client: Client = { socket, ...who, tokens: MESSAGES_PER_SECOND, at: this.now() };
    this.clients.add(client);
    this.names.set(who.accountId, who.username);
    const pendingOffline = this.leaving.get(who.accountId);
    if (pendingOffline) {
      clearTimeout(pendingOffline);
      this.leaving.delete(who.accountId);
    } else if (!wasOnline) void this.announce(who.accountId);
    socket.on('message', (data: Buffer | string) => {
      const t = this.now();
      client.tokens = Math.min(MESSAGES_PER_SECOND, client.tokens + ((t - client.at) / 1000) * MESSAGES_PER_SECOND);
      client.at = t;
      if (client.tokens < 1) {
        this.remove(client);
        socket.close(4429, 'rate');
        return;
      }
      client.tokens -= 1;
      onMessage(typeof data === 'string' ? data : data.toString('utf8'));
    });
    socket.on('close', () => this.remove(client));
    socket.on('error', () => this.remove(client));
  }

  private remove(client: Client): void {
    if (!this.clients.delete(client)) return;
    const id = client.accountId;
    if (this.isOnline(id) || this.leaving.has(id)) return;
    const timer = setTimeout(() => {
      this.leaving.delete(id);
      if (this.isOnline(id)) return;
      this.doing.delete(id);
      this.chatOpen.delete(id);
      void this.announce(id);
    }, OFFLINE_GRACE_MS);
    timer.unref();
    this.leaving.set(id, timer);
  }

  /** Every account online now (plan «escáner pro», part F: the admin's «Conectados ahora»). */
  onlineIds(): Set<string> {
    const out = new Set(this.leaving.keys());
    for (const c of this.clients) out.add(c.accountId);
    return out;
  }

  isOnline(accountId: string): boolean {
    for (const c of this.clients) if (c.accountId === accountId) return true;
    return this.leaving.has(accountId);
  }

  /** What an account is doing, as anyone allowed to see it would (the caller checks it may). */
  presenceOf(accountId: string): Presence {
    if (!this.isOnline(accountId)) return { status: 'offline' };
    const d = this.doing.get(accountId) ?? { activity: 'hub' as const };
    // In a room's lobby (not yet in its run): «in a room, 2/4».
    const room = d.activity === 'run' ? null : (this.deps.roomOf?.(accountId) ?? null);
    if (room) return { status: 'online', activity: 'room', room };
    return { status: 'online', activity: d.activity, ...(d.layer ? { layer: d.layer } : {}), ...(d.room ? { room: d.room } : {}) };
  }

  /** The account says what it is doing now; its friends learn it when it changed. */
  setActivity(accountId: string, doing: Doing): void {
    const before = JSON.stringify(this.doing.get(accountId) ?? null);
    this.doing.set(accountId, doing);
    if (JSON.stringify(doing) !== before) void this.announce(accountId);
  }

  /** The chat channel an account has open now (null: its chat is closed, or it is offline). */
  setChatOpen(accountId: string, channel: ChatChannel | null): void {
    if (channel) this.chatOpen.set(accountId, channel);
    else this.chatOpen.delete(accountId);
  }

  chatOpenOf(accountId: string): ChatChannel | null {
    return this.chatOpen.get(accountId) ?? null;
  }

  /** Tells an account's friends its presence (offline when it hides its status). */
  async announce(accountId: string): Promise<void> {
    const username = this.names.get(accountId);
    if (!username) return;
    const [friends, shows] = await Promise.all([this.deps.friendsOf(accountId), this.deps.showsStatus(accountId)]);
    const presence: Presence = shows ? this.presenceOf(accountId) : { status: 'offline' };
    for (const f of friends) this.send(f, { type: 'presence', username, presence });
  }

  /** Pushes an event to every socket of an account. */
  send(accountId: string, event: LiveEvent): void {
    this.sendMany([accountId], event);
  }

  /** Pushes one event to every socket of these accounts (a mail to many), serialized once. */
  sendMany(accountIds: Iterable<string>, event: LiveEvent): void {
    const to = new Set(accountIds);
    if (to.size === 0) return;
    const data = JSON.stringify(event);
    for (const c of this.clients) {
      if (!to.has(c.accountId) || c.socket.readyState !== c.socket.OPEN) continue;
      if (c.socket.bufferedAmount > MAX_BUFFERED) {
        this.clients.delete(c);
        c.socket.terminate();
        continue;
      }
      c.socket.send(data);
    }
  }

  /** How many sockets are open now (the live statistics). */
  size(): number {
    return this.clients.size;
  }

  /** How many accounts are connected now. */
  online(): number {
    return new Set([...this.clients].map((c) => c.accountId)).size;
  }

  /** Closes every socket of an account (4401: its sessions ended: a ban, closed sessions). */
  dropAccount(accountId: string): void {
    for (const c of [...this.clients]) {
      if (c.accountId !== accountId) continue;
      this.clients.delete(c);
      c.socket.close(4401, 'session');
    }
  }

  /** Closes the sockets opened with one session (its logout). */
  dropSession(sessionId: string): void {
    for (const c of [...this.clients]) {
      if (c.sessionId !== sessionId) continue;
      this.remove(c);
      c.socket.close(4401, 'session');
    }
  }

  close(): void {
    clearInterval(this.ping);
    for (const t of this.leaving.values()) clearTimeout(t);
    this.leaving.clear();
    for (const c of this.clients) c.socket.terminate();
    this.clients.clear();
  }
}
