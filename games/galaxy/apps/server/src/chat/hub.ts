import type { ChatEvent } from '@galaxy/shared';
import type { Kysely } from 'kysely';
import type { WebSocket } from 'ws';
import type { DB } from '../db/schema';

// The chats' live side (GDD §14.4; M5b-2): the open sockets of this process and who gets each event. A clan's events
// go to whoever is in that clan when they are sent (read then, not when the socket opened), so leaving a clan stops
// them at once. A socket that falls behind (more than 1 MB waiting) is closed instead of piling up messages. The beta
// runs one container, so the sockets live in memory: an account keeps three sockets at most (a fourth closes its
// oldest, 4008) and the process a few thousand, so nobody can fill its memory with idle sockets.

const MAX_BUFFERED = 1_000_000;
const PING_MS = 25_000;
export const SOCKETS_PER_ACCOUNT = 3;
const SOCKETS_TOTAL = 5000;

interface Client {
  socket: WebSocket;
  accountId: string;
}

export class ChatHub {
  private readonly clients = new Set<Client>();
  private readonly ping: NodeJS.Timeout;

  constructor(private readonly db: Kysely<DB>) {
    // Keeps proxies (Cloudflare's tunnel) from closing a quiet socket.
    this.ping = setInterval(() => {
      for (const c of this.clients) if (c.socket.readyState === c.socket.OPEN) c.socket.ping();
    }, PING_MS);
    this.ping.unref();
  }

  add(socket: WebSocket, accountId: string): void {
    if (this.clients.size >= SOCKETS_TOTAL) {
      socket.close(1013, 'busy');
      return;
    }
    const mine = [...this.clients].filter((c) => c.accountId === accountId);
    if (mine.length >= SOCKETS_PER_ACCOUNT) {
      this.clients.delete(mine[0]!);
      mine[0]!.socket.close(4008, 'too many');
    }
    const client = { socket, accountId };
    this.clients.add(client);
    socket.on('close', () => this.clients.delete(client));
    socket.on('error', () => this.clients.delete(client));
  }

  /** How many sockets are open now (the live statistics, M6d-2). */
  size(): number {
    return this.clients.size;
  }

  /** Closes every socket of an account (4401: its sessions ended), so a ban or closed sessions stop the live chat. */
  dropAccount(accountId: string): void {
    for (const c of this.clients) {
      if (c.accountId !== accountId) continue;
      this.clients.delete(c);
      c.socket.close(4401, 'session');
    }
  }

  /** Sends an event of `channelKey` ('global' or 'clan:<id>') to every socket allowed to read it. */
  async broadcast(channelKey: string, event: ChatEvent): Promise<void> {
    let allowed: Set<string> | null = null;
    if (channelKey.startsWith('clan:')) {
      const rows = await this.db.selectFrom('galaxy.clan_members').select('account_id').where('clan_id', '=', channelKey.slice(5)).execute();
      allowed = new Set(rows.map((r) => r.account_id));
    }
    const data = JSON.stringify(event);
    for (const c of this.clients) {
      if (allowed && !allowed.has(c.accountId)) continue;
      if (c.socket.readyState !== c.socket.OPEN) continue;
      if (c.socket.bufferedAmount > MAX_BUFFERED) {
        // A closing handshake would queue behind the backlog: cut it.
        this.clients.delete(c);
        c.socket.terminate();
        continue;
      }
      c.socket.send(data);
    }
  }

  close(): void {
    clearInterval(this.ping);
    for (const c of this.clients) c.socket.terminate();
    this.clients.clear();
  }
}
