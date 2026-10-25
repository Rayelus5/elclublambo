import { describe, expect, it, vi } from "vitest";
import { isMissingTicket, ticketSegment } from "@/lib/tickets/guard";

const ID = "11111111-1111-4111-8111-111111111111";

function client(opts: { ticket?: unknown; ticketError?: unknown; status?: unknown }) {
  const maybeSingle = vi.fn(async () => ({ data: opts.ticket ?? null, error: opts.ticketError ?? null }));
  const eq = vi.fn(() => ({ maybeSingle }));
  const select = vi.fn(() => ({ eq }));
  const from = vi.fn(() => ({ select }));
  const rpc = vi.fn(async () => ({ data: "status" in opts ? opts.status : "active", error: null }));
  return { from, rpc, eq };
}

describe("ticketSegment", () => {
  it.each([
    [`/foro/tickets/${ID}`, ID],
    [`/foro/tickets/${ID}/`, ID],
    ["/foro/tickets/xyz", "xyz"],
  ])("%s", (path, seg) => expect(ticketSegment(path)).toBe(seg));
  it.each(["/", "/foro/tickets", "/foro/tickets/", `/foro/tickets/${ID}/x`, "/foro/c/abc", "/foro/x/tickets/abc", `/tickets/${ID}`])("%s is not a ticket path", (p) =>
    expect(ticketSegment(p)).toBeNull(),
  );
});

describe("isMissingTicket", () => {
  it("ignores other paths without querying", async () => {
    const c = client({});
    expect(await isMissingTicket(c as never, "/foro/tickets")).toBe(false);
    expect(c.from).not.toHaveBeenCalled();
  });

  it("an accessible ticket is not missing", async () => {
    const c = client({ ticket: { id: ID } });
    expect(await isMissingTicket(c as never, `/foro/tickets/${ID}`)).toBe(false);
    expect(c.eq).toHaveBeenCalledWith("id", ID);
  });

  it("an inaccessible or inexistent ticket is missing for an active member", async () => {
    expect(await isMissingTicket(client({ ticket: null }) as never, `/foro/tickets/${ID}`)).toBe(true);
  });

  it("a malformed id is missing without touching the table", async () => {
    const c = client({});
    expect(await isMissingTicket(c as never, "/foro/tickets/not-a-uuid")).toBe(true);
    expect(c.from).not.toHaveBeenCalled();
  });

  it("is not missing for members who are not active (the layout redirects them)", async () => {
    expect(await isMissingTicket(client({ ticket: null, status: "banned" }) as never, `/foro/tickets/${ID}`)).toBe(false);
  });

  it("fails open on a query error", async () => {
    expect(await isMissingTicket(client({ ticketError: { message: "boom" } }) as never, `/foro/tickets/${ID}`)).toBe(false);
  });
});
