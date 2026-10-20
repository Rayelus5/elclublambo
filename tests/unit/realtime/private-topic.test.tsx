import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// T-006: the club-wide private topics ("activity", "presence", "dao") are shared by every component that listens to
// them. Switching channels remounts the right rail; before, that left and re-joined both topics on every switch, and two
// listeners of one topic (the rail's member list and an open member card) removed each other's channel as a "zombie".

type Status = "SUBSCRIBED" | "CHANNEL_ERROR" | "TIMED_OUT" | "CLOSED";
interface FakeChannel {
  topic: string;
  binds: Array<{ event: string; cb: (m: { event: string; payload: unknown }) => void }>;
  statusCb: ((s: Status) => void) | null;
  on: (type: string, filter: { event: string }, cb: (m: { event: string; payload: unknown }) => void) => FakeChannel;
  subscribe: (cb: (s: Status) => void) => FakeChannel;
}

const h = vi.hoisted(() => ({
  channels: [] as unknown[],
  removeChannel: vi.fn(),
  getSession: vi.fn(async () => ({ data: { session: { access_token: "tok" } } })),
}));

vi.mock("@/lib/supabase/browser", () => ({
  createBrowserClient: () => ({
    auth: {
      getSession: h.getSession,
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
    },
    realtime: { setAuth: async () => {} },
    channel: (topic: string) => {
      const ch: FakeChannel = {
        topic,
        binds: [],
        statusCb: null,
        on(_type, filter, cb) {
          ch.binds.push({ event: filter.event, cb });
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

import { RELEASE_DELAY_MS, usePrivateTopic } from "@/lib/realtime/private-topic";

const channels = () => h.channels as FakeChannel[];
const flush = async () => {
  await act(async () => {
    for (let i = 0; i < 40; i++) await Promise.resolve();
  });
};
/** Delivers a broadcast the way realtime-js does: to every binding whose event filter matches (or is "*"). */
const broadcast = (ch: FakeChannel, event: string, payload: unknown) =>
  act(() => {
    for (const b of ch.binds) if (b.event === "*" || b.event === event) b.cb({ event, payload });
  });

beforeEach(() => {
  vi.useFakeTimers();
  h.channels.length = 0;
  h.removeChannel.mockReset();
  h.removeChannel.mockResolvedValue("ok");
});

afterEach(async () => {
  // Let every topic of the test go away before the next one.
  await act(async () => {
    vi.advanceTimersByTime(RELEASE_DELAY_MS + 1);
  });
  await flush();
  vi.useRealTimers();
});

describe("usePrivateTopic", () => {
  it("shares one channel between listeners of the same topic and routes each event to its listeners", async () => {
    const a = vi.fn();
    const b = vi.fn();
    const c = vi.fn();
    const ha = renderHook(() => usePrivateTopic("presence", "presence_changed", { onEvent: a }));
    const hb = renderHook(() => usePrivateTopic("presence", "presence_changed", { onEvent: b }));
    const hc = renderHook(() => usePrivateTopic("presence", "other_event", { onEvent: c }));
    await flush();
    expect(channels()).toHaveLength(1);
    expect(h.removeChannel).not.toHaveBeenCalled();

    broadcast(channels()[0]!, "presence_changed", { id: 1 });
    expect(a).toHaveBeenCalledWith({ id: 1 });
    expect(b).toHaveBeenCalledWith({ id: 1 });
    expect(c).not.toHaveBeenCalled();
    ha.unmount();
    hb.unmount();
    hc.unmount();
  });

  it("keeps the channel when a listener is replaced right away (a remount on navigation)", async () => {
    const first = renderHook(() => usePrivateTopic("activity", "activity_changed", {}));
    await flush();
    act(() => channels()[0]!.statusCb!("SUBSCRIBED"));
    first.unmount();
    const onResync = vi.fn();
    const second = renderHook(() => usePrivateTopic("activity", "activity_changed", { onResync }));
    await act(async () => {
      vi.advanceTimersByTime(RELEASE_DELAY_MS * 2);
    });
    await flush();
    expect(channels()).toHaveLength(1);
    expect(h.removeChannel).not.toHaveBeenCalled();
    // Joining an already-open topic is not a re-join after a gap.
    expect(onResync).not.toHaveBeenCalled();
    second.unmount();
  });

  it("leaves the topic once its last listener has been gone for a moment", async () => {
    const one = renderHook(() => usePrivateTopic("dao", "dao_changed", {}));
    await flush();
    one.unmount();
    expect(h.removeChannel).not.toHaveBeenCalled();
    await act(async () => {
      vi.advanceTimersByTime(RELEASE_DELAY_MS + 1);
    });
    await flush();
    expect(h.removeChannel).toHaveBeenCalledTimes(1);

    // A later listener opens a fresh channel.
    const again = renderHook(() => usePrivateTopic("dao", "dao_changed", {}));
    await flush();
    expect(channels()).toHaveLength(2);
    again.unmount();
  });

  it("tells every listener to resync when the channel re-joins after a gap", async () => {
    const a = vi.fn();
    const b = vi.fn();
    const ha = renderHook(() => usePrivateTopic("activity", "activity_changed", { onResync: a }));
    const hb = renderHook(() => usePrivateTopic("activity", "activity_changed", { onResync: b }));
    await flush();
    const ch = channels()[0]!;
    act(() => ch.statusCb!("SUBSCRIBED"));
    expect(a).not.toHaveBeenCalled();
    act(() => ch.statusCb!("SUBSCRIBED"));
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
    ha.unmount();
    hb.unmount();
  });

  it("a topic that gave up after its retries joins again when a listener comes back", async () => {
    const first = renderHook(() => usePrivateTopic("presence", "presence_changed", {}));
    await flush();
    // The first join and its three retries fail: the topic gives up.
    for (let i = 0; i < 4; i++) {
      act(() => channels()[channels().length - 1]!.statusCb!("CHANNEL_ERROR"));
      await act(async () => {
        vi.advanceTimersByTime(10_000);
      });
      await flush();
    }
    expect(channels()).toHaveLength(4);
    first.unmount();

    // A remount within the release delay must not inherit the dead channel.
    const onEvent = vi.fn();
    const second = renderHook(() => usePrivateTopic("presence", "presence_changed", { onEvent }));
    await flush();
    expect(channels()).toHaveLength(5);
    act(() => channels()[4]!.statusCb!("SUBSCRIBED"));
    broadcast(channels()[4]!, "presence_changed", { ok: true });
    expect(onEvent).toHaveBeenCalledWith({ ok: true });
    second.unmount();
  });
});
