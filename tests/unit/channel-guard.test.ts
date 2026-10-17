import { describe, expect, it, vi } from "vitest";
import { channelSegment, isMissingChannel } from "@/lib/channels/guard";

const ID = "11111111-1111-4111-8111-111111111111";

function client(opts: { channel?: unknown; channelError?: unknown; status?: unknown }) {
  const maybeSingle = vi.fn(async () => ({ data: opts.channel ?? null, error: opts.channelError ?? null }));
  const eq = vi.fn(() => ({ maybeSingle }));
  const select = vi.fn(() => ({ eq }));
  const from = vi.fn(() => ({ select }));
  const rpc = vi.fn(async () => ({ data: "status" in opts ? opts.status : "active", error: null }));
  return { from, rpc, eq, maybeSingle };
}

describe("channelSegment", () => {
  it.each([
    [`/c/${ID}`, ID],
    [`/c/${ID}/`, ID],
    ["/c/not-a-uuid", "not-a-uuid"],
  ])("%s -> %s", (path, seg) => expect(channelSegment(path)).toBe(seg));

  it.each(["/", "/c", "/c/", `/c/${ID}/extra`, "/cx/abc", "/settings/c/abc", "/u/0xabc"])("%s is not a channel path", (path) =>
    expect(channelSegment(path)).toBeNull(),
  );
});

describe("isMissingChannel", () => {
  it("ignores paths outside /c/<id> without querying", async () => {
    const c = client({});
    expect(await isMissingChannel(c, "/")).toBe(false);
    expect(c.from).not.toHaveBeenCalled();
    expect(c.rpc).not.toHaveBeenCalled();
  });

  it("a visible channel is not missing", async () => {
    const c = client({ channel: { id: ID } });
    expect(await isMissingChannel(c, `/c/${ID}`)).toBe(false);
    expect(c.eq).toHaveBeenCalledWith("id", ID);
  });

  it("a hidden or inexistent channel is missing for an active member (RLS makes them the same)", async () => {
    expect(await isMissingChannel(client({ channel: null }), `/c/${ID}`)).toBe(true);
  });

  it("a malformed id is missing without touching the channels table", async () => {
    const c = client({});
    expect(await isMissingChannel(c, "/c/not-a-uuid")).toBe(true);
    expect(c.from).not.toHaveBeenCalled();
  });

  it("does not turn into a 404 for members who are not active (the layout redirects them)", async () => {
    for (const status of ["banned", "none", null]) {
      expect(await isMissingChannel(client({ channel: null, status }), `/c/${ID}`)).toBe(false);
    }
  });

  it("fails open when the query errors", async () => {
    expect(await isMissingChannel(client({ channelError: { message: "db down" } }), `/c/${ID}`)).toBe(false);
  });
});
