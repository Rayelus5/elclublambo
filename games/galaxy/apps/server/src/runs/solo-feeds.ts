import type { AdminRunReplay, SoloFeedState, SoloLiveRow, SoloStreamMessage, SoloStreamServerMessage, SoloWatchMessage } from '@galaxy/shared';
import { decodeEvents, fromBase64, toBase64 } from '@galaxy/sim';

// The solo runs' live feeds (plan «escáner pro», part G; the owner: «los admins deberían de poder ver partidas
// individuales en directo»). A solo run streams its input log while it is played: each piece must follow the last
// (else the player hears where to resume), read as a solo log and never go back in time; it is kept and handed to the
// staff watching, who start from the whole log so far. One feed per account (the newest run's), 2000 at most, 2 MB
// of log each and 256 MB in all; a run never claims more ticks than the time it has been running, nor more bytes than
// those ticks can log. A feed ends when its run is saved, or 5 minutes after its player's socket went (a player still
// connected keeps it, however long it pauses). Only for watching, and not evidence: the client could stage its own
// replay; the reward still comes from the finish, which replays the log the client sends there.

/** The bits of a websocket the feeds use (ws's WebSocket fits; the tests use a fake). */
export interface FeedSocket {
  readonly readyState: number;
  readonly OPEN: number;
  readonly bufferedAmount: number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
}

export interface FeedRun {
  id: string;
  accountId: string;
  player: string;
  sector: string;
  probe: string;
  startedAt: string;
}

interface Feed {
  run: FeedRun;
  startedMs: number;
  /** The log so far (pieces one after another), in a buffer that doubles as it fills. */
  buf: Uint8Array;
  bytes: number;
  /** Events kept (6 numbers each in the sim's log). */
  events: number;
  /** The last event's tick. */
  tick: number;
  /** The tick the run had reached. */
  to: number;
  state: SoloFeedState;
  seenAt: number;
  socket: FeedSocket | null;
  watchers: Set<FeedSocket>;
}

const GRACE_MS = 5 * 60_000;
const SWEEP_MS = 30_000;
/** A viewer this far behind (bytes waiting to go) is dropped rather than buffered forever: above the biggest hello. */
const WATCHER_BUFFER_MAX = 4_000_000;
/** Ticks a run may claim beyond the time it has been running (clock skew, a slow start). */
const TICK_SLACK = 600;
/**
 * Bytes a run may log per tick it claims (a move is 9 at most, one per tick; a dash 6 at most, and never two within a
 * few ticks), and some slack for the picks.
 */
const BYTES_PER_TICK = 12;
const BYTES_SLACK = 4096;
/** encodeLog's header for one probe: version 1, one probe. */
const HEADER = Uint8Array.from([1, 1]);

export class SoloFeeds {
  private readonly feeds = new Map<string, Feed>();
  private readonly byAccount = new Map<string, string>();
  private readonly now: () => number;
  private readonly maxBytes: number;
  private readonly maxFeeds: number;
  private readonly maxTotalBytes: number;
  private totalBytes = 0;
  private timer: NodeJS.Timeout | null = null;

  constructor(opts: { now?: () => number; maxBytes?: number; maxFeeds?: number; maxTotalBytes?: number } = {}) {
    this.now = opts.now ?? Date.now;
    this.maxBytes = opts.maxBytes ?? 2_000_000;
    this.maxFeeds = opts.maxFeeds ?? 2000;
    this.maxTotalBytes = opts.maxTotalBytes ?? 256_000_000;
  }

  /** Sweeps every 30 s (the app starts it; tests sweep by hand). */
  start(): void {
    this.timer ??= setInterval(() => this.sweep(), SWEEP_MS);
    this.timer.unref();
  }

  /** The server is going away (a deploy): every socket closes as «restarting» (1012), and nobody is told a run ended. */
  close(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    for (const feed of this.feeds.values()) {
      for (const w of feed.watchers) if (w.readyState === w.OPEN) w.close(1012, 'restart');
      if (feed.socket && feed.socket.readyState === feed.socket.OPEN) feed.socket.close(1012, 'restart');
    }
    this.feeds.clear();
    this.byAccount.clear();
    this.totalBytes = 0;
  }

  has(runId: string): boolean {
    return this.feeds.has(runId);
  }

  /**
   * The player's socket for its open solo run: hello with what is kept. 'busy' when there is no room for another feed;
   * 'older' when the account streams a run that started later (two tabs or devices): the newest run keeps the feed.
   */
  connect(run: FeedRun, socket: FeedSocket): 'ok' | 'busy' | 'older' {
    const previous = this.byAccount.get(run.accountId);
    const other = previous && previous !== run.id ? this.feeds.get(previous) : undefined;
    if (other) {
      if (Date.parse(other.run.startedAt) > Date.parse(run.startedAt)) return 'older';
      this.end(other.run.id);
    }
    let feed = this.feeds.get(run.id);
    if (!feed) {
      if (this.feeds.size >= this.maxFeeds) return 'busy';
      feed = {
        run,
        startedMs: Date.parse(run.startedAt),
        buf: new Uint8Array(1024),
        bytes: 0,
        events: 0,
        tick: 0,
        to: 0,
        state: 'run',
        seenAt: this.now(),
        socket: null,
        watchers: new Set(),
      };
      this.feeds.set(run.id, feed);
      this.byAccount.set(run.accountId, run.id);
    }
    if (feed.socket && feed.socket !== socket) feed.socket.close(4409, 'replaced');
    feed.socket = socket;
    feed.seenAt = this.now();
    if (feed.state === 'lost') {
      feed.state = 'run';
      this.tell(feed, { t: 'st', s: 'run' });
    }
    this.hello(feed);
    return 'ok';
  }

  /** A message from the player's socket (already parsed by the route). */
  message(runId: string, socket: FeedSocket, msg: SoloStreamMessage): void {
    const feed = this.feeds.get(runId);
    if (!feed || feed.socket !== socket) return;
    feed.seenAt = this.now();
    if (msg.t === 'end') {
      feed.state = 'done';
      this.tell(feed, { t: 'st', s: 'done' });
      return;
    }
    if (msg.at !== feed.events) {
      this.hello(feed);
      return;
    }
    // No run is further on than the time it has been running.
    if (msg.to > Math.floor(((this.now() - feed.startedMs) / 1000) * 60) + TICK_SLACK) {
      this.reject(feed, 4400, 'future');
      return;
    }
    let bytes: Uint8Array;
    let read: { events: number[]; tick: number };
    try {
      bytes = fromBase64(msg.b);
      read = decodeEvents(bytes, feed.tick, 1);
    } catch {
      this.reject(feed, 4400, 'log');
      return;
    }
    // Its events never go past the tick it says the run reached (an older `to` after a resume is fine: the furthest counts).
    if (read.events.length > 0 && msg.to < read.tick) {
      this.reject(feed, 4400, 'tick');
      return;
    }
    const cap = Math.min(this.maxBytes, BYTES_PER_TICK * Math.max(feed.to, msg.to) + BYTES_SLACK);
    if (feed.bytes + bytes.length > cap || this.totalBytes + bytes.length > this.maxTotalBytes) {
      feed.socket?.close(4413, 'too big');
      feed.socket = null;
      this.end(runId);
      return;
    }
    if (bytes.length > 0) {
      if (feed.bytes + bytes.length > feed.buf.length) {
        const grown = new Uint8Array(Math.max(feed.buf.length * 2, feed.bytes + bytes.length));
        grown.set(feed.buf.subarray(0, feed.bytes));
        feed.buf = grown;
      }
      feed.buf.set(bytes, feed.bytes);
      feed.bytes += bytes.length;
      this.totalBytes += bytes.length;
      feed.events += read.events.length / 6;
      feed.tick = read.tick;
    }
    feed.to = Math.max(feed.to, msg.to);
    feed.state = msg.s;
    this.tell(feed, { t: 'f', b: msg.b, to: feed.to, s: msg.s });
  }

  /** The player's socket closed: the viewers hear it is lost, and the feed waits for it (5 minutes). */
  disconnect(runId: string, socket: FeedSocket): void {
    const feed = this.feeds.get(runId);
    if (!feed || feed.socket !== socket) return;
    feed.socket = null;
    feed.seenAt = this.now();
    if (feed.state !== 'done') {
      feed.state = 'lost';
      this.tell(feed, { t: 'st', s: 'lost' });
    }
  }

  /** A viewer (staff): hello with the run, its start and the whole log so far, then every piece. */
  watch(runId: string, socket: FeedSocket, extra: { start: AdminRunReplay['start']; contentFallback: boolean }): boolean {
    const feed = this.feeds.get(runId);
    if (!feed) return false;
    const log = new Uint8Array(HEADER.length + feed.bytes);
    log.set(HEADER, 0);
    log.set(feed.buf.subarray(0, feed.bytes), HEADER.length);
    const hello: SoloWatchMessage = {
      t: 'hello',
      run: { id: feed.run.id, player: feed.run.player, startedAt: feed.run.startedAt },
      start: extra.start,
      contentFallback: extra.contentFallback,
      log: toBase64(log),
      to: feed.to,
      s: feed.state,
    };
    socket.send(JSON.stringify(hello));
    const first = feed.watchers.size === 0;
    feed.watchers.add(socket);
    if (first) this.toPlayer(feed, { t: 'watch', on: true });
    return true;
  }

  unwatch(runId: string, socket: FeedSocket): void {
    const feed = this.feeds.get(runId);
    if (!feed || !feed.watchers.delete(socket)) return;
    if (feed.watchers.size === 0) this.toPlayer(feed, { t: 'watch', on: false });
  }

  /** The run was saved (or its feed is dropped): the viewers hear it, and every socket of it closes. */
  end(runId: string): void {
    const feed = this.feeds.get(runId);
    if (!feed) return;
    this.feeds.delete(runId);
    this.totalBytes -= feed.bytes;
    if (this.byAccount.get(feed.run.accountId) === runId) this.byAccount.delete(feed.run.accountId);
    for (const w of feed.watchers) {
      if (w.readyState === w.OPEN) {
        w.send(JSON.stringify({ t: 'end' } satisfies SoloWatchMessage));
        w.close(1000, 'end');
      }
    }
    feed.watchers.clear();
    if (feed.socket?.readyState === feed.socket?.OPEN) feed.socket?.close(1000, 'end');
    feed.socket = null;
  }

  /** Feeds without their player for longer than the grace end (a connected player may pause as long as it likes). */
  sweep(): void {
    const t = this.now();
    for (const [id, feed] of [...this.feeds]) if (!feed.socket && t - feed.seenAt > GRACE_MS) this.end(id);
  }

  /** The runs being played now, newest first. */
  list(): SoloLiveRow[] {
    return [...this.feeds.values()]
      .map((f) => ({ runId: f.run.id, player: f.run.player, sector: f.run.sector, probe: f.run.probe, startedAt: f.run.startedAt, tick: f.to, state: f.state, watchers: f.watchers.size }))
      .sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  }

  private hello(feed: Feed): void {
    this.toPlayer(feed, { t: 'hello', have: feed.events, tick: feed.tick, watched: feed.watchers.size > 0 });
  }

  private reject(feed: Feed, code: number, reason: string): void {
    feed.socket?.close(code, reason);
    if (feed.socket) this.disconnect(feed.run.id, feed.socket);
  }

  private toPlayer(feed: Feed, msg: SoloStreamServerMessage): void {
    if (feed.socket && feed.socket.readyState === feed.socket.OPEN) feed.socket.send(JSON.stringify(msg));
  }

  private tell(feed: Feed, msg: SoloWatchMessage): void {
    const data = JSON.stringify(msg);
    const had = feed.watchers.size;
    for (const w of [...feed.watchers]) {
      if (w.readyState !== w.OPEN) {
        feed.watchers.delete(w);
        continue;
      }
      if (w.bufferedAmount > WATCHER_BUFFER_MAX) {
        feed.watchers.delete(w);
        w.close(4408, 'slow');
        continue;
      }
      w.send(data);
    }
    // The last one left without a word (closed, or dropped as too slow): the player can slow down again.
    if (had > 0 && feed.watchers.size === 0) this.toPlayer(feed, { t: 'watch', on: false });
  }
}
