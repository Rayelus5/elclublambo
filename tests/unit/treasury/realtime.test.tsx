import { act, cleanup, render, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Status = "SUBSCRIBED" | "CHANNEL_ERROR" | "TIMED_OUT" | "CLOSED";
interface FakeChannel {
  topic: string;
  config: unknown;
  handlers: Map<string, (m: { event: string; payload: unknown }) => void>;
  statusCb: ((s: Status) => void) | null;
  on: (type: string, filter: { event: string }, cb: (m: { event: string; payload: unknown }) => void) => FakeChannel;
  subscribe: (cb: (s: Status) => void) => FakeChannel;
}

const h = vi.hoisted(() => ({
  channels: [] as unknown[],
  removeChannel: vi.fn(),
  setAuth: vi.fn(async () => {}),
  refresh: vi.fn(),
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: h.refresh }) }));
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

import { DaoLive } from "@/components/treasury/dao-live";
import { useDaoEvents } from "@/lib/treasury/realtime";
import { RELEASE_DELAY_MS } from "@/lib/realtime/private-topic";

const last = () => h.channels[h.channels.length - 1] as FakeChannel;
/** realtime-js delivers a broadcast to the "*" binding of the shared topic channel, with its event name. */
const emit = (event: string, payload: unknown) => last().handlers.get("*")!({ event, payload });
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
  h.refresh.mockReset();
  Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
});
afterEach(async () => {
  // The dao topic is shared page-wide and lingers briefly after its last listener: let it go before the next test.
  cleanup();
  await act(async () => {
    vi.advanceTimersByTime(RELEASE_DELAY_MS + 1);
  });
  vi.useRealTimers();
});

describe("useDaoEvents", () => {
  it("joins the private dao topic with the session token and reports changes", async () => {
    const onChanged = vi.fn();
    renderHook(() => useDaoEvents({ onChanged }));
    await flush();
    expect(h.setAuth).toHaveBeenCalledWith("tok");
    expect(last().topic).toBe("dao");
    expect(last().config).toEqual({ config: { private: true } });
    act(() => emit("dao_changed", { chain_id: 59141 }));
    expect(onChanged).toHaveBeenCalledTimes(1);
  });

  it("retries a failed join with backoff and leaves the topic on unmount", async () => {
    const { unmount } = renderHook(() => useDaoEvents({}));
    await flush();
    act(() => last().statusCb!("CHANNEL_ERROR"));
    expect(h.channels).toHaveLength(1);
    await act(async () => {
      vi.advanceTimersByTime(1000);
    });
    await flush();
    expect(h.channels).toHaveLength(2);
    unmount();
    await act(async () => {
      vi.advanceTimersByTime(RELEASE_DELAY_MS + 1);
    });
    expect(h.removeChannel).toHaveBeenCalled();
  });
});

describe("DaoLive", () => {
  it("refreshes the page once for a burst of changes (a credit touches ledger and state together)", async () => {
    render(<DaoLive />);
    await flush();
    act(() => {
      emit("dao_changed", { chain_id: 59141 });
      emit("dao_changed", { chain_id: 59141 });
    });
    expect(h.refresh).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(400));
    expect(h.refresh).toHaveBeenCalledTimes(1);
  });

  it("refreshes after a re-join (events may have been missed)", async () => {
    render(<DaoLive />);
    await flush();
    act(() => last().statusCb!("SUBSCRIBED"));
    act(() => last().statusCb!("SUBSCRIBED"));
    act(() => vi.advanceTimersByTime(400));
    expect(h.refresh).toHaveBeenCalledTimes(1);
  });
});
