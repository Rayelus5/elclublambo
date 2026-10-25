// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const revalidatePath = vi.hoisted(() => vi.fn());
vi.mock("next/cache", () => ({ revalidatePath }));

const SIG = "b44679b9a59af2ec876b1a6b1ad52ea9b1615fc3982b19576350f93447cb1125e342b73a8dd2bacbe47e4b6b63ed5e39";
const fetchBeacon = vi.hoisted(() => vi.fn());
vi.mock("@/lib/giveaways/drand", async (orig) => ({ ...(await orig<typeof import("@/lib/giveaways/drand")>()), fetchBeacon }));

type Rpc = { data: unknown; error: { message: string } | null };
const rpcAnswers = vi.hoisted(() => new Map<string, (args?: Record<string, unknown>) => Rpc>());
const rpc = vi.hoisted(() =>
  vi.fn(async (fn: string, args?: Record<string, unknown>) => {
    const a = rpcAnswers.get(fn);
    if (!a) throw new Error(`unexpected rpc ${fn}`);
    return a(args);
  }),
);
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ rpc }) }));

import { roundTime } from "@/lib/giveaways/drand";
import { runGiveawaySteps } from "@/lib/giveaways/cron";

const NOW = (roundTime(5000n) + 10) * 1000; // round 5000 emitted 10 s ago, 5004 is in the future
const G1 = "00000000-0000-4000-8000-000000000001";
const G2 = "00000000-0000-4000-8000-000000000002";
const G3 = "00000000-0000-4000-8000-000000000003";
const P1 = "00000000-0000-4000-8000-0000000000a1";
const P2 = "00000000-0000-4000-8000-0000000000a2";
const NO_PUBLIC = { closed: 0, voided: 0, drawn: 0, waiting: 0, failed: 0 };

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ now: NOW, toFake: ["Date"] });
  rpcAnswers.clear();
  rpcAnswers.set("close_due_giveaways", () => ({ data: { closed: 2, voided: 1 }, error: null }));
  rpcAnswers.set("giveaways_awaiting_draw", () => ({ data: [{ id: G1, target_round: 5000 }], error: null }));
  rpcAnswers.set("draw_giveaway", () => ({ data: { status: "drawn" }, error: null }));
  rpcAnswers.set("close_due_public_giveaways", () => ({ data: { closed: 0, voided: 0 }, error: null }));
  rpcAnswers.set("public_giveaways_awaiting_draw", () => ({ data: [], error: null }));
  rpcAnswers.set("draw_public_giveaway", () => ({ data: "drawn", error: null }));
  fetchBeacon.mockResolvedValue({ status: "ok", signature: SIG, randomness: "ab".repeat(32) });
});
afterEach(() => vi.useRealTimers());

const calls = (fn: string) => rpc.mock.calls.filter((c) => c[0] === fn);

describe("runGiveawaySteps", () => {
  it("closes the due giveaways, then draws each closed one whose round exists", async () => {
    expect(await runGiveawaySteps()).toEqual({ closed: 2, voided: 1, drawn: 1, waiting: 0, failed: 0, public: NO_PUBLIC });
    expect(rpc.mock.calls.map((c) => c[0])).toEqual([
      "close_due_giveaways",
      "giveaways_awaiting_draw",
      "draw_giveaway",
      "close_due_public_giveaways",
      "public_giveaways_awaiting_draw",
    ]);
    expect(fetchBeacon).toHaveBeenCalledWith(5000n);
    expect(calls("draw_giveaway")[0]![1]).toEqual({ p_id: G1, p_round: 5000, p_signature: SIG });
    expect(revalidatePath).toHaveBeenCalledWith("/sorteos");
    expect(revalidatePath).toHaveBeenCalledWith("/sorteos/[id]", "page");
  });

  it("Review Focus 5: drand unavailable counts as waiting and never calls draw_giveaway", async () => {
    fetchBeacon.mockResolvedValue({ status: "unavailable" });
    expect(await runGiveawaySteps()).toMatchObject({ drawn: 0, waiting: 1, failed: 0 });
    expect(calls("draw_giveaway")).toHaveLength(0);
  });

  it("once drand is unavailable in a run, the remaining giveaways wait without fetching again", async () => {
    rpcAnswers.set("giveaways_awaiting_draw", () => ({
      data: [
        { id: G1, target_round: 4990 },
        { id: G2, target_round: 4995 },
        { id: G3, target_round: 5000 },
      ],
      error: null,
    }));
    fetchBeacon.mockResolvedValue({ status: "unavailable" });
    expect(await runGiveawaySteps()).toMatchObject({ drawn: 0, waiting: 3, failed: 0 });
    expect(fetchBeacon).toHaveBeenCalledTimes(1);
    expect(calls("draw_giveaway")).toHaveLength(0);
  });

  it("an invalid beacon counts as failed, is logged and is not drawn", async () => {
    fetchBeacon.mockResolvedValue({ status: "invalid" });
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await runGiveawaySteps()).toMatchObject({ drawn: 0, waiting: 0, failed: 1 });
    expect(calls("draw_giveaway")).toHaveLength(0);
    expect(err).toHaveBeenCalledWith("[giveaways] invalid drand beacon", G1, "5000");
    err.mockRestore();
  });

  it("a giveaway whose round is still in the future waits without asking drand", async () => {
    rpcAnswers.set("giveaways_awaiting_draw", () => ({ data: [{ id: G2, target_round: 5004 }], error: null }));
    expect(await runGiveawaySteps()).toMatchObject({ drawn: 0, waiting: 1, failed: 0 });
    expect(fetchBeacon).not.toHaveBeenCalled();
  });

  it("each giveaway is isolated: an RPC error fails that one, round_not_ready waits, already counts as drawn", async () => {
    rpcAnswers.set("giveaways_awaiting_draw", () => ({
      data: [
        { id: G1, target_round: 4990 },
        { id: G2, target_round: 4995 },
        { id: G3, target_round: 5000 },
      ],
      error: null,
    }));
    rpcAnswers.set("draw_giveaway", (a) => {
      if (a!.p_id === G1) return { data: null, error: { message: "invalid_state" } };
      if (a!.p_id === G2) return { data: null, error: { message: "round_not_ready" } };
      return { data: { status: "already" }, error: null };
    });
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await runGiveawaySteps()).toMatchObject({ drawn: 1, waiting: 1, failed: 1 });
    expect(calls("draw_giveaway")).toHaveLength(3);
    err.mockRestore();
  });

  it("a failed close is logged and the draws still run", async () => {
    rpcAnswers.set("close_due_giveaways", () => ({ data: null, error: { message: "db down" } }));
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await runGiveawaySteps()).toEqual({ closed: 0, voided: 0, drawn: 1, waiting: 0, failed: 0, public: NO_PUBLIC });
    expect(err).toHaveBeenCalled();
    err.mockRestore();
  });

  it("a failed awaiting read is logged and counted as a failure; the public cycle still runs", async () => {
    rpcAnswers.set("giveaways_awaiting_draw", () => ({ data: null, error: { message: "db down" } }));
    rpcAnswers.set("public_giveaways_awaiting_draw", () => ({ data: [{ id: P1, target_round: 5000 }], error: null }));
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const report = await runGiveawaySteps();
    expect(report).toMatchObject({ closed: 2, voided: 1, drawn: 0, failed: 1 });
    expect(report.public).toEqual({ closed: 0, voided: 0, drawn: 1, waiting: 0, failed: 0 });
    expect(err).toHaveBeenCalled();
    // the club close changed something: its pages are still revalidated
    expect(revalidatePath).toHaveBeenCalledWith("/sorteos");
    err.mockRestore();
  });

  it("a club cycle that throws (rpc rejects) does not skip the public cycle", async () => {
    rpcAnswers.set("close_due_giveaways", () => {
      throw new Error("socket hang up");
    });
    rpcAnswers.set("public_giveaways_awaiting_draw", () => ({ data: [{ id: P1, target_round: 5000 }], error: null }));
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const report = await runGiveawaySteps();
    expect(report).toMatchObject({ closed: 0, voided: 0, drawn: 0, failed: 1 });
    expect(report.public).toMatchObject({ drawn: 1, failed: 0 });
    err.mockRestore();
  });

  it("does not revalidate when nothing changed", async () => {
    rpcAnswers.set("close_due_giveaways", () => ({ data: { closed: 0, voided: 0 }, error: null }));
    rpcAnswers.set("giveaways_awaiting_draw", () => ({ data: [], error: null }));
    expect(await runGiveawaySteps()).toEqual({ closed: 0, voided: 0, drawn: 0, waiting: 0, failed: 0, public: NO_PUBLIC });
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});

describe("runGiveawaySteps: public giveaways (P2)", () => {
  beforeEach(() => {
    rpcAnswers.set("close_due_giveaways", () => ({ data: { closed: 0, voided: 0 }, error: null }));
    rpcAnswers.set("giveaways_awaiting_draw", () => ({ data: [], error: null }));
  });

  it("closes the due public giveaways and draws each closed one with draw_public_giveaway", async () => {
    rpcAnswers.set("close_due_public_giveaways", () => ({ data: { closed: 1, voided: 2 }, error: null }));
    rpcAnswers.set("public_giveaways_awaiting_draw", () => ({ data: [{ id: P1, target_round: "5000" }], error: null }));
    expect(await runGiveawaySteps()).toEqual({
      closed: 0,
      voided: 0,
      drawn: 0,
      waiting: 0,
      failed: 0,
      public: { closed: 1, voided: 2, drawn: 1, waiting: 0, failed: 0 },
    });
    expect(calls("draw_giveaway")).toHaveLength(0);
    expect(calls("draw_public_giveaway")[0]![1]).toEqual({ p_id: P1, p_round: 5000, p_signature: SIG });
    expect(fetchBeacon).toHaveBeenCalledWith(5000n);
  });

  it("'already' from draw_public_giveaway counts as drawn; an error fails only that giveaway", async () => {
    rpcAnswers.set("public_giveaways_awaiting_draw", () => ({
      data: [
        { id: P1, target_round: 4990 },
        { id: P2, target_round: 4995 },
      ],
      error: null,
    }));
    rpcAnswers.set("draw_public_giveaway", (a) =>
      a!.p_id === P1 ? { data: "already", error: null } : { data: null, error: { message: "invalid_state" } },
    );
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    expect((await runGiveawaySteps()).public).toEqual({ closed: 0, voided: 0, drawn: 1, waiting: 0, failed: 1 });
    err.mockRestore();
  });

  it("drand unavailable in the club cycle is not asked again in the public cycle", async () => {
    rpcAnswers.set("giveaways_awaiting_draw", () => ({ data: [{ id: G1, target_round: 5000 }], error: null }));
    rpcAnswers.set("public_giveaways_awaiting_draw", () => ({
      data: [
        { id: P1, target_round: 4990 },
        { id: P2, target_round: 5000 },
      ],
      error: null,
    }));
    fetchBeacon.mockResolvedValue({ status: "unavailable" });
    const report = await runGiveawaySteps();
    expect(report).toMatchObject({ waiting: 1, drawn: 0 });
    expect(report.public).toEqual({ closed: 0, voided: 0, drawn: 0, waiting: 2, failed: 0 });
    expect(fetchBeacon).toHaveBeenCalledTimes(1);
    expect(calls("draw_public_giveaway")).toHaveLength(0);
  });

  it("a failed public close is logged and the public draws still run", async () => {
    rpcAnswers.set("close_due_public_giveaways", () => ({ data: null, error: { message: "db down" } }));
    rpcAnswers.set("public_giveaways_awaiting_draw", () => ({ data: [{ id: P1, target_round: 5000 }], error: null }));
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    expect((await runGiveawaySteps()).public).toEqual({ closed: 0, voided: 0, drawn: 1, waiting: 0, failed: 0 });
    expect(err).toHaveBeenCalled();
    err.mockRestore();
  });

  it("a failed public awaiting read is logged and counted; the club report is kept", async () => {
    rpcAnswers.set("giveaways_awaiting_draw", () => ({ data: [{ id: G1, target_round: 5000 }], error: null }));
    rpcAnswers.set("public_giveaways_awaiting_draw", () => ({ data: null, error: { message: "db down" } }));
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const report = await runGiveawaySteps();
    expect(report).toMatchObject({ drawn: 1, failed: 0 });
    expect(report.public).toEqual({ closed: 0, voided: 0, drawn: 0, waiting: 0, failed: 1 });
    expect(err).toHaveBeenCalled();
    err.mockRestore();
  });
});
