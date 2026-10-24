// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const revalidatePath = vi.hoisted(() => vi.fn());
vi.mock("next/cache", () => ({ revalidatePath }));

const GID = "00000000-0000-4000-8000-000000000001";
const PID = "00000000-0000-4000-8000-0000000000aa";
const HOST = "00000000-0000-4000-8000-0000000000b1";
const HOST_ADDR = "0x70997970c51812dc3a010c7d01b50e0d17dc79c8";
const WINNER = "0x90f79bf6eb2c4f870365e785982e1f101e93b906";
const WALLET = "0x3c44cdddb6a900fa2b585dd299e03d12fa4293bc";
const HASH = `0x${"AB".repeat(32)}`;
const DRAWN_AT = "2026-10-20T10:00:00.000Z";

const getPublicSession = vi.hoisted(() => vi.fn());
vi.mock("@/lib/auth/public-session", () => ({ getPublicSession }));
const hitRateLimit = vi.hoisted(() => vi.fn());
vi.mock("@/lib/rate-limit", () => ({ hitRateLimit }));
const verifyTransfer = vi.hoisted(() => vi.fn());
vi.mock("@/lib/payments/verify", () => ({ verifyTransfer }));
const countTransactions = vi.hoisted(() => vi.fn());
vi.mock("@/lib/public-giveaways/tx-count", () => ({ countTransactions }));

type Res = { data: unknown; error: { message: string; code?: string } | null };
const adminRpc = vi.hoisted(() => vi.fn());
const rows = vi.hoisted(() => new Map<string, Res>());
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    rpc: adminRpc,
    from: (table: string) => ({
      select: () => ({ eq: () => ({ maybeSingle: async () => rows.get(table) ?? { data: null, error: null } }) }),
    }),
  }),
}));
const userRpc = vi.hoisted(() => vi.fn());
vi.mock("@/lib/supabase/server", () => ({ createServerClient: async () => ({ rpc: userRpc }) }));

import {
  cancelPublicGiveawayAction,
  createPublicGiveawayAction,
  enterPublicGiveawayAction,
  leavePublicGiveawayAction,
  markPublicPrizeDeliveredAction,
  markPublicPrizePaidAction,
} from "@/lib/public-giveaways/actions";

const ok = (data: unknown = null): Res => ({ data, error: null });
const err = (message: string): Res => ({ data: null, error: { message } });
const future = () => new Date(Date.now() + 86_400_000).toISOString();

beforeEach(() => {
  vi.clearAllMocks();
  rows.clear();
  vi.stubEnv("NEXT_PUBLIC_NETWORK_SET", "testnet");
  getPublicSession.mockResolvedValue({ userId: HOST, wallet: WALLET, isMember: false });
  hitRateLimit.mockResolvedValue("ok");
  userRpc.mockResolvedValue(ok());
  adminRpc.mockResolvedValue(ok("paid"));
  countTransactions.mockResolvedValue(10);
  verifyTransfer.mockResolvedValue({ status: "ok", logIndex: 3, value: 5_000_000n, blockNumber: 77n, blockTimestamp: new Date() });
  rows.set("public_giveaway_prizes", ok({ giveaway_id: GID, kind: "crypto", status: "awarded", chain_id: 84532, amount: "5000000", winner_address: WINNER }));
  rows.set("public_giveaways", ok({ host_user_id: HOST, host_address: HOST_ADDR, drawn_at: DRAWN_AT, min_tx_count: 0 }));
});

describe("createPublicGiveawayAction", () => {
  const input = (over: Record<string, unknown> = {}) => ({
    title: "Sorteo",
    description: "",
    closesAt: future(),
    hostName: "",
    minTxCount: 0,
    allowlist: "",
    prizes: [{ kind: "crypto" as const, chainId: 84532 as const, amount: "5,5" }, { kind: "custom" as const, label: " Camiseta " }],
    ...over,
  });

  it("normalizes and dedupes the pasted allowlist and sends the prizes in base units", async () => {
    userRpc.mockResolvedValue(ok(GID));
    const A = "0xAbCdEf0123456789aBcDef0123456789AbCdEf01";
    const r = await createPublicGiveawayAction(input({ allowlist: `${A}\n${A.toLowerCase()}, ${WINNER}  ${HOST_ADDR};` }));
    expect(r).toEqual({ ok: true, id: GID });
    const args = userRpc.mock.calls[0]![1];
    expect(args.p_allowlist).toEqual([A.toLowerCase(), WINNER, HOST_ADDR]);
    expect(args.p_prizes).toEqual([{ kind: "crypto", chainId: 84532, amount: "5500000" }, { kind: "custom", label: "Camiseta" }]);
    expect(args.p_description).toBeNull();
    expect(args.p_host_name).toBeNull();
    expect(revalidatePath).toHaveBeenCalledWith(`/es/tools/giveaways/${GID}`);
    expect(revalidatePath).toHaveBeenCalledWith(`/en/tools/giveaways/${GID}`);
  });

  it("rejects 0x123 as invalid_allowlist naming it, without calling the database", async () => {
    const r = await createPublicGiveawayAction(input({ allowlist: `${WINNER}\n0x123` }));
    expect(r).toEqual({ ok: false, error: "invalid_allowlist", detail: "0x123" });
    expect(userRpc).not.toHaveBeenCalled();
  });

  it.each([
    ["no prizes", { prizes: [] }],
    ["a chain of the other network set", { prizes: [{ kind: "crypto", chainId: 8453, amount: "5" }] }],
    ["zero amount", { prizes: [{ kind: "crypto", chainId: 84532, amount: "0" }] }],
    ["blank custom label", { prizes: [{ kind: "custom", label: "  " }] }],
    ["a date without zone", { closesAt: "2030-01-01T10:00" }],
    ["min tx over 1000", { minTxCount: 1001 }],
    ["fractional min tx", { minTxCount: 1.5 }],
  ])("rejects %s as invalid_input", async (_n, over) => {
    expect(await createPublicGiveawayAction(input(over as Record<string, unknown>))).toEqual({ ok: false, error: "invalid_input" });
    expect(userRpc).not.toHaveBeenCalled();
  });

  it("without a session answers not_authenticated", async () => {
    getPublicSession.mockResolvedValue(null);
    expect(await createPublicGiveawayAction(input())).toEqual({ ok: false, error: "not_authenticated" });
    expect(userRpc).not.toHaveBeenCalled();
  });

  it.each(["too_many_open", "rate_limited", "forbidden"])("maps the database code %s", async (code) => {
    userRpc.mockResolvedValue(err(code));
    expect(await createPublicGiveawayAction(input())).toEqual({ ok: false, error: code });
  });

  it("maps an unknown database message to unknown", async () => {
    userRpc.mockResolvedValue(err("boom"));
    expect(await createPublicGiveawayAction(input())).toEqual({ ok: false, error: "unknown" });
  });
});

describe("enterPublicGiveawayAction", () => {
  it("without a session answers not_authenticated and touches nothing", async () => {
    getPublicSession.mockResolvedValue(null);
    expect(await enterPublicGiveawayAction(GID)).toEqual({ ok: false, error: "not_authenticated" });
    expect(adminRpc).not.toHaveBeenCalled();
  });

  it("minTxCount 5 with 3 transactions: min_tx_not_met, the RPC is not called", async () => {
    rows.set("public_giveaways", ok({ min_tx_count: 5 }));
    countTransactions.mockResolvedValue(3);
    expect(await enterPublicGiveawayAction(GID)).toEqual({ ok: false, error: "min_tx_not_met" });
    expect(countTransactions).toHaveBeenCalledWith(WALLET);
    expect(adminRpc).not.toHaveBeenCalled();
  });

  it("an RPC failure counting transactions fails closed as chain_unavailable", async () => {
    rows.set("public_giveaways", ok({ min_tx_count: 5 }));
    countTransactions.mockRejectedValue(new Error("down"));
    expect(await enterPublicGiveawayAction(GID)).toEqual({ ok: false, error: "chain_unavailable" });
    expect(adminRpc).not.toHaveBeenCalled();
  });

  it("enough transactions enters with the session wallet", async () => {
    rows.set("public_giveaways", ok({ min_tx_count: 5 }));
    countTransactions.mockResolvedValue(5);
    adminRpc.mockResolvedValue(ok("entered"));
    expect(await enterPublicGiveawayAction(GID)).toEqual({ ok: true });
    expect(adminRpc).toHaveBeenCalledWith("enter_public_giveaway", { p_id: GID, p_user: HOST, p_wallet: WALLET });
    expect(revalidatePath).toHaveBeenCalledWith(`/es/tools/giveaways/${GID}`);
  });

  it("without a minimum the chain is not asked", async () => {
    adminRpc.mockResolvedValue(ok("already"));
    expect(await enterPublicGiveawayAction(GID)).toEqual({ ok: true });
    expect(countTransactions).not.toHaveBeenCalled();
  });

  it("an unknown giveaway is not_found; a bad id invalid_input", async () => {
    rows.delete("public_giveaways");
    expect(await enterPublicGiveawayAction(GID)).toEqual({ ok: false, error: "not_found" });
    expect(await enterPublicGiveawayAction("x")).toEqual({ ok: false, error: "invalid_input" });
  });

  it.each(["not_allowed", "giveaway_full", "giveaway_closed"])("maps the database code %s", async (code) => {
    adminRpc.mockResolvedValue(err(code));
    expect(await enterPublicGiveawayAction(GID)).toEqual({ ok: false, error: code });
  });
});

describe("thin wrappers", () => {
  it("leave and cancel call their RPC with the user's client", async () => {
    expect(await leavePublicGiveawayAction(GID)).toEqual({ ok: true });
    expect(userRpc).toHaveBeenCalledWith("leave_public_giveaway", { p_id: GID });
    expect(await cancelPublicGiveawayAction(GID)).toEqual({ ok: true });
    expect(userRpc).toHaveBeenCalledWith("cancel_public_giveaway", { p_id: GID });
    expect(adminRpc).not.toHaveBeenCalled();
  });

  it("map the database error and require a session", async () => {
    userRpc.mockResolvedValue(err("giveaway_closed"));
    expect(await leavePublicGiveawayAction(GID)).toEqual({ ok: false, error: "giveaway_closed" });
    getPublicSession.mockResolvedValue(null);
    expect(await cancelPublicGiveawayAction(GID)).toEqual({ ok: false, error: "not_authenticated" });
  });

  it("markPublicPrizeDeliveredAction calls mark_public_prize_delivered and revalidates the giveaway", async () => {
    rows.set("public_giveaway_prizes", ok({ giveaway_id: GID }));
    expect(await markPublicPrizeDeliveredAction(PID)).toEqual({ ok: true });
    expect(userRpc).toHaveBeenCalledWith("mark_public_prize_delivered", { p_prize: PID });
    expect(revalidatePath).toHaveBeenCalledWith(`/en/tools/giveaways/${GID}`);
  });
});

describe("markPublicPrizePaidAction (Review Focus 4)", () => {
  it("verifies from the host to the snapshotted winner for the exact amount, then records", async () => {
    expect(await markPublicPrizePaidAction(PID, HASH)).toEqual({ ok: true, status: "paid" });
    expect(hitRateLimit).toHaveBeenCalledWith(expect.anything(), "chain_verify");
    expect(verifyTransfer).toHaveBeenCalledWith({
      chain: 84532,
      token: "USDC",
      txHash: HASH.toLowerCase(),
      from: HOST_ADDR,
      to: WINNER,
      amount: 5_000_000n,
      notBefore: new Date(DRAWN_AT),
    });
    expect(adminRpc).toHaveBeenCalledWith("record_public_giveaway_payout", {
      p_prize: PID,
      p_payout: { txHash: HASH.toLowerCase(), logIndex: 3, blockNumber: "77" },
      p_actor: HOST,
    });
    expect(revalidatePath).toHaveBeenCalledWith(`/es/tools/giveaways/${GID}`);
  });

  it("the same payout again answers already", async () => {
    adminRpc.mockResolvedValue(ok("already"));
    expect(await markPublicPrizePaidAction(PID, HASH)).toEqual({ ok: true, status: "already" });
  });

  it.each([
    ["tx_mismatch (wrong sender, amount, recipient or token)", { status: "error", code: "tx_mismatch" }, "tx_mismatch"],
    ["tx_too_old (before the draw)", { status: "error", code: "tx_too_old" }, "tx_too_old"],
    ["tx_not_found", { status: "error", code: "tx_not_found" }, "tx_not_found"],
    ["tx_failed", { status: "error", code: "tx_failed" }, "tx_failed"],
    ["rpc_unavailable (also a wrong chain)", { status: "error", code: "rpc_unavailable" }, "rpc_unavailable"],
    ["pending", { status: "pending" }, "pending"],
  ])("verification %s returns its code and never touches the database", async (_n, result, code) => {
    verifyTransfer.mockResolvedValue(result);
    expect(await markPublicPrizePaidAction(PID, HASH)).toEqual({ ok: false, error: code });
    expect(adminRpc).not.toHaveBeenCalled();
  });

  it("only the host: another account is forbidden before any verification", async () => {
    getPublicSession.mockResolvedValue({ userId: "00000000-0000-4000-8000-0000000000c2", wallet: WALLET, isMember: false });
    expect(await markPublicPrizePaidAction(PID, HASH)).toEqual({ ok: false, error: "forbidden" });
    expect(verifyTransfer).not.toHaveBeenCalled();
    expect(adminRpc).not.toHaveBeenCalled();
  });

  it("no session: not_authenticated, rate limit untouched", async () => {
    getPublicSession.mockResolvedValue(null);
    expect(await markPublicPrizePaidAction(PID, HASH)).toEqual({ ok: false, error: "not_authenticated" });
    expect(hitRateLimit).not.toHaveBeenCalled();
  });

  it("rate limited stops before reading anything", async () => {
    hitRateLimit.mockResolvedValue("rate_limited");
    expect(await markPublicPrizePaidAction(PID, HASH)).toEqual({ ok: false, error: "rate_limited" });
    expect(verifyTransfer).not.toHaveBeenCalled();
  });

  it.each([
    ["a custom prize", { kind: "custom", status: "awarded" }],
    ["a prize not awarded yet", { status: "pending" }],
    ["no winner", { winner_address: null }],
  ])("%s is invalid_state", async (_n, over) => {
    rows.set("public_giveaway_prizes", ok({ giveaway_id: GID, kind: "crypto", status: "awarded", chain_id: 84532, amount: "5000000", winner_address: WINNER, ...over }));
    expect(await markPublicPrizePaidAction(PID, HASH)).toEqual({ ok: false, error: "invalid_state" });
    expect(verifyTransfer).not.toHaveBeenCalled();
  });

  it("a chain of the other network set is chain_invalid", async () => {
    rows.set("public_giveaway_prizes", ok({ giveaway_id: GID, kind: "crypto", status: "awarded", chain_id: 8453, amount: "5000000", winner_address: WINNER }));
    expect(await markPublicPrizePaidAction(PID, HASH)).toEqual({ ok: false, error: "chain_invalid" });
  });

  it("a giveaway not drawn yet is invalid_state; a missing prize not_found; a bad hash invalid_input", async () => {
    rows.set("public_giveaways", ok({ host_user_id: HOST, host_address: HOST_ADDR, drawn_at: null }));
    expect(await markPublicPrizePaidAction(PID, HASH)).toEqual({ ok: false, error: "invalid_state" });
    rows.delete("public_giveaway_prizes");
    expect(await markPublicPrizePaidAction(PID, HASH)).toEqual({ ok: false, error: "not_found" });
    expect(await markPublicPrizePaidAction(PID, "0x12")).toEqual({ ok: false, error: "invalid_input" });
  });

  it("tx_already_used from the record RPC is returned", async () => {
    adminRpc.mockResolvedValue(err("tx_already_used"));
    expect(await markPublicPrizePaidAction(PID, HASH)).toEqual({ ok: false, error: "tx_already_used" });
  });
});
