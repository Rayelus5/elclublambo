import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const hit = vi.hoisted(() => vi.fn());
vi.mock("@/lib/rate-limit", () => ({ hitRateLimit: hit }));

const session = vi.hoisted(() => vi.fn());
vi.mock("@/lib/auth/public-session", () => ({ getPublicSession: session }));

const verifyTransfer = vi.hoisted(() => vi.fn());
vi.mock("@/lib/payments/verify", () => ({ verifyTransfer }));
const verifyClubSafe = vi.hoisted(() => vi.fn());
vi.mock("@/lib/economy/club-safe", () => ({ verifyClubSafe }));
const readEthUsd = vi.hoisted(() => vi.fn());
vi.mock("@/lib/economy/eth-price", async (orig) => ({ ...(await orig<object>()), readEthUsd }));

const userRpc = vi.fn();
vi.mock("@/lib/supabase/server", () => ({ createServerClient: async () => ({ rpc: userRpc }) }));

const adminRpc = vi.fn();
let intentRow: Record<string, unknown> | null;
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    rpc: adminRpc,
    from: () => {
      const b: Record<string, unknown> = {};
      b.select = () => b;
      b.eq = () => b;
      b.maybeSingle = async () => ({ data: intentRow, error: null });
      return b;
    },
  }),
}));

import { attachPublicDonationTxAction, createPublicDonationIntentAction, verifyPublicDonationAction } from "@/lib/donations/public-actions";

const ID = "11111111-1111-4111-8111-111111111111";
const HASH = `0x${"ab".repeat(32)}`;
const DONOR = "0x00000000000000000000000000000000000000d1";
const SAFE = "0x00000000000000000000000000000000000000a5";

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("NEXT_PUBLIC_NETWORK_SET", "testnet");
  hit.mockResolvedValue("ok");
  session.mockResolvedValue({ userId: "u1", wallet: DONOR, isMember: false });
  intentRow = {
    id: ID, user_id: "u1", donor_address: DONOR, chain_id: 84532, token: "USDC", amount: "5000000", recipient_address: SAFE,
    status: "pending", fail_reason: null, main_tx_hash: HASH, created_at: "2026-10-25T10:00:00Z",
  };
  verifyTransfer.mockResolvedValue({ status: "ok", logIndex: 3, blockNumber: 77n, blockTimestamp: new Date() });
  verifyClubSafe.mockResolvedValue("ok");
  readEthUsd.mockResolvedValue({ priceE8: 250000000000n });
  adminRpc.mockResolvedValue({ data: { status: "confirmed", donationId: "d1" }, error: null });
  userRpc.mockResolvedValue({ data: null, error: null });
});
afterEach(() => vi.unstubAllEnvs());

describe("verifyPublicDonationAction", () => {
  it("confirms, pinning the transfer to the donor wallet, the Safe and the exact amount", async () => {
    expect(await verifyPublicDonationAction(ID)).toEqual({ status: "confirmed" });
    expect(verifyTransfer).toHaveBeenCalledWith(
      expect.objectContaining({ chain: 84532, token: "USDC", from: DONOR, to: SAFE, amount: 5000000n, txHash: HASH, notBefore: new Date("2026-10-25T10:00:00Z") }),
    );
    expect(adminRpc).toHaveBeenCalledWith("confirm_public_donation", expect.objectContaining({ p_intent: ID, p_usd6: "5000000", p_eth_price_e8: null }));
  });

  it("a tx_mismatch fails the intent for good", async () => {
    verifyTransfer.mockResolvedValue({ status: "error", code: "tx_mismatch" });
    expect(await verifyPublicDonationAction(ID)).toMatchObject({ status: "failed", code: "tx_mismatch" });
    expect(adminRpc).toHaveBeenCalledWith("fail_public_donation", { p_intent: ID, p_reason: "tx_mismatch" });
  });

  it("an ETH donation with no trusted price stays pending/price_unavailable", async () => {
    intentRow!.token = "ETH";
    intentRow!.amount = "1000000000000000";
    readEthUsd.mockResolvedValue(null);
    expect(await verifyPublicDonationAction(ID)).toEqual({ status: "pending", reason: "price_unavailable" });
    expect(adminRpc).not.toHaveBeenCalled();
  });

  it("an undeployed Safe stays pending/safe_not_deployed", async () => {
    verifyClubSafe.mockResolvedValue("not_deployed");
    expect(await verifyPublicDonationAction(ID)).toEqual({ status: "pending", reason: "safe_not_deployed" });
    expect(adminRpc).not.toHaveBeenCalled();
  });

  it("another user's intent is not_found and never touches the chain", async () => {
    session.mockResolvedValue({ userId: "u2", wallet: DONOR, isMember: false });
    expect(await verifyPublicDonationAction(ID)).toMatchObject({ status: "failed", code: "not_found" });
    expect(verifyTransfer).not.toHaveBeenCalled();
  });

  it("without a session it is pending, never a definitive failure (the stored hash must survive a lost session)", async () => {
    session.mockResolvedValue(null);
    expect(await verifyPublicDonationAction(ID)).toEqual({ status: "pending", reason: "not_authenticated" });
    expect(verifyTransfer).not.toHaveBeenCalled();
    expect(adminRpc).not.toHaveBeenCalled();
  });

  it("a rate-limited caller waits (pending) without reading the chain", async () => {
    hit.mockResolvedValue("rate_limited");
    expect(await verifyPublicDonationAction(ID)).toEqual({ status: "pending" });
    expect(verifyTransfer).not.toHaveBeenCalled();
  });

  it("a transient chain error stays pending", async () => {
    verifyTransfer.mockResolvedValue({ status: "pending" });
    expect(await verifyPublicDonationAction(ID)).toEqual({ status: "pending" });
  });

  it("rejects a malformed id", async () => {
    expect(await verifyPublicDonationAction("nope")).toMatchObject({ status: "failed", code: "invalid_input" });
  });
});

describe("createPublicDonationIntentAction", () => {
  const valid = { chainId: 84532, token: "USDC" as const, amount: "5", anonymous: false, listed: true };
  it("checks the Safe, converts the amount and calls the RPC", async () => {
    const intent = { id: ID, chainId: 84532, token: "USDC", amount: "5000000", feeAmount: "0", recipientAddress: SAFE, platformAddress: null, expiresAt: "x" };
    userRpc.mockResolvedValue({ data: intent, error: null });
    expect(await createPublicDonationIntentAction(valid)).toEqual({ ok: true, intent });
    expect(userRpc).toHaveBeenCalledWith("create_public_donation_intent", { p_chain_id: 84532, p_token: "USDC", p_amount: "5000000", p_anonymous: false, p_listed: true });
  });
  it("without a session it is not_authenticated before any Safe read", async () => {
    session.mockResolvedValue(null);
    expect(await createPublicDonationIntentAction(valid)).toMatchObject({ ok: false, code: "not_authenticated" });
    expect(verifyClubSafe).not.toHaveBeenCalled();
    expect(userRpc).not.toHaveBeenCalled();
  });
  it("an undeployed Safe never reaches the RPC", async () => {
    verifyClubSafe.mockResolvedValue("not_deployed");
    expect(await createPublicDonationIntentAction(valid)).toMatchObject({ ok: false, code: "safe_not_deployed" });
    expect(userRpc).not.toHaveBeenCalled();
  });
  it("rejects bad input and chains outside the build", async () => {
    expect(await createPublicDonationIntentAction({ ...valid, amount: "0" })).toMatchObject({ code: "invalid_input" });
    expect(await createPublicDonationIntentAction({ ...valid, listed: "x" as never })).toMatchObject({ code: "invalid_input" });
    expect(await createPublicDonationIntentAction({ ...valid, chainId: 8453 })).toMatchObject({ code: "chain_invalid" });
    expect(userRpc).not.toHaveBeenCalled();
  });
  it("maps RPC errors", async () => {
    userRpc.mockResolvedValue({ data: null, error: { message: "use_club_donation" } });
    expect(await createPublicDonationIntentAction(valid)).toMatchObject({ ok: false, code: "use_club_donation" });
  });
});

describe("attachPublicDonationTxAction", () => {
  it("lowercases the hash and calls the RPC", async () => {
    expect(await attachPublicDonationTxAction(ID, HASH.toUpperCase().replace("0X", "0x"))).toEqual({ ok: true });
    expect(userRpc).toHaveBeenCalledWith("attach_public_donation_tx", { p_intent: ID, p_hash: HASH });
  });
  it("without a session it is not_authenticated (retryable once signed in again) and never calls the RPC", async () => {
    session.mockResolvedValue(null);
    expect(await attachPublicDonationTxAction(ID, HASH)).toMatchObject({ ok: false, code: "not_authenticated" });
    expect(userRpc).not.toHaveBeenCalled();
  });
  it("rejects malformed input", async () => {
    expect(await attachPublicDonationTxAction("x", HASH)).toMatchObject({ ok: false, code: "invalid_input" });
    expect(await attachPublicDonationTxAction(ID, "0x12")).toMatchObject({ ok: false, code: "invalid_input" });
  });
});
