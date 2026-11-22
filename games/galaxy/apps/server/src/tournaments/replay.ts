import { type AdminRunReplay, type CheckRow, checkReplay, replayOptionsOf, replayUntil, type UnverifiableReason } from '@galaxy/shared';
import { decodeLog, fromBase64, type InputLog, replay, SIM_VERSION } from '@galaxy/sim';

// The review's replay of one run (plan «temporadas como fichas», part 5; GDD §13.3, §14.7): what the server kept at its
// start (seed, sector, probe, relics, bonuses, variant, anomaly and the content of its own version, `runReplay`) with
// its recorded inputs, played to the tick the client sent, and its end compared with what the client sent — the same
// `checkReplay` the panel's «Comprobar» uses. Pure and synchronous: production runs it in a worker thread.

export type ReplayVerdict =
  /** It matches (ok) or not (mismatch: the run becomes suspicious), with every figure compared. */
  | { status: 'ok' | 'mismatch'; detail: { rows: CheckRow[] } }
  /** It cannot be checked: an admin accepts or discards it. */
  | { status: 'unverifiable'; detail: { reason: UnverifiableReason } }
  /** The replay itself failed (a bug, a timeout): an admin decides too. */
  | { status: 'error'; detail: { reason: string } };

/** Replays a kept solo run and says whether its end is the one the client sent. */
export function verifyRun(data: AdminRunReplay, simVersion: string = SIM_VERSION): ReplayVerdict {
  // Group runs are refereed by the server as they are played: they never reach the review.
  if (data.coop) return { status: 'unverifiable', detail: { reason: 'coop' } };
  // Another simulation plays the same inputs differently.
  if (data.run.simVersion !== simVersion) return { status: 'unverifiable', detail: { reason: 'sim_version' } };
  // The content it started with is gone from the history or no longer reads.
  if (data.contentFallback) return { status: 'unverifiable', detail: { reason: 'content_unreadable' } };
  if (!data.inputs) return { status: 'unverifiable', detail: { reason: 'inputs_missing' } };
  let log: InputLog;
  try {
    log = decodeLog(fromBase64(data.inputs));
    if (log.probes !== 1) throw new RangeError('bad_log');
  } catch {
    return { status: 'unverifiable', detail: { reason: 'inputs_unreadable' } };
  }
  try {
    const sim = replay(replayOptionsOf(data.start), log, replayUntil(data.run));
    const { matches, rows } = checkReplay(sim, data.run);
    return { status: matches ? 'ok' : 'mismatch', detail: { rows } };
  } catch (err) {
    return { status: 'error', detail: { reason: (err as Error).name || 'replay_failed' } };
  }
}
