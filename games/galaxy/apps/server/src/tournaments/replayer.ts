import { Worker } from 'node:worker_threads';
import type { AdminRunReplay } from '@galaxy/shared';
import { type ReplayVerdict, verifyRun } from './replay';

// Who replays the review's runs (plan «temporadas como fichas», part 5; GDD §18): the game is one Node process, so in
// production a long replay runs in a worker thread (`dist/replay-worker.js`, the server bundle's third entry), one at a
// time, and the event loop that serves the game never waits for it. The tests replay in the process. Closing (a deploy's
// SIGTERM) aborts what is in flight: an aborted replay is no verdict, its check stays pending for the next process. A
// worker that dies or runs out of time is tried again, a few times, before its check becomes an error.

/** A replay that did not happen (the replayer closed): nothing is written, the check stays pending. */
export type ReplayOutcome = ReplayVerdict | { status: 'aborted' };

export interface Replayer {
  verify(data: AdminRunReplay): Promise<ReplayOutcome>;
  close(): Promise<void>;
}

/** How many times a check is replayed when its worker dies or runs out of time, before it is an error. */
export const MAX_REPLAY_ATTEMPTS = 3;
const RETRYABLE = new Set(['timeout', 'worker_failed']);

/** Whether a verdict is the worker's failure, not the run's, and the check is tried again (`attempts`: tries before). */
export function retryOf(v: ReplayVerdict, attempts: number): boolean {
  return v.status === 'error' && RETRYABLE.has(v.detail.reason) && attempts + 1 < MAX_REPLAY_ATTEMPTS;
}

/** Replays in this process (the tests; nothing else runs meanwhile). */
export function inlineReplayer(): Replayer {
  let closed = false;
  return {
    verify: async (data) => (closed ? { status: 'aborted' } : verifyRun(data)),
    close: async () => {
      closed = true;
    },
  };
}

/** The production replayer's worker: next to the bundle that starts it. */
export const REPLAY_WORKER_URL = () => new URL('./replay-worker.js', import.meta.url);

/**
 * Replays in a worker thread started from `url`, one run at a time (the next waits for the one before). A run that takes
 * longer than `timeoutMs` (5 minutes by default) or a worker that fails is an `error` verdict (`timeout`,
 * `worker_failed`: retryable), and the worker is replaced by a new one for the next run. After `close()`, the run in
 * flight and every one still waiting answer `aborted`.
 */
export function workerReplayer(opts: { url: URL; timeoutMs?: number; onError?: (err: unknown) => void }): Replayer {
  const timeoutMs = opts.timeoutMs ?? 300_000;
  let worker: Worker | null = null;
  let seq = 0;
  let chain: Promise<unknown> = Promise.resolve();
  let closed = false;
  /** Ends the run in flight (close aborts it). */
  let abortCurrent: (() => void) | null = null;

  const fresh = (): Worker => {
    if (worker) return worker;
    const w = new Worker(opts.url);
    // Never what keeps the process alive at shutdown.
    w.unref();
    w.on('error', (err) => opts.onError?.(err));
    w.on('exit', () => {
      if (worker === w) worker = null;
    });
    worker = w;
    return w;
  };

  const one = (data: AdminRunReplay): Promise<ReplayOutcome> =>
    new Promise<ReplayOutcome>((resolve) => {
      if (closed) return resolve({ status: 'aborted' });
      const w = fresh();
      const id = ++seq;
      const done = (v: ReplayOutcome, kill = false) => {
        clearTimeout(timer);
        abortCurrent = null;
        w.off('message', onMessage);
        w.off('error', onFail);
        w.off('exit', onFail);
        if (kill) {
          if (worker === w) worker = null;
          void w.terminate();
        }
        resolve(v);
      };
      const onMessage = (m: { id: number; verdict: ReplayVerdict }) => {
        if (m.id === id) done(m.verdict);
      };
      const onFail = () => done({ status: 'error', detail: { reason: 'worker_failed' } }, true);
      const timer = setTimeout(() => done({ status: 'error', detail: { reason: 'timeout' } }, true), timeoutMs);
      abortCurrent = () => done({ status: 'aborted' }, true);
      w.on('message', onMessage);
      w.once('error', onFail);
      w.once('exit', onFail);
      w.postMessage({ id, data });
    });

  return {
    verify(data) {
      const next = chain.then(() => one(data));
      chain = next.catch(() => undefined);
      return next;
    },
    async close() {
      closed = true;
      abortCurrent?.();
      const w = worker;
      worker = null;
      if (w) await w.terminate();
    },
  };
}
