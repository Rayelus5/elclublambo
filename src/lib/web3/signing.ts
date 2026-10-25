// Helpers shared by every flow that signs from the user's wallet (vouches, approvals, and later multisend): the
// refused-switch marker, wallet error classification, the retry with back-off while a server answers `pending`, and the
// sent-hash guard kept in localStorage with when it was sent. Pure or storage-only: no React, no wagmi.

/** Thrown (as the error message) when the wallet did not move to the target chain: nothing was signed. */
export const CHAIN_SWITCH_FAILED = "chain_switch_failed";

/** A sent hash the chain still does not know after this long is taken as dropped or replaced (as the P2 prize button). */
export const NOT_FOUND_GIVE_UP_MS = 10 * 60_000;

/** When a hash was sent, or the time a check runs (called from event handlers and state initialisers, so components stay pure for the React Compiler lint). */
export const sentAtNow = (): number => Date.now();

type Answer = { ok: true } | { ok: false; error: string };

/**
 * Calls `record` until it answers something other than `pending`, waiting `delays[i]` before each retry. Resolves to
 * that answer, to "pending" when every call was pending, or to null when the component went away meanwhile.
 */
export async function recordUntilSettled<R extends Answer>(
  record: () => Promise<R>,
  delays: readonly number[],
  alive: () => boolean,
): Promise<R | "pending" | null> {
  for (let i = 0; i <= delays.length; i++) {
    const r = await record();
    if (!alive()) return null;
    const a: Answer = r;
    if (a.ok || a.error !== "pending") return r;
    if (i < delays.length) await new Promise((res) => setTimeout(res, delays[i]));
  }
  return "pending";
}

export function isUserRejection(err: unknown): boolean {
  if (typeof err !== "object" || err === null) return false;
  const e = err as { name?: string; code?: number; cause?: unknown };
  if (e.name === "UserRejectedRequestError" || e.code === 4001) return true;
  return e.cause ? isUserRejection(e.cause) : false;
}

/** Why a wallet write threw: the chain switch refused, the signature cancelled, or anything else (e.g. a failed estimate). */
export function writeErrorKind(err: unknown): "switch" | "cancelled" | "failed" {
  if (err instanceof Error && err.message === CHAIN_SWITCH_FAILED) return "switch";
  return isUserRejection(err) ? "cancelled" : "failed";
}

export type Sent = { hash: `0x${string}`; sentAt: number };
const TX_HASH = /^0x[0-9a-fA-F]{64}$/;

/** Whether a sent hash is still inside the give-up window at `now` (evaluate it when acting, not only at mount). */
export function isSentFresh(sent: Sent, now: number = Date.now()): boolean {
  return now - sent.sentAt < NOT_FOUND_GIVE_UP_MS;
}

/**
 * A signed hash the server has not settled yet, kept in localStorage under `key` with when it was sent, so a reload or
 * a second tab resumes on it instead of signing again. Storage may be missing or throw: every access is guarded and the
 * caller's in-memory copy takes over.
 */
export function readSentRaw(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function parseSent(raw: string | null): Sent | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as { hash?: unknown; sentAt?: unknown };
    if (typeof v.hash === "string" && TX_HASH.test(v.hash) && typeof v.sentAt === "number" && Number.isFinite(v.sentAt)) {
      return { hash: v.hash as `0x${string}`, sentAt: v.sentAt };
    }
  } catch {
    // Not ours.
  }
  return null;
}

export function writeSent(key: string, sent: Sent): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(sent));
  } catch {
    // Without storage the guard only lasts while the page is open.
  }
}

export function clearSent(key: string): void {
  try {
    window.localStorage.removeItem(key);
  } catch {
    // Nothing stored, or no storage at all.
  }
}

/** For useSyncExternalStore: other tabs writing the same key. */
export const subscribeStorage = (onChange: () => void) => {
  window.addEventListener("storage", onChange);
  return () => window.removeEventListener("storage", onChange);
};
export const noStored = () => null;
