import type { Content, CoopRules, RelicInput, SimOptions, StatBonus } from '@galaxy/sim';
import { z } from 'zod';
import type { ConfigValue } from '../config/registry';
import type { RunResult } from './runs';

// Co-op runs (multiplayer plan, phase 6). The server seals every player's input as a log event and closes ticks at
// 60 Hz; the play socket carries those events to every player, who simulate only closed ticks. The messages are
// small JSON: the inputs only when they change, the sealed events in batches with the tick they close up to.

export type CoopConfig = ConfigValue<'coop'>;

/** The run's co-op rules from the live config, taken at launch (like the anomaly). */
export function coopRulesOf(cfg: CoopConfig): CoopRules {
  return {
    pickSeconds: cfg.pickSeconds,
    downSeconds: cfg.downSeconds,
    reviveSeconds: cfg.reviveSeconds,
    reviveRadius: cfg.reviveRadius,
    reviveHp: cfg.reviveHp,
    reviveInvuln: cfg.reviveInvuln,
    enemyHp: [...cfg.enemyHp],
    enemyDamage: [...cfg.enemyDamage],
    density: [...cfg.density],
    bossHp: [...cfg.bossHp],
    limits: { shots: 2, areas: 2, pickups: 1.5 },
  };
}

/** One player of a co-op run, with what the server snapshotted for its probe at launch. */
export interface CoopPlayer {
  username: string;
  probe: string;
  relics: RelicInput[];
  bonuses: StatBonus[];
  variant: string | null;
  /** The skin its probe wears (plan «skins»; absent in runs from before it: the base drawing). */
  skin?: string | null;
}

/** Everything a player needs to simulate the run, and its own place in it. */
export interface CoopRunStart {
  id: string;
  seed: string;
  sector: string;
  anomaly: string | null;
  content: Content;
  contentVersion: number;
  rules: CoopRules;
  players: CoopPlayer[];
  /** My probe's index. */
  slot: number;
  startedAt: string;
}

/** The simulation every party runs: the referee, each player and the panel's replayer. */
export function coopSimOptions(start: Pick<CoopRunStart, 'seed' | 'content' | 'sector' | 'anomaly' | 'rules' | 'players'>, record = false): SimOptions {
  return {
    seed: start.seed,
    content: start.content,
    sector: start.sector,
    probes: start.players.map((p) => ({ probe: p.probe, relics: p.relics, bonuses: p.bonuses, variant: p.variant })),
    anomaly: start.anomaly,
    coop: start.rules,
    record,
  };
}

const int = (lo: number, hi: number) => z.number().int().min(lo).max(hi);

/** The quick marks a player puts on the world (phase 6c): over the play socket, never in the sealed log. */
export const COOP_MARKS = ['here', 'help', 'beacon', 'danger'] as const;
export type CoopMark = (typeof COOP_MARKS)[number];

/**
 * Every this many ticks (5 s) a client sends the hash of its world (sim stateHash) for the referee to compare (phase
 * 6c): a client whose world went its own way is told to rebuild it from the sealed log.
 */
export const COOP_SUM_EVERY = 300;

/** What a player sends on the play socket. */
export const coopClientMessageSchema = z.discriminatedUnion('t', [
  z.object({ t: z.literal('in'), mx: int(-127, 127), my: int(-127, 127), aim: int(-1, 4095) }).strict(),
  z.object({ t: z.literal('pick'), i: int(0, 15), seq: int(0, 255) }).strict(),
  // The player's dash (SIM 1.12.0), with the pointer's angle at the press (−1: none) for a probe standing still.
  z.object({ t: z.literal('dash'), a: int(-1, 4095) }).strict(),
  z.object({ t: z.literal('leave') }).strict(),
  z.object({ t: z.literal('ping'), at: z.number().finite() }).strict(),
  z.object({ t: z.literal('mark'), kind: z.enum(COOP_MARKS), x: int(-1_000_000, 1_000_000), y: int(-1_000_000, 1_000_000) }).strict(),
  z.object({ t: z.literal('sum'), tick: int(1, 2_147_483_647), h: z.string().regex(/^[0-9a-f]{1,32}$/) }).strict(),
]);
export type CoopClientMessage = z.infer<typeof coopClientMessageSchema>;

/** How the run ended for the group. */
export type CoopOutcome = 'extracted' | 'died' | 'interrupted';

/** What the server sends on the play socket. */
export type CoopServerMessage =
  /** On connecting (and reconnecting): the run, its sealed log so far (base64, log v2) and the tick it closes up to. */
  | { t: 'hello'; start: CoopRunStart; log: string; to: number }
  /** More sealed events (flat [tick, probe, kind, a, b, c]…), all ticks up to `to` closed. */
  | { t: 'f'; to: number; ev: number[] }
  /** The run is over: how, and what this player was paid (null: nothing, e.g. already paid). */
  | { t: 'end'; outcome: CoopOutcome; result: RunResult | null }
  | { t: 'pong'; at: number }
  /** A quick mark a player put (the sender too): who, which, where in the world. */
  | { t: 'mark'; slot: number; kind: CoopMark; x: number; y: number }
  /** This player's world is not the referee's at `tick`: rebuild it from the start and the sealed log. */
  | { t: 'desync'; tick: number };
