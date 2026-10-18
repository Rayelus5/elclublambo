import { act, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const rpc = vi.hoisted(() => vi.fn(async () => ({ data: null, error: null })));
vi.mock("@/lib/supabase/browser", () => ({
  createBrowserClient: () => ({
    rpc,
    auth: {
      getSession: async () => ({ data: { session: { access_token: "tok" } } }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe: vi.fn() } } }),
    },
  }),
}));

import { PresenceHeartbeat } from "@/components/members/presence-heartbeat";

let fetchSpy: ReturnType<typeof vi.fn>;
beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
  rpc.mockClear();
  fetchSpy = vi.fn(async () => new Response(null));
  vi.stubGlobal("fetch", fetchSpy);
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://sb.example");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon");
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

const flush = async () => {
  await act(async () => {
    for (let i = 0; i < 10; i++) await Promise.resolve();
  });
};

describe("PresenceHeartbeat", () => {
  it("beats on load and every 30 s, also in the background", async () => {
    Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });
    render(<PresenceHeartbeat />);
    expect(rpc).toHaveBeenCalledWith("touch_presence");
    act(() => vi.advanceTimersByTime(30_000));
    expect(rpc).toHaveBeenCalledTimes(2);
  });

  it("says goodbye with a keepalive request when the last tab closes", async () => {
    render(<PresenceHeartbeat />);
    await flush();
    act(() => {
      window.dispatchEvent(new Event("pagehide"));
    });
    expect(fetchSpy).toHaveBeenCalledWith("https://sb.example/rest/v1/rpc/leave_presence", expect.objectContaining({ keepalive: true }));
  });

  it("stays silent on close while another tab of the browser is alive", async () => {
    localStorage.setItem("elclub:presence-tabs", JSON.stringify({ other: Date.now() }));
    render(<PresenceHeartbeat />);
    await flush();
    act(() => {
      window.dispatchEvent(new Event("pagehide"));
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("stops beating on unmount", () => {
    const { unmount } = render(<PresenceHeartbeat />);
    unmount();
    act(() => vi.advanceTimersByTime(120_000));
    expect(rpc).toHaveBeenCalledTimes(1);
  });
});
