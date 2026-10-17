import { describe, expect, it } from "vitest";
import { getMessagesAround } from "@/lib/chat/queries";

const CH = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const ME = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const ts = (n: number) => new Date(Date.UTC(2026, 9, 17, 10, n, 0)).toISOString();

interface Row {
  id: string;
  channel_id: string;
  thread_root_id: string | null;
  created_at: string;
}
const row = (n: number, over: Partial<Row> = {}) => ({
  id: id(n),
  channel_id: CH,
  thread_root_id: null,
  author_id: ME,
  body: {},
  allow_links: true,
  kind: "text",
  expanded: false,
  quoted_message_id: null,
  reply_count: 0,
  last_reply_at: null,
  pinned_at: null,
  edited_at: null,
  deleted_at: null,
  created_at: ts(n),
  ...over,
});

/** A fake PostgREST client over an in-memory `messages` table; records every filter so the cursors can be asserted. */
function fakeClient(rows: ReturnType<typeof row>[]) {
  const log: Array<{ table: string; ops: Array<[string, ...unknown[]]> }> = [];
  const from = (table: string) => {
    const ops: Array<[string, ...unknown[]]> = [];
    log.push({ table, ops });
    const cmp = (a: ReturnType<typeof row>, b: ReturnType<typeof row>) => (a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
    const run = () => {
      if (table !== "messages") return [];
      let out = [...rows];
      let asc = true;
      let limit = Infinity;
      for (const [op, ...args] of ops) {
        if (op === "eq") out = out.filter((r) => (r as unknown as Record<string, unknown>)[args[0] as string] === args[1]);
        if (op === "is") out = out.filter((r) => (r as unknown as Record<string, unknown>)[args[0] as string] === args[1]);
        if (op === "or") {
          const m = /created_at\.(lt|gt)\.([^,]+),and\(created_at\.eq\.[^,]+,id\.(lt|gt)\.([^)]+)\)/.exec(args[0] as string)!;
          const [, dir, at, , cursorId] = m as unknown as [string, string, string, string, string];
          const pivot = { created_at: at, id: cursorId } as ReturnType<typeof row>;
          out = out.filter((r) => (dir === "lt" ? cmp(r, pivot) < 0 : cmp(r, pivot) > 0));
        }
        if (op === "order" && args[0] === "created_at") asc = (args[1] as { ascending: boolean }).ascending;
        if (op === "limit") limit = args[0] as number;
      }
      out.sort(cmp);
      if (!asc) out.reverse();
      return out.slice(0, limit);
    };
    const chain: Record<string, unknown> = {};
    for (const op of ["select", "eq", "is", "not", "in", "or", "order", "limit"]) {
      chain[op] = (...args: unknown[]) => {
        ops.push([op, ...args]);
        return chain;
      };
    }
    chain.returns = () => chain;
    chain.maybeSingle = async () => ({ data: run()[0] ?? null, error: null });
    chain.then = (resolve: (v: unknown) => void) => resolve({ data: run(), error: null });
    return chain;
  };
  return { client: { from, storage: { from: () => ({ createSignedUrls: async () => ({ data: [], error: null }) }) } } as never, log };
}

const thirty = Array.from({ length: 30 }, (_, i) => row(i + 1));

describe("getMessagesAround", () => {
  it("returns the roots around the target, oldest first, with both cursors", async () => {
    const { client } = fakeClient(thirty);
    const res = await getMessagesAround(client, CH, ME, id(15), { before: 3, after: 2 });
    expect(res.messages.map((m) => m.id)).toEqual([id(12), id(13), id(14), id(15), id(16), id(17)]);
    expect(res.anchorId).toBe(id(15));
    expect(res.hasMore).toBe(true);
    expect(res.hasNewer).toBe(true);
  });

  it("reports no older / newer pages at the edges of the channel", async () => {
    const { client } = fakeClient(thirty);
    const res = await getMessagesAround(client, CH, ME, id(2), { before: 3, after: 40 });
    expect(res.messages[0]!.id).toBe(id(1));
    expect(res.messages.at(-1)!.id).toBe(id(30));
    expect(res.hasMore).toBe(false);
    expect(res.hasNewer).toBe(false);
  });

  it("is not fooled by a window that exactly reaches the edge", async () => {
    const { client } = fakeClient(thirty);
    const res = await getMessagesAround(client, CH, ME, id(4), { before: 3, after: 26 });
    expect(res.messages).toHaveLength(30);
    expect(res.hasMore).toBe(false);
    expect(res.hasNewer).toBe(false);
  });

  it("centres on the root of a reply and reports the thread root", async () => {
    const reply = row(31, { thread_root_id: id(15) });
    const { client } = fakeClient([...thirty, reply]);
    const res = await getMessagesAround(client, CH, ME, id(31), { before: 1, after: 1 });
    expect(res.messages.map((m) => m.id)).toEqual([id(14), id(15), id(16)]);
    expect(res.anchorId).toBe(id(31));
    expect(res.threadRootId).toBe(id(15));
  });

  it("falls back to the normal latest page when the message does not exist", async () => {
    const { client } = fakeClient(thirty);
    const res = await getMessagesAround(client, CH, ME, id(999));
    expect(res.anchorId).toBeNull();
    expect(res.hasNewer).toBe(false);
    expect(res.messages.at(-1)!.id).toBe(id(30));
  });

  it("ignores a message of another channel", async () => {
    const other = row(40, { channel_id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd" });
    const { client } = fakeClient([...thirty, other]);
    const res = await getMessagesAround(client, CH, ME, id(40));
    expect(res.anchorId).toBeNull();
    expect(res.messages.some((m) => m.id === id(40))).toBe(false);
  });

  it("ignores a reply whose root is not visible", async () => {
    const orphan = row(50, { thread_root_id: id(777) });
    const { client } = fakeClient([...thirty, orphan]);
    const res = await getMessagesAround(client, CH, ME, id(50));
    expect(res.anchorId).toBeNull();
    expect(res.threadRootId).toBeNull();
  });

  it("uses (created_at, id) cursors on both sides", async () => {
    const { client, log } = fakeClient(thirty);
    await getMessagesAround(client, CH, ME, id(15), { before: 3, after: 2 });
    const ors = log.flatMap((l) => l.ops.filter(([op]) => op === "or").map(([, f]) => String(f)));
    expect(ors).toContain(`created_at.lt.${ts(15)},and(created_at.eq.${ts(15)},id.lt.${id(15)})`);
    expect(ors).toContain(`created_at.gt.${ts(15)},and(created_at.eq.${ts(15)},id.gt.${id(15)})`);
  });
});
