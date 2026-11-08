import type { ChatEvent } from '@galaxy/shared';
import type { Kysely } from 'kysely';
import type { WebSocket } from 'ws';
import type { DB } from '../db/schema';

// The chats' live side (GDD §14.4; M5b-2): the open sockets of this process and who gets each event. A clan's events
// go to whoever is in that clan when they are sent (read then, not when the socket opened), so leaving a clan stops
// them at once. A socket that falls behind (more than 1 MB waiting) is closed instead of piling up messages. The beta
// runs one container, so the sockets live in memory.

const MAX_BUFFERED = 1_000_000;
const PING_MS = 25_000;

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
    const client = { socket, accountId };
    this.clients.add(client);
    socket.on('close', () => this.clients.delete(client));
    socket.on('error', () => this.clients.delete(client));
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
        c.socket.close(1013, 'slow');
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
