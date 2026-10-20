import { beforeEach, describe, expect, it, vi } from "vitest";

const rpc = vi.fn();
const remove = vi.fn();
const storageFrom = vi.fn(() => ({ remove }));
const results: Record<string, { data: unknown[]; error: unknown }> = {
  members: { data: [], error: null },
  roles: { data: [], error: null },
};
const builders: Record<string, Record<string, ReturnType<typeof vi.fn>>> = {};
function makeBuilder(table: string) {
  const b: Record<string, unknown> = {};
  for (const m of ["select", "eq", "neq", "or", "ilike", "order", "limit"]) b[m] = vi.fn(() => b);
  b.then = (res: (v: unknown) => unknown) => Promise.resolve(results[table]).then(res);
  builders[table] = b as Record<string, ReturnType<typeof vi.fn>>;
  return b;
}
const from = vi.fn((table: string) => makeBuilder(table));

vi.mock("@/lib/supabase/server", () => ({ createServerClient: async () => ({ rpc, from }) }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ storage: { from: storageFrom } }) }));

import {
  deleteMessageAction,
  editMessageAction,
  getSlowmodeAction,
  markReadAction,
  postMessageAction,
  searchMentionTargetsAction,
  setPinnedAction,
  toggleReactionAction,
} from "@/lib/chat/actions";

const CH = "11111111-1111-4111-8111-111111111111";
const ROOT = "22222222-2222-4222-8222-222222222222";
const MSG = "33333333-3333-4333-8333-333333333333";
const MEMBER = "44444444-4444-4444-8444-444444444444";

const doc = (text: string) => ({ type: "doc", content: [{ type: "paragraph", content: text ? [{ type: "text", text }] : [] }] });

beforeEach(() => {
  rpc.mockReset();
  remove.mockReset();
  storageFrom.mockClear();
  from.mockClear();
  results.members = { data: [], error: null };
  results.roles = { data: [], error: null };
});

describe("postMessageAction", () => {
  it("sanitizes the doc server-side and derives the text before calling the RPC", async () => {
    rpc.mockResolvedValue({ data: MSG, error: null });
    const evil = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "hola", marks: [{ type: "link", attrs: { href: "javascript:alert(1)" } }, { type: "bold" }] },
            { type: "script", content: [{ type: "text", text: "x" }] },
          ],
        },
      ],
    };
    const res = await postMessageAction({ channelId: CH, doc: evil, expanded: false });
    expect(res).toEqual({ id: MSG });
    const [name, args] = rpc.mock.calls[0] as [string, Record<string, unknown>];
    expect(name).toBe("post_message");
    expect(JSON.stringify(args.p_body)).not.toContain("javascript");
    expect(JSON.stringify(args.p_body)).not.toContain("script");
    expect(args.p_body).toEqual({
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "hola", marks: [{ type: "bold" }] }, { type: "text", text: "x" }] }],
    });
    expect(args.p_body_text).toBe("holax");
    expect(args).toMatchObject({ p_channel: CH, p_expanded: false, p_thread_root: null, p_quoted: null, p_attachments: [] });
  });

  it("passes the client key so a retry of the same message is deduplicated by the server", async () => {
    rpc.mockResolvedValue({ data: MSG, error: null });
    const KEY = "55555555-5555-4555-8555-555555555555";
    await postMessageAction({ channelId: CH, doc: doc("hola"), expanded: false, clientId: KEY });
    expect((rpc.mock.calls[0] as [string, Record<string, unknown>])[1]).toMatchObject({ p_client_id: KEY });
    rpc.mockClear();
    await postMessageAction({ channelId: CH, doc: doc("hola"), expanded: false });
    expect((rpc.mock.calls[0] as [string, Record<string, unknown>])[1]).toMatchObject({ p_client_id: null });
  });

  it("refuses a client key that is not a uuid", async () => {
    expect(await postMessageAction({ channelId: CH, doc: doc("hola"), expanded: false, clientId: "nope" })).toEqual({ error: "invalid_input" });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("rejects an empty doc without calling the RPC", async () => {
    expect(await postMessageAction({ channelId: CH, doc: doc(""), expanded: false })).toEqual({ error: "invalid_input" });
    expect(await postMessageAction({ channelId: CH, doc: doc("   \n "), expanded: false })).toEqual({ error: "invalid_input" });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("allows an empty doc when there are attachments", async () => {
    rpc.mockResolvedValue({ data: MSG, error: null });
    const path = `${CH}/${MEMBER}/55555555-5555-4555-8555-555555555555.webp`;
    const res = await postMessageAction({
      channelId: CH,
      doc: doc(""),
      expanded: false,
      attachments: [{ path, mime: "image/webp", size: 10, width: 1, height: 2 }],
    });
    expect(res).toEqual({ id: MSG });
    expect((rpc.mock.calls[0]![1] as { p_attachments: unknown[] }).p_attachments).toEqual([
      { path, mime: "image/webp", size: 10, width: 1, height: 2 },
    ]);
  });

  it("validates ids and attachments", async () => {
    expect(await postMessageAction({ channelId: "nope", doc: doc("a"), expanded: false })).toEqual({ error: "invalid_input" });
    expect(await postMessageAction({ channelId: CH, doc: doc("a"), expanded: false, threadRootId: "x" })).toEqual({ error: "invalid_input" });
    expect(await postMessageAction({ channelId: CH, doc: doc("a"), expanded: false, quotedId: "x" })).toEqual({ error: "invalid_input" });
    const bad = { path: "p", mime: "image/webp", size: 1, width: 1, height: 1 };
    expect(await postMessageAction({ channelId: CH, doc: doc("a"), expanded: false, attachments: [bad] })).toEqual({ error: "invalid_input" });
    expect(await postMessageAction({ channelId: CH, doc: doc("a"), expanded: false, attachments: new Array(5).fill(bad) })).toEqual({
      error: "too_many_attachments",
    });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("passes thread root and quoted ids", async () => {
    rpc.mockResolvedValue({ data: MSG, error: null });
    await postMessageAction({ channelId: CH, doc: doc("a"), expanded: true, threadRootId: ROOT, quotedId: MSG });
    expect(rpc.mock.calls[0]![1]).toMatchObject({ p_thread_root: ROOT, p_quoted: MSG, p_expanded: true });
  });

  it("maps RPC errors and exposes the slowmode seconds from the error detail", async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { message: "slowmode", details: "12" } });
    expect(await postMessageAction({ channelId: CH, doc: doc("a"), expanded: false })).toEqual({ error: "slowmode", slowmodeSeconds: 12 });
    rpc.mockResolvedValueOnce({ data: null, error: { message: "too_long" } });
    expect(await postMessageAction({ channelId: CH, doc: doc("a"), expanded: false })).toEqual({ error: "too_long" });
    rpc.mockResolvedValueOnce({ data: null, error: { message: "boom" } });
    expect(await postMessageAction({ channelId: CH, doc: doc("a"), expanded: false })).toEqual({ error: "unknown" });
  });
});

describe("editMessageAction", () => {
  it("sanitizes and validates the id", async () => {
    rpc.mockResolvedValue({ data: null, error: null });
    expect(await editMessageAction({ id: "x", doc: doc("a") })).toEqual({ error: "invalid_input" });
    expect(rpc).not.toHaveBeenCalled();
    expect(await editMessageAction({ id: MSG, doc: doc("hola") })).toEqual({});
    expect(rpc).toHaveBeenCalledWith("edit_message", { p_id: MSG, p_body: doc("hola"), p_body_text: "hola" });
  });

  it("lets SQL decide on an empty text (allowed when the message has attachments)", async () => {
    rpc.mockResolvedValueOnce({ data: null, error: null });
    expect(await editMessageAction({ id: MSG, doc: doc("") })).toEqual({});
    expect(rpc).toHaveBeenCalledWith("edit_message", { p_id: MSG, p_body: { type: "doc", content: [{ type: "paragraph" }] }, p_body_text: "" });
    rpc.mockResolvedValueOnce({ data: null, error: { message: "invalid_input" } });
    expect(await editMessageAction({ id: MSG, doc: doc("") })).toEqual({ error: "invalid_input" });
  });

  it("maps errors", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "forbidden" } });
    expect(await editMessageAction({ id: MSG, doc: doc("a") })).toEqual({ error: "forbidden" });
  });
});

describe("deleteMessageAction", () => {
  it("removes the returned paths from chat-images with the admin client", async () => {
    rpc.mockResolvedValue({ data: { hard: true, paths: ["a/b/c.webp", "a/b/d.png"] }, error: null });
    remove.mockResolvedValue({ error: null });
    expect(await deleteMessageAction(MSG)).toEqual({});
    expect(rpc).toHaveBeenCalledWith("delete_message", { p_id: MSG });
    expect(storageFrom).toHaveBeenCalledWith("chat-images");
    expect(remove).toHaveBeenCalledWith(["a/b/c.webp", "a/b/d.png"]);
  });

  it("removes in chunks of 1000", async () => {
    const paths = Array.from({ length: 2300 }, (_, i) => `p/${i}.webp`);
    rpc.mockResolvedValue({ data: { hard: true, paths }, error: null });
    remove.mockResolvedValue({ error: null });
    await deleteMessageAction(MSG);
    expect(remove.mock.calls.map((c) => (c[0] as string[]).length)).toEqual([1000, 1000, 300]);
  });

  it("does not touch storage without paths, and logs storage failures without failing", async () => {
    rpc.mockResolvedValue({ data: { hard: false, paths: [] }, error: null });
    expect(await deleteMessageAction(MSG)).toEqual({});
    expect(remove).not.toHaveBeenCalled();

    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    rpc.mockResolvedValue({ data: { hard: true, paths: ["x"] }, error: null });
    remove.mockResolvedValueOnce({ error: { message: "nope" } });
    expect(await deleteMessageAction(MSG)).toEqual({});
    remove.mockRejectedValueOnce(new Error("net"));
    expect(await deleteMessageAction(MSG)).toEqual({});
    expect(spy).toHaveBeenCalledTimes(2);
    spy.mockRestore();
  });

  it("maps RPC errors and validates the id", async () => {
    expect(await deleteMessageAction("x")).toEqual({ error: "invalid_input" });
    rpc.mockResolvedValue({ data: null, error: { message: "forbidden" } });
    expect(await deleteMessageAction(MSG)).toEqual({ error: "forbidden" });
    expect(remove).not.toHaveBeenCalled();
  });
});

describe("social actions", () => {
  it("toggleReactionAction returns the new state and validates the emoji", async () => {
    rpc.mockResolvedValue({ data: true, error: null });
    expect(await toggleReactionAction({ messageId: MSG, emoji: "👍" })).toEqual({ active: true });
    expect(rpc).toHaveBeenCalledWith("toggle_reaction", { p_message: MSG, p_emoji: "👍" });
    expect(await toggleReactionAction({ messageId: MSG, emoji: "" })).toEqual({ error: "invalid_input" });
    expect(await toggleReactionAction({ messageId: MSG, emoji: "x".repeat(33) })).toEqual({ error: "invalid_input" });
    expect(await toggleReactionAction({ messageId: "x", emoji: "👍" })).toEqual({ error: "invalid_input" });
  });

  it("setPinnedAction and markReadAction", async () => {
    rpc.mockResolvedValue({ data: null, error: null });
    expect(await setPinnedAction({ messageId: MSG, pinned: true })).toEqual({});
    expect(rpc).toHaveBeenCalledWith("set_pinned", { p_message: MSG, p_pinned: true });
    expect(await markReadAction(CH)).toEqual({});
    expect(rpc).toHaveBeenCalledWith("mark_channel_read", { p_channel: CH });
    expect(await markReadAction("x")).toEqual({ error: "invalid_input" });
    rpc.mockResolvedValue({ data: null, error: { message: "forbidden" } });
    expect(await setPinnedAction({ messageId: MSG, pinned: false })).toEqual({ error: "forbidden" });
  });

  it("getSlowmodeAction returns the server value", async () => {
    rpc.mockResolvedValue({ data: 7, error: null });
    expect(await getSlowmodeAction(CH)).toEqual({ seconds: 7 });
    expect(rpc).toHaveBeenCalledWith("my_slowmode_remaining", { p_channel: CH });
    rpc.mockResolvedValue({ data: null, error: { message: "forbidden" } });
    expect(await getSlowmodeAction(CH)).toEqual({ seconds: 0, error: "forbidden" });
    expect(await getSlowmodeAction("x")).toEqual({ seconds: 0, error: "invalid_input" });
  });
});

describe("searchMentionTargetsAction", () => {
  it("returns members and roles (without @everyone), sanitizing the pattern", async () => {
    results.members = { data: [{ id: MEMBER, display_name: "Ana", wallet_address: "0xabc" }], error: null };
    results.roles = { data: [{ id: ROOT, name: "Anfitriones" }], error: null };
    const res = await searchMentionTargetsAction("  An\%a,(x) ");
    expect(res.members).toEqual([{ id: MEMBER, label: "Ana", handle: null, walletAddress: "0xabc" }]);
    expect(res.roles).toEqual([{ id: ROOT, label: "Anfitriones" }]);
    expect(String(builders.members!.or!.mock.calls[0]![0])).toBe("display_name.ilike.%an\\%ax%,handle.ilike.%an\\%ax%,wallet_address.ilike.%an\\%ax%");
    expect(builders.members!.limit).toHaveBeenCalledWith(8);
    expect(builders.roles!.eq).toHaveBeenCalledWith("is_everyone", false);
    expect(builders.roles!.ilike).toHaveBeenCalledWith("name", "%an\\%ax%");
  });

  it("returns the handle next to the display name", async () => {
    results.members = { data: [{ id: MEMBER, display_name: "Ana", handle: "ana_l", wallet_address: "0xabc" }], error: null };
    const res = await searchMentionTargetsAction("ana_l");
    expect(res.members).toEqual([{ id: MEMBER, label: "Ana", handle: "ana_l", walletAddress: "0xabc" }]);
  });

  it("escapes _ and % for ilike instead of stripping them (foo_bar is found literally)", async () => {
    await searchMentionTargetsAction("foo_bar");
    expect(String(builders.members!.or!.mock.calls[0]![0])).toBe("display_name.ilike.%foo\\_bar%,handle.ilike.%foo\\_bar%,wallet_address.ilike.%foo\\_bar%");
    expect(builders.roles!.ilike).toHaveBeenCalledWith("name", "%foo\\_bar%");
  });

  it("with an empty query lists only roles", async () => {
    results.roles = { data: [{ id: ROOT, name: "Admin" }], error: null };
    const res = await searchMentionTargetsAction("");
    expect(res.members).toEqual([]);
    expect(res.roles).toEqual([{ id: ROOT, label: "Admin" }]);
    expect(from).not.toHaveBeenCalledWith("members");
  });

  it("rejects non-string and overlong queries", async () => {
    expect(await searchMentionTargetsAction(42 as unknown as string)).toEqual({ members: [], roles: [] });
    expect(await searchMentionTargetsAction("x".repeat(60))).toEqual({ members: [], roles: [] });
  });
});
