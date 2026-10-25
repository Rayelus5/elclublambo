// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const revalidatePath = vi.hoisted(() => vi.fn());
vi.mock("next/cache", () => ({ revalidatePath }));
const headersFn = vi.hoisted(() => vi.fn(async () => new Headers({ "x-forwarded-for": "203.0.113.7" })));
vi.mock("next/headers", () => ({ headers: headersFn }));

const getPublicSession = vi.hoisted(() => vi.fn());
vi.mock("@/lib/auth/public-session", () => ({ getPublicSession }));
const hitRateLimit = vi.hoisted(() => vi.fn());
vi.mock("@/lib/rate-limit", () => ({ hitRateLimit }));
const hitIpRateLimit = vi.hoisted(() => vi.fn());
vi.mock("@/lib/rate-limit/ip", () => ({ hitIpRateLimit }));
const verifyVouchTx = vi.hoisted(() => vi.fn());
const readAttestation = vi.hoisted(() => vi.fn());
vi.mock("@/lib/vouches/verify", () => ({ verifyVouchTx, readAttestation }));

type Res = { data: unknown; error: { message: string; code?: string } | null };
const adminRpc = vi.hoisted(() => vi.fn());
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ rpc: adminRpc }) }));
const userClient = vi.hoisted(() => ({ rpc: vi.fn(), tag: "jwt" }));
vi.mock("@/lib/supabase/server", () => ({ createServerClient: async () => userClient }));

import { recordRevocationAction, recordVouchAction, refreshVouchAction } from "@/lib/vouches/actions";

const WALLET = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
const RECIPIENT = "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC";
const OTHER = "0x90f79bf6eb2c4f870365e785982e1f101e93b906";
const UID = `0x${"ab".repeat(32)}`;
const HASH = `0x${"CD".repeat(32)}`;
const TIME = new Date("2026-10-25T10:00:00.000Z");
const REVOKED = new Date("2026-10-25T12:00:00.000Z");

const ok = (data: unknown = null): Res => ({ data, error: null });
const attestation = (over: Record<string, unknown> = {}) => ({
  uid: UID,
  schema: `0x${"b3".repeat(32)}`,
  attester: WALLET,
  recipient: RECIPIENT,
  kind: 2,
  time: TIME,
  revokedAt: null,
  revocable: true,
  ...over,
});

/** adminRpc answers per RPC name. */
const answers = new Map<string, Res>();

beforeEach(() => {
  vi.clearAllMocks();
  answers.clear();
  vi.stubEnv("NEXT_PUBLIC_NETWORK_SET", "testnet");
  getPublicSession.mockResolvedValue({ userId: "u1", wallet: WALLET, isMember: false });
  hitRateLimit.mockResolvedValue("ok");
  hitIpRateLimit.mockResolvedValue("ok");
  verifyVouchTx.mockResolvedValue({ status: "ok", attestation: attestation() });
  readAttestation.mockResolvedValue(attestation());
  answers.set("record_vouch", ok({ already: false, uid: UID }));
  answers.set("vouch_attester", ok(WALLET.toLowerCase()));
  answers.set("apply_vouch_state", ok("revoked"));
  adminRpc.mockImplementation(async (fn: string) => answers.get(fn) ?? ok());
});

const called = (fn: string) => adminRpc.mock.calls.filter((c) => c[0] === fn);

describe("recordVouchAction", () => {
  it("not_authenticated without a session", async () => {
    getPublicSession.mockResolvedValue(null);
    expect(await recordVouchAction({ chainId: 84532, txHash: HASH })).toEqual({ ok: false, error: "not_authenticated" });
    expect(verifyVouchTx).not.toHaveBeenCalled();
  });

  it("chain_unsupported for Arbitrum (and for the other Base of the set)", async () => {
    expect(await recordVouchAction({ chainId: 42161, txHash: HASH })).toEqual({ ok: false, error: "chain_unsupported" });
    expect(await recordVouchAction({ chainId: 8453, txHash: HASH })).toEqual({ ok: false, error: "chain_unsupported" });
    expect(hitRateLimit).not.toHaveBeenCalled();
  });

  it("invalid_input for a malformed hash, without charging the limiter", async () => {
    for (const txHash of ["0x1234", "nothex", `0x${"zz".repeat(32)}`, 42 as unknown as string]) {
      expect(await recordVouchAction({ chainId: 84532, txHash })).toEqual({ ok: false, error: "invalid_input" });
    }
    expect(await recordVouchAction(null as unknown as { chainId: number; txHash: string })).toEqual({ ok: false, error: "invalid_input" });
    expect(hitRateLimit).not.toHaveBeenCalled();
  });

  it("charges vouch_write with the user's JWT client; rate_limited stops before the chain", async () => {
    hitRateLimit.mockResolvedValue("rate_limited");
    expect(await recordVouchAction({ chainId: 84532, txHash: HASH })).toEqual({ ok: false, error: "rate_limited" });
    expect(hitRateLimit).toHaveBeenCalledWith(userClient, "vouch_write");
    expect(verifyVouchTx).not.toHaveBeenCalled();
    hitRateLimit.mockResolvedValue("error");
    expect(await recordVouchAction({ chainId: 84532, txHash: HASH })).toEqual({ ok: false, error: "unknown" });
    expect(verifyVouchTx).not.toHaveBeenCalled();
  });

  it("propagates pending and verification codes without writing", async () => {
    verifyVouchTx.mockResolvedValue({ status: "pending" });
    expect(await recordVouchAction({ chainId: 84532, txHash: HASH })).toEqual({ ok: false, error: "pending" });
    for (const code of ["tx_not_found", "tx_failed", "not_a_vouch", "wrong_attester", "rpc_unavailable"]) {
      verifyVouchTx.mockResolvedValue({ status: "error", code });
      expect(await recordVouchAction({ chainId: 84532, txHash: HASH })).toEqual({ ok: false, error: code });
    }
    expect(adminRpc).not.toHaveBeenCalled();
  });

  it("verifies an attest signed by the session wallet, with the lower-cased hash", async () => {
    await recordVouchAction({ chainId: 84532, txHash: HASH });
    expect(verifyVouchTx).toHaveBeenCalledWith({ chain: 84532, txHash: HASH.toLowerCase(), expect: "attest", attester: WALLET });
  });

  it("self_vouch when the attestation's recipient is the session, without writing", async () => {
    verifyVouchTx.mockResolvedValue({ status: "ok", attestation: attestation({ recipient: WALLET.toLowerCase() }) });
    expect(await recordVouchAction({ chainId: 84532, txHash: HASH })).toEqual({ ok: false, error: "self_vouch" });
    expect(adminRpc).not.toHaveBeenCalled();
  });

  it("not_a_vouch when the data is not one uint8 (kind null), without writing", async () => {
    verifyVouchTx.mockResolvedValue({ status: "ok", attestation: attestation({ kind: null }) });
    expect(await recordVouchAction({ chainId: 84532, txHash: HASH })).toEqual({ ok: false, error: "not_a_vouch" });
    expect(adminRpc).not.toHaveBeenCalled();
  });

  it("records kind, recipient and times read from the chain, never from the client", async () => {
    const input = { chainId: 84532, txHash: HASH, kind: 1, recipient: OTHER } as unknown as { chainId: number; txHash: string };
    expect(await recordVouchAction(input)).toEqual({ ok: true, uid: UID, already: false });
    expect(called("record_vouch")[0]![1]).toEqual({
      p_chain_id: 84532,
      p_uid: UID,
      p_attester: WALLET,
      p_recipient: RECIPIENT,
      p_kind: 2,
      p_tx_hash: HASH.toLowerCase(),
      p_attested_at: TIME.toISOString(),
      p_revoked_at: null,
    });
    expect(revalidatePath).toHaveBeenCalledWith("/es/tools/vouches");
    expect(revalidatePath).toHaveBeenCalledWith("/en/tools/vouches");
    expect(revalidatePath).toHaveBeenCalledWith("/[lang]/pay/[target]", "page");
  });

  it("an attestation already revoked on chain is stored with its revocation time", async () => {
    verifyVouchTx.mockResolvedValue({ status: "ok", attestation: attestation({ revokedAt: REVOKED }) });
    await recordVouchAction({ chainId: 84532, txHash: HASH });
    expect(called("record_vouch")[0]![1]).toMatchObject({ p_revoked_at: REVOKED.toISOString() });
  });

  it("Review Focus 4: the same hash again answers ok with already: true", async () => {
    answers.set("record_vouch", ok({ already: true, uid: UID }));
    expect(await recordVouchAction({ chainId: 84532, txHash: HASH })).toEqual({ ok: true, uid: UID, already: true });
  });

  it("maps the SQL codes and hides anything else as unknown", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    answers.set("record_vouch", { data: null, error: { message: "self_vouch" } });
    expect(await recordVouchAction({ chainId: 84532, txHash: HASH })).toEqual({ ok: false, error: "self_vouch" });
    answers.set("record_vouch", { data: null, error: { message: "invalid_input" } });
    expect(await recordVouchAction({ chainId: 84532, txHash: HASH })).toEqual({ ok: false, error: "invalid_input" });
    answers.set("record_vouch", { data: null, error: { message: "connection reset" } });
    expect(await recordVouchAction({ chainId: 84532, txHash: HASH })).toEqual({ ok: false, error: "unknown" });
    answers.set("record_vouch", ok("garbage"));
    expect(await recordVouchAction({ chainId: 84532, txHash: HASH })).toEqual({ ok: false, error: "unknown" });
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});

describe("recordRevocationAction", () => {
  beforeEach(() => {
    verifyVouchTx.mockResolvedValue({ status: "ok", attestation: attestation({ revokedAt: REVOKED }) });
  });

  it("verifies a revoke and marks the stored row revoked at the chain's time", async () => {
    expect(await recordRevocationAction({ chainId: 84532, txHash: HASH })).toEqual({ ok: true, uid: UID });
    expect(verifyVouchTx).toHaveBeenCalledWith({ chain: 84532, txHash: HASH.toLowerCase(), expect: "revoke", attester: WALLET });
    expect(hitRateLimit).toHaveBeenCalledWith(userClient, "vouch_write");
    expect(called("vouch_attester")[0]![1]).toEqual({ p_uid: UID });
    expect(called("apply_vouch_state")[0]![1]).toEqual({ p_uid: UID, p_state: "revoked", p_revoked_at: REVOKED.toISOString() });
    expect(revalidatePath).toHaveBeenCalledWith("/es/tools/vouches");
  });

  it("not_authenticated, invalid_input and chain_unsupported as for recording", async () => {
    expect(await recordRevocationAction({ chainId: 84532, txHash: "0x12" })).toEqual({ ok: false, error: "invalid_input" });
    expect(await recordRevocationAction({ chainId: 421614, txHash: HASH })).toEqual({ ok: false, error: "chain_unsupported" });
    getPublicSession.mockResolvedValue(null);
    expect(await recordRevocationAction({ chainId: 84532, txHash: HASH })).toEqual({ ok: false, error: "not_authenticated" });
    expect(adminRpc).not.toHaveBeenCalled();
  });

  it("rate_limited stops before the chain; verification codes pass through without writing", async () => {
    hitRateLimit.mockResolvedValue("rate_limited");
    expect(await recordRevocationAction({ chainId: 84532, txHash: HASH })).toEqual({ ok: false, error: "rate_limited" });
    expect(verifyVouchTx).not.toHaveBeenCalled();
    hitRateLimit.mockResolvedValue("ok");
    verifyVouchTx.mockResolvedValue({ status: "pending" });
    expect(await recordRevocationAction({ chainId: 84532, txHash: HASH })).toEqual({ ok: false, error: "pending" });
    verifyVouchTx.mockResolvedValue({ status: "error", code: "wrong_attester" });
    expect(await recordRevocationAction({ chainId: 84532, txHash: HASH })).toEqual({ ok: false, error: "wrong_attester" });
    expect(adminRpc).not.toHaveBeenCalled();
  });

  it("wrong_attester when the stored row belongs to another attester", async () => {
    answers.set("vouch_attester", ok(OTHER));
    expect(await recordRevocationAction({ chainId: 84532, txHash: HASH })).toEqual({ ok: false, error: "wrong_attester" });
    expect(called("apply_vouch_state")).toHaveLength(0);
  });

  it("not_found when the uid has no row", async () => {
    answers.set("vouch_attester", ok(null));
    expect(await recordRevocationAction({ chainId: 84532, txHash: HASH })).toEqual({ ok: false, error: "not_found" });
    expect(called("apply_vouch_state")).toHaveLength(0);
  });

  it("not_found when the row disappears before the update; unknown on read errors", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    answers.set("apply_vouch_state", ok("not_found"));
    expect(await recordRevocationAction({ chainId: 84532, txHash: HASH })).toEqual({ ok: false, error: "not_found" });
    answers.set("vouch_attester", { data: null, error: { message: "db down" } });
    expect(await recordRevocationAction({ chainId: 84532, txHash: HASH })).toEqual({ ok: false, error: "unknown" });
  });
});

describe("refreshVouchAction (Review Focus 3)", () => {
  it("revoked when the chain has a revocation time", async () => {
    readAttestation.mockResolvedValue(attestation({ revokedAt: REVOKED }));
    expect(await refreshVouchAction(UID)).toEqual({ ok: true, state: "revoked" });
    expect(readAttestation).toHaveBeenCalledWith(84532, UID);
    expect(called("apply_vouch_state")[0]![1]).toEqual({ p_uid: UID, p_state: "revoked", p_revoked_at: REVOKED.toISOString() });
    expect(revalidatePath).toHaveBeenCalledWith("/[lang]/pay/[target]", "page");
  });

  it("removed when the chain no longer knows the uid", async () => {
    readAttestation.mockResolvedValue(null);
    answers.set("apply_vouch_state", ok("removed"));
    expect(await refreshVouchAction(UID)).toEqual({ ok: true, state: "removed" });
    expect(called("apply_vouch_state")[0]![1]).toEqual({ p_uid: UID, p_state: "removed", p_revoked_at: null });
  });

  it("active leaves the row as it is and does not revalidate", async () => {
    answers.set("apply_vouch_state", ok("active"));
    expect(await refreshVouchAction(UID)).toEqual({ ok: true, state: "active" });
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("not_found without a row, before reading the chain", async () => {
    answers.set("vouch_attester", ok(null));
    expect(await refreshVouchAction(UID)).toEqual({ ok: false, error: "not_found" });
    expect(readAttestation).not.toHaveBeenCalled();
  });

  it("rate_limited by IP (vouch_refresh); a limiter error lets it through", async () => {
    hitIpRateLimit.mockResolvedValue("rate_limited");
    expect(await refreshVouchAction(UID)).toEqual({ ok: false, error: "rate_limited" });
    expect(hitIpRateLimit).toHaveBeenCalledWith("vouch_refresh", expect.any(Headers));
    expect(adminRpc).not.toHaveBeenCalled();
    hitIpRateLimit.mockResolvedValue("error");
    answers.set("apply_vouch_state", ok("active"));
    expect(await refreshVouchAction(UID)).toEqual({ ok: true, state: "active" });
  });

  it("needs no session", async () => {
    getPublicSession.mockResolvedValue(null);
    answers.set("apply_vouch_state", ok("active"));
    expect(await refreshVouchAction(UID)).toEqual({ ok: true, state: "active" });
    expect(getPublicSession).not.toHaveBeenCalled();
  });

  it("invalid_input for a malformed uid, before the limiter", async () => {
    for (const uid of ["0x12", "", `0x${"gg".repeat(32)}`, 7 as unknown as string]) {
      expect(await refreshVouchAction(uid)).toEqual({ ok: false, error: "invalid_input" });
    }
    expect(hitIpRateLimit).not.toHaveBeenCalled();
  });

  it("rpc_unavailable when the chain read throws, without writing", async () => {
    readAttestation.mockRejectedValue(new Error("rpc down"));
    expect(await refreshVouchAction(UID)).toEqual({ ok: false, error: "rpc_unavailable" });
    expect(called("apply_vouch_state")).toHaveLength(0);
  });

  it("not_found if the row vanished meanwhile; unknown on database errors", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    answers.set("apply_vouch_state", ok("not_found"));
    expect(await refreshVouchAction(UID)).toEqual({ ok: false, error: "not_found" });
    answers.set("apply_vouch_state", { data: null, error: { message: "db down" } });
    expect(await refreshVouchAction(UID)).toEqual({ ok: false, error: "unknown" });
  });

  it("accepts an upper-case uid and sends it lower-cased", async () => {
    answers.set("apply_vouch_state", ok("active"));
    await refreshVouchAction(UID.toUpperCase().replace("0X", "0x"));
    expect(called("vouch_attester")[0]![1]).toEqual({ p_uid: UID });
  });
});
