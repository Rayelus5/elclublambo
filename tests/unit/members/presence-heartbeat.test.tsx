import { act, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const rpc = vi.hoisted(() => vi.fn(async () => ({ data: null, error: null })));
vi.mock("@/lib/supabase/browser", () => ({ createBrowserClient: () => ({ rpc }) }));

import { PresenceHeartbeat } from "@/components/members/presence-heartbeat";

let visibility = "visible";
beforeEach(() => {
  vi.useFakeTimers();
  rpc.mockClear();
  visibility = "visible";
  Object.defineProperty(document, "visibilityState", { get: () => visibility, configurable: true });
});
afterEach(() => vi.useRealTimers());

describe("PresenceHeartbeat", () => {
  it("beats on load and every minute while visible, through the session-bound RPC", () => {
    render(<PresenceHeartbeat />);
    expect(rpc).toHaveBeenCalledWith("touch_presence");
    expect(rpc).toHaveBeenCalledTimes(1);
    act(() => vi.advanceTimersByTime(60_000));
    expect(rpc).toHaveBeenCalledTimes(2);
  });

  it("skips beats while the tab is hidden and beats again when it comes back", () => {
    render(<PresenceHeartbeat />);
    visibility = "hidden";
    act(() => vi.advanceTimersByTime(120_000));
    expect(rpc).toHaveBeenCalledTimes(1);
    visibility = "visible";
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(rpc).toHaveBeenCalledTimes(2);
  });

  it("stops on unmount", () => {
    const { unmount } = render(<PresenceHeartbeat />);
    unmount();
    act(() => vi.advanceTimersByTime(180_000));
    expect(rpc).toHaveBeenCalledTimes(1);
  });
});
