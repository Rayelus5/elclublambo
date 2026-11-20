import type { BotRun } from '@galaxy/sim';
import type { QuickJob, QuickReply } from './quicksim.worker';

export type { QuickJob } from './quicksim.worker';
export interface QuickResult {
  live: BotRun[] | null;
  draft: BotRun[];
}

/**
 * Plays the quick check in a worker of its own (the content editor, 2026-11-16, P7): `promise` ends with every run of
 * both sides; `cancel` stops it at once (the worker is ended, nothing is left running).
 */
export function runQuickSim(job: QuickJob, onProgress?: (done: number, total: number) => void): { promise: Promise<QuickResult>; cancel: () => void } {
  const worker = new Worker(new URL('./quicksim.worker.ts', import.meta.url), { type: 'module', name: 'galaxy-quicksim' });
  let cancel = () => worker.terminate();
  const promise = new Promise<QuickResult>((resolve, reject) => {
    cancel = () => {
      worker.terminate();
      reject(new Error('cancelled'));
    };
    worker.onmessage = (event: MessageEvent<QuickReply>) => {
      const reply = event.data;
      if (reply.type === 'progress') onProgress?.(reply.done, reply.total);
      else {
        worker.terminate();
        if (reply.type === 'done') resolve({ live: reply.live, draft: reply.draft });
        else reject(new Error(reply.error));
      }
    };
    worker.onerror = (event) => {
      worker.terminate();
      reject(new Error(event.message));
    };
    worker.postMessage(job);
  });
  return { promise, cancel: () => cancel() };
}
