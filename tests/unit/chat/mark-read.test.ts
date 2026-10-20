import { describe, expect, it, vi } from "vitest";
import { markChannelRead } from "@/lib/chat/queries";

// T-006: the read mark goes straight to the database from the browser (one RPC under the member's own session), not
// through a server action that cost a Next request plus the proxy's session and page checks on every channel visit.
const CH = "0b7c1e0a-1111-4222-8333-944455556666";

describe("markChannelRead", () => {
  it("calls mark_channel_read for the channel", async () => {
    const rpc = vi.fn(async () => ({ data: null, error: null }));
    expect(await markChannelRead({ rpc } as never, CH)).toEqual({});
    expect(rpc).toHaveBeenCalledWith("mark_channel_read", { p_channel: CH });
  });

  it("rejects a channel id that is not a uuid without calling the database", async () => {
    const rpc = vi.fn();
    expect(await markChannelRead({ rpc } as never, "../x")).toEqual({ error: "invalid_input" });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("maps a failure to an error code, never the raw database message", async () => {
    const rpc = vi.fn(async () => ({ data: null, error: { message: "relation \"x\" does not exist", code: "42P01" } }));
    expect(await markChannelRead({ rpc } as never, CH)).toEqual({ error: "unknown" });
    rpc.mockResolvedValueOnce({ data: null, error: { message: "boom", code: "40001" } });
    expect(await markChannelRead({ rpc } as never, CH)).toEqual({ error: "retry" });
  });
});
