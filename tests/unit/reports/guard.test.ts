import { describe, expect, it, vi } from "vitest";
import { isHiddenReportsPage } from "@/lib/reports/guard";

function client(opts: { anywhere?: unknown; anywhereError?: unknown; status?: unknown; statusError?: unknown }) {
  const rpc = vi.fn(async (fn: string) => {
    if (fn === "has_any_channel_perm") return { data: "anywhere" in opts ? opts.anywhere : true, error: opts.anywhereError ?? null };
    if (fn === "my_membership_status") return { data: "status" in opts ? opts.status : "active", error: opts.statusError ?? null };
    throw new Error(`unexpected rpc ${fn}`);
  });
  return { rpc, from: vi.fn() };
}

describe("isHiddenReportsPage", () => {
  it.each(["/", "/foro/moderation", "/foro/moderation/reports/x", "/foro/c/abc", "/foro/x/moderation/reports", "/moderation/reports"])("%s is not the queue: no query", async (p) => {
    const c = client({});
    expect(await isHiddenReportsPage(c as never, p)).toBe(false);
    expect(c.rpc).not.toHaveBeenCalled();
  });

  it.each(["/foro/moderation/reports", "/foro/moderation/reports/"])("%s is hidden when the member moderates no channel", async (p) => {
    expect(await isHiddenReportsPage(client({ anywhere: false }) as never, p)).toBe(true);
  });

  it("is visible for someone with MANAGE_MESSAGES somewhere", async () => {
    const c = client({ anywhere: true });
    expect(await isHiddenReportsPage(c as never, "/foro/moderation/reports")).toBe(false);
    expect(c.rpc).toHaveBeenCalledWith("has_any_channel_perm", { p_bit: 8 });
  });

  it("only active members get the 404 (the layout redirects everyone else)", async () => {
    expect(await isHiddenReportsPage(client({ anywhere: false, status: "banned" }) as never, "/foro/moderation/reports")).toBe(false);
  });

  it("fails open on any error (the page itself still calls notFound)", async () => {
    expect(await isHiddenReportsPage(client({ anywhereError: { message: "x" }, anywhere: null }) as never, "/foro/moderation/reports")).toBe(false);
    expect(await isHiddenReportsPage(client({ anywhere: false, statusError: { message: "x" } }) as never, "/foro/moderation/reports")).toBe(false);
    expect(await isHiddenReportsPage(client({ anywhere: null }) as never, "/foro/moderation/reports")).toBe(false);
  });
});
