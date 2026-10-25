import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { acquireLock, heartbeat, LOCK_STALE_MS, lockKey, lockedByOther, ownsLock, readLockRaw, releaseLock, TAB_ID, withRunLock } from "@/lib/multisend/run-lock";

const RUN = "elclub:multisend:84532:0xabc:k1";

beforeEach(() => window.localStorage.clear());
afterEach(() => {
  vi.restoreAllMocks();
  Object.defineProperty(navigator, "locks", { value: undefined, configurable: true });
});

/** A Web Locks manager shared by every "tab" of the test: a name is held while its callback runs. */
function fakeLocks() {
  const held = new Set<string>();
  const request = vi.fn(async (name: string, _opts: { ifAvailable?: boolean }, cb: (lock: { name: string } | null) => Promise<unknown>) => {
    if (held.has(name)) return cb(null);
    held.add(name);
    try {
      return await cb({ name });
    } finally {
      held.delete(name);
    }
  });
  Object.defineProperty(navigator, "locks", { value: { request }, configurable: true });
  return { held, request };
}

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

describe("NEW-3: withRunLock", () => {
  it("with Web Locks: asks ifAvailable, holds the lock for the whole run, and a second run meanwhile does not start", async () => {
    const locks = fakeLocks();
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const first = withRunLock(RUN, async (owns) => {
      expect(owns()).toBe(true);
      await gate;
      return "a";
    });
    await vi.waitFor(() => expect(locks.held.has(lockKey(RUN))).toBe(true));
    expect(locks.request).toHaveBeenCalledWith(lockKey(RUN), { ifAvailable: true }, expect.any(Function));
    // Even when the advisory marker looks stale (a throttled hidden tab), the Web Lock still excludes.
    window.localStorage.setItem(lockKey(RUN), JSON.stringify({ tab: TAB_ID, beat: Date.now() - LOCK_STALE_MS * 10 }));
    const second = vi.fn(async () => "b");
    await expect(withRunLock(RUN, second)).resolves.toEqual({ ran: false });
    expect(second).not.toHaveBeenCalled();
    release();
    await expect(first).resolves.toEqual({ ran: true, value: "a" });
    expect(locks.held.size).toBe(0);
    expect(readLockRaw(RUN)).toBeNull();
  });

  it("with Web Locks: an error inside the run is passed on and the lock is released", async () => {
    const locks = fakeLocks();
    await expect(withRunLock(RUN, async () => Promise.reject(new Error("boom")))).rejects.toThrow("boom");
    expect(locks.held.size).toBe(0);
  });

  it("without Web Locks: the localStorage lock, whose ownership the run can re-check (lost once another tab takes it)", async () => {
    const out = await withRunLock(RUN, async (owns) => {
      expect(owns()).toBe(true);
      window.localStorage.setItem(lockKey(RUN), JSON.stringify({ tab: "tab-b", beat: Date.now() }));
      return owns();
    });
    expect(out).toEqual({ ran: true, value: false });
    // The other tab's lock is left alone.
    expect(JSON.parse(readLockRaw(RUN)!).tab).toBe("tab-b");
    await expect(withRunLock(RUN, async () => 1)).resolves.toEqual({ ran: false });
  });

  it("ownsLock: a missing lock with storage working is not owned; without storage there is no lock to lose", () => {
    expect(ownsLock(RUN, "tab-a")).toBe(false);
    acquireLock(RUN, "tab-a", Date.now());
    expect(ownsLock(RUN, "tab-a")).toBe(true);
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("denied");
    });
    expect(ownsLock(RUN, "tab-b")).toBe(true);
  });
});
