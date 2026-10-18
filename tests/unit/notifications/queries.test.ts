import { describe, expect, it } from "vitest";
import { listNotifications, PAGE_SIZE } from "@/lib/notifications/queries";

const CH = "11111111-1111-4111-8111-111111111111";
const ROOT = "22222222-2222-4222-8222-222222222222";
const TICKET = "33333333-3333-4333-8333-333333333333";
const WALLET = "0xd590d5d858d5b61c357e7a40ee6b6a72d938b82d";

type Row = Record<string, unknown>;

function fakeClient(rows: Row[]) {
  const calls: Array<[string, ...unknown[]]> = [];
  const builder: Record<string, unknown> = {};
  for (const m of ["select", "order", "limit", "in", "or"]) {
    builder[m] = (...args: unknown[]) => {
      calls.push([m, ...args]);
      return builder;
    };
  }
  builder.then = (resolve: (v: unknown) => void) => resolve({ data: rows, error: null });
  return { client: { from: () => builder } as never, calls };
}

const base = {
  id: 7,
  kind: "mention",
  created_at: "2026-10-17T10:00:00.123456+00:00",
  read_at: null,
  channel_id: CH,
  ticket_id: null,
  data: {},
  actor: { display_name: "Ana", handle: null, avatar_path: null, wallet_address: WALLET },
  channel: { name: "trading" },
  message: { body_text: "hola  mundo", deleted_at: null },
  ticket: null,
};

describe("listNotifications", () => {
  it("maps rows into views with identity from members", async () => {
    const { client } = fakeClient([base]);
    const [v] = await listNotifications({ filter: "all" }, client);
    expect(v).toMatchObject({
      id: 7,
      kind: "mention",
      createdAt: base.created_at,
      readAt: null,
      actor: { name: "@Ana", wallet: WALLET },
      channelName: "trading",
      excerpt: "hola mundo",
      ticketSubject: null,
      href: `/c/${CH}`,
    });
  });

  it("falls back to the short wallet and null actor", async () => {
    const { client } = fakeClient([
      { ...base, actor: { display_name: null, handle: null, avatar_path: null, wallet_address: WALLET } },
      { ...base, id: 8, actor: null },
    ]);
    const views = await listNotifications({ filter: "all" }, client);
    expect(views[0]!.actor?.name).toBe("@0xd590…b82d");
    expect(views[1]!.actor).toBeNull();
  });

  it("hides the excerpt of a deleted message and caps it at 140 chars", async () => {
    const { client } = fakeClient([
      { ...base, message: { body_text: "x", deleted_at: "2026-10-17T11:00:00Z" } },
      { ...base, id: 8, message: { body_text: "a".repeat(300), deleted_at: null } },
      { ...base, id: 9, message: null },
    ]);
    const views = await listNotifications({ filter: "all" }, client);
    expect(views[0]!.excerpt).toBeNull();
    expect(views[1]!.excerpt).toHaveLength(140);
    expect(views[2]!.excerpt).toBeNull();
  });

  it("builds the href of every kind", async () => {
    const rows = [
      { ...base, id: 1, kind: "reply", data: { thread_root_id: ROOT } },
      { ...base, id: 2, kind: "reply", data: { thread_root_id: "not-a-uuid" } },
      { ...base, id: 3, kind: "channel_message" },
      { ...base, id: 4, kind: "invite_redeemed", channel_id: null },
      { ...base, id: 5, kind: "godchild_banned", channel_id: null },
      { ...base, id: 6, kind: "report_new" },
      { ...base, id: 7, kind: "member_review", channel_id: null },
      { ...base, id: 8, kind: "ticket_new", channel_id: null, ticket_id: TICKET, ticket: { subject: "Ayuda" } },
      { ...base, id: 9, kind: "invite_redeemed", channel_id: null, actor: null },
    ];
    const { client } = fakeClient(rows);
    const hrefs = (await listNotifications({ filter: "all" }, client)).map((v) => v.href);
    expect(hrefs).toEqual([
      `/c/${CH}?thread=${ROOT}`,
      `/c/${CH}`,
      `/c/${CH}`,
      `/u/${WALLET}`,
      `/u/${WALLET}`,
      "/moderation/reports",
      "/admin/members",
      `/tickets/${TICKET}`,
      "/notifications",
    ]);
  });

  it("exposes the ticket subject and status", async () => {
    const { client } = fakeClient([
      { ...base, kind: "ticket_status", channel_id: null, ticket_id: TICKET, ticket: { subject: "Ayuda" }, data: { status: "closed" } },
    ]);
    const [v] = await listNotifications({ filter: "all" }, client);
    expect(v!.ticketSubject).toBe("Ayuda");
    expect(v!.ticketStatus).toBe("closed");
  });

  it("pages by 30 with a keyset cursor and filters mentions", async () => {
    const { client, calls } = fakeClient([]);
    await listNotifications({ filter: "mentions", cursor: { createdAt: "2026-10-17T10:00:00.5+00:00", id: 9 } }, client);
    expect(PAGE_SIZE).toBe(30);
    expect(calls).toContainEqual(["limit", 30]);
    expect(calls).toContainEqual(["in", "kind", ["mention", "reply"]]);
    const or = calls.find((c) => c[0] === "or");
    expect(or?.[1]).toBe('created_at.lt."2026-10-17T10:00:00.5+00:00",and(created_at.eq."2026-10-17T10:00:00.5+00:00",id.lt.9)');
  });

  it("rejects a malformed cursor instead of building a filter from it", async () => {
    const { client } = fakeClient([]);
    await expect(
      listNotifications({ filter: "all", cursor: { createdAt: '"),id.gt.0,(x', id: 1 } }, client),
    ).rejects.toThrow();
  });
});
