// R5/NEW-3: one tab at a time runs a list (progress key). With Web Locks (withRunLock) the lock is held for the whole
// run. Without them, a lock in localStorage: { tab, beat }; the running tab beats every HEARTBEAT_MS, a lock whose beat
// is LOCK_STALE_MS old is stale and may be taken, and the run re-checks it before every prompt. Either way the storage
// value doubles as the marker other tabs watch (storage events) to show «Otra pestaña está enviando esta lista».
// Without storage there is no storage lock (the page warns about reloads and other tabs). Every access is guarded.

export const HEARTBEAT_MS = 10_000;
export const LOCK_STALE_MS = 30_000;

/** This tab's id, for the life of the page. */
export const TAB_ID: string =
  typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `tab-${Math.random().toString(36).slice(2)}`;

type Lock = { tab: string; beat: number };

export const lockKey = (runKey: string) => `${runKey}:lock`;

/**
 * NEW-5: what a run locks: the wallet on the chain, not the list, so no two runs of the same wallet overlap in any tab
 * (two lists can share a line).
 */
export const walletRunKey = (owner: `0x${string}`, chain: number) => `elclub:multisend:${chain}:${owner.toLowerCase()}`;

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

/** Whether `tab` still holds the storage lock. Without storage there is no lock to lose: true. */
export function ownsLock(runKey: string, tab: string): boolean {
  try {
    return parseLock(window.localStorage.getItem(lockKey(runKey)))?.tab === tab;
  } catch {
    return true;
  }
}

/** Writes this tab's marker whatever is there (only under a held Web Lock, where the marker is only for display). */
function writeMarker(runKey: string, tab: string): void {
  try {
    window.localStorage.setItem(lockKey(runKey), JSON.stringify({ tab, beat: Date.now() }));
  } catch {
    // No storage, no marker.
  }
}

type LockManagerLike = {
  request(name: string, options: { ifAvailable: boolean }, cb: (lock: unknown) => Promise<unknown>): Promise<unknown>;
};

function webLocks(): LockManagerLike | null {
  const locks = typeof navigator === "undefined" ? undefined : (navigator as { locks?: Partial<LockManagerLike> }).locks;
  return typeof locks?.request === "function" ? (locks as LockManagerLike) : null;
}

/**
 * NEW-3: runs `fn` while this tab alone runs the list, or returns `{ ran: false }` when another tab is running it.
 * - With Web Locks: `navigator.locks.request(key, { ifAvailable: true })`, held until `fn` settles. Timer throttling in
 *   a hidden tab cannot make it stale. The storage marker is still written, only so other tabs can show the notice.
 * - Without them: the storage lock (heartbeat, stale after 30 s), which a throttled tab can lose. `fn` gets `owns()`
 *   and must check it (and re-read storage) before every wallet prompt, stopping when it is false.
 * - A Web Locks request that fails before granting anything falls back to the storage lock.
 */
export async function withRunLock<T>(runKey: string, fn: (owns: () => boolean) => Promise<T>): Promise<{ ran: true; value: T } | { ran: false }> {
  const locks = webLocks();
  if (locks) {
    let granted = false;
    let value!: T;
    try {
      await locks.request(lockKey(runKey), { ifAvailable: true }, async (lock) => {
        if (!lock) return;
        granted = true;
        writeMarker(runKey, TAB_ID);
        const beat = setInterval(() => writeMarker(runKey, TAB_ID), HEARTBEAT_MS);
        try {
          value = await fn(() => true);
        } finally {
          clearInterval(beat);
          releaseLock(runKey, TAB_ID);
        }
      });
    } catch (err) {
      if (granted) throw err;
      return storageLocked(runKey, fn);
    }
    return granted ? { ran: true, value } : { ran: false };
  }
  return storageLocked(runKey, fn);
}

async function storageLocked<T>(runKey: string, fn: (owns: () => boolean) => Promise<T>): Promise<{ ran: true; value: T } | { ran: false }> {
  if (!acquireLock(runKey, TAB_ID, Date.now())) return { ran: false };
  const beat = setInterval(() => heartbeat(runKey, TAB_ID, Date.now()), HEARTBEAT_MS);
  try {
    return { ran: true, value: await fn(() => ownsLock(runKey, TAB_ID)) };
  } finally {
    clearInterval(beat);
    releaseLock(runKey, TAB_ID);
  }
}
