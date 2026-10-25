// R5: a cross-tab run lock per list (progress key) in localStorage: { tab, beat }. The running tab beats every
// HEARTBEAT_MS; a lock whose beat is LOCK_STALE_MS old is stale and may be taken. Other tabs watch it through `storage`
// events and refuse to start a run meanwhile. Without storage there is no lock (the page already says progress lives
// only in this tab). Every access is guarded.

export const HEARTBEAT_MS = 10_000;
export const LOCK_STALE_MS = 30_000;

/** This tab's id, for the life of the page. */
export const TAB_ID: string =
  typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `tab-${Math.random().toString(36).slice(2)}`;

type Lock = { tab: string; beat: number };

export const lockKey = (runKey: string) => `${runKey}:lock`;

export function readLockRaw(runKey: string): string | null {
  try {
    return window.localStorage.getItem(lockKey(runKey));
  } catch {
    return null;
  }
}

function parseLock(raw: string | null): Lock | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Partial<Lock>;
    return typeof v.tab === "string" && typeof v.beat === "number" && Number.isFinite(v.beat) ? { tab: v.tab, beat: v.beat } : null;
  } catch {
    return null;
  }
}

/** Whether another tab holds a fresh lock at `now`. */
export function lockedByOther(raw: string | null, tab: string, now: number): boolean {
  const lock = parseLock(raw);
  return lock !== null && lock.tab !== tab && now - lock.beat < LOCK_STALE_MS;
}

/** Takes the lock for `tab` unless another tab holds a fresh one. Without storage: true (no lock to take). */
export function acquireLock(runKey: string, tab: string, now: number): boolean {
  try {
    if (lockedByOther(window.localStorage.getItem(lockKey(runKey)), tab, now)) return false;
    window.localStorage.setItem(lockKey(runKey), JSON.stringify({ tab, beat: now }));
    // Two tabs writing at once: the last write wins, and only its tab goes on.
    return parseLock(window.localStorage.getItem(lockKey(runKey)))?.tab === tab;
  } catch {
    return true;
  }
}

/** Refreshes the beat of `tab`'s own lock; never touches another tab's. */
export function heartbeat(runKey: string, tab: string, now: number): void {
  try {
    if (parseLock(window.localStorage.getItem(lockKey(runKey)))?.tab !== tab) return;
    window.localStorage.setItem(lockKey(runKey), JSON.stringify({ tab, beat: now }));
  } catch {
    // No storage, no lock.
  }
}

export function releaseLock(runKey: string, tab: string): void {
  try {
    if (parseLock(window.localStorage.getItem(lockKey(runKey)))?.tab === tab) window.localStorage.removeItem(lockKey(runKey));
  } catch {
    // No storage, no lock.
  }
}
