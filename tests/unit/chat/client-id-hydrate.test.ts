import { describe, expect, it, vi } from "vitest";
import { getMessage } from "@/lib/chat/queries";

const CH = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const ME = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const MSG = "11111111-1111-4111-8111-111111111111";
const KEY = "55555555-5555-4555-8555-555555555555";

const row = (over: Record<string, unknown> = {}) => ({
  id: MSG,
  channel_id: CH,
  thread_root_id: null,
  author_id: ME,
  body: { type: "doc", content: [] },
  allow_links: true,
  kind: "text",
  expanded: false,
  quoted_message_id: null,
  reply_count: 0,
  last_reply_at: null,
  pinned_at: null,
  edited_at: null,
  deleted_at: null,
  created_at: "2026-10-18T10:00:00Z",
  ...over,
});

function client(message: Record<string, unknown>) {
  const selects: string[] = [];
  const from = (table: string) => {
    const result = () => (table === "messages" ? { data: message, error: null } : { data: [], error: null });
    const chain: Record<string, unknown> = {};
    for (const op of ["eq", "in", "is", "not", "order", "limit", "or"]) chain[op] = () => chain;
    chain.select = (cols: string) => {
      if (table === "messages") selects.push(cols);
      return chain;
    };
    chain.maybeSingle = async () => result();
    chain.then = (resolve: (v: unknown) => void) => resolve(result());
    return chain;
  };
  return { rpc: vi.fn(async () => ({ data: [], error: null })), from, selects };
}

describe("chat queries: client key", () => {
  it("reads client_id and exposes it as clientId (the realtime echo of my optimistic send is matched by it)", async () => {
    const supabase = client(row({ client_id: KEY }));
    const { message } = await getMessage(supabase as never, MSG, ME);
    expect(supabase.selects[0]).toContain("client_id");
    expect(message?.clientId).toBe(KEY);
  });

  it("is null for a message sent without a key", async () => {
    const { message } = await getMessage(client(row({ client_id: null })) as never, MSG, ME);
    expect(message?.clientId).toBeNull();
  });
});
