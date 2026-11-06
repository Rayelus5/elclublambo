import type { BrailleRender, Lod, Traits } from '@galaxy/engine';
import type { GalaxyJob, GalaxyReply } from './worker';

// One engine Worker for the whole app, fed one job at a time from a queue: a job aborted while it waits is never
// sent, one aborted while running is discarded when it returns. Aborted jobs reject with an AbortError.
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

function engine(): Worker {
  if (!worker) {
    worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module', name: 'galaxy-engine' });
    worker.onmessage = (event: MessageEvent<GalaxyReply>) => {
      const job = running;
      running = null;
      if (job && job.job.id === event.data.id) {
        if (job.signal?.aborted) job.reject(abortError());
        else if ('error' in event.data) job.reject(new Error(event.data.error));
        else job.resolve(event.data.render as GalaxyRender);
      }
      pump();
    };
    worker.onerror = (event) => {
      const job = running;
      running = null;
      job?.reject(new Error(event.message || 'galaxy worker failed'));
      pump();
    };
  }
  return worker;
}

function pump(): void {
  if (running) return;
  let next = queue.shift();
  while (next?.signal?.aborted) next = queue.shift();
  if (!next) return;
  running = next;
  engine().postMessage(next.job);
}

export function requestGalaxy(seed: bigint, columns: Lod, fixed?: Partial<Traits>, signal?: AbortSignal): Promise<GalaxyRender> {
  if (signal?.aborted) return Promise.reject(abortError());
  return new Promise<GalaxyRender>((resolve, reject) => {
    const pending: Pending = { job: { id: nextId++, seed: seed.toString(), columns, fixed }, resolve, reject, signal };
    signal?.addEventListener(
      'abort',
      () => {
        const i = queue.indexOf(pending);
        if (i >= 0) queue.splice(i, 1);
        reject(abortError());
      },
      { once: true },
    );
    queue.push(pending);
    pump();
  });
}
