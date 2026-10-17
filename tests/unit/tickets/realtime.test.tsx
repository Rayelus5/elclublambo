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
}));

vi.mock("@/lib/supabase/browser", () => ({
  createBrowserClient: () => ({
    auth: {
      getSession: async () => ({ data: { session: { access_token: "tok" } } }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe: vi.fn() } } }),
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

import { useTicketEvents } from "@/lib/tickets/realtime";

const T = "22222222-2222-4222-8222-222222222222";
const MSG = "33333333-3333-4333-8333-333333333333";
const last = () => h.channels[h.channels.length - 1] as FakeChannel;
const flush = async () => {
  await act(async () => {
    for (let i = 0; i < 40; i++) await Promise.resolve();
  });
};

beforeEach(() => {
  vi.useFakeTimers();
  h.channels.length = 0;
  h.removeChannel.mockReset();
  h.setAuth.mockClear();
  Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
});
afterEach(() => vi.useRealTimers());

describe("useTicketEvents", () => {
  it("joins the private ticket topic with the session token", async () => {
    renderHook(() => useTicketEvents(T, {}));
    await flush();
    expect(h.setAuth).toHaveBeenCalledWith("tok");
    expect(last().topic).toBe(`ticket:${T}`);
    expect(last().config).toEqual({ config: { private: true } });
  });

  it("delivers message ids and updates, and ignores junk payloads", async () => {
    const onMessage = vi.fn();
    const onUpdated = vi.fn();
    renderHook(() => useTicketEvents(T, { onMessage, onUpdated }));
    await flush();
    act(() => {
      last().handlers.get("ticket_message_created")!({ payload: { id: MSG, ticket_id: T } });
      last().handlers.get("ticket_message_created")!({ payload: { id: 5 } });
      last().handlers.get("ticket_message_created")!({ payload: null });
      last().handlers.get("ticket_updated")!({ payload: { id: T, ticket_id: T } });
    });
    expect(onMessage).toHaveBeenCalledTimes(1);
    expect(onMessage).toHaveBeenCalledWith(MSG);
    expect(onUpdated).toHaveBeenCalledTimes(1);
  });

  it("does not join with a malformed ticket id", async () => {
    renderHook(() => useTicketEvents("nope", {}));
    await flush();
    expect(h.channels).toHaveLength(0);
  });

  it("awaits the failed channel's leave before joining again, then resyncs", async () => {
    const onResync = vi.fn();
    let finishLeave!: () => void;
    h.removeChannel.mockImplementation(() => new Promise<void>((r) => (finishLeave = r)));
    renderHook(() => useTicketEvents(T, { onResync }));
    await flush();
    act(() => last().statusCb!("SUBSCRIBED"));
    act(() => last().statusCb!("CHANNEL_ERROR"));
    await act(async () => void vi.advanceTimersByTime(1100));
    await flush();
    expect(h.channels).toHaveLength(1);
    await act(async () => finishLeave());
    await flush();
    expect(h.channels).toHaveLength(2);
    act(() => last().statusCb!("SUBSCRIBED"));
    expect(onResync).toHaveBeenCalledTimes(1);
  });

  it("leaves the topic on unmount", async () => {
    const { unmount } = renderHook(() => useTicketEvents(T, {}));
    await flush();
    unmount();
    expect(h.removeChannel).toHaveBeenCalled();
  });
});
