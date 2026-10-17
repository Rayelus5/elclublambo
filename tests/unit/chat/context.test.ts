import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const state = vi.hoisted(() => ({ read: null as null | { last_read_at: string }, joined: "2026-01-02T00:00:00+00:00" }));
const empty = { messages: [], hasMore: false, directory: { members: {}, roles: {} } };
vi.mock("@/lib/chat/queries", () => ({
  getMessages: vi.fn(async () => empty),
  getPinned: vi.fn(async () => empty),
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

  it("maps channel permission bits", async () => {
    const { viewer } = await loadChatContext("c");
    expect(viewer).toMatchObject({ canPost: true, canThread: false, canManage: false, canAttach: false, canReact: false });
  });
});
