import type { ChainId } from "@/lib/economy/networks";

type Address = `0x${string}`;

/**
 * One line of a send as this browser last saw it. `hash` and `sentAt` are written as soon as the wallet returns the
 * hash, before the receipt (the pattern of pending-sends.ts); `callsId` marks a line sent in an atomic batch
 * (EIP-5792), re-checked by that id before anything is sent again.
 */
export type RowState = {
  to: Address;
  /** Base units, as a decimal string (JSON has no bigint). */
  amount: string;
  hash?: `0x${string}`;
  sentAt?: number;
  callsId?: string;
  status: "todo" | "sent" | "confirmed" | "failed";
};

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const TX_HASH = /^0x[0-9a-fA-F]{64}$/;
const UNITS = /^\d+$/;
const STATUSES = new Set(["todo", "sent", "confirmed", "failed"]);

/** `elclub:multisend:<chainId>:<owner>:<list hash>` (P6-R3). */
export const progressKey = (owner: Address, chain: ChainId, key: string) => `elclub:multisend:${chain}:${owner.toLowerCase()}:${key}`;

function isRow(v: unknown): v is RowState {
  if (typeof v !== "object" || v === null) return false;
  const r = v as Record<string, unknown>;
  return (
    typeof r.to === "string" &&
    ADDRESS.test(r.to) &&
    typeof r.amount === "string" &&
    UNITS.test(r.amount) &&
    typeof r.status === "string" &&
    STATUSES.has(r.status) &&
    (r.hash === undefined || (typeof r.hash === "string" && TX_HASH.test(r.hash))) &&
    (r.sentAt === undefined || (typeof r.sentAt === "number" && Number.isFinite(r.sentAt))) &&
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

/** Stored progress counts only for the same lines in the same order (same address, same amount). */
export function matchesList(stored: readonly RowState[] | null, rows: readonly { to: string; amount: bigint }[]): stored is RowState[] {
  return (
    stored !== null &&
    stored.length === rows.length &&
    stored.every((s, i) => s.to.toLowerCase() === rows[i]!.to.toLowerCase() && s.amount === rows[i]!.amount.toString())
  );
}
