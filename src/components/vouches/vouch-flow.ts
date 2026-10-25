import type { Dictionary } from "@/lib/i18n";
import type { VouchError } from "@/lib/vouches/types";
import { NOT_FOUND_GIVE_UP_MS, writeErrorKind } from "@/lib/web3/signing";

// Vouch-specific parts of the signing flow; the shared helpers (retry, sent-hash storage, error kinds) live in
// src/lib/web3/signing.ts.

/** Waits between calls while the server answers `pending`: at most five calls, each one hit of vouch_write. */
export const PENDING_DELAYS_MS: readonly number[] = [1000, 2000, 4000, 8000];

/** Answers after which the hash will never become a vouch (or a revocation) whatever its age. */
const FINAL: ReadonlySet<VouchError> = new Set(["invalid_input", "chain_unsupported", "tx_failed", "not_a_vouch", "wrong_attester", "self_vouch"]);

/** Whether to drop a sent hash after this answer, so the user can sign again; pending, RPC and limit errors keep it. */
export function isFinalVouchError(code: VouchError, sentAt: number, now: number = Date.now()): boolean {
  if (FINAL.has(code)) return true;
  return code === "tx_not_found" && now - sentAt >= NOT_FOUND_GIVE_UP_MS;
}

/** The text for a wallet write that threw. */
export function writeErrorText(err: unknown, t: Dictionary["vouches"]["form"]): string {
  const kind = writeErrorKind(err);
  return kind === "switch" ? t.switchFailed : kind === "cancelled" ? t.cancelled : t.failed;
}
