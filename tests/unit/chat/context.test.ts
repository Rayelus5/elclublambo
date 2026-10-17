import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const state = vi.hoisted(() => ({ read: null as null | { last_read_at: string }, joined: "2026-01-02T00:00:00+00:00" }));
const empty = { messages: [], hasMore: false, directory: { members: {}, roles: {} } };
vi.mock("@/lib/chat/queries", () => ({
  getMessages: vi.fn(async () => empty),
  getPinned: vi.fn(async () => empty),
  getMessagesAround: vi.fn(async (_s: unknown, _c: string, _m: string, id: string) => ({
    ...empty,
    hasNewer: true,
    anchorId: id === "missing" ? null : id,
    threadRootId: id === "reply" ? "root-1" : null,
  })),
}));

function table(name: string) {
  const result = () => {
    if (name === "channel_reads") return { data: state.read, error: null };
    if (name === "members") return { data: { created_at: state.joined }, error: null };
    return { data: [{ domain: "github.com" }], error: null };
  };
  const chain: Record<string, unknown> = {
    select: () => chain,
    eq: () => chain,
    maybeSingle: async () => result(),
    then: (resolve: (v: unknown) => void) => resolve(result()),
  };
  return chain;
}
vi.mock("@/lib/supabase/server", () => ({
  createServerClient: async () => ({
    from: table,
    rpc: async (fn: string) => ({ data: fn === "current_member_id" ? "11111111-1111-4111-8111-111111111111" : 3, error: null }),
  }),
}));

import { loadChatContext } from "@/lib/chat/context";

beforeEach(() => {
  state.read = null;
});

describe("loadChatContext lastReadAt", () => {
  it("uses the read mark when there is one", async () => {
    state.read = { last_read_at: "2026-10-17T10:00:00+00:00" };
    expect((await loadChatContext("c")).initial.lastReadAt).toBe("2026-10-17T10:00:00+00:00");
  });

  it("falls back to the member's join date, like my_unread_channels", async () => {
    expect((await loadChatContext("c")).initial.lastReadAt).toBe("2026-01-02T00:00:00+00:00");
  });

  it("loads the window around an anchor and exposes it", async () => {
    const ctx = await loadChatContext("c", "reply");
    expect(ctx.anchor).toEqual({ id: "reply", threadRootId: "root-1" });
    expect(ctx.initial.hasNewer).toBe(true);
  });

  it("has no anchor (and no newer pages) for a normal load or an anchor that does not resolve", async () => {
    const plain = await loadChatContext("c");
    expect(plain.anchor).toBeNull();
    expect(plain.initial.hasNewer).toBe(false);
    const missing = await loadChatContext("c", "missing");
    expect(missing.anchor).toBeNull();
  });

  it("maps channel permission bits", async () => {
    const { viewer } = await loadChatContext("c");
    expect(viewer).toMatchObject({ canPost: true, canThread: false, canManage: false, canAttach: false, canReact: false });
  });
});
