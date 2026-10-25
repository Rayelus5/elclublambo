import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { acquireLock, heartbeat, LOCK_STALE_MS, lockKey, lockedByOther, readLockRaw, releaseLock } from "@/lib/multisend/run-lock";

const RUN = "elclub:multisend:84532:0xabc:k1";

beforeEach(() => window.localStorage.clear());
afterEach(() => vi.restoreAllMocks());

describe("R5: cross-tab run lock", () => {
  it("one tab takes the lock; another tab cannot while it is fresh, and can once it is stale (30 s)", () => {
    expect(acquireLock(RUN, "tab-a", 1_000)).toBe(true);
    expect(JSON.parse(window.localStorage.getItem(lockKey(RUN))!)).toEqual({ tab: "tab-a", beat: 1_000 });
    expect(acquireLock(RUN, "tab-b", 1_000 + LOCK_STALE_MS - 1)).toBe(false);
    expect(lockedByOther(readLockRaw(RUN), "tab-b", 1_000 + LOCK_STALE_MS - 1)).toBe(true);
    expect(lockedByOther(readLockRaw(RUN), "tab-a", 1_000)).toBe(false);
    expect(lockedByOther(readLockRaw(RUN), "tab-b", 1_000 + LOCK_STALE_MS)).toBe(false);
    expect(acquireLock(RUN, "tab-b", 1_000 + LOCK_STALE_MS)).toBe(true);
    expect(LOCK_STALE_MS).toBe(30_000);
  });

  it("the heartbeat keeps the owner's lock fresh; it never takes another tab's lock", () => {
    acquireLock(RUN, "tab-a", 0);
    heartbeat(RUN, "tab-a", 25_000);
    expect(lockedByOther(readLockRaw(RUN), "tab-b", 50_000)).toBe(true);
    heartbeat(RUN, "tab-b", 50_000);
    expect(JSON.parse(window.localStorage.getItem(lockKey(RUN))!).tab).toBe("tab-a");
  });

  it("release removes only the owner's lock", () => {
    acquireLock(RUN, "tab-a", 0);
    releaseLock(RUN, "tab-b");
    expect(readLockRaw(RUN)).not.toBeNull();
    releaseLock(RUN, "tab-a");
    expect(readLockRaw(RUN)).toBeNull();
  });

  it("the same tab may take its own lock again; junk is no lock", () => {
    acquireLock(RUN, "tab-a", 0);
    expect(acquireLock(RUN, "tab-a", 5)).toBe(true);
    window.localStorage.setItem(lockKey(RUN), "junk");
    expect(lockedByOther(readLockRaw(RUN), "tab-b", 0)).toBe(false);
    expect(acquireLock(RUN, "tab-b", 0)).toBe(true);
  });

  it("without storage there is no lock: acquiring succeeds and nothing throws", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("denied");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("denied");
    });
    vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => {
      throw new Error("denied");
    });
    expect(acquireLock(RUN, "tab-a", 0)).toBe(true);
    expect(() => heartbeat(RUN, "tab-a", 1)).not.toThrow();
    expect(() => releaseLock(RUN, "tab-a")).not.toThrow();
    expect(readLockRaw(RUN)).toBeNull();
  });
});
