import { describe, expect, it, vi } from "vitest";
import { getMessage } from "@/lib/chat/queries";

const CH = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const ME = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const SOLVER = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const BOUNTY = "11111111-1111-4111-8111-111111111111";
const REPLY = "22222222-2222-4222-8222-222222222222";

const message = (over: Record<string, unknown> = {}) => ({
  id: BOUNTY,
  channel_id: CH,
  thread_root_id: null,
  author_id: ME,
  body: { type: "doc", content: [] },
  allow_links: true,
  kind: "bounty",
  expanded: false,
  quoted_message_id: null,
  reply_count: 1,
  last_reply_at: null,
  pinned_at: null,
  edited_at: null,
  deleted_at: null,
  created_at: "2026-10-18T10:00:00Z",
  ...over,
});

function client(row: Record<string, unknown>, rpcs: Record<string, unknown>) {
  const rpc = vi.fn(async (name: string): Promise<{ data: unknown; error: { message: string } | null }> => ({ data: rpcs[name] ?? [], error: null }));
  const from = (table: string) => {
    const result = () => {
      if (table === "messages") return { data: row, error: null };
      if (table === "members") return { data: [{ id: SOLVER, handle: "ana_l", display_name: "Ana", wallet_address: "0x2222222222222222222222222222222222222222", avatar_path: null }], error: null };
      return { data: [], error: null };
    };
    const chain: Record<string, unknown> = {};
    for (const op of ["select", "eq", "in", "is", "not", "order", "limit", "or"]) chain[op] = () => chain;
    chain.maybeSingle = async () => result();
    chain.then = (resolve: (v: unknown) => void) => resolve(result());
    return chain;
  };
  return { rpc, from, storage: { from: () => ({ createSignedUrls: async () => ({ data: [], error: null }) }) } };
}

const detailsRow = {
  message_id: BOUNTY,
  token: "USDC",
  amount_text: "25000000",
  chain_id: 59141,
  status: "solution_marked",
  solution_message_id: REPLY,
  solver_id: SOLVER,
  solution_marked_at: "2026-10-18T11:00:00Z",
  pay_deadline: "2026-10-25T11:00:00Z",
  paid_tip_id: null,
};

describe("chat queries: bounty messages", () => {
  it("loads bounty_details for kind 'bounty' messages and attaches them", async () => {
    const supabase = client(message(), { bounty_details: [detailsRow] });
    const { message: m } = await getMessage(supabase as never, BOUNTY, ME);
    expect(supabase.rpc).toHaveBeenCalledWith("bounty_details", { p_message_ids: [BOUNTY] });
    expect(m?.kind).toBe("bounty");
    expect(m?.bounty).toMatchObject({ messageId: BOUNTY, token: "USDC", amount: 25_000_000n, status: "solution_marked", solutionMessageId: REPLY, solverId: SOLVER });
  });

  it("adds the solver to the directory so the card can pay them", async () => {
    const supabase = client(message(), { bounty_details: [detailsRow] });
    const { directory } = await getMessage(supabase as never, BOUNTY, ME);
    expect(directory.members[SOLVER]?.walletAddress).toBe("0x2222222222222222222222222222222222222222");
  });

  it("leaves bounty null when the read fails, and never asks for non-bounty or deleted messages", async () => {
    const broken = client(message(), {});
    broken.rpc.mockImplementation(async (name: string) => (name === "bounty_details" ? { data: null, error: { message: "x" } } : { data: [], error: null }));
    expect((await getMessage(broken as never, BOUNTY, ME)).message?.bounty).toBeNull();

    const text = client(message({ kind: "text" }), {});
    expect((await getMessage(text as never, BOUNTY, ME)).message?.bounty).toBeNull();
    expect(text.rpc).not.toHaveBeenCalledWith("bounty_details", expect.anything());

    const deleted = client(message({ deleted_at: "2026-10-18T12:00:00Z" }), {});
    await getMessage(deleted as never, BOUNTY, ME);
    expect(deleted.rpc).not.toHaveBeenCalledWith("bounty_details", expect.anything());
  });
});
