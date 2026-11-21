import { Worker } from 'node:worker_threads';
import type { AdminRunReplay } from '@galaxy/shared';
import { type ReplayVerdict, verifyRun } from './replay';

// Who replays the review's runs (plan «temporadas como fichas», part 5; GDD §18): the game is one Node process, so in
// production a long replay runs in a worker thread (`dist/replay-worker.js`, the server bundle's third entry), one at a
// time, and the event loop that serves the game never waits for it. The tests replay in the process.

export interface Replayer {
  verify(data: AdminRunReplay): Promise<ReplayVerdict>;
  close(): Promise<void>;
}

/** Replays in this process (the tests; nothing else runs meanwhile). */
export function inlineReplayer(): Replayer {
  return { verify: async (data) => verifyRun(data), close: async () => undefined };
}

/** The production replayer's worker: next to the bundle that starts it. */
export const REPLAY_WORKER_URL = () => new URL('./replay-worker.js', import.meta.url);

/**
 * Replays in a worker thread started from `url`, one run at a time (the next waits for the one before). A run that takes
 * longer than `timeoutMs` (5 minutes by default) or a worker that fails is an `error` verdict, and the worker is
 * replaced by a new one for the next run.
 */
export function workerReplayer(opts: { url: URL; timeoutMs?: number; onError?: (err: unknown) => void }): Replayer {
  const timeoutMs = opts.timeoutMs ?? 300_000;
  let worker: Worker | null = null;
  let seq = 0;
  let chain: Promise<unknown> = Promise.resolve();
  let closed = false;

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

  const one = (data: AdminRunReplay): Promise<ReplayVerdict> =>
    new Promise<ReplayVerdict>((resolve) => {
      if (closed) return resolve({ status: 'error', detail: { reason: 'closed' } });
      const w = fresh();
      const id = ++seq;
      const done = (v: ReplayVerdict, kill = false) => {
        clearTimeout(timer);
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
      const w = worker;
      worker = null;
      if (w) await w.terminate();
    },
  };
}
