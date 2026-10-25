import type { ChainId } from "@/lib/economy/networks";

type Address = `0x${string}`;
type Hash = `0x${string}`;

/**
 * Where a line stands (the state model of fix round 2; only `todo` and a ticked `not_found` may be signed):
 * - `todo`: may be signed. With an `attempt` (a definitive rejection of its first prompt), it is scanned first and
 *   signed only while the wallet has no pending tx (R1, NEW-2).
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
 * starts). `callsId` marks a line sent in an atomic batch (EIP-5792). `hash` is the confirming tx once `confirmed`, and
 * before that the last tx known for an attempt (for its explorer link). `updated` is when this copy last changed: two
 * copies of a line (storage and memory, or two tabs) merge to the newest (mergeProgress).
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
  updated?: number;
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
    (r.callsId === undefined || (typeof r.callsId === "string" && r.callsId !== "")) &&
    (r.updated === undefined || (typeof r.updated === "number" && Number.isFinite(r.updated)))
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
const stamp = (r: RowState) => r.updated ?? r.attempt?.at ?? 0;

/**
 * Per line, the newest of two copies (storage and memory, finding 1; or another tab's write): the one with the later
 * `updated` (its attempt time for copies written before it existed). A confirmed copy always wins, since nothing ever
 * follows a confirmation; between copies of the same age the more advanced one wins. A resume therefore never resets a
 * confirmed or attempted line, whichever copy was lost.
 */
export function mergeProgress(a: readonly RowState[] | null, b: readonly RowState[] | null): RowState[] | null {
  if (!a) return b ? [...b] : null;
  if (!b) return [...a];
  return a.map((x, i) => {
    const y = b[i]!;
    if ((x.status === "confirmed") !== (y.status === "confirmed")) return x.status === "confirmed" ? x : y;
    if (stamp(x) !== stamp(y)) return stamp(x) > stamp(y) ? x : y;
    const score = (r: RowState) => RANK[r.status] * 2 + (r.attempt ? 1 : 0);
    return score(y) > score(x) ? y : x;
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

/**
 * The 24 h record of this browser, across lists (C3, NEW-4): every confirmed send, to warn about paying the same line
 * twice from a new list, and every attempt, so a line attempted from one list is inherited as unconfirmed by any other
 * list (an edited one) and scanned before it can be signed. A confirmation clears the attempts it covers.
 */
export const RECENT_KEY = "elclub:multisend:recent";
export const RECENT_MS = 24 * 60 * 60_000;
/** Attempts share the record (up to 20 per run): room for 50 full runs a day before the oldest entry drops. */
const RECENT_MAX = 1000;
/** A confirmed send (no `kind`, as before fix round 4). `from` is the wallet, when known. */
export type RecentSend = { chain: ChainId; from?: Address; to: Address; amount: string; hash?: Hash; at: number };
/** An attempt: `at` is the attempt's time, `block` the block read before its prompt, `hash` its tx when known. */
export type RecentAttempt = { kind: "attempt"; chain: ChainId; from: Address; to: Address; amount: string; block?: string; hash?: Hash; at: number };
type RecentEntry = RecentSend | RecentAttempt;

const isAttemptEntry = (e: RecentEntry): e is RecentAttempt => "kind" in e && e.kind === "attempt";
const sameAddress = (a: string | undefined, b: string | undefined) => a !== undefined && b !== undefined && a.toLowerCase() === b.toLowerCase();

/** The raw record (for useSyncExternalStore), or null without storage. */
export function readRecentRaw(): string | null {
  try {
    return window.localStorage.getItem(RECENT_KEY);
  } catch {
    return null;
  }
}

function isEntry(e: unknown): e is RecentEntry {
  if (typeof e !== "object" || e === null) return false;
  const r = e as Record<string, unknown>;
  const base =
    typeof r.chain === "number" &&
    typeof r.to === "string" &&
    ADDRESS.test(r.to) &&
    typeof r.amount === "string" &&
    UNITS.test(r.amount) &&
    typeof r.at === "number" &&
    (r.hash === undefined || (typeof r.hash === "string" && TX_HASH.test(r.hash))) &&
    (r.from === undefined || (typeof r.from === "string" && ADDRESS.test(r.from)));
  if (!base) return false;
  if (r.kind === undefined) return true;
  return r.kind === "attempt" && typeof r.from === "string" && (r.block === undefined || (typeof r.block === "string" && UNITS.test(r.block)));
}

function parseRecentAll(raw: string | null): RecentEntry[] {
  try {
    const v: unknown = JSON.parse(raw ?? "[]");
    return Array.isArray(v) ? v.filter(isEntry) : [];
  } catch {
    return [];
  }
}

function writeRecent(entries: RecentEntry[]): void {
  try {
    window.localStorage.setItem(RECENT_KEY, JSON.stringify(entries.slice(-RECENT_MAX)));
  } catch {
    // Without storage there is no cross-list record (the page says so).
  }
}

/** The record's confirmed sends of `chain` younger than 24 h at `now` (the C3 warning). */
export function parseRecent(raw: string | null, chain: ChainId, now: number): RecentSend[] {
  return parseRecentAll(raw).filter((e): e is RecentSend => !isAttemptEntry(e) && e.chain === chain && now - e.at < RECENT_MS);
}

/** The record's attempts of `chain` from wallet `from` younger than 24 h at `now` (NEW-4). */
export function parseRecentAttempts(raw: string | null, chain: ChainId, from: Address, now: number): RecentAttempt[] {
  return parseRecentAll(raw).filter(
    (e): e is RecentAttempt => isAttemptEntry(e) && e.chain === chain && sameAddress(e.from, from) && now - e.at < RECENT_MS,
  );
}

const sameLine = (e: RecentEntry, l: { chain: ChainId; from?: Address; to: Address; amount: string }) =>
  e.chain === l.chain && sameAddress(e.to, l.to) && e.amount === l.amount && (l.from === undefined || e.from === undefined || sameAddress(e.from, l.from));

/**
 * Records a confirmed send at `now`. With `from`, it also clears the attempts of the same line from that wallet made
 * up to `attemptAt` (the confirmed line's last attempt; all of them without it): this confirmation covers them.
 */
export function recordConfirmed(entry: Omit<RecentSend, "at"> & { attemptAt?: number }, now: number): void {
  const { attemptAt, ...send } = entry;
  const kept = parseRecentAll(readRecentRaw()).filter((e) => {
    if (now - e.at >= RECENT_MS) return false;
    if (isAttemptEntry(e)) return !(send.from !== undefined && sameLine(e, send) && (attemptAt === undefined || e.at <= attemptAt));
    return !(send.hash && e.hash === send.hash && sameAddress(e.to, send.to));
  });
  kept.push({ ...send, at: now });
  writeRecent(kept);
}

/** Records an attempt (at its own time `at`). The same attempt again (now with its hash) replaces its entry. */
export function recordAttempt(entry: Omit<RecentAttempt, "kind" | "at">, at: number): void {
  const kept = parseRecentAll(readRecentRaw()).filter((e) => at - e.at < RECENT_MS && !(isAttemptEntry(e) && sameLine(e, entry) && e.at === at));
  kept.push({ kind: "attempt" as const, ...entry, at });
  writeRecent(kept);
}

export function recentConfirmed(chain: ChainId, now: number): RecentSend[] {
  return parseRecent(readRecentRaw(), chain, now);
}

export function recentAttempts(chain: ChainId, from: Address, now: number): RecentAttempt[] {
  return parseRecentAttempts(readRecentRaw(), chain, from, now);
}

/**
 * NEW-4: every `todo` line never attempted in this list that matches attempts from the record (same recipient and
 * amount; the caller passes only this wallet's and chain's) becomes `unconfirmed`, with an attempt from the earliest
 * block (none when any attempt lacks one: it cannot be scanned and ends `scan_failed`), the latest time and the latest
 * known hash, so it is scanned before it can be signed. Returns `rows` itself when nothing matches. Pure.
 */
export function inheritAttempts(rows: RowState[], attempts: readonly RecentAttempt[]): RowState[] {
  let changed = false;
  const out = rows.map((r) => {
    if (r.status !== "todo" || r.attempt) return r;
    const hits = attempts.filter((e) => sameAddress(e.to, r.to) && e.amount === r.amount).sort((x, y) => x.at - y.at);
    if (hits.length === 0) return r;
    changed = true;
    const blocks = hits.map((e) => e.block);
    const block = blocks.every((b): b is string => b !== undefined) ? blocks.reduce((m, b) => (BigInt(b) < BigInt(m) ? b : m)) : undefined;
    const hash = hits.filter((e) => e.hash).at(-1)?.hash;
    return { ...r, status: "unconfirmed" as const, attempt: { ...(block ? { block } : {}), at: hits.at(-1)!.at }, ...(hash ? { hash } : {}) };
  });
  return changed ? out : rows;
}
