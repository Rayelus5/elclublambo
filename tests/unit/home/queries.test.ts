import { describe, expect, it, vi } from "vitest";
import {
  getClubActivity,
  getHomeHighlights,
  getHomeUnreadChannels,
  getOpenBounties,
  getUnreadSummary,
  messageHref,
} from "@/lib/home/queries";

const rpcClient = (data: unknown, error: unknown = null) => ({ rpc: vi.fn(async () => ({ data, error })), from: vi.fn() });

describe("home queries", () => {
  it("maps open bounties with exact bigint amounts", async () => {
    const c = rpcClient([
      { message_id: "m1", channel_id: "c1", channel_name: "General", token: "USDC", amount_text: "123456789012345678901", status: "open", excerpt: "falla", created_at: "2026-10-18T10:00:00Z" },
    ]);
    const [b] = await getOpenBounties(c as never, 5);
    expect(c.rpc).toHaveBeenCalledWith("home_open_bounties", { p_limit: 5 });
    expect(b).toMatchObject({ messageId: "m1", channelName: "General", amount: 123456789012345678901n, status: "open" });
  });

  it("throws on an RPC error so the section can show its own error state", async () => {
    await expect(getOpenBounties(rpcClient(null, { message: "boom" }) as never)).rejects.toThrow("boom");
  });

  it("keeps only known activity kinds and never invents a name", async () => {
    const c = rpcClient([
      { kind: "tip", at: "t", actor_label: "Anónimo", target_label: "@bob", token: "ETH", amount_text: "1000", channel_id: "c", message_id: "m", target_wallet: null },
      { kind: "weird", at: "t" },
      { kind: "donation", at: "t", actor_label: null, token: "USDC", amount_text: "5000000" },
    ]);
    const items = await getClubActivity(c as never);
    expect(items.map((i) => i.kind)).toEqual(["tip", "donation"]);
    expect(items[1]!.actorLabel).toBe("Anónimo");
    expect(items[0]!.token).toBe("ETH");
  });

  it("counts unread mentions, replies and everything", async () => {
    const calls: string[][] = [];
    const from = vi.fn(() => {
      const q: Record<string, unknown> = {};
      let kinds: string[] | null = null;
      q.select = () => q;
      q.is = () => q;
      q.in = (_c: string, k: string[]) => {
        kinds = k;
        return q;
      };
      q.then = (resolve: (v: unknown) => void) => {
        calls.push(kinds ?? ["*"]);
        resolve({ count: kinds?.[0] === "mention" ? 3 : kinds?.[0] === "reply" ? 2 : 9, error: null });
      };
      return q;
    });
    expect(await getUnreadSummary({ rpc: vi.fn(), from } as never)).toEqual({ mentions: 3, replies: 2, total: 9 });
  });

  it("links a message in its channel", () => {
    expect(messageHref("c1", "m1")).toBe("/foro/c/c1?m=m1");
  });
  it("maps unread channels from home_unread_channels", async () => {
    const c = rpcClient([
      { channel_id: "c1", channel_name: "general", unread_count: 99, last_excerpt: "hola", last_author: "@ana", last_at: "2026-10-24T10:00:00Z" },
      { channel_id: "c2", channel_name: "ideas", unread_count: null, last_excerpt: null, last_author: null, last_at: "2026-10-24T09:00:00Z" },
    ]);
    const list = await getHomeUnreadChannels(c as never, 4);
    expect(c.rpc).toHaveBeenCalledWith("home_unread_channels", { p_limit: 4 });
    expect(list).toEqual([
      { channelId: "c1", channelName: "general", unreadCount: 99, lastExcerpt: "hola", lastAuthor: "@ana", lastAt: "2026-10-24T10:00:00Z" },
      { channelId: "c2", channelName: "ideas", unreadCount: 0, lastExcerpt: "", lastAuthor: "", lastAt: "2026-10-24T09:00:00Z" },
    ]);
  });

  it("throws when home_unread_channels fails", async () => {
    await expect(getHomeUnreadChannels(rpcClient(null, { message: "boom" }) as never, 6)).rejects.toThrow("boom");
  });

  it("maps home_highlights with poll and giveaway", async () => {
    const c = rpcClient({
      openBounties: 3,
      poll: { messageId: "m1", channelId: "c1", question: "¿Sí?", closesAt: "2026-10-25T10:00:00+00:00" },
      giveaway: { id: "g1", title: "Sorteo", closesAt: "2026-10-26T10:00:00+00:00", iEntered: true },
      donor: { isMecenas: true },
    });
    expect(await getHomeHighlights(c as never)).toEqual({
      openBounties: 3,
      poll: { messageId: "m1", channelId: "c1", question: "¿Sí?", closesAt: "2026-10-25T10:00:00+00:00" },
      giveaway: { id: "g1", title: "Sorteo", closesAt: "2026-10-26T10:00:00+00:00", iEntered: true },
      donor: { isMecenas: true },
    });
    expect(c.rpc).toHaveBeenCalledWith("home_highlights");
  });

  it("reads null poll and giveaway, and defends against a malformed payload", async () => {
    expect(await getHomeHighlights(rpcClient({ openBounties: 0, poll: null, giveaway: null, donor: { isMecenas: false } }) as never)).toEqual({
      openBounties: 0,
      poll: null,
      giveaway: null,
      donor: { isMecenas: false },
    });
    expect(await getHomeHighlights(rpcClient(null) as never)).toEqual({
      openBounties: 0,
      poll: null,
      giveaway: null,
      donor: { isMecenas: false },
    });
    await expect(getHomeHighlights(rpcClient(null, { message: "forbidden" }) as never)).rejects.toThrow("forbidden");
  });
});
