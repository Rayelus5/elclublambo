import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createThrottle } from "@/lib/chat/throttle";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("createThrottle", () => {
  it("runs the first call immediately", () => {
    const fn = vi.fn();
    createThrottle(fn, 5000).call();
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("collapses calls inside the window into one trailing call", () => {
    const fn = vi.fn();
    const t = createThrottle(fn, 5000);
    t.call();
    vi.advanceTimersByTime(1000);
    t.call();
    t.call();
    t.call();
    expect(fn).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(3999);
    expect(fn).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(2);
    expect(fn).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(20_000);
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("runs again immediately once the window has passed", () => {
    const fn = vi.fn();
    const t = createThrottle(fn, 5000);
    t.call();
    vi.advanceTimersByTime(5001);
    t.call();
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("cancel drops the pending trailing call", () => {
    const fn = vi.fn();
    const t = createThrottle(fn, 5000);
    t.call();
    t.call();
    t.cancel();
    vi.advanceTimersByTime(10_000);
    expect(fn).toHaveBeenCalledTimes(1);
  });
});
