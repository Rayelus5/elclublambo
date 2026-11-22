import { parentPort } from 'node:worker_threads';
import type { AdminRunReplay } from '@galaxy/shared';
import { type ReplayVerdict, verifyRun } from './replay';

// The review's replay thread (plan «temporadas como fichas», part 5): `dist/replay-worker.js`, started by the server's
// replayer (replayer.ts). It gets one run at a time and answers its verdict; nothing here touches the database.

parentPort?.on('message', (m: { id: number; data: AdminRunReplay }) => {
  let verdict: ReplayVerdict;
  try {
    verdict = verifyRun(m.data);
  } catch (err) {
    verdict = { status: 'error', detail: { reason: (err as Error).name || 'replay_failed' } };
  }
  parentPort!.postMessage({ id: m.id, verdict });
});
