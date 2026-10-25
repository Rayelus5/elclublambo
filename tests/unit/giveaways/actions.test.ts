// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const revalidatePath = vi.hoisted(() => vi.fn());
vi.mock("next/cache", () => ({ revalidatePath }));

const SAFE = "0x380f2e12081995359e2Ab88E3c31c6b227904234";
const WINNER = "0x90f79bf6eb2c4f870365e785982e1f101e93b906";
const HASH = `0x${"AB".repeat(32)}`;
const SIG = "b44679b9a59af2ec876b1a6b1ad52ea9b1615fc3982b19576350f93447cb1125e342b73a8dd2bacbe47e4b6b63ed5e39";
const GID = "00000000-0000-4000-8000-000000000001";
const PID = "00000000-0000-4000-8000-0000000000aa";
const DRAWN_AT = "2026-10-20T10:00:00.000Z";

const treasurerId = vi.hoisted(() => vi.fn());
vi.mock("@/lib/treasury/treasurer", () => ({ treasurerId }));
const hitRateLimit = vi.hoisted(() => vi.fn());
vi.mock("@/lib/rate-limit", () => ({ hitRateLimit }));
const verifyTransfer = vi.hoisted(() => vi.fn());
vi.mock("@/lib/payments/verify", () => ({ verifyTransfer }));
const fetchBeacon = vi.hoisted(() => vi.fn());
vi.mock("@/lib/giveaways/drand", async (orig) => ({ ...(await orig<typeof import("@/lib/giveaways/drand")>()), fetchBeacon }));

type Res = { data: unknown; error: { message: string; code?: string } | null };
// admin client: rpc + from(table).select().eq().maybeSingle()
const adminRpc = vi.hoisted(() => vi.fn());
const rows = vi.hoisted(() => new Map<string, Res>());
const selects = vi.hoisted(() => [] as string[]);
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    rpc: adminRpc,
    from: (table: string) => ({
      select: (cols: string) => {
        selects.push(`${table}:${cols}`);
        return { eq: () => ({ maybeSingle: async () => rows.get(table) ?? { data: null, error: null } }) };
      },
    }),
  }),
}));
const userRpc = vi.hoisted(() => vi.fn());
vi.mock("@/lib/supabase/server", () => ({ createServerClient: async () => ({ rpc: userRpc }) }));

import { roundTime } from "@/lib/giveaways/drand";
import {
  cancelGiveawayAction,
  createGiveawayAction,
  drawGiveawayNowAction,
  enterGiveawayAction,
  leaveGiveawayAction,
  markPrizeDeliveredAction,
  markPrizePaidAction,
} from "@/lib/giveaways/actions";

const ok = (data: unknown = null): Res => ({ data, error: null });
const err = (message: string): Res => ({ data: null, error: { message } });

beforeEach(() => {
  vi.clearAllMocks();
  rows.clear();
  selects.length = 0;
  vi.stubEnv("NEXT_PUBLIC_NETWORK_SET", "testnet");
  treasurerId.mockResolvedValue("m1");
  hitRateLimit.mockResolvedValue("ok");
  userRpc.mockResolvedValue(ok());
  adminRpc.mockResolvedValue(ok({ status: "paid" }));
  verifyTransfer.mockResolvedValue({ status: "ok", logIndex: 3, value: 5_000_000n, blockNumber: 77n, blockTimestamp: new Date() });
  rows.set("giveaway_prizes", ok({ giveaway_id: GID, kind: "crypto", status: "awarded", chain_id: 84532, token: "USDC", amount: "5000000", winner_address: WINNER }));
  rows.set("giveaways", ok({ id: GID, status: "drawn", drawn_at: DRAWN_AT, target_round: 1000, closes_at: DRAWN_AT }));
  rows.set("chains", ok({ safe_address: SAFE }));
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

const expectRevalidated = () => {
  expect(revalidatePath).toHaveBeenCalledWith("/foro/sorteos");
  expect(revalidatePath).toHaveBeenCalledWith("/foro/sorteos/[id]", "page");
};

describe("createGiveawayAction", () => {
  const closesAt = new Date(Date.now() + 3_600_000).toISOString();
  const input = {
    title: "Sorteo de otoño",
    description: "",
    closesAt,
    prizes: [
      { kind: "crypto" as const, chainId: 84532, amount: "5,5" },
      { kind: "role" as const, roleId: "00000000-0000-4000-8000-0000000000bb" },
      { kind: "custom" as const, label: "Camiseta del club" },
    ],
  };

  it("sends USDC in base units and returns the commit and target round", async () => {
    userRpc.mockResolvedValue(ok({ id: GID, commit: `0x${"1".repeat(64)}`, targetRound: 123 }));
    expect(await createGiveawayAction(input)).toEqual({ ok: true, id: GID, commit: `0x${"1".repeat(64)}`, targetRound: 123 });
    expect(userRpc).toHaveBeenCalledWith("create_giveaway", {
      p_title: "Sorteo de otoño",
      p_description: null,
      p_closes_at: closesAt,
      p_prizes: [
        { kind: "crypto", chainId: 84532, amount: "5500000" },
        { kind: "role", roleId: "00000000-0000-4000-8000-0000000000bb" },
        { kind: "custom", label: "Camiseta del club" },
      ],
    });
    expectRevalidated();
  });

  it.each([
    { ...input, prizes: [] },
    { ...input, prizes: Array.from({ length: 11 }, () => ({ kind: "custom" as const, label: "x" })) },
    { ...input, prizes: [{ kind: "crypto" as const, chainId: 8453, amount: "1" }] }, // mainnet chain on a testnet build
    { ...input, prizes: [{ kind: "crypto" as const, chainId: 84532, amount: "0" }] },
    { ...input, prizes: [{ kind: "role" as const, roleId: "nope" }] },
    { ...input, prizes: [{ kind: "nft", label: "x" }] },
    { ...input, closesAt: "2026-10-30T10:00" }, // no zone
    { ...input, title: 5 },
  ])("rejects invalid input without calling the RPC (%#)", async (bad) => {
    expect(await createGiveawayAction(bad as never)).toMatchObject({ ok: false });
    expect(userRpc).not.toHaveBeenCalled();
  });

  it("maps SQL's closes_at_invalid to the giveaway copy (10 min to 30 days)", async () => {
    userRpc.mockResolvedValue(err("closes_at_invalid"));
    expect(await createGiveawayAction(input)).toMatchObject({ ok: false, code: "giveaway_closes_at_invalid", error: expect.stringContaining("10 minutos") });
  });

  it("maps role_not_allowed", async () => {
    userRpc.mockResolvedValue(err("role_not_allowed"));
    expect(await createGiveawayAction(input)).toMatchObject({ ok: false, code: "role_not_allowed" });
  });
});

describe("cancel / enter / leave", () => {
  it("call their RPC with the caller's JWT and revalidate", async () => {
    expect(await cancelGiveawayAction(GID, "Error en el premio")).toEqual({ ok: true });
    expect(userRpc).toHaveBeenLastCalledWith("cancel_giveaway", { p_id: GID, p_reason: "Error en el premio" });
    expect(await enterGiveawayAction(GID)).toEqual({ ok: true });
    expect(userRpc).toHaveBeenLastCalledWith("enter_giveaway", { p_id: GID });
    expect(await leaveGiveawayAction(GID)).toEqual({ ok: true });
    expect(userRpc).toHaveBeenLastCalledWith("leave_giveaway", { p_id: GID });
    expectRevalidated();
  });
  it("map giveaway_closed and reject a bad id", async () => {
    userRpc.mockResolvedValue(err("giveaway_closed"));
    expect(await enterGiveawayAction(GID)).toMatchObject({ ok: false, code: "giveaway_closed" });
    expect(await leaveGiveawayAction("x")).toMatchObject({ ok: false, code: "invalid_input" });
  });
});

describe("markPrizePaidAction", () => {
  it("verifies the exact USDC transfer from the Safe to the winner, not before the draw, then records it", async () => {
    expect(await markPrizePaidAction(PID, HASH)).toEqual({ ok: true, status: "paid" });
    expect(hitRateLimit).toHaveBeenCalledWith(expect.anything(), "chain_verify");
    expect(verifyTransfer).toHaveBeenCalledWith({
      chain: 84532,
      token: "USDC",
      txHash: HASH.toLowerCase(),
      from: SAFE,
      to: WINNER,
      amount: 5_000_000n,
      notBefore: new Date(DRAWN_AT),
    });
    expect(adminRpc).toHaveBeenCalledWith("record_giveaway_payout", {
      p_prize: PID,
      p_payout: { txHash: HASH.toLowerCase(), logIndex: 3, blockNumber: "77" },
      p_actor: "m1",
    });
    expectRevalidated();
  });

  it("tx_mismatch does not call the RPC", async () => {
    verifyTransfer.mockResolvedValue({ status: "error", code: "tx_mismatch" });
    expect(await markPrizePaidAction(PID, HASH)).toMatchObject({ ok: false, code: "tx_mismatch" });
    expect(adminRpc).not.toHaveBeenCalled();
  });

  it("pending confirmations answer payout_pending", async () => {
    verifyTransfer.mockResolvedValue({ status: "pending" });
    expect(await markPrizePaidAction(PID, HASH)).toMatchObject({ ok: false, code: "payout_pending" });
    expect(adminRpc).not.toHaveBeenCalled();
  });

  it("forbidden without MANAGE_TREASURY, before the rate limit", async () => {
    treasurerId.mockResolvedValue(null);
    expect(await markPrizePaidAction(PID, HASH)).toMatchObject({ ok: false, code: "forbidden" });
    expect(hitRateLimit).not.toHaveBeenCalled();
  });

  it("stops at the rate limit before reading the chain", async () => {
    hitRateLimit.mockResolvedValue("rate_limited");
    expect(await markPrizePaidAction(PID, HASH)).toMatchObject({ ok: false, code: "rate_limited" });
    expect(verifyTransfer).not.toHaveBeenCalled();
  });

  it.each([
    ["a custom prize", { kind: "custom", status: "awarded" }, "invalid_state"],
    ["a pending prize", { status: "pending" }, "invalid_state"],
    ["a prize without a winner wallet", { winner_address: null }, "invalid_state"],
    ["a chain outside this build", { chain_id: 8453 }, "chain_invalid"],
  ])("refuses %s without verifying", async (_name, over, code) => {
    const base = rows.get("giveaway_prizes")!.data as Record<string, unknown>;
    rows.set("giveaway_prizes", ok({ ...base, ...over }));
    expect(await markPrizePaidAction(PID, HASH)).toMatchObject({ ok: false, code });
    expect(verifyTransfer).not.toHaveBeenCalled();
  });

  it("not_found for an unknown prize; safe_not_configured without a Safe", async () => {
    rows.set("giveaway_prizes", ok(null));
    expect(await markPrizePaidAction(PID, HASH)).toMatchObject({ ok: false, code: "not_found" });
    rows.set("giveaway_prizes", ok({ giveaway_id: GID, kind: "crypto", status: "awarded", chain_id: 84532, token: "USDC", amount: "5000000", winner_address: WINNER }));
    rows.set("chains", ok({ safe_address: null }));
    expect(await markPrizePaidAction(PID, HASH)).toMatchObject({ ok: false, code: "safe_not_configured" });
  });

  it("maps the RPC's tx_already_used and passes 'already' through", async () => {
    adminRpc.mockResolvedValueOnce(err("tx_already_used"));
    expect(await markPrizePaidAction(PID, HASH)).toMatchObject({ ok: false, code: "tx_already_used" });
    adminRpc.mockResolvedValueOnce(ok({ status: "already" }));
    expect(await markPrizePaidAction(PID, HASH)).toEqual({ ok: true, status: "already" });
  });

  it("rejects a malformed hash or id", async () => {
    expect(await markPrizePaidAction(PID, "0x12")).toMatchObject({ ok: false, code: "invalid_input" });
    expect(await markPrizePaidAction("x", HASH)).toMatchObject({ ok: false, code: "invalid_input" });
    expect(treasurerId).not.toHaveBeenCalled();
  });
});

describe("markPrizeDeliveredAction", () => {
  it("calls the RPC with the caller's JWT and revalidates", async () => {
    expect(await markPrizeDeliveredAction(PID)).toEqual({ ok: true });
    expect(userRpc).toHaveBeenCalledWith("mark_giveaway_prize_delivered", { p_prize: PID });
    expectRevalidated();
  });
});

describe("drawGiveawayNowAction", () => {
  const closed = (round: number) => ok({ id: GID, status: "closed", target_round: round, closes_at: DRAWN_AT, drawn_at: null });

  beforeEach(() => {
    vi.useFakeTimers({ now: (roundTime(1000n) + 30) * 1000, toFake: ["Date"] });
    adminRpc.mockImplementation(async (fn: string) => {
      if (fn === "close_due_giveaways") return ok({ closed: 1, voided: 0 });
      if (fn === "draw_giveaway") return ok({ status: "drawn" });
      throw new Error(fn);
    });
    rows.set("giveaways", closed(1000));
    fetchBeacon.mockResolvedValue({ status: "ok", signature: SIG, randomness: "ab".repeat(32) });
  });

  it("forbidden for a non-treasurer", async () => {
    treasurerId.mockResolvedValue(null);
    expect(await drawGiveawayNowAction(GID)).toMatchObject({ ok: false, code: "forbidden" });
    expect(adminRpc).not.toHaveBeenCalled();
  });

  it("closes due giveaways first, then runs the cron's draw step for this one", async () => {
    expect(await drawGiveawayNowAction(GID)).toEqual({ ok: true, status: "drawn" });
    expect(adminRpc.mock.calls.map((c) => c[0])).toEqual(["close_due_giveaways", "draw_giveaway"]);
    expect(adminRpc).toHaveBeenLastCalledWith("draw_giveaway", { p_id: GID, p_round: 1000, p_signature: SIG });
    expectRevalidated();
  });

  it("round_not_ready when the target round does not exist yet (drand not asked)", async () => {
    rows.set("giveaways", closed(1011));
    expect(await drawGiveawayNowAction(GID)).toMatchObject({ ok: false, code: "round_not_ready" });
    expect(fetchBeacon).not.toHaveBeenCalled();
  });

  it("an open giveaway (not due yet) is round_not_ready too", async () => {
    rows.set("giveaways", ok({ id: GID, status: "open", target_round: 2000, closes_at: DRAWN_AT, drawn_at: null }));
    expect(await drawGiveawayNowAction(GID)).toMatchObject({ ok: false, code: "round_not_ready" });
  });

  it("drand down answers drand_unavailable and leaves the giveaway closed", async () => {
    fetchBeacon.mockResolvedValue({ status: "unavailable" });
    expect(await drawGiveawayNowAction(GID)).toMatchObject({ ok: false, code: "drand_unavailable" });
    expect(adminRpc.mock.calls.map((c) => c[0])).toEqual(["close_due_giveaways"]);
  });

  it("an invalid beacon answers drand_invalid", async () => {
    fetchBeacon.mockResolvedValue({ status: "invalid" });
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await drawGiveawayNowAction(GID)).toMatchObject({ ok: false, code: "drand_invalid" });
  });

  it("a giveaway already drawn or voided answers ok with its status", async () => {
    rows.set("giveaways", ok({ id: GID, status: "drawn", target_round: 1000, closes_at: DRAWN_AT, drawn_at: DRAWN_AT }));
    expect(await drawGiveawayNowAction(GID)).toEqual({ ok: true, status: "already" });
    rows.set("giveaways", ok({ id: GID, status: "void", target_round: 1000, closes_at: DRAWN_AT, drawn_at: null }));
    expect(await drawGiveawayNowAction(GID)).toEqual({ ok: true, status: "void" });
  });

  it("a cancelled giveaway is invalid_state; an unknown one not_found", async () => {
    rows.set("giveaways", ok({ id: GID, status: "cancelled", target_round: 1000, closes_at: DRAWN_AT, drawn_at: null }));
    expect(await drawGiveawayNowAction(GID)).toMatchObject({ ok: false, code: "invalid_state" });
    rows.set("giveaways", ok(null));
    expect(await drawGiveawayNowAction(GID)).toMatchObject({ ok: false, code: "not_found" });
  });
});
