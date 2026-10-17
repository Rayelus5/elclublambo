import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  getUser: vi.fn(),
  rpc: vi.fn(),
  channelRow: vi.fn(),
  adminRpc: vi.fn(),
  verify: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createServerClient: async () => ({
    auth: { getUser: h.getUser },
    rpc: h.rpc,
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: () => h.channelRow() }) }),
    }),
  }),
}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ rpc: h.adminRpc }) }));
vi.mock("@/lib/chat/linea", () => ({ verifyLineaContract: h.verify }));

import { postAlphaAction } from "@/lib/chat/alpha";

const CH = "11111111-1111-4111-8111-111111111111";
const ME = "44444444-4444-4444-8444-444444444444";
const MSG = "33333333-3333-4333-8333-333333333333";
const ADDR = "0x1234567890abcdef1234567890ABCDEF12345678";
const doc = (text: string) => ({ type: "doc", content: [{ type: "paragraph", content: text ? [{ type: "text", text }] : [] }] });

function session({ status = "active", perms = 2048 + 3, alpha = true, member = ME as string | null } = {}) {
  h.getUser.mockResolvedValue({ data: { user: { id: "u1" } } });
  h.rpc.mockImplementation(async (name: string) => {
    if (name === "current_member_id") return { data: member, error: null };
    if (name === "my_membership_status") return { data: status, error: null };
    if (name === "my_channel_permissions") return { data: perms, error: null };
    return { data: null, error: { message: "unexpected" } };
  });
  h.channelRow.mockResolvedValue({ data: alpha === null ? null : { alpha_enabled: alpha, kind: "text" }, error: null });
}

beforeEach(() => {
  for (const f of Object.values(h)) f.mockReset();
  session();
  h.verify.mockResolvedValue(true);
  h.adminRpc.mockResolvedValue({ data: MSG, error: null });
});

describe("postAlphaAction", () => {
  it("posts through post_message_as with the member of the session and the lowercased contract", async () => {
    const res = await postAlphaAction({ channelId: CH, address: ADDR, doc: doc("mi tesis") });
    expect(res).toEqual({ id: MSG });
    expect(h.verify).toHaveBeenCalledWith(ADDR);
    expect(h.adminRpc).toHaveBeenCalledTimes(1);
    const [name, args] = h.adminRpc.mock.calls[0] as [string, Record<string, unknown>];
    expect(name).toBe("post_message_as");
    expect(args).toMatchObject({
      p_member: ME,
      p_channel: CH,
      p_body_text: "mi tesis",
      p_expanded: false,
      p_thread_root: null,
      p_quoted: null,
      p_attachments: [],
      p_alpha_address: ADDR.toLowerCase(),
    });
    expect(args.p_body).toEqual(doc("mi tesis"));
  });

  it("never reads a member id from the client input", async () => {
    await postAlphaAction({ channelId: CH, address: ADDR, doc: doc("x"), memberId: "evil", p_member: "evil" } as never);
    expect((h.adminRpc.mock.calls[0]![1] as { p_member: string }).p_member).toBe(ME);
  });

  it("requires a thesis text (the RPC rejects empty alpha messages)", async () => {
    expect(await postAlphaAction({ channelId: CH, address: ADDR, doc: doc("") })).toEqual({ error: "invalid_input" });
    expect(h.getUser).not.toHaveBeenCalled();
  });

  it("not_a_contract when the address has no bytecode; nothing is posted", async () => {
    h.verify.mockResolvedValue(false);
    expect(await postAlphaAction({ channelId: CH, address: ADDR, doc: doc("x") })).toEqual({ error: "not_a_contract" });
    expect(h.adminRpc).not.toHaveBeenCalled();
  });

  it("network when the chain cannot be reached; nothing is posted", async () => {
    h.verify.mockRejectedValue(new Error("network"));
    expect(await postAlphaAction({ channelId: CH, address: ADDR, doc: doc("x") })).toEqual({ error: "network" });
    expect(h.adminRpc).not.toHaveBeenCalled();
  });

  it("forbidden without EMBED_LINKS, without alpha_enabled, for inactive members, and without a session", async () => {
    session({ perms: 3 });
    expect(await postAlphaAction({ channelId: CH, address: ADDR, doc: doc("x") })).toEqual({ error: "forbidden" });
    session({ alpha: false });
    expect(await postAlphaAction({ channelId: CH, address: ADDR, doc: doc("x") })).toEqual({ error: "forbidden" });
    session({ status: "banned" });
    expect(await postAlphaAction({ channelId: CH, address: ADDR, doc: doc("x") })).toEqual({ error: "forbidden" });
    h.getUser.mockResolvedValue({ data: { user: null } });
    expect(await postAlphaAction({ channelId: CH, address: ADDR, doc: doc("x") })).toEqual({ error: "not_authenticated" });
    expect(h.verify).not.toHaveBeenCalled();
    expect(h.adminRpc).not.toHaveBeenCalled();
  });

  it("forbidden without SEND_MESSAGES, before spending the on-chain lookup", async () => {
    session({ perms: 2048 + 1 });
    expect(await postAlphaAction({ channelId: CH, address: ADDR, doc: doc("x") })).toEqual({ error: "forbidden" });
    expect(h.verify).not.toHaveBeenCalled();
    expect(h.adminRpc).not.toHaveBeenCalled();
  });

  it("validates ids and the address before touching anything", async () => {
    expect(await postAlphaAction({ channelId: "x", address: ADDR, doc: doc("x") })).toEqual({ error: "invalid_input" });
    expect(await postAlphaAction({ channelId: CH, address: "0xabc", doc: doc("x") })).toEqual({ error: "invalid_input" });
    expect(await postAlphaAction({ channelId: CH, address: ADDR.replace("0x", "0z"), doc: doc("x") })).toEqual({ error: "invalid_input" });
    expect(h.getUser).not.toHaveBeenCalled();
  });

  it("maps RPC errors (slowmode carries the seconds)", async () => {
    h.adminRpc.mockResolvedValueOnce({ data: null, error: { message: "slowmode", details: "7" } });
    expect(await postAlphaAction({ channelId: CH, address: ADDR, doc: doc("x") })).toEqual({ error: "slowmode", slowmodeSeconds: 7 });
    h.adminRpc.mockResolvedValueOnce({ data: null, error: { message: "forbidden" } });
    expect(await postAlphaAction({ channelId: CH, address: ADDR, doc: doc("x") })).toEqual({ error: "forbidden" });
  });
});
