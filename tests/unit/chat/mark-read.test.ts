import { describe, expect, it, vi } from "vitest";
import { markChannelRead } from "@/lib/chat/queries";

// T-006: the read mark goes straight to the database from the browser (one RPC under the member's own session), not
// through a server action that cost a Next request plus the proxy's session and page checks on every channel visit.
describe("markChannelRead", () => {
  it("calls mark_channel_read for the channel", async () => {
    const rpc = vi.fn(async () => ({ data: null, error: null }));
    expect(await markChannelRead({ rpc } as never, "c1")).toEqual({});
    expect(rpc).toHaveBeenCalledWith("mark_channel_read", { p_channel: "c1" });
  });

  it("reports a failure without throwing", async () => {
    const rpc = vi.fn(async () => ({ data: null, error: { message: "boom", code: "P0001" } }));
    expect(await markChannelRead({ rpc } as never, "c1")).toEqual({ error: "boom" });
  });
});
