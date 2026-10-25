import type { Dictionary } from "@/lib/i18n";
import type { VouchError } from "@/lib/vouches/types";
import { CHAIN_SWITCH_FAILED } from "@/lib/vouches/use-vouch-write";

/** Waits between calls while the server answers `pending`: at most five calls, each one hit of vouch_write. */
export const PENDING_DELAYS_MS: readonly number[] = [1000, 2000, 4000, 8000];

/** A sent hash the chain still does not know after this long is taken as dropped or replaced (as the P2 prize button). */
export const NOT_FOUND_GIVE_UP_MS = 10 * 60_000;

/** Answers after which the hash will never become a vouch (or a revocation) whatever its age. */
const FINAL: ReadonlySet<VouchError> = new Set(["invalid_input", "chain_unsupported", "tx_failed", "not_a_vouch", "wrong_attester", "self_vouch"]);

/** Whether to drop a sent hash after this answer, so the user can sign again; pending, RPC and limit errors keep it. */
export function isFinalVouchError(code: VouchError, sentAt: number, now: number = Date.now()): boolean {
  if (FINAL.has(code)) return true;
  return code === "tx_not_found" && now - sentAt >= NOT_FOUND_GIVE_UP_MS;
}

/** When a hash was sent (called from event handlers; kept here so components stay pure for the React Compiler lint). */
export const sentAtNow = (): number => Date.now();

type Answer<T> = ({ ok: true } & T) | { ok: false; error: VouchError };

/**
 * Calls `record` until it answers something other than `pending`, waiting `delays[i]` before each retry. Resolves to
 * that answer, to "pending" when every call was pending, or to null when the component went away meanwhile.
 */
export async function recordUntilSettled<T>(record: () => Promise<Answer<T>>, delays: readonly number[], alive: () => boolean): Promise<Answer<T> | "pending" | null> {
  for (let i = 0; i <= delays.length; i++) {
    const r = await record();
    if (!alive()) return null;
    if (r.ok || r.error !== "pending") return r;
    if (i < delays.length) await new Promise((res) => setTimeout(res, delays[i]));
  }
  return "pending";
}

function isUserRejection(err: unknown): boolean {
  if (typeof err !== "object" || err === null) return false;
  const e = err as { name?: string; code?: number; cause?: unknown };
  if (e.name === "UserRejectedRequestError" || e.code === 4001) return true;
  return e.cause ? isUserRejection(e.cause) : false;
}

/** The text for a wallet write that threw: the chain switch refused, the signature cancelled, or anything else. */
export function writeErrorText(err: unknown, t: Dictionary["vouches"]["form"]): string {
  if (err instanceof Error && err.message === CHAIN_SWITCH_FAILED) return t.switchFailed;
  return isUserRejection(err) ? t.cancelled : t.failed;
}
