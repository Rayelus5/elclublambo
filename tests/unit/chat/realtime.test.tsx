import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Status = "SUBSCRIBED" | "CHANNEL_ERROR" | "TIMED_OUT" | "CLOSED";

interface FakeChannel {
  topic: string;
  config: unknown;
  handlers: Map<string, (m: { payload: unknown }) => void>;
  statusCb: ((s: Status, err?: unknown) => void) | null;
  on: (type: string, filter: { event: string }, cb: (m: { payload: unknown }) => void) => FakeChannel;
  subscribe: (cb: (s: Status, err?: unknown) => void) => FakeChannel;
}

const h = vi.hoisted(() => ({
  channels: [] as unknown[],
  removeChannel: vi.fn(),
  setAuth: vi.fn(async () => {}),
  getSession: vi.fn(async () => ({ data: { session: { access_token: "tok" } } })),
  authListeners: [] as Array<(event: string) => void>,
  unsubscribeAuth: vi.fn(),
}));

vi.mock("@/lib/supabase/browser", () => ({
  createBrowserClient: () => ({
    auth: {
      getSession: h.getSession,
      onAuthStateChange: (cb: (event: string) => void) => {
        h.authListeners.push(cb);
        return { data: { subscription: { unsubscribe: h.unsubscribeAuth } } };
      },
    },
    realtime: { setAuth: h.setAuth },
    channel: (topic: string, config: unknown) => {
      const ch: FakeChannel = {
        topic,
        config,
        handlers: new Map(),
        statusCb: null,
        on(_type, filter, cb) {
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
  }),
}));

import { useChannelEvents } from "@/lib/chat/realtime";

const CH = "11111111-1111-4111-8111-111111111111";
const M1 = "22222222-2222-4222-8222-222222222222";
const M2 = "33333333-3333-4333-8333-333333333333";
const last = () => h.channels[h.channels.length - 1] as FakeChannel;
const flush = async () => {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
};

beforeEach(() => {
  vi.useFakeTimers();
  h.channels.length = 0;
  h.authListeners.length = 0;
  h.removeChannel.mockClear();
  h.setAuth.mockClear();
  h.unsubscribeAuth.mockClear();
});
afterEach(() => vi.useRealTimers());

function mount(onEvent = vi.fn(), extra: Parameters<typeof useChannelEvents>[2] = {}) {
  const utils = renderHook(({ id }) => useChannelEvents(id, onEvent, extra), { initialProps: { id: CH } });
  return { onEvent, ...utils };
}

describe("useChannelEvents", () => {
  it("authenticates the socket with the session token, then joins the private topic", async () => {
    mount();
    await flush();
    expect(h.setAuth).toHaveBeenCalledWith("tok");
    expect(h.channels).toHaveLength(1);
    expect(last().topic).toBe(`channel:${CH}`);
    expect(last().config).toEqual({ config: { private: true } });
    expect([...last().handlers.keys()].toSorted()).toEqual([
      "message_created",
      "message_deleted",
      "message_pinned",
      "message_updated",
      "reaction_changed",
    ]);
  });

  it("delivers an event after the debounce, with ids only", async () => {
    const { onEvent } = mount();
    await flush();
    act(() => last().handlers.get("message_created")!({ payload: { id: M1, channel_id: CH, thread_root_id: null } }));
    expect(onEvent).not.toHaveBeenCalled();
    act(() => void vi.advanceTimersByTime(160));
    expect(onEvent).toHaveBeenCalledTimes(1);
    expect(onEvent).toHaveBeenCalledWith({ id: M1, threadRootId: null, events: ["message_created"] });
  });

  it("coalesces several events for one message (soft delete bursts) and keeps other ids apart", async () => {
    const { onEvent } = mount();
    await flush();
    const p = (id: string) => ({ payload: { id, channel_id: CH, thread_root_id: null } });
    act(() => {
      last().handlers.get("reaction_changed")!(p(M1));
      last().handlers.get("reaction_changed")!(p(M1));
      last().handlers.get("message_deleted")!(p(M1));
      last().handlers.get("message_updated")!(p(M2));
    });
    act(() => void vi.advanceTimersByTime(160));
    expect(onEvent).toHaveBeenCalledTimes(2);
    const first = onEvent.mock.calls.find((c) => c[0].id === M1)![0];
    expect(first.events.toSorted()).toEqual(["message_deleted", "reaction_changed"]);
  });

  it("ignores malformed payloads", async () => {
    const { onEvent } = mount();
    await flush();
    act(() => {
      last().handlers.get("message_created")!({ payload: null });
      last().handlers.get("message_created")!({ payload: { id: "nope" } });
    });
    act(() => void vi.advanceTimersByTime(500));
    expect(onEvent).not.toHaveBeenCalled();
  });

  it("removes the channel and retries with backoff on CHANNEL_ERROR, at most 3 times", async () => {
    mount();
    await flush();
    const first = last();
    act(() => first.statusCb!("CHANNEL_ERROR", new Error("Unauthorized")));
    expect(h.removeChannel).toHaveBeenCalledWith(first);

    for (let attempt = 1; attempt <= 3; attempt++) {
      await act(async () => void vi.advanceTimersByTime(10_000));
      await flush();
      expect(h.channels).toHaveLength(attempt + 1);
      act(() => last().statusCb!("TIMED_OUT"));
    }
    // the budget is spent: no 5th channel
    await act(async () => void vi.advanceTimersByTime(60_000));
    await flush();
    expect(h.channels).toHaveLength(4);
  });

  it("a successful subscription resets the retry budget", async () => {
    mount();
    await flush();
    act(() => last().statusCb!("TIMED_OUT"));
    await act(async () => void vi.advanceTimersByTime(10_000));
    await flush();
    act(() => last().statusCb!("SUBSCRIBED"));
    act(() => last().statusCb!("CHANNEL_ERROR"));
    await act(async () => void vi.advanceTimersByTime(10_000));
    await flush();
    expect(h.channels).toHaveLength(3);
  });

  it("resubscribes (and asks for a resync) when the tab becomes visible again", async () => {
    const onResync = vi.fn();
    mount(vi.fn(), { onResync });
    await flush();
    act(() => last().statusCb!("SUBSCRIBED"));
    const before = h.channels.length;
    Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
    act(() => void document.dispatchEvent(new Event("visibilitychange")));
    await flush();
    expect(h.removeChannel).toHaveBeenCalled();
    expect(h.channels.length).toBe(before + 1);
    act(() => last().statusCb!("SUBSCRIBED"));
    expect(onResync).toHaveBeenCalledTimes(1);
  });

  it("resubscribes on TOKEN_REFRESHED but not on other auth events", async () => {
    mount();
    await flush();
    act(() => h.authListeners.forEach((l) => l("SIGNED_IN")));
    await flush();
    expect(h.channels).toHaveLength(1);
    act(() => h.authListeners.forEach((l) => l("TOKEN_REFRESHED")));
    await flush();
    expect(h.channels).toHaveLength(2);
  });

  it("cleans up on unmount and when the channel changes", async () => {
    const { rerender, unmount, onEvent } = mount();
    await flush();
    const first = last();
    act(() => first.statusCb!("SUBSCRIBED"));
    rerender({ id: "44444444-4444-4444-8444-444444444444" });
    await flush();
    expect(h.removeChannel).toHaveBeenCalledWith(first);
    expect(last().topic).toBe("channel:44444444-4444-4444-8444-444444444444");
    // pending events of the old channel are dropped
    unmount();
    expect(h.unsubscribeAuth).toHaveBeenCalled();
    act(() => void vi.advanceTimersByTime(1000));
    expect(onEvent).not.toHaveBeenCalled();
  });
});
