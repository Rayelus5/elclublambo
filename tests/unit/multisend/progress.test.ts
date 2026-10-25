import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearProgress, loadProgress, progressKey, saveProgress, type RowState } from "@/lib/multisend/progress";

const OWNER = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8" as const;
const TO = "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC" as const;
const HASH = `0x${"ab".repeat(32)}` as const;
const rows: RowState[] = [
  { to: TO, amount: "1000000", hash: HASH, sentAt: 1_700_000_000_000, status: "confirmed" },
  { to: TO, amount: "2500000", status: "todo" },
];

beforeEach(() => window.localStorage.clear());
afterEach(() => vi.restoreAllMocks());

describe("multisend progress", () => {
  it("the key is elclub:multisend:<chainId>:<owner>:<list hash>, owner in lower case", () => {
    expect(progressKey(OWNER, 84532, "abc")).toBe(`elclub:multisend:84532:${OWNER.toLowerCase()}:abc`);
  });

  it("save and load round-trip; another chain, owner or list has nothing", () => {
    saveProgress(OWNER, 84532, "k1", rows);
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
    expect(() => saveProgress(OWNER, 84532, "k1", rows)).not.toThrow();
    expect(loadProgress(OWNER, 84532, "k1")).toBeNull();
    expect(() => clearProgress(OWNER, 84532, "k1")).not.toThrow();
  });

  it("stored junk is null, not a crash", () => {
    const key = progressKey(OWNER, 84532, "k1");
    for (const junk of ["nope", "{}", "[1]", JSON.stringify([{ ...rows[0], status: "paid" }]), JSON.stringify([{ ...rows[0], hash: "0x12" }]), JSON.stringify([{ ...rows[1], amount: "-1" }])]) {
      window.localStorage.setItem(key, junk);
      expect(loadProgress(OWNER, 84532, "k1")).toBeNull();
    }
  });
});
