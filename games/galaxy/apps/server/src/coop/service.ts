import { activeAnomaly, type CoopClientMessage, type CoopOutcome, type CoopPlayer, coopRulesOf, coopSimOptions, parseConfig } from '@galaxy/shared';
import { createReplayer, decodeLog, type Content, SIM_VERSION } from '@galaxy/sim';
import { type Kysely, sql } from 'kysely';
import type { ConfigReader } from '../config/reader';
import type { DB } from '../db/schema';
import { inTransaction } from '../db/tx';
import { HttpError } from '../errors';
import { ensureHangar, testedProbe } from '../runs/hangar';
import { loadoutSnapshot, newRunSeed } from '../runs/service';
import { CoopRun, type CoopRunBase, type CoopSlot, type Gone, type PlaySocket } from './relay';
import type { Room } from './rooms';
import { settleCoop } from './settle';

// The co-op runs of this server (multiplayer plan, phase 6): launching a room's run (every player's probe snapshotted
// like a solo run's, one row each), the clock that closes their ticks, saving their logs every few seconds, paying
// them when they end, and paying the ones a restart left behind (from their last saved log).

const CLOCK_MS = 16;
const SAVE_EVERY_MS = 5_000;
/** The run starts this long after launching: every player loads the arena first. */
export const LEAD_MS = 3_000;
/** A run whose log was not saved for this long belongs to no live server: it is paid as interrupted. */
const ORPHAN_MS = 30_000;
const RECOVER_EVERY_MS = 60_000;

export interface CoopDeps {
  db: Kysely<DB>;
  config: ConfigReader;
  now?: () => Date;
  log?: { error: (obj: object, msg: string) => void; info: (obj: object, msg: string) => void };
  /** Pay orphaned runs at start and every minute (off in tests, which call recover() themselves). */
  autoRecover?: boolean;
}

export class CoopService {
  private readonly runs = new Map<string, CoopRun>();
  private readonly ends = new Map<string, { promise: Promise<void>; resolve: () => void }>();
  private readonly savedAt = new Map<string, number>();
  private readonly saving = new Set<string>();
  private clock: NodeJS.Timeout | null = null;
  private recovery: NodeJS.Timeout | null = null;
  private readonly now: () => Date;
  /** Told when a run ended, with its room (the room routes wait again and tell its members). */
  onRunEnded: (roomId: string) => Promise<void> = async () => {};

  constructor(private readonly deps: CoopDeps) {
    this.now = deps.now ?? (() => new Date());
    if (deps.autoRecover) {
      const recover = () => void this.recover(this.now()).catch((err) => this.deps.log?.error({ err: (err as Error).name }, 'coop_recover_failed'));
      setTimeout(recover, 5_000).unref();
      this.recovery = setInterval(recover, RECOVER_EVERY_MS);
      this.recovery.unref();
    }
  }

  get(runId: string): CoopRun | null {
    return this.runs.get(runId) ?? null;
  }

  size(): number {
    return this.runs.size;
  }

  /**
   * Launches a room's run: every member's hangar probe and loadout snapshotted, the run and one row per player kept,
   * and the clock started a moment later. The room's checks (leader, everyone ready, sector) are the caller's.
   */
  async launch(room: Room): Promise<string> {
    const features = await this.deps.config.get('features');
    if (!features.coop) throw new HttpError(403, 'coop_disabled');
    if (!features.runs) throw new HttpError(503, 'runs_disabled');
    const [{ value: content, version: contentVersion }, probes, lab, planetarium, redshift, season, coopCfg] = await Promise.all([
      this.deps.config.getVersioned('content'),
      this.deps.config.get('probes'),
      this.deps.config.get('lab'),
      this.deps.config.get('planetarium'),
      this.deps.config.get('redshift'),
      this.deps.config.get('season'),
      this.deps.config.get('coop'),
    ]);
    const now = this.now();
    const anomaly = activeAnomaly(season, content, now)?.id ?? null;
    const rules = coopRulesOf(coopCfg);
    const seed = newRunSeed();
    const members = [...room.members].sort((a, b) => a.joinedAt - b.joinedAt);
    const n = members.length;
    const pointsFactor = coopCfg.points[n - 1] ?? 1;
    const { id, slots, players } = await inTransaction(this.deps.db, async (trx) => {
      const players: CoopPlayer[] = [];
      const snapshots: { accountId: string; payout: unknown }[] = [];
      for (const m of members) {
        if ((await testedProbe(trx, m.accountId)) === null) throw new HttpError(409, 'probe_test_required');
        const hangar = await ensureHangar(trx, m.accountId);
        const snap = await loadoutSnapshot(trx, m.accountId, hangar.probe, hangar.slots, { content, probes, lab, planetarium, redshift });
        players.push({ username: m.username, probe: hangar.probe, relics: snap.relics, bonuses: snap.bonuses, variant: snap.variant });
        snapshots.push({ accountId: m.accountId, payout: snap.payout });
      }
      const row = await trx
        .insertInto('galaxy.coop_runs')
        .values({
          room_code: room.code,
          kind: room.kind,
          leader_id: room.leader,
          sector: room.sector,
          seed,
          anomaly,
          rules: JSON.stringify(rules),
          players: JSON.stringify(players),
          content_version: contentVersion,
          sim_version: SIM_VERSION,
          started_at: now,
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      const slots: CoopSlot[] = [];
      for (let slot = 0; slot < n; slot++) {
        const p = players[slot]!;
        const r = await trx
          .insertInto('galaxy.runs')
          .values({
            account_id: snapshots[slot]!.accountId,
            seed,
            sector: room.sector,
            probe: p.probe,
            relics: JSON.stringify(p.relics),
            upgrades: JSON.stringify({ bonuses: p.bonuses, variant: p.variant, payout: snapshots[slot]!.payout, anomaly }),
            content_version: contentVersion,
            sim_version: SIM_VERSION,
            start_key: `coop:${row.id}`,
            started_at: now,
            coop_run_id: row.id,
            slot,
            party_size: n,
            points_factor: pointsFactor,
          })
          .returning('id')
          .executeTakeFirstOrThrow();
        slots.push({ accountId: snapshots[slot]!.accountId, username: p.username, runRowId: r.id });
      }
      await trx.insertInto('galaxy.coop_run_inputs').values({ coop_run_id: row.id, inputs: Buffer.alloc(0), ticks: 0, updated_at: now }).execute();
      return { id: row.id, slots, players };
    });
    const base: CoopRunBase = { id, seed, sector: room.sector, anomaly, content, contentVersion, rules, players, startedAt: now.toISOString() };
    const run = new CoopRun(id, room.id, base, slots, Date.now() + LEAD_MS);
    this.runs.set(id, run);
    let resolve!: () => void;
    const promise = new Promise<void>((r) => (resolve = r));
    this.ends.set(id, { promise, resolve });
    this.savedAt.set(id, Date.now());
    this.startClock();
    return id;
  }

  /**
   * A player's play socket: it plays its slot and gets the run (its hello goes out on the next turn, once the socket's
   * own listeners are in place); closing it starts the grace.
   */
  connect(runId: string, accountId: string, socket: PlaySocket): { run: CoopRun; slot: number } | null {
    const run = this.runs.get(runId);
    if (!run || run.ended) return null;
    const slot = run.slotOf(accountId);
    if (slot < 0) return null;
    setImmediate(() => {
      if (socket.readyState === 1 && !run.ended) run.attach(slot, socket);
    });
    return { run, slot };
  }

  disconnect(run: CoopRun, slot: number, socket: PlaySocket): void {
    run.detach(slot, socket, Date.now());
  }

  message(run: CoopRun, slot: number, msg: CoopClientMessage, socket: PlaySocket): void {
    if (msg.t === 'in') run.input(slot, msg.mx, msg.my, msg.aim);
    else if (msg.t === 'pick') run.pick(slot, msg.i, msg.seq);
    else if (msg.t === 'leave') run.leave(slot);
    else if (msg.t === 'ping') socket.send(JSON.stringify({ t: 'pong', at: msg.at }));
  }

  /** A member left the room while its run plays: it leaves the run for good. */
  leaveRun(runId: string, accountId: string): void {
    const run = this.runs.get(runId);
    const slot = run?.slotOf(accountId) ?? -1;
    if (run && slot >= 0) run.leave(slot);
  }

  /** Everyone leaves the run (a closed room, or a test): resolves once it ended and was paid. */
  async abandon(runId: string): Promise<void> {
    const run = this.runs.get(runId);
    if (!run) return;
    for (let slot = 0; slot < run.slots.length; slot++) run.leave(slot);
    await this.ends.get(runId)?.promise;
  }

  private startClock(): void {
    if (this.clock) return;
    this.clock = setInterval(() => this.pump(), CLOCK_MS);
  }

  private pump(): void {
    const now = Date.now();
    for (const run of this.runs.values()) {
      if (run.ended) continue;
      let ended = false;
      try {
        ended = run.pump(now);
      } catch (err) {
        this.deps.log?.error({ err: (err as Error).name, run: run.id }, 'coop_pump_failed');
        continue;
      }
      if (ended) void this.finish(run);
      else if (now - (this.savedAt.get(run.id) ?? 0) >= SAVE_EVERY_MS) void this.save(run);
    }
    if (this.runs.size === 0 && this.clock) {
      clearInterval(this.clock);
      this.clock = null;
    }
  }

  private async save(run: CoopRun): Promise<void> {
    if (this.saving.has(run.id)) return;
    this.saving.add(run.id);
    this.savedAt.set(run.id, Date.now());
    try {
      await this.deps.db
        .updateTable('galaxy.coop_run_inputs')
        .set({ inputs: Buffer.from(run.log()), ticks: run.closed, updated_at: this.now() })
        .where('coop_run_id', '=', run.id)
        .execute();
    } catch (err) {
      this.deps.log?.error({ err: (err as Error).name, run: run.id }, 'coop_save_failed');
    } finally {
      this.saving.delete(run.id);
    }
  }

  private async finish(run: CoopRun): Promise<void> {
    const outcome: CoopOutcome = run.referee.status === 'extracted' ? 'extracted' : 'died';
    try {
      this.saving.delete(run.id);
      await this.save(run);
      const results = await settleCoop(
        { db: this.deps.db, config: this.deps.config, now: this.now },
        { coopRunId: run.id, slots: run.slots, referee: run.referee, gone: run.gone, playersByLayer: run.playersByLayer, outcome },
      );
      for (let slot = 0; slot < run.slots.length; slot++) run.sendTo(slot, { t: 'end', outcome, result: results[slot] ?? null });
    } catch (err) {
      this.deps.log?.error({ err: (err as Error).name, run: run.id }, 'coop_settle_failed');
      run.broadcast({ t: 'end', outcome, result: null });
    } finally {
      run.closeAll(1000, 'end');
      this.runs.delete(run.id);
      this.savedAt.delete(run.id);
      await this.onRunEnded(run.roomId).catch(() => {});
      this.ends.get(run.id)?.resolve();
      this.ends.delete(run.id);
    }
  }

  /**
   * Pays the runs no live server plays (a restart left them «running», their log not saved for a while): each is
   * replayed from its saved log and paid as an extraction of its loot so far. Returns the ids paid now.
   */
  async recover(now: Date): Promise<string[]> {
    const stale = await this.deps.db
      .selectFrom('galaxy.coop_runs as c')
      .leftJoin('galaxy.coop_run_inputs as i', 'i.coop_run_id', 'c.id')
      .select(['c.id', 'c.seed', 'c.sector', 'c.anomaly', 'c.rules', 'c.players', 'c.content_version', 'c.room_code', 'i.inputs', 'i.ticks'])
      .where('c.state', '=', 'running')
      .where(sql<boolean>`coalesce(i.updated_at, c.started_at) < ${new Date(now.getTime() - ORPHAN_MS)}`)
      .execute();
    const paid: string[] = [];
    for (const row of stale) {
      if (this.runs.has(row.id)) continue;
      try {
        await this.settleFromLog(row, 'interrupted', now);
        paid.push(row.id);
      } catch (err) {
        this.deps.log?.error({ err: (err as Error).name, run: row.id }, 'coop_recover_run_failed');
      }
    }
    return paid;
  }

  /** Pays an ended run again (nothing more is paid: each player's operation answers with what it paid). */
  async settleAgain(runId: string): Promise<void> {
    const row = await this.deps.db
      .selectFrom('galaxy.coop_runs as c')
      .leftJoin('galaxy.coop_run_inputs as i', 'i.coop_run_id', 'c.id')
      .select(['c.id', 'c.seed', 'c.sector', 'c.anomaly', 'c.rules', 'c.players', 'c.content_version', 'c.room_code', 'c.outcome', 'i.inputs', 'i.ticks'])
      .where('c.id', '=', runId)
      .executeTakeFirstOrThrow();
    await this.settleFromLog(row, row.outcome ?? 'interrupted', this.now());
  }

  /** Forgets a live run without paying it (what a crash does; for tests): its log is saved first. */
  async forget(runId: string): Promise<void> {
    const run = this.runs.get(runId);
    if (!run) return;
    this.runs.delete(runId);
    await this.save(run);
    this.savedAt.delete(runId);
    run.ended = true;
  }

  private async settleFromLog(
    row: { id: string; seed: string; sector: string; anomaly: string | null; rules: unknown; players: unknown; content_version: number; inputs: Buffer | null; ticks: number | null },
    outcome: CoopOutcome,
    now: Date,
  ): Promise<void> {
    const content = await this.contentOf(row.content_version);
    const players = row.players as CoopPlayer[];
    const opts = coopSimOptions({ seed: String(row.seed), content, sector: row.sector, anomaly: row.anomaly, rules: row.rules as CoopRunBase['rules'], players });
    const log = row.inputs && row.inputs.length > 0 ? decodeLog(new Uint8Array(row.inputs)) : { probes: players.length, events: [] };
    const lastTick = log.events.length >= 6 ? log.events[log.events.length - 6]! : 0;
    const replayer = createReplayer(opts, log, Math.max(lastTick, row.ticks ?? 0, 1));
    // Who left, and the loot up to then, and the players each layer started with, as the referee had them.
    const gone: (Gone | null)[] = players.map(() => null);
    const playersByLayer: number[] = [replayer.sim.players];
    while (replayer.next()) {
      const sim = replayer.sim;
      for (const e of sim.events) {
        if (e.t === 'presence' && e.life === 'left') {
          const p = sim.probes[e.probe]!;
          gone[e.probe] = { tick: sim.tick, kills: p.kills, level: p.level, loot: sim.loot.map((l) => ({ ...l })) };
        }
      }
      playersByLayer[sim.layer - 1] ??= sim.players;
    }
    const runRows = await this.deps.db.selectFrom('galaxy.runs').select(['id', 'account_id', 'slot']).where('coop_run_id', '=', row.id).orderBy('slot').execute();
    const slots: CoopSlot[] = runRows.map((r, i) => ({ accountId: r.account_id, username: players[i]?.username ?? '', runRowId: r.id }));
    const status = replayer.sim.status;
    await settleCoop(
      { db: this.deps.db, config: this.deps.config, now: () => now },
      { coopRunId: row.id, slots, referee: replayer.sim, gone, playersByLayer, outcome: outcome === 'interrupted' && status === 'dead' ? 'died' : outcome },
    );
  }

  private async contentOf(version: number): Promise<Content> {
    if (version > 0) {
      const stored = await this.deps.db.selectFrom('galaxy.game_config_versions').select('data').where('key', '=', 'content').where('version', '=', version).executeTakeFirst();
      if (stored) {
        try {
          return parseConfig('content', stored.data) as Content;
        } catch {
          // Fall through to today's content.
        }
      }
    }
    return (await this.deps.config.get('content')) as Content;
  }

  /** On shutdown: the clock stops and every live run's log is saved (the next start pays them as interrupted). */
  async close(): Promise<void> {
    if (this.clock) clearInterval(this.clock);
    if (this.recovery) clearInterval(this.recovery);
    this.clock = null;
    await Promise.all([...this.runs.values()].map((run) => (this.saving.delete(run.id), this.save(run))));
    for (const run of this.runs.values()) run.closeAll(4503, 'restart');
  }
}
