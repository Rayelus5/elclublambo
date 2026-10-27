import { describe, expect, it, vi } from "vitest";
import { isMissingChannel } from "@/lib/channels/guard";

const ID = "11111111-1111-4111-8111-111111111111";

function client(opts: { lock?: unknown; lockError?: unknown; status?: unknown }) {
  const maybeSingle = vi.fn(async () => ({ data: null, error: null }));
  const from = vi.fn(() => ({ select: () => ({ eq: () => ({ maybeSingle }) }) }));
  const rpc = vi.fn(async (name: string) => {
    if (name === "channel_lock_state") return { data: opts.lock ?? null, error: opts.lockError ?? null };
    return { data: "status" in opts ? opts.status : "active", error: null };
  });
  return { from, rpc };
}

describe("isMissingChannel with locked channels", () => {
  it("lets a locked channel through (the page renders the lock page)", async () => {
    const c = client({ lock: { scope: "view", name: "Alpha" } });
    expect(await isMissingChannel(c as never, `/foro/c/${ID}`)).toBe(false);
    expect(c.rpc).toHaveBeenCalledWith("channel_lock_state", { p_channel: ID });
  });
  it("still 404s for an unknown or hidden channel (no lock state)", async () => {
    expect(await isMissingChannel(client({ lock: null }) as never, `/foro/c/${ID}`)).toBe(true);
  });
  it("never asks the lock state for a malformed id", async () => {
    const c = client({ lock: { scope: "view" } });
    expect(await isMissingChannel(c as never, "/foro/c/nope")).toBe(true);
    expect(c.rpc).not.toHaveBeenCalledWith("channel_lock_state", expect.anything());
  });
  it("fails open when the lock state errors", async () => {
    expect(await isMissingChannel(client({ lockError: { message: "boom" } }) as never, `/foro/c/${ID}`)).toBe(false);
  });
  it("does not turn non-active members into a 404", async () => {
    expect(await isMissingChannel(client({ lock: null, status: "banned" }) as never, `/foro/c/${ID}`)).toBe(false);
  });
});
