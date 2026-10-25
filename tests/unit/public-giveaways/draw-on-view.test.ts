// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const fetchBeacon = vi.hoisted(() => vi.fn());
vi.mock("@/lib/giveaways/drand", async (orig) => ({ ...(await orig<typeof import("@/lib/giveaways/drand")>()), fetchBeacon }));
const adminRpc = vi.hoisted(() => vi.fn());
const statusRead = vi.hoisted(() => vi.fn());
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    rpc: adminRpc,
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: statusRead }) }) }),
  }),
}));

import { roundTime } from "@/lib/giveaways/drand";
import { maybeDrawOnView } from "@/lib/public-giveaways/draw-on-view";
import type { PublicGiveawayView } from "@/lib/public-giveaways/types";

const ROUND = 1000;
const dueAt = roundTime(BigInt(ROUND)) * 1000;
const view = (over: Partial<PublicGiveawayView> = {}) =>
  ({ id: "g1", status: "closed", closesAt: new Date(dueAt - 60_000).toISOString(), targetRound: ROUND, ...over }) as PublicGiveawayView;

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  adminRpc.mockImplementation(async (fn: string) => (fn === "close_due_public_giveaways" ? { data: { closed: 0, voided: 0 }, error: null } : { data: "drawn", error: null }));
  fetchBeacon.mockResolvedValue({ status: "ok", signature: "sig" });
  statusRead.mockResolvedValue({ data: { status: "closed" }, error: null });
});

describe("maybeDrawOnView", () => {
  it("does nothing before the drand round exists", async () => {
    expect(await maybeDrawOnView(view(), dueAt - 1000)).toBe(false);
    expect(adminRpc).not.toHaveBeenCalled();
    expect(fetchBeacon).not.toHaveBeenCalled();
  });

  it("does nothing before closes_at, or for finished giveaways", async () => {
    expect(await maybeDrawOnView(view({ status: "open", closesAt: new Date(dueAt + 1e6).toISOString() }), dueAt)).toBe(false);
    for (const status of ["drawn", "void", "cancelled"] as const) expect(await maybeDrawOnView(view({ status }), dueAt + 1e6)).toBe(false);
    expect(adminRpc).not.toHaveBeenCalled();
  });

  it("closes and draws a due giveaway once its round is out", async () => {
    expect(await maybeDrawOnView(view(), dueAt + 1000)).toBe(true);
    expect(adminRpc).toHaveBeenCalledWith("close_due_public_giveaways");
    expect(adminRpc).toHaveBeenCalledWith("draw_public_giveaway", { p_id: "g1", p_round: ROUND, p_signature: "sig" });
  });

  it("an open giveaway that only got closed still reports a change", async () => {
    adminRpc.mockImplementation(async (fn: string) => (fn === "close_due_public_giveaways" ? { data: { closed: 1, voided: 0 }, error: null } : { data: null, error: { message: "invalid_state" } }));
    expect(await maybeDrawOnView(view({ status: "open" }), dueAt + 1000)).toBe(true);
  });

  it("already drawn elsewhere: false", async () => {
    adminRpc.mockImplementation(async (fn: string) => (fn === "close_due_public_giveaways" ? { data: {}, error: null } : { data: "already", error: null }));
    expect(await maybeDrawOnView(view(), dueAt + 1000)).toBe(false);
  });

  it("drand down: false, no draw call, no throw", async () => {
    fetchBeacon.mockResolvedValue({ status: "unavailable" });
    expect(await maybeDrawOnView(view(), dueAt + 1000)).toBe(false);
    expect(adminRpc).not.toHaveBeenCalledWith("draw_public_giveaway", expect.anything());
  });

  it("the close just voided it (no entries): no drand fetch, no draw, but a change", async () => {
    adminRpc.mockImplementation(async (fn: string) => (fn === "close_due_public_giveaways" ? { data: { closed: 0, voided: 1 }, error: null } : { data: "drawn", error: null }));
    statusRead.mockResolvedValue({ data: { status: "void" }, error: null });
    expect(await maybeDrawOnView(view({ status: "open" }), dueAt + 1000)).toBe(true);
    expect(fetchBeacon).not.toHaveBeenCalled();
    expect(adminRpc).not.toHaveBeenCalledWith("draw_public_giveaway", expect.anything());
  });

  it("a failed status read still tries the draw (the RPC re-checks the state)", async () => {
    statusRead.mockResolvedValue({ data: null, error: { message: "boom" } });
    expect(await maybeDrawOnView(view(), dueAt + 1000)).toBe(true);
    expect(adminRpc).toHaveBeenCalledWith("draw_public_giveaway", expect.anything());
  });

  it("never throws, whatever fails", async () => {
    adminRpc.mockRejectedValue(new Error("db down"));
    await expect(maybeDrawOnView(view(), dueAt + 1000)).resolves.toBe(false);
    fetchBeacon.mockRejectedValue(new Error("boom"));
    adminRpc.mockResolvedValue({ data: {}, error: null });
    await expect(maybeDrawOnView(view(), dueAt + 1000)).resolves.toBe(false);
  });
});
