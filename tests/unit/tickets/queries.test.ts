import { describe, expect, it } from "vitest";
import { getTicket, getTicketMessage, getTicketState, listTickets } from "@/lib/tickets/queries";

const ME = "11111111-1111-4111-8111-111111111111";
const WALLET = "0xd590d5d858d5b61c357e7a40ee6b6a72d938b82d";

type Row = Record<string, unknown>;

function fake(tables: Record<string, Row[] | Row | null>) {
  const calls: Array<[string, string, ...unknown[]]> = [];
  const client = {
    from(table: string) {
      const b: Record<string, unknown> = {};
      for (const m of ["select", "order", "limit", "eq", "neq", "in"]) {
        b[m] = (...args: unknown[]) => {
          calls.push([table, m, ...args]);
          return b;
        };
      }
      b.maybeSingle = async () => {
        const t = tables[table];
        return { data: Array.isArray(t) ? (t[0] ?? null) : (t ?? null), error: null };
      };
      b.then = (resolve: (v: unknown) => void) => {
        const t = tables[table];
        resolve({ data: Array.isArray(t) ? t : t ? [t] : [], error: null });
      };
      return b;
    },
  };
  return { client: client as never, calls };
}

const author = { id: "a1", wallet_address: WALLET, display_name: "Ana" };
const ticketRow = (over: Row = {}) => ({
  id: "t1",
  subject: "Ayuda",
  status: "open",
  author_id: "a1",
  last_message_at: "2026-10-17T10:00:00+00:00",
  created_at: "2026-10-17T09:00:00+00:00",
  channel: { name: "soporte" },
  author,
  ...over,
});

describe("listTickets", () => {
  it("mine: filters on the author and the status, newest activity first", async () => {
    const { client, calls } = fake({ tickets: [ticketRow()] });
    const list = await listTickets({ scope: "mine", status: "open" }, client, ME);
    expect(calls).toContainEqual(["tickets", "eq", "author_id", ME]);
    expect(calls).toContainEqual(["tickets", "eq", "status", "open"]);
    expect(calls).toContainEqual(["tickets", "order", "last_message_at", { ascending: false }]);
    expect(list).toEqual([
      { id: "t1", subject: "Ayuda", status: "open", channelName: "soporte", authorName: "Ana", lastMessageAt: "2026-10-17T10:00:00+00:00" },
    ]);
  });

  it("staff: excludes the reader's own tickets", async () => {
    const { client, calls } = fake({ tickets: [] });
    await listTickets({ scope: "staff", status: "closed" }, client, ME);
    expect(calls).toContainEqual(["tickets", "neq", "author_id", ME]);
    expect(calls).toContainEqual(["tickets", "eq", "status", "closed"]);
  });

  it("falls back to the short wallet without a display name", async () => {
    const { client } = fake({ tickets: [ticketRow({ author: { ...author, display_name: null } })] });
    const [t] = await listTickets({ scope: "mine", status: "open" }, client, ME);
    expect(t!.authorName).toBe("0xd590…b82d");
  });
});

describe("getTicket", () => {
  it("returns null when RLS hides it", async () => {
    const { client } = fake({ tickets: null });
    expect(await getTicket("t1", client)).toBeNull();
  });

  it("returns the ticket with messages, marking as staff whoever is not the ticket's author", async () => {
    const msg = (id: string, authorId: string) => ({
      id,
      ticket_id: "t1",
      author_id: authorId,
      body_text: "x",
      allow_links: false,
      created_at: "2026-10-17T10:00:00+00:00",
      author: { id: authorId, wallet_address: WALLET, display_name: authorId === "a1" ? "Ana" : "Bruno" },
    });
    const { client } = fake({
      tickets: ticketRow({ channel_id: "c1" }),
      ticket_messages: [msg("m1", "a1"), msg("m2", "s1")],
    });
    const t = await getTicket("t1", client);
    expect(t!.ticket).toMatchObject({ id: "t1", subject: "Ayuda", status: "open", authorId: "a1", channelId: "c1", channelName: "soporte" });
    expect(t!.messages.map((m) => [m.id, m.isStaff, m.authorName])).toEqual([
      ["m1", false, "Ana"],
      ["m2", true, "Bruno"],
    ]);
  });
});

describe("realtime re-reads", () => {
  it("getTicketMessage returns a view or null", async () => {
    const { client } = fake({
      ticket_messages: [
        {
          id: "m9",
          ticket_id: "t1",
          author_id: "s1",
          body_text: "hola",
          allow_links: true,
          created_at: "2026-10-17T10:00:00+00:00",
          author: { id: "s1", wallet_address: WALLET, display_name: "Bruno" },
          ticket: { author_id: "a1" },
        },
      ],
    });
    expect(await getTicketMessage(client, "m9")).toMatchObject({ id: "m9", isStaff: true, allowLinks: true, bodyText: "hola" });
    expect(await getTicketMessage(fake({ ticket_messages: null }).client, "m9")).toBeNull();
  });

  it("getTicketState returns the status", async () => {
    const { client } = fake({ tickets: { status: "closed" } });
    expect(await getTicketState(client, "t1")).toEqual({ status: "closed" });
  });
});
