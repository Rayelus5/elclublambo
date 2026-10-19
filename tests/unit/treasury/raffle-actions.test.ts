import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const serverRpc = vi.hoisted(() => vi.fn());
vi.mock("@/lib/supabase/server", () => ({ createServerClient: async () => ({ rpc: serverRpc }) }));

const revalidatePath = vi.hoisted(() => vi.fn());
vi.mock("next/cache", () => ({ revalidatePath }));

const adminRpc = vi.hoisted(() => vi.fn());
const tables = vi.hoisted(() => ({}) as Record<string, unknown>);
const tableErrors = vi.hoisted(() => ({}) as Record<string, { message: string }>);
const createAdminClient = vi.hoisted(() =>
  vi.fn(() => ({
    rpc: adminRpc,
    from: (table: string) => {
      const b: Record<string, unknown> = {};
      for (const m of ["select", "eq"]) b[m] = () => b;
      b.maybeSingle = async () => (tableErrors[table] ? { data: null, error: tableErrors[table] } : { data: tables[table] ?? null, error: null });
      return b;
    },
  })),
);
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient }));

const safeAddressOf = vi.hoisted(() => vi.fn());
vi.mock("@/lib/treasury/snapshot", () => ({ safeAddressOf }));

const verifyPrizePayout = vi.hoisted(() => vi.fn());
vi.mock("@/lib/treasury/raffle-cron", async (importOriginal) => ({ ...(await importOriginal<object>()), verifyPrizePayout }));

import {
  cancelRaffleAction,
  createRaffleAction,
  enterRaffleAction,
  leaveRaffleAction,
  markRafflePaidAction,
  setWeightedRafflesEnabledAction,
} from "@/lib/treasury/raffle-actions";

const ID = "6f1c1d3e-2b4a-4c5d-8e9f-0a1b2c3d4e5f";
const ME = "11111111-2222-4333-8444-555555555555";
const SAFE = "0x3c44cdddb6a900fa2b585dd299e03d12fa4293bc";
const WINNER = "0x70997970c51812dc3a010c7d01b50e0d17dc79c8";
const HASH = `0x${"ab".repeat(32)}`;
const DRAWN = "2026-10-19T10:00:00.000Z";
const TS = new Date("2026-10-19T11:00:00.000Z");

let perms = "256";
let serverReplies: Record<string, { data?: unknown; error?: { message: string } | null }> = {};
let adminReplies: Record<string, { data?: unknown; error?: { message: string } | null }> = {};
const serverCalls = (name: string) => serverRpc.mock.calls.filter((c) => c[0] === name).map((c) => c[1]);
const adminCalls = (name: string) => adminRpc.mock.calls.filter((c) => c[0] === name).map((c) => c[1]);

beforeEach(() => {
  vi.clearAllMocks();
  perms = "256";
  serverReplies = {};
  adminReplies = {};
  for (const k of Object.keys(tables)) delete tables[k];
  for (const k of Object.keys(tableErrors)) delete tableErrors[k];
  tables.raffles = {
    chain_id: 59141, status: "drawn", prize_token: "WETH", prize_amount: "10000000000000000", winner_address: WINNER,
    drawn_at: DRAWN, payout_tx_hash: null,
  };
  serverRpc.mockImplementation(async (name: string) => {
    if (name === "my_permissions") return { data: perms, error: null };
    if (name === "current_member_id") return { data: ME, error: null };
    const r = serverReplies[name];
    return { data: r?.data ?? null, error: r?.error ?? null };
  });
  adminRpc.mockImplementation(async (name: string) => {
    const r = adminReplies[name];
    return { data: r?.data ?? null, error: r?.error ?? null };
  });
  safeAddressOf.mockResolvedValue(SAFE);
  verifyPrizePayout.mockResolvedValue({ status: "ok", logIndex: 2, value: 105n * 10n ** 14n, blockNumber: 140n, blockTimestamp: TS });
});

const revalidated = (id?: string) => {
  expect(revalidatePath).toHaveBeenCalledWith("/dao");
  expect(revalidatePath).toHaveBeenCalledWith("/dao/tesoreria");
  if (id) expect(revalidatePath).toHaveBeenCalledWith(`/dao/sorteos/${id}`);
};

describe("markRafflePaidAction", () => {
  it("a non-treasurer gets forbidden and no admin client is created", async () => {
    perms = "0";
    expect(await markRafflePaidAction(ID, HASH)).toMatchObject({ ok: false, code: "forbidden" });
    expect(createAdminClient).not.toHaveBeenCalled();
    expect(verifyPrizePayout).not.toHaveBeenCalled();
  });
  it.each(["", "0x123", `0x${"zz".repeat(32)}`, `${"ab".repeat(32)}`])("a malformed hash %j is invalid_input without an RPC call", async (h) => {
    expect(await markRafflePaidAction(ID, h)).toMatchObject({ ok: false, code: "invalid_input" });
    expect(serverRpc).not.toHaveBeenCalled();
    expect(adminRpc).not.toHaveBeenCalled();
  });
  it("a malformed id is invalid_input", async () => {
    expect(await markRafflePaidAction("nope", HASH)).toMatchObject({ ok: false, code: "invalid_input" });
    expect(serverRpc).not.toHaveBeenCalled();
  });
  it("verifies the prize (token, winner, amount, drawn_at) and records with p_actor = the caller", async () => {
    adminReplies.record_raffle_payout = { data: { status: "recorded" } };
    expect(await markRafflePaidAction(ID, ` ${HASH.toUpperCase().replace("0X", "0x")} `)).toEqual({ ok: true, status: "recorded" });
    expect(verifyPrizePayout).toHaveBeenCalledWith(
      { chain: 59141, safe: SAFE, token: "WETH", winner: WINNER, prize: 10n ** 16n, drawnAt: new Date(DRAWN) },
      HASH,
    );
    expect(adminCalls("record_raffle_payout")).toEqual([
      {
        p_raffle: ID,
        p_safe: SAFE,
        p_actor: ME,
        p_payout: { txHash: HASH, logIndex: 2, blockNumber: "140", blockTime: TS.toISOString(), to: WINNER, token: "WETH", amount: "10500000000000000" },
      },
    ]);
    revalidated(ID);
  });
  it("verify pending maps to payout_pending; verify errors pass through; nothing is recorded", async () => {
    verifyPrizePayout.mockResolvedValueOnce({ status: "pending" });
    expect(await markRafflePaidAction(ID, HASH)).toMatchObject({ ok: false, code: "payout_pending" });
    verifyPrizePayout.mockResolvedValueOnce({ status: "error", code: "tx_mismatch" });
    expect(await markRafflePaidAction(ID, HASH)).toMatchObject({ ok: false, code: "tx_mismatch", error: "La transacción no coincide con el pago." });
    expect(adminCalls("record_raffle_payout")).toEqual([]);
  });
  it("refuses with invalid_state unless the raffle is drawn with no payout", async () => {
    for (const over of [{ status: "open" }, { status: "closed" }, { status: "cancelled" }, { status: "drawn", payout_tx_hash: `0x${"cd".repeat(32)}` }]) {
      Object.assign(tables.raffles as object, { status: "drawn", payout_tx_hash: null }, over);
      expect(await markRafflePaidAction(ID, HASH)).toMatchObject({ ok: false, code: "invalid_state" });
    }
    expect(verifyPrizePayout).not.toHaveBeenCalled();
  });
  it("the same hash already recorded answers already without verifying again", async () => {
    Object.assign(tables.raffles as object, { payout_tx_hash: HASH });
    expect(await markRafflePaidAction(ID, HASH)).toEqual({ ok: true, status: "already" });
    expect(verifyPrizePayout).not.toHaveBeenCalled();
  });
  it("not_found, a read error, no Safe and an RPC refusal", async () => {
    delete tables.raffles;
    expect(await markRafflePaidAction(ID, HASH)).toMatchObject({ ok: false, code: "not_found" });
    tableErrors.raffles = { message: "db down" };
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await markRafflePaidAction(ID, HASH)).toMatchObject({ ok: false, code: "unknown" });
    err.mockRestore();
    delete tableErrors.raffles;
    tables.raffles = { chain_id: 59141, status: "drawn", prize_token: "USDC", prize_amount: "5000000", winner_address: WINNER, drawn_at: DRAWN, payout_tx_hash: null };
    safeAddressOf.mockResolvedValueOnce(null);
    expect(await markRafflePaidAction(ID, HASH)).toMatchObject({ ok: false, code: "safe_not_configured" });
    adminReplies.record_raffle_payout = { error: { message: "tx_already_used" } };
    expect(await markRafflePaidAction(ID, HASH)).toMatchObject({ ok: false, code: "tx_already_used" });
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});

describe("createRaffleAction", () => {
  const input = { title: "Sorteo de otoño", prizeToken: "WETH" as const, prize: "0,01", closesAt: "2026-10-25T18:30:00+02:00", mode: "equal" as const };
  it("sends the prize in base units and the close as ISO, with the user's client", async () => {
    serverReplies.create_raffle = { data: { id: ID, commit: `0x${"ef".repeat(32)}` } };
    expect(await createRaffleAction(input)).toEqual({ ok: true, id: ID, commit: `0x${"ef".repeat(32)}` });
    expect(serverCalls("create_raffle")).toEqual([
      { p_title: "Sorteo de otoño", p_prize_token: "WETH", p_prize_amount: "10000000000000000", p_closes_at: "2026-10-25T16:30:00.000Z", p_mode: "equal" },
    ]);
    expect(createAdminClient).not.toHaveBeenCalled();
    revalidated(ID);
  });
  it.each([
    { prize: "1,1234567", prizeToken: "USDC" },
    { prize: "abc" },
    { prize: "" },
    { prizeToken: "ETH" },
    { mode: "random" },
    { closesAt: "mañana" },
    { closesAt: "2026-10-25T18:30" },
    { closesAt: "2026-10-25T18:30:00" },
    { closesAt: "2026-10-25" },
    { title: 7 },
  ])("bad input %j is invalid_input with no RPC call", async (over) => {
    expect(await createRaffleAction({ ...input, ...over } as never)).toMatchObject({ ok: false, code: "invalid_input" });
    expect(serverRpc).not.toHaveBeenCalled();
  });
  it("passes SQL refusals through with their copy", async () => {
    serverReplies.create_raffle = { error: { message: "weighted_raffles_disabled" } };
    expect(await createRaffleAction({ ...input, mode: "weighted" })).toEqual({
      ok: false, code: "weighted_raffles_disabled", error: "Los sorteos ponderados no están activados en esta red.",
    });
  });
});

describe("cancel / enter / leave / switch", () => {
  it("cancelRaffleAction calls cancel_raffle with the reason", async () => {
    expect(await cancelRaffleAction(ID, "Error en el premio")).toEqual({ ok: true });
    expect(serverCalls("cancel_raffle")).toEqual([{ p_raffle: ID, p_reason: "Error en el premio" }]);
    revalidated(ID);
    serverReplies.cancel_raffle = { error: { message: "raffle_drawn" } };
    expect(await cancelRaffleAction(ID, "x")).toMatchObject({ ok: false, code: "raffle_drawn" });
    expect(await cancelRaffleAction("bad", "x")).toMatchObject({ ok: false, code: "invalid_input" });
  });
  it("enterRaffleAction / leaveRaffleAction call their RPCs", async () => {
    expect(await enterRaffleAction(ID)).toEqual({ ok: true });
    expect(await leaveRaffleAction(ID)).toEqual({ ok: true });
    expect(serverCalls("enter_raffle")).toEqual([{ p_raffle: ID }]);
    expect(serverCalls("leave_raffle")).toEqual([{ p_raffle: ID }]);
    revalidated(ID);
    serverReplies.enter_raffle = { error: { message: "raffle_closed" } };
    expect(await enterRaffleAction(ID)).toEqual({ ok: false, code: "raffle_closed", error: "El sorteo ya está cerrado." });
    expect(await leaveRaffleAction("bad")).toMatchObject({ ok: false, code: "invalid_input" });
  });
  it("setWeightedRafflesEnabledAction calls the switch for a known chain only", async () => {
    expect(await setWeightedRafflesEnabledAction(59144, true)).toEqual({ ok: true });
    expect(serverCalls("set_weighted_raffles_enabled")).toEqual([{ p_chain: 59144, p_enabled: true }]);
    revalidated();
    expect(await setWeightedRafflesEnabledAction(1, true)).toMatchObject({ ok: false, code: "invalid_input" });
    expect(await setWeightedRafflesEnabledAction(59141, "yes" as never)).toMatchObject({ ok: false, code: "invalid_input" });
    serverReplies.set_weighted_raffles_enabled = { error: { message: "forbidden" } };
    expect(await setWeightedRafflesEnabledAction(59141, false)).toMatchObject({ ok: false, code: "forbidden" });
  });
});
