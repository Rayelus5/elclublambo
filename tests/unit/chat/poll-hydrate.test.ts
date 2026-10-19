import { describe, expect, it, vi } from "vitest";
import { getMessage } from "@/lib/chat/queries";

const CH = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const ME = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const POLL = "11111111-1111-4111-8111-111111111111";
const OPT = "22222222-2222-4222-8222-222222222222";

const message = (over: Record<string, unknown> = {}) => ({
  id: POLL,
  channel_id: CH,
  thread_root_id: null,
  author_id: ME,
  body: { type: "doc", content: [] },
  allow_links: true,
  kind: "poll",
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

const detailsRow = {
  message_id: POLL,
  weight_mode: "equal",
  closes_at: "2026-10-20T10:00:00+00:00",
  closed: false,
  voter_count: 2,
  options: [{ id: OPT, label: "Sí", position: 1 }, { id: "33333333-3333-4333-8333-333333333333", label: "No", position: 2 }],
  my_option_id: OPT,
  i_voted: true,
  my_has_weight: null,
  results_status: "pending",
  results: null,
};

function client(row: Record<string, unknown>, rpcs: Record<string, unknown>) {
  const rpc = vi.fn(async (name: string): Promise<{ data: unknown; error: { message: string } | null }> => ({ data: rpcs[name] ?? [], error: null }));
  const from = (table: string) => {
    const result = () => (table === "messages" ? { data: row, error: null } : { data: [], error: null });
    const chain: Record<string, unknown> = {};
    for (const op of ["select", "eq", "in", "is", "not", "order", "limit", "or"]) chain[op] = () => chain;
    chain.maybeSingle = async () => result();
    chain.then = (resolve: (v: unknown) => void) => resolve(result());
    return chain;
  };
  return { rpc, from };
}

describe("chat queries: poll messages", () => {
  it("loads poll_details for kind 'poll' messages and attaches them", async () => {
    const supabase = client(message(), { poll_details: [detailsRow] });
    const { message: m } = await getMessage(supabase as never, POLL, ME);
    expect(supabase.rpc).toHaveBeenCalledWith("poll_details", { p_message_ids: [POLL] });
    expect(m?.kind).toBe("poll");
    expect(m?.poll).toMatchObject({ messageId: POLL, weightMode: "equal", voterCount: 2, myOptionId: OPT, iVoted: true });
  });

  it("gives null for a deleted poll and does not ask for it", async () => {
    const supabase = client(message({ deleted_at: "2026-10-18T11:00:00Z", kind: "poll" }), { poll_details: [detailsRow] });
    const { message: m } = await getMessage(supabase as never, POLL, ME);
    expect(m?.poll).toBeNull();
    expect(supabase.rpc).not.toHaveBeenCalledWith("poll_details", expect.anything());
  });

  it("leaves poll null when the read fails or the row is malformed, and never asks for non-poll messages", async () => {
    const broken = client(message(), {});
    broken.rpc.mockImplementation(async (name: string) => (name === "poll_details" ? { data: null, error: { message: "x" } } : { data: [], error: null }));
    expect((await getMessage(broken as never, POLL, ME)).message?.poll).toBeNull();
    const text = client(message({ kind: "text" }), { poll_details: [detailsRow] });
    expect((await getMessage(text as never, POLL, ME)).message?.poll).toBeNull();
    expect(text.rpc).not.toHaveBeenCalledWith("poll_details", expect.anything());
  });
});
