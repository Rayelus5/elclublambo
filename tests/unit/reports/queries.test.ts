import { describe, expect, it } from "vitest";
import { listReportQueue } from "@/lib/reports/queries";

const CH = "11111111-1111-4111-8111-111111111111";
const M1 = "22222222-2222-4222-8222-222222222222";
const M2 = "33333333-3333-4333-8333-333333333333";
const AU = "44444444-4444-4444-8444-444444444444";
const SP = "55555555-5555-4555-8555-555555555555";
const WALLET = "0xd590d5d858d5b61c357e7a40ee6b6a72d938b82d";

type Row = Record<string, unknown>;

function fakeClient(tables: Record<string, Row[]>) {
  const calls: Array<[string, string, ...unknown[]]> = [];
  const client = {
    from(table: string) {
      const builder: Record<string, unknown> = {};
      for (const m of ["select", "order", "limit", "in", "eq"]) {
        builder[m] = (...args: unknown[]) => {
          calls.push([table, m, ...args]);
          return builder;
        };
      }
      builder.then = (resolve: (v: unknown) => void) => resolve({ data: tables[table] ?? [], error: null });
      return builder;
    },
  };
  return { client: client as never, calls };
}

const author = {
  id: AU,
  wallet_address: WALLET,
  display_name: "Ana",
  status: "active",
  invited_by_member_id: SP,
};

const row = (over: Row = {}): Row => ({
  id: "r1",
  message_id: M1,
  channel_id: CH,
  reason: "spam",
  note: null,
  snapshot_text: "compra ya",
  status: "open",
  created_at: "2026-10-17T10:00:00+00:00",
  resolved_at: null,
  channel: { name: "general" },
  author,
  message: { deleted_at: null },
  ...over,
});

const sponsor = { id: SP, wallet_address: "0x2222222222222222222222222222222222222222", display_name: "Bruno", status: "active" };

describe("listReportQueue", () => {
  it("queries open reports newest first", async () => {
    const { client, calls } = fakeClient({ reports: [] });
    expect(await listReportQueue("open", client)).toEqual({ groups: [], capped: false });
    expect(calls).toContainEqual(["reports", "eq", "status", "open"]);
    expect(calls).toContainEqual(["reports", "order", "created_at", { ascending: false }]);
  });

  it("closed means dismissed or actioned", async () => {
    const { client, calls } = fakeClient({ reports: [] });
    await listReportQueue("closed", client);
    expect(calls).toContainEqual(["reports", "in", "status", ["dismissed", "actioned"]]);
  });

  it("groups by message with a count, reasons, notes and the author's sponsor", async () => {
    const { client } = fakeClient({
      reports: [
        row({ id: "r3", reason: "scam", note: "es una estafa", created_at: "2026-10-17T12:00:00+00:00" }),
        row({ id: "r2", reason: "spam", note: "  " }),
        row({ id: "r1", reason: "spam", created_at: "2026-10-17T09:00:00+00:00" }),
        row({ id: "r4", message_id: M2, snapshot_text: "otro", created_at: "2026-10-17T08:00:00+00:00" }),
      ],
      members: [sponsor],
      member_roles: [],
    });
    const { groups } = await listReportQueue("open", client);
    expect(groups).toHaveLength(2);
    const [g, other] = groups;
    expect(g).toMatchObject({
      messageId: M1,
      reportId: "r3",
      count: 3,
      snapshotText: "compra ya",
      notes: ["es una estafa"],
      channel: { id: CH, name: "general" },
      latestAt: "2026-10-17T12:00:00+00:00",
      messageDeleted: false,
      status: "open",
    });
    expect(g!.reasons).toEqual([
      { reason: "spam", count: 2 },
      { reason: "scam", count: 1 },
    ]);
    expect(g!.author).toMatchObject({ id: AU, name: "Ana", walletAddress: WALLET, status: "active", sponsorIsAdmin: false });
    expect(g!.author?.sponsor).toMatchObject({ id: SP, displayName: "Bruno" });
    expect(other).toMatchObject({ messageId: M2, count: 1 });
  });

  it("keeps the snapshot of a message that was deleted or removed", async () => {
    const { client } = fakeClient({
      reports: [
        row({ id: "a", message: { deleted_at: "2026-10-17T11:00:00+00:00" } }),
        row({ id: "b", message_id: null, snapshot_text: "texto guardado" }),
      ],
      members: [sponsor],
      member_roles: [],
    });
    const { groups } = await listReportQueue("open", client);
    expect(groups).toHaveLength(2);
    expect(groups.find((g) => g.reportId === "a")).toMatchObject({ messageDeleted: true, snapshotText: "compra ya" });
    expect(groups.find((g) => g.reportId === "b")).toMatchObject({ messageId: null, messageDeleted: true, snapshotText: "texto guardado" });
  });

  it("flags sponsors that are administrators", async () => {
    const { client } = fakeClient({
      reports: [row()],
      members: [sponsor],
      member_roles: [{ member_id: SP }],
    });
    const [g] = (await listReportQueue("open", client)).groups;
    expect(g!.author?.sponsorIsAdmin).toBe(true);
  });

  it("falls back to the short wallet without a display name", async () => {
    const { client } = fakeClient({ reports: [row({ author: { ...author, display_name: null, invited_by_member_id: null } })] });
    const [g] = (await listReportQueue("open", client)).groups;
    expect(g!.author?.name).toBe("0xd590…b82d");
    expect(g!.author?.sponsor).toBeNull();
  });

  it("closed items are grouped per resolution batch, not merged across batches", async () => {
    const { client } = fakeClient({
      reports: [
        row({ id: "a", status: "dismissed", resolved_at: "2026-10-17T12:00:00+00:00" }),
        row({ id: "b", status: "dismissed", resolved_at: "2026-10-17T12:00:00+00:00" }),
        row({ id: "c", status: "dismissed", resolved_at: "2026-10-17T09:00:00+00:00" }),
      ],
      members: [sponsor],
      member_roles: [],
    });
    const { groups } = await listReportQueue("closed", client);
    expect(groups.map((g) => g.count)).toEqual([2, 1]);
  });

  it("asks for one row more than the cap to detect it exactly", async () => {
    const { client, calls } = fakeClient({ reports: [] });
    await listReportQueue("open", client);
    expect(calls).toContainEqual(["reports", "limit", 1001]);
  });

  it("exactly at the cap is not capped: nothing is dropped", async () => {
    const rows = Array.from({ length: 1000 }, (_, i) => row({ id: `r${i}`, message_id: `m${i}` }));
    const { client } = fakeClient({ reports: rows, members: [sponsor], member_roles: [] });
    const { groups, capped } = await listReportQueue("open", client);
    expect(capped).toBe(false);
    expect(groups).toHaveLength(1000);
  });

  it("capped: keeps every group read when the extra row belongs to a new group", async () => {
    const rows = Array.from({ length: 1001 }, (_, i) => row({ id: `r${i}`, message_id: `m${i}` }));
    const { client } = fakeClient({ reports: rows, members: [sponsor], member_roles: [] });
    const { groups, capped } = await listReportQueue("open", client);
    expect(capped).toBe(true);
    expect(groups).toHaveLength(1000);
    expect(groups[0]!.messageId).toBe("m0");
    expect(groups.some((g) => g.messageId === "m1000")).toBe(false);
  });

  it("capped: drops only the group that continues past the cap, never the newest ones", async () => {
    // 999 single-report groups, then two reports of the same message: one inside the cap, one beyond it.
    const rows = [
      ...Array.from({ length: 999 }, (_, i) => row({ id: `r${i}`, message_id: `m${i}` })),
      row({ id: "edge1", message_id: "medge" }),
      row({ id: "edge2", message_id: "medge" }),
    ];
    const { client } = fakeClient({ reports: rows, members: [sponsor], member_roles: [] });
    const { groups, capped } = await listReportQueue("open", client);
    expect(capped).toBe(true);
    expect(groups).toHaveLength(999);
    expect(groups.some((g) => g.messageId === "medge")).toBe(false);
    expect(groups[0]!.messageId).toBe("m0");
  });

  it("capped: a single huge newest group is kept (truncated) instead of emptying the queue", async () => {
    const rows = Array.from({ length: 1001 }, (_, i) => row({ id: `r${i}`, message_id: "mhuge" }));
    const { client } = fakeClient({ reports: rows, members: [sponsor], member_roles: [] });
    const { groups, capped } = await listReportQueue("open", client);
    expect(capped).toBe(true);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.count).toBe(1000);
  });

  it("throws on a database error", async () => {
    const client = {
      from: () => {
        const b: Record<string, unknown> = {};
        for (const m of ["select", "order", "limit", "in", "eq"]) b[m] = () => b;
        b.then = (resolve: (v: unknown) => void) => resolve({ data: null, error: { message: "boom" } });
        return b;
      },
    };
    await expect(listReportQueue("open", client as never)).rejects.toThrow("boom");
  });
});
