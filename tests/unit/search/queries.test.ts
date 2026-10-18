import { describe, expect, it, vi } from "vitest";
import { searchMembers, searchMessages } from "@/lib/search/queries";

function fake(handlers: { rpc?: (name: string, args: unknown) => unknown; members?: unknown }) {
  const rpc = vi.fn(async (name: string, args: unknown) => handlers.rpc?.(name, args));
  const inFn = vi.fn(async () => handlers.members);
  const select = vi.fn(() => ({ in: inFn }));
  const from = vi.fn(() => ({ select }));
  return { client: { rpc, from } as never, rpc, from };
}

describe("searchMessages", () => {
  it("calls search_messages and joins author names", async () => {
    const f = fake({
      rpc: () => ({
        data: [{ id: "m1", channel_id: "c1", thread_root_id: null, author_id: "a1", created_at: "2026-10-01T10:00:00Z", snippet: "hola linea" }],
        error: null,
      }),
      members: { data: [{ id: "a1", display_name: "Ana", wallet_address: "0xabc0000000000000000000000000000000000001" }], error: null },
    });
    const hits = await searchMessages(f.client, "lin", { limit: 5, channel: "c1" });
    expect(f.rpc).toHaveBeenCalledWith("search_messages", { p_q: "lin", p_limit: 5, p_channel: "c1" });
    expect(hits).toEqual([
      { id: "m1", channelId: "c1", threadRootId: null, authorId: "a1", authorName: "Ana", createdAt: "2026-10-01T10:00:00Z", snippet: "hola linea" },
    ]);
  });
  it("falls back to a short address, then to 'alguien'", async () => {
    const f = fake({
      rpc: () => ({
        data: [
          { id: "m1", channel_id: "c", thread_root_id: "r", author_id: "a1", created_at: "t", snippet: "x" },
          { id: "m2", channel_id: "c", thread_root_id: null, author_id: "zz", created_at: "t", snippet: "y" },
        ],
        error: null,
      }),
      members: { data: [{ id: "a1", display_name: null, wallet_address: "0xd590d5d858d5b61c357e7a40ee6b6a72d938b82d" }], error: null },
    });
    const hits = await searchMessages(f.client, "xx");
    expect(hits[0]!.authorName).toMatch(/^0xd590.*b82d$/);
    expect(hits[0]!.threadRootId).toBe("r");
    expect(hits[1]!.authorName).toBe("alguien");
  });
  it("keeps the hits as 'autor desconocido' and logs when the author lookup fails", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const f = fake({
      rpc: () => ({ data: [{ id: "m1", channel_id: "c", thread_root_id: null, author_id: "a1", created_at: "t", snippet: "x" }], error: null }),
      members: { data: null, error: { message: "nope" } },
    });
    const hits = await searchMessages(f.client, "xx");
    expect(hits).toHaveLength(1);
    expect(hits[0]!.authorName).toBe("autor desconocido");
    expect(log).toHaveBeenCalled();
    log.mockRestore();
  });
  it("returns [] without a members query when there are no hits", async () => {
    const f = fake({ rpc: () => ({ data: [], error: null }) });
    expect(await searchMessages(f.client, "xx")).toEqual([]);
    expect(f.from).not.toHaveBeenCalled();
  });
  it("throws when the rpc fails", async () => {
    const f = fake({ rpc: () => ({ data: null, error: { message: "boom" } }) });
    await expect(searchMessages(f.client, "xx")).rejects.toBeTruthy();
  });
});

describe("searchMembers", () => {
  it("maps rows", async () => {
    const f = fake({ rpc: () => ({ data: [{ id: "a", display_name: "Ana", handle: "ana_l", avatar_path: "a/x.png", wallet_address: "0x1" }], error: null }) });
    expect(await searchMembers(f.client, "an")).toEqual([
      { id: "a", displayName: "Ana", handle: "ana_l", avatarPath: "a/x.png", walletAddress: "0x1" },
    ]);
    expect(f.rpc).toHaveBeenCalledWith("search_members", { p_q: "an" });
  });
  it("throws when the rpc fails", async () => {
    const f = fake({ rpc: () => ({ data: null, error: { message: "boom" } }) });
    await expect(searchMembers(f.client, "an")).rejects.toBeTruthy();
  });
});
