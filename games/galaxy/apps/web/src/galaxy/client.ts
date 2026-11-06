import type { BrailleRender, Lod, Traits } from '@galaxy/engine';
import type { GalaxyJob, GalaxyReply } from './worker';

// One engine Worker for the whole app, fed one job at a time from a queue: a job aborted while it waits is never
// sent, one aborted while running is discarded when it returns. Aborted jobs reject with an AbortError. A Worker that
// cannot start or fails rejects its job and is thrown away; the next job gets a fresh one. Nothing ever hangs.
export type GalaxyRender = BrailleRender & { traits: Traits };

type Pending = {
  job: GalaxyJob;
  resolve: (render: GalaxyRender) => void;
  reject: (error: unknown) => void;
  signal?: AbortSignal;
};

let worker: Worker | null = null;
let running: Pending | null = null;
const queue: Pending[] = [];
let nextId = 1;

const abortError = () => new DOMException('The galaxy render was aborted', 'AbortError');

/** Drops the current Worker and fails the job it was running; the queue moves on with a fresh Worker. */
function fail(error: Error): void {
  worker?.terminate();
  worker = null;
  const job = running;
  running = null;
  job?.reject(error);
  pump();
}

function engine(): Worker {
  if (!worker) {
    const w = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module', name: 'galaxy-engine' });
    w.onmessage = (event: MessageEvent<GalaxyReply>) => {
      const job = running;
      running = null;
      if (job && job.job.id === event.data.id) {
        if (job.signal?.aborted) job.reject(abortError());
        else if ('error' in event.data) job.reject(new Error(event.data.error));
        else job.resolve(event.data.render as GalaxyRender);
      }
      pump();
    };
    w.onerror = (event) => fail(new Error(event.message || 'galaxy worker failed'));
    w.onmessageerror = () => fail(new Error('galaxy worker sent a message that could not be read'));
    worker = w;
  }
  return worker;
}

function pump(): void {
  if (running) return;
  let next = queue.shift();
  while (next?.signal?.aborted) next = queue.shift();
  if (!next) return;
  try {
    engine().postMessage(next.job);
    running = next;
  } catch (error) {
    worker = null;
    next.reject(error);
    pump();
  }
}

export function requestGalaxy(seed: bigint, columns: Lod, fixed?: Partial<Traits>, signal?: AbortSignal): Promise<GalaxyRender> {
  if (signal?.aborted) return Promise.reject(abortError());
  return new Promise<GalaxyRender>((resolve, reject) => {
    const onAbort = () => {
      const i = queue.indexOf(pending);
      if (i >= 0) queue.splice(i, 1);
      reject(abortError());
    };
    const settle = () => signal?.removeEventListener('abort', onAbort);
    const pending: Pending = {
      job: { id: nextId++, seed: seed.toString(), columns, fixed },
      resolve: (render) => {
        settle();
        resolve(render);
      },
      reject: (error) => {
        settle();
        reject(error);
      },
      signal,
    };
    signal?.addEventListener('abort', onAbort, { once: true });
    queue.push(pending);
    pump();
  });
}
