import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  alignProgress,
  clearProgress,
  inheritAttempts,
  loadProgress,
  mergeProgress,
  recentAttempts,
  recordAttempt,
  progressKey,
  recentConfirmed,
  recordConfirmed,
  RECENT_KEY,
  RECENT_MS,
  saveProgress,
  type RowState,
} from "@/lib/multisend/progress";

const OWNER = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8" as const;
const TO = "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC" as const;
const TO2 = "0x90F79bf6EB2c4f870365E785982E1f101E93b906" as const;
const HASH = `0x${"ab".repeat(32)}` as const;
const id = (to: string, amount: string) => `${to.toLowerCase()}:${amount}:0`;
const rows: RowState[] = [
  { id: id(TO, "1000000"), to: TO, amount: "1000000", hash: HASH, attempt: { block: "123", at: 1_700_000_000_000 }, status: "confirmed" },
  { id: id(TO2, "2500000"), to: TO2, amount: "2500000", attempt: { at: 5 }, status: "scan_failed" },
];

beforeEach(() => window.localStorage.clear());
afterEach(() => vi.restoreAllMocks());

describe("multisend progress", () => {
  it("the key is elclub:multisend:<chainId>:<owner>:<list hash>, owner in lower case", () => {
    expect(progressKey(OWNER, 84532, "abc")).toBe(`elclub:multisend:84532:${OWNER.toLowerCase()}:abc`);
  });

  it("save and load round-trip; another chain, owner or list has nothing", () => {
    expect(saveProgress(OWNER, 84532, "k1", rows)).toBe(true);
    expect(loadProgress(OWNER, 84532, "k1")).toEqual(rows);
    expect(loadProgress(OWNER.toLowerCase() as `0x${string}`, 84532, "k1")).toEqual(rows);
    expect(loadProgress(OWNER, 421614, "k1")).toBeNull();
    expect(loadProgress(OWNER, 84532, "k2")).toBeNull();
    clearProgress(OWNER, 84532, "k1");
    expect(loadProgress(OWNER, 84532, "k1")).toBeNull();
  });

  it("a localStorage that throws breaks nothing and load is null", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("denied");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("denied");
    });
    vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => {
      throw new Error("denied");
    });
    expect(saveProgress(OWNER, 84532, "k1", rows)).toBe(false);
    expect(loadProgress(OWNER, 84532, "k1")).toBeNull();
    expect(() => clearProgress(OWNER, 84532, "k1")).not.toThrow();
    expect(() => recordConfirmed({ chain: 84532, to: TO, amount: "1", hash: HASH }, 0)).not.toThrow();
    expect(recentConfirmed(84532, 0)).toEqual([]);
  });

  it("stored junk is null, not a crash", () => {
    const key = progressKey(OWNER, 84532, "k1");
    for (const junk of [
      "nope",
      "{}",
      "[1]",
      JSON.stringify([{ ...rows[0], status: "paid" }]),
      JSON.stringify([{ ...rows[0], hash: "0x12" }]),
      JSON.stringify([{ ...rows[1], amount: "-1" }]),
      JSON.stringify([{ ...rows[1], id: undefined }]),
      JSON.stringify([{ ...rows[0], attempt: { block: "x", at: 1 } }]),
      JSON.stringify([{ ...rows[0], attempt: { block: "1" } }]),
      JSON.stringify([{ ...rows[1], status: "failed" }]),
    ]) {
      window.localStorage.setItem(key, junk);
      expect(loadProgress(OWNER, 84532, "k1")).toBeNull();
    }
  });

  it("C3: alignProgress matches by line identity, in the list's order; another set of lines is null", () => {
    const list = [
      { id: id(TO2, "2500000"), to: TO2, amount: 2_500_000n },
      { id: id(TO, "1000000"), to: TO, amount: 1_000_000n },
    ];
    expect(alignProgress(rows, list)).toEqual([rows[1], rows[0]]);
    expect(alignProgress(rows, list.slice(0, 1))).toBeNull();
    expect(alignProgress(rows, [list[0]!, { id: id(TO, "1"), to: TO, amount: 1n }])).toBeNull();
    expect(alignProgress(null, list)).toBeNull();
  });
});

describe("C3: confirmed sends of the last 24 h", () => {
  it("records (chain, recipient, amount, hash) and returns those of the chain within 24 h", () => {
    recordConfirmed({ chain: 84532, to: TO, amount: "1000000", hash: HASH }, 1_000);
    recordConfirmed({ chain: 421614, to: TO2, amount: "5", hash: HASH }, 1_000);
    expect(recentConfirmed(84532, 2_000)).toEqual([{ chain: 84532, to: TO, amount: "1000000", hash: HASH, at: 1_000 }]);
    expect(recentConfirmed(84532, 1_000 + RECENT_MS)).toEqual([]);
  });

  it("old entries are pruned on write, the same hash is kept once, and junk reads as empty", () => {
    recordConfirmed({ chain: 84532, to: TO, amount: "1", hash: HASH }, 0);
    recordConfirmed({ chain: 84532, to: TO, amount: "1", hash: HASH }, 10);
    expect(recentConfirmed(84532, 20)).toHaveLength(1);
    recordConfirmed({ chain: 84532, to: TO2, amount: "2" }, RECENT_MS + 20);
    expect(JSON.parse(window.localStorage.getItem(RECENT_KEY)!)).toHaveLength(1);
    window.localStorage.setItem(RECENT_KEY, "{bad");
    expect(recentConfirmed(84532, 0)).toEqual([]);
  });
});

describe("fix round 4", () => {
  const A1 = { id: id(TO, "1000000"), to: TO, amount: "1000000" } as const;

  it("minor: mergeProgress keeps the newest copy of each line by its timestamp; a confirmed copy is never undone", () => {
    const older: RowState = { ...A1, status: "sent", hash: HASH, attempt: { block: "1", at: 100 }, updated: 100 };
    const newer: RowState = { ...A1, status: "unconfirmed", attempt: { block: "1", at: 200 }, updated: 200 };
    expect(mergeProgress([older], [newer])).toEqual([newer]);
    expect(mergeProgress([newer], [older])).toEqual([newer]);
    const confirmed: RowState = { ...A1, status: "confirmed", hash: HASH, updated: 50 };
    expect(mergeProgress([confirmed], [newer])).toEqual([confirmed]);
    expect(mergeProgress([newer], [confirmed])).toEqual([confirmed]);
  });

  it("NEW-4: attempts go to the 24 h record with the wallet and block; they are not confirmations", () => {
    recordAttempt({ chain: 84532, from: OWNER, to: TO, amount: "1000000", block: "900" }, 1_000);
    expect(recentConfirmed(84532, 2_000)).toEqual([]);
    expect(recentAttempts(84532, OWNER, 2_000)).toEqual([{ kind: "attempt", chain: 84532, from: OWNER, to: TO, amount: "1000000", block: "900", at: 1_000 }]);
    expect(recentAttempts(84532, TO2, 2_000)).toEqual([]);
    expect(recentAttempts(421614, OWNER, 2_000)).toEqual([]);
    expect(recentAttempts(84532, OWNER, 1_000 + RECENT_MS)).toEqual([]);
    // The same attempt again (now with its hash) replaces the entry.
    recordAttempt({ chain: 84532, from: OWNER, to: TO, amount: "1000000", block: "900", hash: HASH }, 1_000);
    expect(recentAttempts(84532, OWNER, 2_000)).toEqual([expect.objectContaining({ hash: HASH })]);
  });

  it("NEW-4: a confirmation clears the attempts of the same line it covers, and only those", () => {
    recordAttempt({ chain: 84532, from: OWNER, to: TO, amount: "1000000", block: "900" }, 1_000);
    recordAttempt({ chain: 84532, from: OWNER, to: TO2, amount: "5", block: "900" }, 1_000);
    recordAttempt({ chain: 84532, from: OWNER, to: TO, amount: "1000000", block: "950" }, 3_000);
    recordConfirmed({ chain: 84532, from: OWNER, to: TO, amount: "1000000", hash: HASH, attemptAt: 2_000 }, 2_500);
    expect(recentAttempts(84532, OWNER, 4_000).map((e) => [e.to, e.at])).toEqual([
      [TO2, 1_000],
      [TO, 3_000],
    ]);
    expect(recentConfirmed(84532, 4_000)).toHaveLength(1);
  });

  it("NEW-4: inheritAttempts makes an untouched todo line that matches an attempt unconfirmed, from the earliest block, with the latest time and a known hash", () => {
    const rowsIn: RowState[] = [
      { ...A1, status: "todo" },
      { id: id(TO2, "2500000"), to: TO2, amount: "2500000", status: "todo" },
    ];
    const attempts = [
      { kind: "attempt" as const, chain: 84532 as const, from: OWNER, to: TO.toLowerCase() as `0x${string}`, amount: "1000000", block: "950", at: 2_000 },
      { kind: "attempt" as const, chain: 84532 as const, from: OWNER, to: TO, amount: "1000000", block: "900", hash: HASH, at: 1_000 },
    ];
    const out = inheritAttempts(rowsIn, attempts);
    expect(out[0]).toEqual({ ...A1, status: "unconfirmed", attempt: { block: "900", at: 2_000 }, hash: HASH });
    expect(out[1]).toBe(rowsIn[1]);
    // Nothing to inherit: the same array back.
    expect(inheritAttempts(rowsIn, [])).toBe(rowsIn);
    // A line already attempted or past todo keeps its own record.
    const own: RowState[] = [{ ...A1, status: "todo", attempt: { block: "1", at: 5 } }];
    expect(inheritAttempts(own, attempts)).toBe(own);
    // An attempt without its block cannot be scanned from anywhere: inherited without one (scan_failed later).
    expect(inheritAttempts([{ ...A1, status: "todo" }], [{ ...attempts[0]!, block: undefined }])[0]!.attempt).toEqual({ at: 2_000 });
  });
});
