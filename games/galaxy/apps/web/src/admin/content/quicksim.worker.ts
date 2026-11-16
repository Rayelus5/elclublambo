/// <reference lib="webworker" />
import { type BotRun, type Content, playBot } from '@galaxy/sim';

// The content editor's quick check off the main thread (2026-11-16, P7): the bot plays the same seeds with what is
// published and with the draft, telling its progress as each run ends.
export interface QuickJob {
  /** What is published, or null when it does not have the sector or the probe (a new one). */
  live: Content | null;
  draft: Content;
  sector: string;
  probe: string;
  seeds: string[];
  maxMinutes: number;
}
export type QuickReply = { type: 'progress'; done: number; total: number } | { type: 'done'; live: BotRun[] | null; draft: BotRun[] } | { type: 'error'; error: string };

const scope = self as unknown as DedicatedWorkerGlobalScope;

scope.onmessage = (event: MessageEvent<QuickJob>) => {
  const { live, draft, sector, probe, seeds, maxMinutes } = event.data;
  try {
    const total = seeds.length * (live ? 2 : 1);
    let done = 0;
    const play = (content: Content) =>
      seeds.map((seed) => {
        const run = playBot(content, { sector, probe, seed, maxMinutes });
        done++;
        scope.postMessage({ type: 'progress', done, total } satisfies QuickReply);
        return run;
      });
    const liveRuns = live ? play(live) : null;
    scope.postMessage({ type: 'done', live: liveRuns, draft: play(draft) } satisfies QuickReply);
  } catch (error) {
    scope.postMessage({ type: 'error', error: error instanceof Error ? error.message : String(error) } satisfies QuickReply);
  }
};
