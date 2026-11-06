/// <reference lib="webworker" />
import { renderFromSeed, type Lod, type Traits } from '@galaxy/engine';

// The galaxy engine off the main thread: one job at a time (the client queues them), buffers transferred back.
export type GalaxyJob = { id: number; seed: string; columns: Lod; fixed?: Partial<Traits> };
export type GalaxyReply =
  | { id: number; render: ReturnType<typeof renderFromSeed> }
  | { id: number; error: string };

const scope = self as unknown as DedicatedWorkerGlobalScope;

scope.onmessage = (event: MessageEvent<GalaxyJob>) => {
  const { id, seed, columns, fixed } = event.data;
  try {
    const render = renderFromSeed(BigInt(seed), { columns, fixed });
    scope.postMessage({ id, render } satisfies GalaxyReply, [render.on.buffer, render.dotColor.buffer, render.dotRadius.buffer]);
  } catch (error) {
    scope.postMessage({ id, error: error instanceof Error ? error.message : String(error) } satisfies GalaxyReply);
  }
};
