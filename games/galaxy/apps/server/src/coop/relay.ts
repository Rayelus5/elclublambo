import { type CoopRunStart, type CoopServerMessage, coopSimOptions } from '@galaxy/shared';
import { CoopFeed, createSim, encodeLog, MOVE, PICK_SEQ, PRESENCE, type Sim, step, toBase64 } from '@galaxy/sim';

// One co-op run as the server plays it (multiplayer plan, phase 6). Inputs arrive from the players' sockets and are
// sealed at once, as log events, on the next tick not yet closed; the clock closes ticks at 60 Hz whatever the
// players do, so a slow or hidden player never holds the others. Each closed tick steps the referee (the same
// simulation, fed the same events), which decides how the run ends; the sockets get the sealed events in batches with
// the tick they close up to (and a heartbeat every few ticks). A player without a socket for a while, while others
// play, is sealed «away» (intangible) and «back» when it returns; «left» is for good; a player whose last socket
// closes stops moving at once. With nobody connected the clock waits (a shared outage or a slow start never costs the
// run); nobody for long, and everyone is sealed «left» and the run ends.

export const TICK_MS = 1000 / 60;
const BEAT_TICKS = 3;
/** At most this many ticks closed per pump: a stalled server catches up over a few pumps instead of all at once. */
const MAX_TICKS_PER_PUMP = 30;
export const AWAY_AFTER_MS = 10_000;
export const ALL_GONE_MS = 120_000;
const OPEN = 1;

export interface PlaySocket {
  readonly readyState: number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
}

export interface CoopSlot {
  accountId: string;
  username: string;
  /** Its own row in galaxy.runs. */
  runRowId: string;
}

/** The run as every player gets it, but its own place. */
export type CoopRunBase = Omit<CoopRunStart, 'slot'>;

/** What the referee saw of a player who left before the end: when, and the group's loot up to then. */
export interface Gone {
  tick: number;
  kills: number;
  level: number;
  /** The group's Cores until then (those killed after it went are not its own). */
  bossKills: number;
  loot: { coins: number; dust: number; components: number }[];
}

const PRESENCE_UP = 0;
const PRESENCE_AWAY = 1;
const PRESENCE_LEFT = 2;

export class CoopRun {
  readonly events: number[] = [];
  closed = 0;
  ended = false;
  readonly referee: Sim;
  /** Players the run counted at the start of each layer (index = layer − 1): the loot's factor by layer. */
  readonly playersByLayer: number[] = [];
  /** Players who left before the end, as they were when they went. */
  readonly gone: (Gone | null)[];
  private readonly feed: CoopFeed;
  private pending: number[] = [];
  private sent = 0;
  private sentTo = 0;
  private readonly sockets: Set<PlaySocket>[];
  /** Each player's movement in effect after the closed ticks (a new input is sealed only if it differs). */
  private readonly move: [number, number, number][];
  private readonly presence: number[];
  private readonly offlineSince: (number | null)[];
  private lastLayer = 0;
  /** When the clock stopped because nobody was connected (null: running). */
  private pausedSince: number | null = null;
  /** Everyone was gone too long: the clock runs again to close their leaving. */
  private abandoning = false;
  /** The clock's origin, moved forward by every pause. */
  private origin: number;

  constructor(
    readonly id: string,
    readonly roomId: string,
    readonly base: CoopRunBase,
    readonly slots: CoopSlot[],
    readonly t0: number,
  ) {
    const n = slots.length;
    this.referee = createSim(coopSimOptions(base, false));
    this.feed = new CoopFeed(n);
    this.gone = slots.map(() => null);
    this.sockets = slots.map(() => new Set());
    this.move = slots.map(() => [0, 0, -1]);
    this.presence = slots.map(() => PRESENCE_UP);
    // Nobody is connected yet: the grace starts now.
    this.offlineSince = slots.map(() => t0);
    this.origin = t0;
    this.noteLayer();
  }

  slotOf(accountId: string): number {
    return this.slots.findIndex((s) => s.accountId === accountId);
  }

  /** A player's socket opens (or opens again): it gets the run, the log so far and the tick closed; «back» if away. */
  attach(slot: number, socket: PlaySocket): void {
    this.sockets[slot]!.add(socket);
    this.offlineSince[slot] = null;
    if (this.presence[slot] === PRESENCE_AWAY) this.seal(slot, PRESENCE, PRESENCE_UP, 0, 0);
    const hello: CoopServerMessage = {
      t: 'hello',
      start: { ...this.base, slot },
      log: toBase64(encodeLog({ probes: this.slots.length, events: this.events })),
      to: this.closed,
    };
    socket.send(JSON.stringify(hello));
  }

  detach(slot: number, socket: PlaySocket, now: number): void {
    const set = this.sockets[slot]!;
    set.delete(socket);
    if (set.size > 0) return;
    if (this.offlineSince[slot] === null) this.offlineSince[slot] = now;
    // Its last socket closed: the probe stops where it is (it may be gone for a while).
    this.input(slot, 0, 0, -1);
  }

  /** A player's movement and aim: sealed only when it changes what is in effect. */
  input(slot: number, mx: number, my: number, aim: number): void {
    if (this.ended || this.presence[slot] === PRESENCE_LEFT) return;
    const m = this.move[slot]!;
    if (m[0] === mx && m[1] === my && m[2] === aim) {
      // Back to what is in effect: a change sealed earlier on this same open tick is withdrawn.
      this.withdraw(slot, MOVE);
      return;
    }
    this.withdraw(slot, MOVE);
    this.pending.push(this.closed + 1, slot, MOVE, mx, my, aim);
  }

  /** A card picked on the offer the player saw (the referee ignores it if that offer is gone). */
  pick(slot: number, index: number, seq: number): void {
    if (this.ended || this.presence[slot] === PRESENCE_LEFT) return;
    this.withdraw(slot, PICK_SEQ);
    this.pending.push(this.closed + 1, slot, PICK_SEQ, index, seq, 0);
  }

  /** The player leaves the run for good (Abandonar, or out of the room). */
  leave(slot: number): void {
    if (this.ended || this.presence[slot] === PRESENCE_LEFT) return;
    this.seal(slot, PRESENCE, PRESENCE_LEFT, 0, 0);
    // Everyone has gone: the clock runs (even with nobody connected) to close it, and the run ends.
    if (this.presence.every((x) => x === PRESENCE_LEFT)) this.abandoning = true;
  }

  private seal(slot: number, kind: number, a: number, b: number, c: number): void {
    if (kind === PRESENCE) this.presence[slot] = a;
    this.pending.push(this.closed + 1, slot, kind, a, b, c);
  }

  private withdraw(slot: number, kind: number): void {
    for (let i = this.pending.length - 6; i >= 0; i -= 6) {
      if (this.pending[i + 1] === slot && this.pending[i + 2] === kind) {
        this.pending.splice(i, 6);
        return;
      }
    }
  }

  private noteLayer(): void {
    const sim = this.referee;
    if (sim.layer !== this.lastLayer) {
      this.lastLayer = sim.layer;
      this.playersByLayer[sim.layer - 1] = sim.players;
    }
  }

  /** Away after a while without a socket (only called while someone else plays). */
  private watchPresence(now: number): void {
    for (let slot = 0; slot < this.slots.length; slot++) {
      if (this.presence[slot] !== PRESENCE_UP) continue;
      const since = this.offlineSince[slot] ?? null;
      if (since !== null && now - since >= AWAY_AFTER_MS) this.seal(slot, PRESENCE, PRESENCE_AWAY, 0, 0);
    }
  }

  private online(): boolean {
    return this.sockets.some((set) => set.size > 0);
  }

  /**
   * The clock with nobody connected (once the run started): it waits; after ALL_GONE_MS everyone leaves and it runs
   * again to close that. Returns false while it waits.
   */
  private clockRuns(now: number): boolean {
    if (this.abandoning || now < this.origin) return true;
    if (this.online()) {
      if (this.pausedSince !== null) {
        this.origin += now - this.pausedSince;
        this.pausedSince = null;
      }
      return true;
    }
    this.pausedSince ??= now;
    if (now - this.pausedSince < ALL_GONE_MS) return false;
    this.origin += now - this.pausedSince;
    this.pausedSince = null;
    this.abandoning = true;
    for (let slot = 0; slot < this.slots.length; slot++) this.leave(slot);
    return true;
  }

  /**
   * Closes every tick the clock has reached (up to a few per call), steps the referee through them and sends what was
   * sealed. Returns true when the run ended in this call.
   */
  pump(now: number): boolean {
    if (this.ended) return false;
    if (!this.clockRuns(now)) return false;
    if (!this.abandoning) this.watchPresence(now);
    const target = Math.min(Math.floor((now - this.origin) / TICK_MS), this.closed + MAX_TICKS_PER_PUMP);
    const sim = this.referee;
    while (this.closed < target && !this.ended) {
      const tick = this.closed + 1;
      // What was sealed on this tick, in arrival order; later inputs go to the next one.
      const sealed = this.pending;
      this.pending = [];
      for (const e of sealed) this.events.push(e);
      for (let i = 0; i + 5 < sealed.length; i += 6) if (sealed[i + 2] === MOVE) this.move[sealed[i + 1]!] = [sealed[i + 3]!, sealed[i + 4]!, sealed[i + 5]!];
      this.feed.push(sealed);
      this.closed = tick;
      step(sim, this.feed.inputsFor(tick));
      for (const e of sim.events) {
        if (e.t === 'presence' && e.life === 'left') {
          const p = sim.probes[e.probe]!;
          this.gone[e.probe] = { tick: sim.tick, kills: p.kills, level: p.level, bossKills: sim.bossKills, loot: sim.loot.map((l) => ({ ...l })) };
        }
      }
      this.noteLayer();
      if (sim.status === 'dead' || sim.status === 'extracted') this.ended = true;
    }
    if (this.events.length > this.sent || this.closed - this.sentTo >= BEAT_TICKS || this.ended) this.flush();
    return this.ended;
  }

  private flush(): void {
    const msg: CoopServerMessage = { t: 'f', to: this.closed, ev: this.events.slice(this.sent) };
    this.sent = this.events.length;
    this.sentTo = this.closed;
    this.broadcast(msg);
  }

  broadcast(msg: CoopServerMessage): void {
    const data = JSON.stringify(msg);
    for (const set of this.sockets) for (const s of set) if (s.readyState === OPEN) s.send(data);
  }

  sendTo(slot: number, msg: CoopServerMessage): void {
    const data = JSON.stringify(msg);
    for (const s of this.sockets[slot]!) if (s.readyState === OPEN) s.send(data);
  }

  closeAll(code: number, reason: string): void {
    for (const set of this.sockets) for (const s of set) s.close(code, reason);
  }

  /** The sealed log so far (log v2 when it has picks or presence), to save. */
  log(): Uint8Array {
    return encodeLog({ probes: this.slots.length, events: this.events });
  }

  /** Whether a player left the run for good. */
  hasLeft(slot: number): boolean {
    return this.presence[slot] === PRESENCE_LEFT;
  }
}
