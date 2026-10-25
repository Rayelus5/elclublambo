import type { ChainId } from "@/lib/economy/networks";

type Address = `0x${string}`;
type Hash = `0x${string}`;

/**
 * Where a line stands (the state model of fix round 2; only `todo` and a ticked `not_found` may be signed):
 * - `todo`: may be signed. With an `attempt` (a definitive rejection), it is scanned first.
 * - `sent`: the wallet returned a hash (or a batch id); waiting for the receipt.
 * - `confirmed`: a receipt (or a log scan) holds the USDC Transfer(wallet → recipient, amount); `hash` is that tx.
 * - `unconfirmed`: attempted, nothing verified yet (a wallet error, a timeout, a receipt without the Transfer, a
 *   reload during the prompt, a non-successful batch, or a scan that found nothing while the attempt is fresh).
 * - `not_found`: a successful scan found nothing after the give-up window; the user may tick it to send it again.
 * - `scan_failed`: the scan itself failed; never tickable, only «Reintentar comprobación».
 */
export type RowStatus = "todo" | "sent" | "confirmed" | "unconfirmed" | "not_found" | "scan_failed";

/**
 * One line of a send as this browser last saw it, keyed by its identity (`id`, see lineId; C3). `attempt` is written
 * before every wallet prompt: `at` (when) and `block` (the earliest block read before any attempt: where a log scan
 * starts). `callsId` marks a line sent in an atomic batch (EIP-5792).
 */
export type RowState = {
  id: string;
  to: Address;
  /** Base units, as a decimal string (JSON has no bigint). */
  amount: string;
  hash?: Hash;
  attempt?: { block?: string; at: number };
  callsId?: string;
  status: RowStatus;
};

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const TX_HASH = /^0x[0-9a-fA-F]{64}$/;
const UNITS = /^\d+$/;
const STATUSES = new Set<string>(["todo", "sent", "confirmed", "unconfirmed", "not_found", "scan_failed"]);

function isAttempt(v: unknown): boolean {
  if (typeof v !== "object" || v === null) return false;
  const a = v as Record<string, unknown>;
  return typeof a.at === "number" && Number.isFinite(a.at) && (a.block === undefined || (typeof a.block === "string" && UNITS.test(a.block)));
}

/** `elclub:multisend:<chainId>:<owner>:<list hash>` (P6-R3). */
export const progressKey = (owner: Address, chain: ChainId, key: string) => `elclub:multisend:${chain}:${owner.toLowerCase()}:${key}`;

function isRow(v: unknown): v is RowState {
  if (typeof v !== "object" || v === null) return false;
  const r = v as Record<string, unknown>;
  return (
    typeof r.id === "string" &&
    r.id !== "" &&
    typeof r.to === "string" &&
    ADDRESS.test(r.to) &&
    typeof r.amount === "string" &&
    UNITS.test(r.amount) &&
    typeof r.status === "string" &&
    STATUSES.has(r.status) &&
    (r.hash === undefined || (typeof r.hash === "string" && TX_HASH.test(r.hash))) &&
    (r.attempt === undefined || isAttempt(r.attempt)) &&
    (r.callsId === undefined || (typeof r.callsId === "string" && r.callsId !== ""))
  );
}

/** The raw stored value (for useSyncExternalStore), or null without storage. */
export function readProgressRaw(owner: Address, chain: ChainId, key: string): string | null {
  try {
    return window.localStorage.getItem(progressKey(owner, chain, key));
  } catch {
    return null;
  }
}

export function parseProgress(raw: string | null): RowState[] | null {
  if (!raw) return null;
  try {
    const v: unknown = JSON.parse(raw);
    return Array.isArray(v) && v.length > 0 && v.every(isRow) ? v : null;
  } catch {
    return null;
  }
}

export function loadProgress(owner: Address, chain: ChainId, key: string): RowState[] | null {
  return parseProgress(readProgressRaw(owner, chain, key));
}

/** False when storage refused the write: the caller's in-memory copy is then the only record (finding 1). */
export function saveProgress(owner: Address, chain: ChainId, key: string, rows: readonly RowState[]): boolean {
  try {
    window.localStorage.setItem(progressKey(owner, chain, key), JSON.stringify(rows));
    return true;
  } catch {
    return false;
  }
}

/** Whether this browser lets the page keep its progress (a write and a removal of a probe key succeed). */
export function storageAvailable(): boolean {
  try {
    const k = "elclub:multisend:probe";
    window.localStorage.setItem(k, "1");
    window.localStorage.removeItem(k);
    return true;
  } catch {
    return false;
  }
}

const RANK: Record<RowStatus, number> = { todo: 0, scan_failed: 1, unconfirmed: 1, not_found: 1, sent: 2, confirmed: 3 };

/**
 * Per line, the more advanced of two copies (storage and memory, finding 1): confirmed beats anything, a sent hash
 * beats an attempt, an attempt beats a bare todo, and between equals the later attempt wins. A resume therefore never
 * resets a confirmed or attempted line, whichever copy was lost.
 */
export function mergeProgress(a: readonly RowState[] | null, b: readonly RowState[] | null): RowState[] | null {
  if (!a) return b ? [...b] : null;
  if (!b) return [...a];
  const score = (r: RowState) => RANK[r.status] * 2 + (r.attempt ? 1 : 0);
  return a.map((x, i) => {
    const y = b[i]!;
    if (score(x) !== score(y)) return score(x) > score(y) ? x : y;
    return (y.attempt?.at ?? 0) > (x.attempt?.at ?? 0) ? y : x;
  });
}

export function clearProgress(owner: Address, chain: ChainId, key: string): void {
  try {
    window.localStorage.removeItem(progressKey(owner, chain, key));
  } catch {
    // Nothing stored, or no storage at all.
  }
}

/**
 * The stored rows in the list's order when they are exactly the list's lines by identity (C3: a reordered list
 * resumes), or null for any other set of lines.
 */
export function alignProgress(stored: readonly RowState[] | null, lines: readonly { id: string }[]): RowState[] | null {
  if (!stored || stored.length !== lines.length) return null;
  const byId = new Map(stored.map((r) => [r.id, r]));
  if (byId.size !== stored.length) return null;
  const out: RowState[] = [];
  for (const l of lines) {
    const r = byId.get(l.id);
    if (!r) return null;
    out.push(r);
  }
  return out;
}

/** C3: confirmed sends of the last 24 h, in this browser, to warn about paying the same line twice from a new list. */
export const RECENT_KEY = "elclub:multisend:recent";
export const RECENT_MS = 24 * 60 * 60_000;
const RECENT_MAX = 200;
export type RecentSend = { chain: ChainId; to: Address; amount: string; hash?: Hash; at: number };

/** The raw record (for useSyncExternalStore), or null without storage. */
export function readRecentRaw(): string | null {
  try {
    return window.localStorage.getItem(RECENT_KEY);
  } catch {
    return null;
  }
}

/** The record's valid entries of `chain` younger than 24 h at `now`. */
export function parseRecent(raw: string | null, chain: ChainId, now: number): RecentSend[] {
  return parseRecentAll(raw).filter((e) => e.chain === chain && now - e.at < RECENT_MS);
}

function readRecent(): RecentSend[] {
  return parseRecentAll(readRecentRaw());
}

function parseRecentAll(raw: string | null): RecentSend[] {
  try {
    const v: unknown = JSON.parse(raw ?? "[]");
    if (!Array.isArray(v)) return [];
    return v.filter(
      (e): e is RecentSend =>
        typeof e === "object" &&
        e !== null &&
        typeof e.chain === "number" &&
        typeof e.to === "string" &&
        ADDRESS.test(e.to) &&
        typeof e.amount === "string" &&
        UNITS.test(e.amount) &&
        typeof e.at === "number" &&
        (e.hash === undefined || (typeof e.hash === "string" && TX_HASH.test(e.hash))),
    );
  } catch {
    return [];
  }
}

export function recordConfirmed(entry: Omit<RecentSend, "at">, now: number): void {
  try {
    const kept = readRecent().filter((e) => now - e.at < RECENT_MS && !(entry.hash && e.hash === entry.hash && e.to.toLowerCase() === entry.to.toLowerCase()));
    kept.push({ ...entry, at: now });
    window.localStorage.setItem(RECENT_KEY, JSON.stringify(kept.slice(-RECENT_MAX)));
  } catch {
    // Without storage there is no 24 h warning.
  }
}

export function recentConfirmed(chain: ChainId, now: number): RecentSend[] {
  return parseRecent(readRecentRaw(), chain, now);
}
