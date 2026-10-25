import type { ChainId } from "@/lib/economy/networks";

type Address = `0x${string}`;
type Hash = `0x${string}`;

/**
 * One line of a send as this browser last saw it, keyed by its identity (`id`, see lineId; C3). `hash`, `sentAt` and
 * `fromBlock` (the block read just before signing, where a log scan starts) are written as soon as the wallet returns
 * the hash, before the receipt (the pattern of pending-sends.ts); `callsId` marks a line sent in an atomic batch
 * (EIP-5792). `unconfirmed` («sin confirmar»): sent, but neither a receipt nor a Transfer log was found after the
 * give-up window (C1); it is only sent again when the user says they checked it was not sent.
 */
export type RowState = {
  id: string;
  to: Address;
  /** Base units, as a decimal string (JSON has no bigint). */
  amount: string;
  hash?: Hash;
  sentAt?: number;
  fromBlock?: string;
  callsId?: string;
  status: "todo" | "sent" | "confirmed" | "failed" | "unconfirmed";
};

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const TX_HASH = /^0x[0-9a-fA-F]{64}$/;
const UNITS = /^\d+$/;
const STATUSES = new Set(["todo", "sent", "confirmed", "failed", "unconfirmed"]);

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
    (r.sentAt === undefined || (typeof r.sentAt === "number" && Number.isFinite(r.sentAt))) &&
    (r.fromBlock === undefined || (typeof r.fromBlock === "string" && UNITS.test(r.fromBlock))) &&
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

export function saveProgress(owner: Address, chain: ChainId, key: string, rows: readonly RowState[]): void {
  try {
    window.localStorage.setItem(progressKey(owner, chain, key), JSON.stringify(rows));
  } catch {
    // Without storage the progress only lasts while the page is open.
  }
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
