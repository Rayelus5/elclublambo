import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Status = "SUBSCRIBED" | "CHANNEL_ERROR" | "TIMED_OUT" | "CLOSED";
interface FakeChannel {
  topic: string;
  config: unknown;
  handlers: Map<string, (m: { payload: unknown }) => void>;
  statusCb: ((s: Status) => void) | null;
  on: (type: string, filter: { event: string }, cb: (m: { payload: unknown }) => void) => FakeChannel;
  subscribe: (cb: (s: Status) => void) => FakeChannel;
}

const h = vi.hoisted(() => ({
  channels: [] as unknown[],
  removeChannel: vi.fn(),
  setAuth: vi.fn(async () => {}),
  authListeners: [] as Array<(event: string) => void>,
}));

vi.mock("@/lib/supabase/browser", () => ({
  createBrowserClient: () => ({
    auth: {
      getSession: async () => ({ data: { session: { access_token: "tok" } } }),
      onAuthStateChange: (cb: (event: string) => void) => {
        h.authListeners.push(cb);
        return { data: { subscription: { unsubscribe: vi.fn() } } };
      },
    },
    realtime: { setAuth: h.setAuth },
    channel: (topic: string, config: unknown) => {
      const ch: FakeChannel = {
        topic,
        config,
        handlers: new Map(),
        statusCb: null,
        on(_t, filter, cb) {
          ch.handlers.set(filter.event, cb);
          return ch;
        },
        subscribe(cb) {
          ch.statusCb = cb;
          return ch;
        },
      };
      h.channels.push(ch);
      return ch;
    },
    removeChannel: h.removeChannel,
    getChannels: () => [],
  }),
}));

import { useNotificationEvents } from "@/lib/notifications/realtime";

const ME = "11111111-1111-4111-8111-111111111111";
const last = () => h.channels[h.channels.length - 1] as FakeChannel;
const flush = async () => {
  await act(async () => {
    for (let i = 0; i < 40; i++) await Promise.resolve();
  });
};

beforeEach(() => {
  vi.useFakeTimers();
  h.channels.length = 0;
  h.authListeners.length = 0;
  h.removeChannel.mockReset();
  h.setAuth.mockClear();
  Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
});
afterEach(() => vi.useRealTimers());

describe("useNotificationEvents", () => {
  it("joins the private member topic with the session token", async () => {
    renderHook(() => useNotificationEvents(ME, vi.fn()));
    await flush();
    expect(h.setAuth).toHaveBeenCalledWith("tok");
    expect(last().topic).toBe(`member:${ME}`);
    expect(last().config).toEqual({ config: { private: true } });
  });

  it("delivers the numeric id of a created notification and ignores junk", async () => {
    const cb = vi.fn();
    renderHook(() => useNotificationEvents(ME, cb));
    await flush();
    const send = last().handlers.get("notification_created")!;
    act(() => {
      send({ payload: { id: 12 } });
      send({ payload: { id: "12" } });
      send({ payload: null });
      send({ payload: { id: -1 } });
    });
    expect(cb).toHaveBeenCalledTimes(1);
    expect(cb).toHaveBeenCalledWith(12);
  });

  it("does not join with a malformed member id", async () => {
    renderHook(() => useNotificationEvents("nope", vi.fn()));
    await flush();
    expect(h.channels).toHaveLength(0);
  });

  it("removes the failed channel (awaited) before retrying, and resyncs after re-join", async () => {
    const onResync = vi.fn();
    renderHook(() => useNotificationEvents(ME, vi.fn(), { onResync }));
    await flush();
    act(() => last().statusCb!("SUBSCRIBED"));
    expect(onResync).not.toHaveBeenCalled();
    act(() => last().statusCb!("CHANNEL_ERROR"));
    expect(h.removeChannel).toHaveBeenCalledTimes(1);
    await act(async () => void vi.advanceTimersByTime(1100));
    await flush();
    expect(h.channels).toHaveLength(2);
    act(() => last().statusCb!("SUBSCRIBED"));
    expect(onResync).toHaveBeenCalledTimes(1);
  });

  it("waits for an ASYNC leave to finish before joining again after a failure", async () => {
    let finishLeave!: () => void;
    h.removeChannel.mockImplementation(() => new Promise<void>((r) => (finishLeave = r)));
    renderHook(() => useNotificationEvents(ME, vi.fn()));
    await flush();
    act(() => last().statusCb!("CHANNEL_ERROR"));
    expect(h.removeChannel).toHaveBeenCalledTimes(1);
    await act(async () => void vi.advanceTimersByTime(1100));
    await flush();
    // the failed channel is still leaving: no new join yet
    expect(h.channels).toHaveLength(1);
    await act(async () => finishLeave());
    await flush();
    expect(h.channels).toHaveLength(2);
  });

  it("re-joins after the tab was hidden for 30 s or more, not after a short absence", async () => {
    renderHook(() => useNotificationEvents(ME, vi.fn()));
    await flush();
    const setVisibility = (v: "hidden" | "visible") => {
      Object.defineProperty(document, "visibilityState", { value: v, configurable: true });
      document.dispatchEvent(new Event("visibilitychange"));
    };
    act(() => setVisibility("hidden"));
    await act(async () => void vi.advanceTimersByTime(5_000));
    act(() => setVisibility("visible"));
    await flush();
    expect(h.channels).toHaveLength(1);

    act(() => setVisibility("hidden"));
    await act(async () => void vi.advanceTimersByTime(31_000));
    act(() => setVisibility("visible"));
    await flush();
    expect(h.channels).toHaveLength(2);
  });

  it("re-joins when the token is refreshed and leaves on unmount", async () => {
    const { unmount } = renderHook(() => useNotificationEvents(ME, vi.fn()));
    await flush();
    act(() => h.authListeners[0]!("TOKEN_REFRESHED"));
    await flush();
    expect(h.channels).toHaveLength(2);
    unmount();
    expect(h.removeChannel).toHaveBeenCalled();
  });
});
