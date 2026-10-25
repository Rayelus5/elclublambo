import { describe, expect, it, vi } from "vitest";
import { channelSegment, isMissingChannel, NOT_FOUND_PATH } from "@/lib/channels/guard";

const ID = "11111111-1111-4111-8111-111111111111";

function client(opts: { channel?: unknown; channelError?: unknown; status?: unknown }) {
  const maybeSingle = vi.fn(async () => ({ data: opts.channel ?? null, error: opts.channelError ?? null }));
  const eq = vi.fn(() => ({ maybeSingle }));
  const select = vi.fn(() => ({ eq }));
  const from = vi.fn(() => ({ select }));
  // channel_lock_state is null here (locked channels are covered in tests/unit/channels/guard.test.ts).
  const rpc = vi.fn(async (name: string) =>
    name === "channel_lock_state" ? { data: null, error: null } : { data: "status" in opts ? opts.status : "active", error: null },
  );
  return { from, rpc, eq, maybeSingle };
}

describe("channelSegment", () => {
  it.each([
    [`/foro/c/${ID}`, ID],
    [`/foro/c/${ID}/`, ID],
    ["/foro/c/not-a-uuid", "not-a-uuid"],
  ])("%s -> %s", (path, seg) => expect(channelSegment(path)).toBe(seg));

  it.each(["/", "/foro/c", "/foro/c/", `/foro/c/${ID}/extra`, "/foro/cx/abc", "/foro/settings/c/abc", "/foro/u/0xabc", `/c/${ID}`, "/c/not-a-uuid"])("%s is not a channel path", (path) =>
    expect(channelSegment(path)).toBeNull(),
  );
});

describe("isMissingChannel", () => {
  it("ignores paths outside /c/<id> without querying", async () => {
    const c = client({});
    expect(await isMissingChannel(c as never, "/")).toBe(false);
    expect(c.from).not.toHaveBeenCalled();
    expect(c.rpc).not.toHaveBeenCalled();
  });

  it("a visible channel is not missing", async () => {
    const c = client({ channel: { id: ID } });
    expect(await isMissingChannel(c as never, `/foro/c/${ID}`)).toBe(false);
    expect(c.eq).toHaveBeenCalledWith("id", ID);
  });

  it("a hidden or inexistent channel is missing for an active member (RLS makes them the same)", async () => {
    expect(await isMissingChannel(client({ channel: null }) as never, `/foro/c/${ID}`)).toBe(true);
  });

  it("a malformed id is missing without touching the channels table", async () => {
    const c = client({});
    expect(await isMissingChannel(c as never, "/foro/c/not-a-uuid")).toBe(true);
    expect(c.from).not.toHaveBeenCalled();
  });

  it("does not turn into a 404 for members who are not active (the layout redirects them)", async () => {
    for (const status of ["banned", "none", null]) {
      expect(await isMissingChannel(client({ channel: null, status }) as never, `/foro/c/${ID}`)).toBe(false);
    }
  });

  it("fails open when the query errors", async () => {
    expect(await isMissingChannel(client({ channelError: { message: "db down" } }) as never, `/foro/c/${ID}`)).toBe(false);
  });
});

describe("NOT_FOUND_PATH", () => {
  it("matches no route: two segments, so the public /[lang] tree (any single segment) never renders it", () => {
    expect(NOT_FOUND_PATH.split("/").filter(Boolean).length).toBeGreaterThanOrEqual(2);
    expect(NOT_FOUND_PATH.startsWith("/es/") || NOT_FOUND_PATH.startsWith("/en/")).toBe(false);
  });
});
