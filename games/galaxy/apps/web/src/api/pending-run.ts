import type { FinishRunRequest } from '@galaxy/shared';

// A finished run whose result has not reached the server yet (plan ruling 17). It is kept in localStorage with its
// Idempotency-Key, so a dropped connection, a deploy or a reload never loses it, and sending it again never pays twice.

const KEY = 'galaxy.run.pending';

export interface PendingRun {
  runId: string;
  key: string;
  body: FinishRunRequest;
}

export function savePending(p: PendingRun): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(p));
  } catch {
    // No storage (private window, full): the run is only kept in memory for this page.
  }
}

export function clearPending(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // Nothing to clear.
  }
}

export function loadPending(): PendingRun | null {
  let raw: string | null;
  try {
    raw = localStorage.getItem(KEY);
  } catch {
    return null;
  }
  if (!raw) return null;
  try {
    const p = JSON.parse(raw) as Partial<PendingRun>;
    if (typeof p.runId === 'string' && typeof p.key === 'string' && p.body && typeof p.body === 'object' && typeof p.body.inputs === 'string') return p as PendingRun;
  } catch {
    // Unreadable: dropped below.
  }
  clearPending();
  return null;
}
