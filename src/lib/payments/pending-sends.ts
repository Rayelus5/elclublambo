import type { ChainId } from "@/lib/economy/networks";
import type { TipIntent } from "@/lib/payments/tip-actions";

/**
 * Local ledger of in-flight sends (F3b-R4). A hash is written here as soon as the wallet returns it, before the server
 * is told, so a closed tab or a failed attach never costs the member a second payment.
 * Every access is wrapped: the flow must keep working when storage is unavailable.
 */
/** What a send pays for: a message or profile tip, or a bounty (targetId is the bounty message id). */
export type LedgerTargetType = "message" | "profile" | "bounty";

export type PendingSend = {
  intentId: string;
  chainId: number;
  token: "ETH" | "USDC";
  targetType: LedgerTargetType;
  targetId: string;
  /** Always false since P0-R5 (one transfer, no fee); true only on entries left by the fee era, which are pruned. */
  feeRequired: boolean;
  mainHash?: string;
  mainAttached?: boolean;
  createdAt: number;
  /** Timestamp set while a wallet signature request is pending; cleared when it settles (F3b-R5). */
  inFlight?: number;
  /** The server intent, kept so the main transfer can be signed later for the same intent. */
  intent: TipIntent;
};

export const SEND_TTL_MS = 7 * 24 * 60 * 60 * 1000;

const key = (memberId: string) => `elclub:pending-sends:${memberId}`;

function write(memberId: string, list: PendingSend[]): void {
  try {
    if (list.length === 0) window.localStorage.removeItem(key(memberId));
    else window.localStorage.setItem(key(memberId), JSON.stringify(list));
  } catch {
    /* storage unavailable: the in-memory flow still works */
  }
}

/** Entries younger than 7 days; expired ones are dropped from storage on the way. */
export function loadSends(memberId: string, now = Date.now()): PendingSend[] {
  let list: PendingSend[] = [];
  try {
    const raw = window.localStorage.getItem(key(memberId));
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    if (Array.isArray(parsed)) list = parsed.filter((e): e is PendingSend => !!e && typeof e === "object" && typeof (e as PendingSend).intentId === "string");
  } catch {
    return [];
  }
  const fresh = list.filter((e) => typeof e.createdAt === "number" && now - e.createdAt < SEND_TTL_MS);
  if (fresh.length !== list.length) write(memberId, fresh);
  return fresh;
}

export function upsertSend(memberId: string, entry: PendingSend): void {
  const list = loadSends(memberId).filter((e) => e.intentId !== entry.intentId);
  write(memberId, [...list, entry]);
}

export function patchSend(memberId: string, intentId: string, patch: Partial<PendingSend>): void {
  const list = loadSends(memberId);
  if (!list.some((e) => e.intentId === intentId)) return;
  write(memberId, list.map((e) => (e.intentId === intentId ? { ...e, ...patch } : e)));
}

export function removeSend(memberId: string, intentId: string): void {
  write(memberId, loadSends(memberId).filter((e) => e.intentId !== intentId));
}

/** Do not sign (or resume) with less than this left on the server intent: the attach would be refused as expired. */
export const EXPIRY_MARGIN_MS = 10 * 60 * 1000;
/** A pending-signature marker older than this is considered abandoned. */
export const IN_FLIGHT_TTL_MS = 10 * 60 * 1000;

/** Attach errors that will never succeed: stop retrying. Anything else (network, unknown) is retried. */
export const PERMANENT_ATTACH_CODES: ReadonlySet<string> = new Set(["intent_expired", "forbidden", "not_found"]);

/** Time left on the server intent (its own `expiresAt`, never client-derived). Unparseable counts as expired. */
export function remainingMs(intent: Pick<TipIntent, "expiresAt">, now = Date.now()): number {
  const t = Date.parse(intent.expiresAt);
  return Number.isNaN(t) ? -1 : t - now;
}

/**
 * Drops leftovers that can never complete here (Review Focus 4): entries of the fee era (two transfers) and entries on a
 * chain that is not enabled (a legacy chain, or a network the SuperAdmin turned off). Returns how many were dropped.
 */
export function pruneUnsupportedSends(memberId: string, enabled: readonly ChainId[]): number {
  const list = loadSends(memberId);
  const keep = list.filter((e) => e.feeRequired !== true && (enabled as readonly number[]).includes(e.chainId));
  if (keep.length !== list.length) write(memberId, keep);
  return list.length - keep.length;
}

/** A signature request for this target that may still be waiting in the wallet. */
export function findInFlight(memberId: string, targetType: LedgerTargetType, targetId: string, now = Date.now()): PendingSend | undefined {
  return loadSends(memberId, now).find(
    (e) => e.targetType === targetType && e.targetId === targetId && typeof e.inFlight === "number" && now - e.inFlight < IN_FLIGHT_TTL_MS,
  );
}
